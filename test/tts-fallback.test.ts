import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AzureTtsProvider } from '../src/providers/tts/azure.js'
import { SystemTtsProvider } from '../src/providers/tts/system.js'
import { speak } from '../src/providers/tts/registry.js'
import { TtsError, type SynthResult } from '../src/providers/tts/types.js'
import type { AppConfig } from '../src/shared/types.js'

const speechConfig = (): AppConfig => ({
  hotkeys: { explain: '', refine: '' }, doubleClickTranscripts: true,
  unverifiedPronunciations: false, launchAtLogin: false,
  llm: { provider: 'ollama', models: {}, baseUrls: {}, codeModel: '', videoModel: '' },
  tts: { provider: 'online', systemVoice: 'Zira', azureRegion: 'eastus', azureVoice: 'en-US-AvaMultilingualNeural', slowRate: -40, autoPlay: false }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const mp3 = { data: Buffer.from('online audio'), mime: 'audio/mpeg' }
const wav = { data: Buffer.from('offline audio'), mime: 'audio/wav' }

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('speech fallback latency and cancellation', () => {
  it('never starts offline synthesis when Azure responds promptly', async () => {
    vi.spyOn(AzureTtsProvider.prototype, 'synth').mockResolvedValue(mp3)
    const offline = vi.spyOn(SystemTtsProvider.prototype, 'synth').mockResolvedValue(wav)
    expect(await speak(speechConfig(), 'hello', 0, 'key')).toMatchObject({ usedProvider: 'online' })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(offline).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts fallback at two seconds and cancels stalled Azure after offline succeeds', async () => {
    const stalled = deferred<SynthResult>()
    const online = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockReturnValue(stalled.promise)
    const offline = vi.spyOn(SystemTtsProvider.prototype, 'synth').mockResolvedValue(wav)
    const result = speak(speechConfig(), 'hello', -40, 'key')
    await vi.advanceTimersByTimeAsync(1999)
    expect(offline).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toMatchObject({ usedProvider: 'system', fallbackReason: 'The online voice took too long.' })
    expect(offline).toHaveBeenCalledWith('hello', -40, expect.any(AbortSignal))
    expect(online.mock.calls[0][2]?.aborted).toBe(true)
    // A late failure from the losing request must be handled, not an unhandled rejection.
    stalled.reject(new Error('late network failure'))
    await vi.advanceTimersByTimeAsync(0)
  })

  it('keeps Azure eligible while Windows starts, and cancels the losing process', async () => {
    const azure = deferred<SynthResult>()
    vi.spyOn(AzureTtsProvider.prototype, 'synth').mockReturnValue(azure.promise)
    const offline = vi.spyOn(SystemTtsProvider.prototype, 'synth').mockReturnValue(new Promise(() => {}))
    const result = speak(speechConfig(), 'hello', 0, 'key')
    await vi.advanceTimersByTimeAsync(2000)
    azure.resolve(mp3)
    expect(await result).toMatchObject({ usedProvider: 'online', data: mp3.data })
    expect(offline.mock.calls[0][2]?.aborted).toBe(true)
  })

  it('still plays Azure if offline synthesis fails first', async () => {
    const azure = deferred<SynthResult>()
    vi.spyOn(AzureTtsProvider.prototype, 'synth').mockReturnValue(azure.promise)
    vi.spyOn(SystemTtsProvider.prototype, 'synth').mockRejectedValue(new Error('no offline voice'))
    const result = speak(speechConfig(), 'hello', 0, 'key')
    await vi.advanceTimersByTimeAsync(2500)
    azure.resolve(mp3)
    expect(await result).toMatchObject({ usedProvider: 'online' })
  })

  it('falls back immediately on a service error and preserves the reason', async () => {
    vi.spyOn(AzureTtsProvider.prototype, 'synth').mockRejectedValue(new TtsError('unavailable', 'Rate limited.'))
    const offline = vi.spyOn(SystemTtsProvider.prototype, 'synth').mockResolvedValue(wav)
    expect(await speak(speechConfig(), 'hello', 0, 'key')).toMatchObject({ usedProvider: 'system', fallbackReason: 'Rate limited.' })
    expect(offline).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports the offline error if both engines fail', async () => {
    vi.spyOn(AzureTtsProvider.prototype, 'synth').mockRejectedValue(new Error('network'))
    vi.spyOn(SystemTtsProvider.prototype, 'synth').mockRejectedValue(new TtsError('Windows voice failed'))
    await expect(speak(speechConfig(), 'hello', 0, 'key')).rejects.toThrow('Windows voice failed')
  })

  it('uses the offline voice directly when selected or Azure lacks a key', async () => {
    const online = vi.spyOn(AzureTtsProvider.prototype, 'synth')
    const offline = vi.spyOn(SystemTtsProvider.prototype, 'synth').mockResolvedValue(wav)
    const config = speechConfig()
    expect(await speak(config, 'hello', 0, null)).toMatchObject({ usedProvider: 'system', fallbackReason: expect.any(String) })
    config.tts.provider = 'system'
    expect(await speak(config, 'hello', -40, null)).toMatchObject({ usedProvider: 'system' })
    expect(offline).toHaveBeenCalledTimes(2)
    expect(online).not.toHaveBeenCalled()
  })

  it('cancels speculative work without triggering offline synthesis', async () => {
    const online = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockReturnValue(new Promise(() => {}))
    const offline = vi.spyOn(SystemTtsProvider.prototype, 'synth')
    const controller = new AbortController()
    const result = speak(speechConfig(), 'hello', 0, 'key', { signal: controller.signal })
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    await vi.advanceTimersByTimeAsync(20_000)
    expect(offline).not.toHaveBeenCalled()
    expect(online.mock.calls[0][2]?.aborted).toBe(true)
    await expect(speak(speechConfig(), 'hello', 0, 'key', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(online).toHaveBeenCalledOnce()
  })
})
