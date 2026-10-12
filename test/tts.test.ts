/**
 * Exercises the real TTS path, including the fallback to the offline voice.
 * Skipped unless BENCH=1 (it spawns PowerShell and may hit the network).
 */
import { describe, it, expect, vi } from 'vitest'
import { speak } from '../src/providers/tts/registry.js'
import { AzureTtsProvider } from '../src/providers/tts/azure.js'
import { SystemTtsProvider } from '../src/providers/tts/system.js'
import type { AppConfig, TtsProviderId } from '../src/shared/types.js'

const RUN = process.env.BENCH === '1'
const TEXT = 'He is just grandstanding for the base.'

function cfg(provider: TtsProviderId): AppConfig {
  return {
    hotkeys: { explain: '', refine: '', summarize: '' },
    doubleClickTranscripts: true,
    unverifiedPronunciations: false,
    llm: { provider: 'ollama', models: {}, baseUrls: {}, codeModel: '', videoModel: '' },
    tts: {
      provider,
      systemVoice: 'Microsoft Zira',
      azureRegion: 'eastus',
      azureVoice: 'en-US-AvaMultilingualNeural',
      slowRate: -40,
      autoPlay: false
    },
    launchAtLogin: false
  }
}

describe.skipIf(!RUN)('tts', () => {
  it('a stalled online request yields real offline audio after the short fallback delay', async () => {
    const online = vi.spyOn(AzureTtsProvider.prototype, 'synth').mockImplementation((_text, _rate, signal) =>
      new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true })))
    try {
      const started = performance.now()
      const result = await speak(cfg('online'), 'pronunciation', 0, 'fixture-key')
      const elapsedMs = Math.round(performance.now() - started)
      console.log(`\n  stalled Azure -> real system voice: ${elapsedMs}ms, ${result.data.length} bytes`)
      expect(result.usedProvider).toBe('system')
      expect(result.data.length).toBeGreaterThan(1000)
      expect(elapsedMs).toBeLessThan(8000)
      expect(online.mock.calls[0][2]?.aborted).toBe(true)
    } finally { online.mockRestore() }
  }, 20_000)

  it('cancels a running offline synthesis promptly', async () => {
    const controller = new AbortController()
    const result = new SystemTtsProvider().synth(TEXT.repeat(100), 0, controller.signal)
    const timer = setTimeout(() => controller.abort(), 200)
    try {
      await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    } finally { clearTimeout(timer) }
  }, 8000)
  it('online without a key still yields audio via the offline fallback', async () => {
    // Misconfiguration must degrade the voice, never silence read-aloud entirely.
    const r = await speak(cfg('online'), TEXT, 0, null)
    console.log(`\n  online, no key -> "${r.usedProvider}": ${r.fallbackReason}`)
    expect(r.usedProvider).toBe('system')
    expect(r.data.length).toBeGreaterThan(1000)
  }, 60000)

  it('the offline voice works directly', async () => {
    const t0 = Date.now()
    const r = await speak(cfg('system'), TEXT, 0, null)
    console.log(`\n  system voice: ${r.data.length} bytes in ${Date.now() - t0}ms`)
    expect(r.usedProvider).toBe('system')
    expect(r.data.length).toBeGreaterThan(1000)
  }, 60000)

  it('the slow setting reaches the provider without error', async () => {
    const r = await speak(cfg('system'), TEXT, -40, null)
    expect(r.data.length).toBeGreaterThan(1000)
  }, 60000)
})
