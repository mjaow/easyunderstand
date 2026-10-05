/**
 * Exercises the real TTS path, including the fallback to the offline voice.
 * Skipped unless BENCH=1 (it spawns PowerShell and may hit the network).
 */
import { describe, it, expect } from 'vitest'
import { speak } from '../src/providers/tts/registry.js'
import type { AppConfig, TtsProviderId } from '../src/shared/types.js'

const RUN = process.env.BENCH === '1'
const TEXT = 'He is just grandstanding for the base.'

function cfg(provider: TtsProviderId): AppConfig {
  return {
    hotkeys: { explain: '', refine: '' },
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
