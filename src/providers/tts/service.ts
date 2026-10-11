import { cacheKey } from '../../core/cache.js'
import type { AppConfig, TtsProviderId } from '../../shared/types.js'
import { speak } from './registry.js'
import { SystemTtsProvider } from './system.js'
import type { SynthResult } from './types.js'

interface AudioStore {
  get(key: string, ext: string): Buffer | undefined
  set(key: string, ext: string, data: Buffer): void
}

export interface SpeechAudio {
  url: string
  usedProvider: string
  fallbackReason?: string
}

export interface SpeechTiming {
  source: 'prefetch' | 'play'
  provider: TtsProviderId
  characters: number
  rate: number
  cache: boolean
  shared: boolean
  elapsedMs: number
  usedProvider?: string
  fallbackReason?: string
  outcome: 'ready' | 'cancelled' | 'error'
}

interface PendingAudio {
  controller: AbortController
  demanded: boolean
  promise: Promise<SpeechAudio>
}

/** Bound speculative requests to ordinary English words and short phrases. */
export function canPrefetchPronunciation(text: string): boolean {
  return text.length <= 80 && /^[a-z]+(?:['’-][a-z]+)*(?:\s+[a-z]+(?:['’-][a-z]+)*){0,2}$/i.test(text.trim())
}

function audioKey(config: AppConfig, provider: TtsProviderId, rate: number, text: string): string {
  const voice = provider === 'online'
    ? `${config.tts.azureRegion}/${config.tts.azureVoice}`
    : config.tts.systemVoice
  // Retain existing good caches. Old WAV fallbacks under online keys are ignored.
  return cacheKey(provider, voice, String(rate), text)
}

function asAudio(result: SynthResult, usedProvider: string, fallbackReason?: string): SpeechAudio {
  return { url: `data:${result.mime};base64,${result.data.toString('base64')}`, usedProvider, fallbackReason }
}

/** Shared by speculative lookups and explicit play requests; never plays sound itself. */
export class SpeechService {
  private readonly pending = new Map<string, PendingAudio>()
  private prefetchTimer?: ReturnType<typeof setTimeout>
  private prefetched?: PendingAudio

  constructor(private readonly audio: AudioStore, private readonly log: (timing: SpeechTiming) => void = () => {}) {}

  prefetch(config: AppConfig, text: string, apiKey: string | null): void {
    this.cancelPrefetch()
    if (!canPrefetchPronunciation(text) || config.tts.provider !== 'online' ||
        !apiKey || !config.tts.azureRegion.trim() || !config.tts.azureVoice.trim()) return
    // Rapid selections should not create a burst of billed requests.
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = undefined
      void this.request(config, text, false, apiKey, false).catch(() => {})
    }, 150)
  }

  cancelPrefetch(): void {
    clearTimeout(this.prefetchTimer)
    this.prefetchTimer = undefined
    // Once the user clicks, that same work belongs to their play request.
    if (!this.prefetched?.demanded) this.prefetched?.controller.abort()
    this.prefetched = undefined
  }

  synthesize(config: AppConfig, text: string, slow: boolean, apiKey: string | null): Promise<SpeechAudio> {
    // A fast click can finish (including fallback) before the debounce expires.
    // Do not let that timer launch the same online request again afterward.
    clearTimeout(this.prefetchTimer)
    this.prefetchTimer = undefined
    return this.request(config, text, slow, apiKey, true)
  }

  private async request(config: AppConfig, text: string, slow: boolean, apiKey: string | null, demanded: boolean): Promise<SpeechAudio> {
    text = text.trim()
    if (!text) throw new Error('Nothing to read.')
    const start = performance.now()
    const provider = config.tts.provider
    const rate = slow ? config.tts.slowRate : 0
    const timing: SpeechTiming = {
      source: demanded ? 'play' : 'prefetch', provider, characters: text.length, rate,
      cache: false, shared: false, elapsedMs: 0, outcome: 'error'
    }
    try {
      const key = audioKey(config, provider, rate, text)
      const ext = provider === 'online' ? 'mp3' : 'wav'
      const hit = this.audio.get(key, ext)
      if (hit?.length) {
        timing.cache = true
        timing.outcome = 'ready'
        timing.usedProvider = provider
        return asAudio({ data: hit, mime: ext === 'mp3' ? 'audio/mpeg' : 'audio/wav' }, provider)
      }

      // In-memory identity includes credentials and the fallback voice. A settings
      // change must not join a request using an old key or a different system voice.
      const pendingKey = cacheKey(key, config.tts.systemVoice, apiKey ?? '')
      let entry = this.pending.get(pendingKey)
      if (entry && !entry.controller.signal.aborted) {
        timing.shared = true
        entry.demanded ||= demanded
      } else {
        const controller = new AbortController()
        const work: PendingAudio = {
          controller, demanded,
          promise: this.generate(config, text, rate, apiKey, controller.signal).finally(() => {
            if (this.pending.get(pendingKey) === work) this.pending.delete(pendingKey)
            if (this.prefetched === work) this.prefetched = undefined
          })
        }
        entry = work
        this.pending.set(pendingKey, work)
        if (!demanded) this.prefetched = work
      }
      const result = await entry.promise
      timing.usedProvider = result.usedProvider
      timing.fallbackReason = result.fallbackReason
      timing.outcome = 'ready'
      return result
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') timing.outcome = 'cancelled'
      throw error
    } finally {
      timing.elapsedMs = Math.round(performance.now() - start)
      // Timing diagnostics contain no selected text, keys or cache identifiers.
      try { this.log(timing) } catch { /* Diagnostics cannot break playback. */ }
    }
  }

  private async generate(config: AppConfig, text: string, rate: number, apiKey: string | null, signal: AbortSignal): Promise<SpeechAudio> {
    const systemKey = audioKey(config, 'system', rate, text)
    const result = await speak(config, text, rate, apiKey, {
      signal,
      fallback: async (abort) => {
        const cached = this.audio.get(systemKey, 'wav')
        if (cached?.length) return { data: cached, mime: 'audio/wav' }
        return new SystemTtsProvider(config.tts.systemVoice).synth(text, rate, abort)
      }
    })
    signal.throwIfAborted()
    const actual = result.usedProvider === 'online' ? 'online' : 'system'
    this.audio.set(audioKey(config, actual, rate, text), actual === 'online' ? 'mp3' : 'wav', result.data)
    return asAudio(result, result.usedProvider, result.fallbackReason)
  }
}
