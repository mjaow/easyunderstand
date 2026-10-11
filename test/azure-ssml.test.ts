import { describe, it, expect, vi } from 'vitest'
import { AzureTtsProvider } from '../src/providers/tts/azure.js'
import { TtsError } from '../src/providers/tts/types.js'

describe('AzureTtsProvider', () => {
  it('aborts a pending response body when the caller cancels and preserves cancellation', async () => {
    let requestSignal: AbortSignal | undefined
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async (_input, init) => {
      requestSignal = init?.signal as AbortSignal
      return {
        ok: true,
        arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
          requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true })
        })
      } as Response
    })
    try {
      const controller = new AbortController()
      const result = new AzureTtsProvider('key', 'eastus', 'Ava').synth('hello', 0, controller.signal)
      const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
      await Promise.resolve()
      controller.abort()
      await assertion
      expect(requestSignal?.aborted).toBe(true)
      await expect(new AzureTtsProvider('key', 'eastus', 'Ava').synth('hello', 0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
      expect(globalThis.fetch).toHaveBeenCalledOnce()
    } finally {
      globalThis.fetch = original
    }
  })
  it('refuses to construct without a key or region', () => {
    expect(() => new AzureTtsProvider(null, 'eastus', 'v')).toThrow(TtsError)
    expect(() => new AzureTtsProvider('k', '', 'v')).toThrow(TtsError)
  })

  it('escapes selected text so a page cannot inject SSML', async () => {
    // The selection comes from arbitrary web pages. Without escaping, text like
    // this would either break the XML or smuggle in its own markup.
    let sentBody = ''
    const original = globalThis.fetch
    globalThis.fetch = (async (_u: unknown, init: { body?: string }) => {
      sentBody = init.body ?? ''
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }
    }) as unknown as typeof fetch

    try {
      const p = new AzureTtsProvider('key', 'eastus', 'en-US-AvaMultilingualNeural')
      await p.synth(`Tom & Jerry <voice name='evil'>pwned</voice> "quoted"`, 0)
    } finally {
      globalThis.fetch = original
    }

    expect(sentBody).toContain('Tom &amp; Jerry')
    expect(sentBody).toContain('&lt;voice')
    // Exactly one real <voice> element — the injected one must not have survived.
    expect(sentBody.match(/<voice /g)).toHaveLength(1)
  })

  it('wraps text in a prosody element only when slowed', async () => {
    const bodies: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (_u: unknown, init: { body?: string }) => {
      bodies.push(init.body ?? '')
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }
    }) as unknown as typeof fetch

    try {
      const p = new AzureTtsProvider('key', 'eastus', 'v')
      await p.synth('hello', 0)
      await p.synth('hello', -40)
    } finally {
      globalThis.fetch = original
    }

    expect(bodies[0]).not.toContain('prosody')
    expect(bodies[1]).toContain("rate='-40%'")
  })
})
