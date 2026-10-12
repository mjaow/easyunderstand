import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheKey } from '../src/core/cache.js'
import { SpeechService, canPrefetchPronunciation, type SpeechTiming } from '../src/providers/tts/service.js'
import { AzureTtsProvider } from '../src/providers/tts/azure.js'
import { SystemTtsProvider } from '../src/providers/tts/system.js'
import type { AppConfig } from '../src/shared/types.js'
import type { SynthResult } from '../src/providers/tts/types.js'

const config = (): AppConfig => ({
  hotkeys: { explain: '', refine: '', summarize: '' }, doubleClickTranscripts: true,
  unverifiedPronunciations: false, launchAtLogin: false,
  llm: { provider: 'ollama', models: {}, baseUrls: {}, codeModel: '', videoModel: '' },
  tts: { provider: 'online', systemVoice: 'Zira', azureRegion: 'eastus', azureVoice: 'Ava', slowRate: -40, autoPlay: false }
})
const mp3 = { data: Buffer.from('azure'), mime: 'audio/mpeg' }
const wav = { data: Buffer.from('system'), mime: 'audio/wav' }
let stored: Map<string, Buffer>
let service: SpeechService
let timings: SpeechTiming[]

beforeEach(() => {
  vi.useFakeTimers()
  stored = new Map()
  timings = []
  service = new SpeechService({
    get: (key, ext) => stored.get(`${key}.${ext}`),
    set: (key, ext, data) => { stored.set(`${key}.${ext}`, data) }
  }, timing => timings.push(timing))
})
afterEach(() => { service.cancelPrefetch(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('pronunciation cache', () => {
  it('reuses existing Azure MP3s but ignores legacy fallback WAVs under the Azure key', async () => {
    const azure = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockResolvedValue(mp3)
    const key = cacheKey('online', 'eastus/Ava', '0', 'hello')
    stored.set(`${key}.wav`, wav.data)
    expect(await service.synthesize(config(), 'hello', false, 'key')).toMatchObject({ usedProvider: 'online' })
    expect(azure).toHaveBeenCalledOnce()
    expect(await service.synthesize(config(), ' hello ', false, 'key')).toMatchObject({ usedProvider: 'online' })
    expect(azure).toHaveBeenCalledOnce()
    expect(timings.at(-1)?.cache).toBe(true)
  })

  it('stores fallback under the system voice, retries Azure and reuses offline audio if needed', async () => {
    const azure = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockRejectedValue(new Error('offline'))
    const offline = vi.spyOn(SystemTtsProvider.prototype, 'synth').mockResolvedValue(wav)
    expect(await service.synthesize(config(), 'hello', false, 'key')).toMatchObject({ usedProvider: 'system', fallbackReason: expect.any(String) })
    expect(stored.has(`${cacheKey('system', 'Zira', '0', 'hello')}.wav`)).toBe(true)
    expect(stored.has(`${cacheKey('online', 'eastus/Ava', '0', 'hello')}.mp3`)).toBe(false)
    expect(await service.synthesize(config(), 'hello', false, 'key')).toMatchObject({ usedProvider: 'system', fallbackReason: expect.any(String) })
    expect(offline).toHaveBeenCalledOnce()
    expect(azure).toHaveBeenCalledTimes(2)
    azure.mockResolvedValue(mp3)
    expect(await service.synthesize(config(), 'hello', false, 'key')).toMatchObject({ usedProvider: 'online', fallbackReason: undefined })
    const systemConfig = config()
    systemConfig.tts.provider = 'system'
    expect(await service.synthesize(systemConfig, 'hello', false, null)).toMatchObject({ usedProvider: 'system', fallbackReason: undefined })
    expect(offline).toHaveBeenCalledOnce()
  })

  it('separates normal/slow playback, voices and regions', async () => {
    const azure = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockResolvedValue(mp3)
    const first = config()
    await service.synthesize(first, 'hello', false, 'key')
    await service.synthesize(first, 'hello', true, 'key')
    await service.synthesize({ ...first, tts: { ...first.tts, azureVoice: 'Jenny' } }, 'hello', false, 'key')
    await service.synthesize({ ...first, tts: { ...first.tts, azureRegion: 'westus' } }, 'hello', false, 'key')
    expect(azure).toHaveBeenCalledTimes(4)
    expect(azure.mock.calls.map(call => call[1])).toEqual([0, -40, 0, 0])
    expect(stored.size).toBe(4)
  })

  it('deduplicates concurrent requests and permits retry after a failure', async () => {
    let resolve!: (value: SynthResult) => void
    const azure = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockReturnValue(new Promise(yes => { resolve = yes }))
    const one = service.synthesize(config(), 'hello', false, 'key')
    const two = service.synthesize(config(), 'hello', false, 'key')
    resolve(mp3)
    expect(await one).toEqual(await two)
    expect(azure).toHaveBeenCalledOnce()
    azure.mockRejectedValue(new Error('network'))
    vi.spyOn(SystemTtsProvider.prototype, 'synth').mockRejectedValue(new Error('system'))
    await expect(service.synthesize(config(), 'new word', false, 'key')).rejects.toThrow('system')
    azure.mockResolvedValue(mp3)
    expect(await service.synthesize(config(), 'new word', false, 'key')).toMatchObject({ usedProvider: 'online' })
    expect(azure).toHaveBeenCalledTimes(3)
  })

  it('never joins pending requests with changed credentials or fallback voices', async () => {
    const complete: Array<(value: SynthResult) => void> = []
    const azure = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockImplementation(() => new Promise(resolve => complete.push(resolve)))
    const first = config()
    const requests = [
      service.synthesize(first, 'hello', false, 'old key'),
      service.synthesize(first, 'hello', false, 'new key'),
      service.synthesize({ ...first, tts: { ...first.tts, systemVoice: 'David' } }, 'hello', false, 'new key')
    ]
    expect(azure).toHaveBeenCalledTimes(3)
    complete.forEach(resolve => resolve(mp3))
    await Promise.all(requests)
    expect(JSON.stringify(timings)).not.toMatch(/old key|new key|hello/)
  })
})

describe('bounded pronunciation prefetch', () => {
  it('does not retry Azure when a fast click falls back before the prefetch timer fires', async () => {
    const azure = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockRejectedValue(new Error('network'))
    vi.spyOn(SystemTtsProvider.prototype, 'synth').mockResolvedValue(wav)
    service.prefetch(config(), 'hello', 'key')
    await service.synthesize(config(), 'hello', false, 'key')
    await vi.advanceTimersByTimeAsync(2000)
    expect(azure).toHaveBeenCalledOnce()
  })
  it.each(['hello', 'take off', "mother-in-law", "don't give up"] )('accepts short English selections: %s', text => {
    expect(canPrefetchPronunciation(text)).toBe(true)
  })
  it.each(['', '   ', 'one two three four', 'a'.repeat(81), '你好', 'alert(1)', 'x = 3', 'https://example.com'])('does not speculate for %s', text => {
    expect(canPrefetchPronunciation(text)).toBe(false)
  })

  it('debounces rapid selections, reuses completed prefetch and never needs a second request', async () => {
    const azure = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockResolvedValue(mp3)
    service.prefetch(config(), 'old', 'key')
    service.prefetch(config(), 'hello', 'key')
    await vi.advanceTimersByTimeAsync(150)
    expect(azure).toHaveBeenCalledOnce()
    expect(azure.mock.calls[0][0]).toBe('hello')
    await service.synthesize(config(), 'hello', false, 'key')
    expect(azure).toHaveBeenCalledOnce()
  })

  it('shares in-progress prefetch with a click and does not cancel adopted work', async () => {
    let resolve!: (value: SynthResult) => void
    const azure = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockReturnValue(new Promise(yes => { resolve = yes }))
    service.prefetch(config(), 'hello', 'key')
    await vi.advanceTimersByTimeAsync(150)
    const click = service.synthesize(config(), 'hello', false, 'key')
    service.cancelPrefetch()
    expect(azure.mock.calls[0][2]?.aborted).toBe(false)
    resolve(mp3)
    expect(await click).toMatchObject({ usedProvider: 'online' })
    expect(azure).toHaveBeenCalledOnce()
    expect(timings.find(timing => timing.source === 'play')?.shared).toBe(true)
  })

  it('cancels abandoned work without caching it or poisoning a subsequent request', async () => {
    let late!: (value: SynthResult) => void
    const azure = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockReturnValueOnce(new Promise(yes => { late = yes })).mockResolvedValue(mp3)
    const offline = vi.spyOn(SystemTtsProvider.prototype, 'synth').mockResolvedValue(wav)
    service.prefetch(config(), 'hello', 'key')
    await vi.advanceTimersByTimeAsync(150)
    service.cancelPrefetch()
    expect(azure.mock.calls[0][2]?.aborted).toBe(true)
    await service.synthesize(config(), 'hello', false, 'key')
    late({ data: Buffer.from('stale audio'), mime: 'audio/mpeg' })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(azure).toHaveBeenCalledTimes(2)
    expect(offline).not.toHaveBeenCalled()
    expect([...stored.values()]).toEqual([mp3.data])
  })

  it('does no speculative synthesis for offline settings, missing credentials or cancelled timers', async () => {
    const azure = vi.spyOn(AzureTtsProvider.prototype, 'synth')
    const offline = vi.spyOn(SystemTtsProvider.prototype, 'synth')
    service.prefetch(config(), 'hello', null)
    const system = config()
    system.tts.provider = 'system'
    service.prefetch(system, 'hello', 'key')
    await vi.advanceTimersByTimeAsync(2000)
    service.prefetch(config(), 'hello', 'key')
    service.cancelPrefetch()
    await vi.advanceTimersByTimeAsync(2000)
    expect(azure).not.toHaveBeenCalled()
    expect(offline).not.toHaveBeenCalled()
  })
})
