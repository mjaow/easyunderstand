import { describe, it, expect } from 'vitest'
import { probeProvider } from '../src/providers/llm/probe.js'
import type { AppConfig } from '../src/shared/types.js'

function cfg(baseUrl: string, model = 'nonexistent-model'): AppConfig {
  return {
    hotkeys: { explain: '', refine: '' },
    doubleClickTranscripts: true,
    unverifiedPronunciations: false,
    llm: {
      provider: 'ollama',
      models: { ollama: model },
      codeModel: '',
      videoModel: '',
      baseUrls: { ollama: baseUrl }
    },
    tts: {
      provider: 'system',
      systemVoice: '',
      azureRegion: 'eastus',
      azureVoice: 'v',
      slowRate: -40,
      autoPlay: false
    },
    launchAtLogin: false
  }
}

describe('probeProvider', () => {
  /**
   * The bug this pins: an earlier probe only listed models and checked the id was
   * present, so it reported success while every real lookup failed with 403. A
   * listing is a catalogue, not a statement of what the account may call — the probe
   * has to issue a real request.
   */
  it('reports failure when the endpoint cannot be reached', async () => {
    // Port 1 is never a model server.
    const r = await probeProvider(cfg('http://127.0.0.1:1'), null)
    expect(r.ok).toBe(false)
    expect(r.message).toBeTruthy()
  }, 30000)

  it('never claims success merely because a model id looks plausible', async () => {
    const r = await probeProvider(cfg('http://127.0.0.1:1', 'qwen3.7-flash'), null)
    expect(r.ok).toBe(false)
  }, 30000)

  it('surfaces a missing key rather than attempting a call', async () => {
    const c = cfg('https://example.invalid')
    c.llm.provider = 'claude'
    c.llm.models.claude = 'claude-haiku-4-5'
    c.llm.baseUrls.claude = 'https://api.anthropic.com'
    const r = await probeProvider(c, null)
    expect(r.ok).toBe(false)
    expect(r.message.toLowerCase()).toContain('key')
  }, 30000)
})
