import type { AppConfig } from '../../shared/types.js'
import { SystemTtsProvider } from './system.js'
import { AzureTtsProvider } from './azure.js'
import { TtsError, type SynthResult, type TtsProvider } from './types.js'

export function createTtsProvider(config: AppConfig, apiKey: string | null): TtsProvider {
  switch (config.tts.provider) {
    case 'online':
      return new AzureTtsProvider(apiKey, config.tts.azureRegion, config.tts.azureVoice)
    default:
      return new SystemTtsProvider(config.tts.systemVoice)
  }
}

export interface SpeakOutcome extends SynthResult {
  /** Which provider actually produced the audio — may differ from the configured one. */
  usedProvider: string
  /** Set when the preferred provider failed and we fell back. */
  fallbackReason?: string
}

export interface SpeakOptions {
  signal?: AbortSignal
  /** Lets the audio cache supply a previously generated offline clip. */
  fallback?: (signal?: AbortSignal) => Promise<SynthResult>
}

/** Start offline synthesis after this wait; Azure can still win while it runs. */
const FALLBACK_DELAY_MS = 2000

/** The first successful voice wins. A failed fallback must not discard working Azure audio. */
export async function speak(
  config: AppConfig,
  text: string,
  rate: number,
  apiKey: string | null,
  options: SpeakOptions = {}
): Promise<SpeakOutcome> {
  const { signal } = options
  signal?.throwIfAborted()
  const offline = options.fallback ?? ((abort?: AbortSignal) =>
    new SystemTtsProvider(config.tts.systemVoice).synth(text, rate, abort))
  let preferred: TtsProvider
  try {
    preferred = createTtsProvider(config, apiKey)
  } catch (err) {
    // Misconfigured online provider (no key, say) — fall straight through.
    if (config.tts.provider === 'system') throw err
    const reason = err instanceof TtsError ? (err.hint ?? err.message) : String(err)
    const result = await offline(signal)
    return { ...result, usedProvider: 'system', fallbackReason: reason }
  }

  if (preferred.id === 'system') {
    return { ...await preferred.synth(text, rate, signal), usedProvider: 'system' }
  }

  const controller = new AbortController()
  const cancel = (): void => controller.abort(signal?.reason)
  signal?.addEventListener('abort', cancel, { once: true })
  let startFallback!: () => void
  const fallbackReady = new Promise<void>((resolve) => { startFallback = resolve })
  const timer = setTimeout(startFallback, FALLBACK_DELAY_MS)
  let reason = 'The online voice took too long.'
  const online = (async (): Promise<SpeakOutcome> => {
    try {
      return { ...await preferred.synth(text, rate, controller.signal), usedProvider: 'online' }
    } catch (err) {
      reason = err instanceof TtsError ? (err.hint ?? err.message) : String(err)
      startFallback()
      throw err
    }
  })()
  const fallback = fallbackReady.then(async (): Promise<SpeakOutcome> => {
    controller.signal.throwIfAborted()
    const result = await offline(controller.signal)
    return { ...result, usedProvider: 'system', fallbackReason: reason }
  })
  const cancelled = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
  })
  try {
    return await Promise.race([
      Promise.any([online, fallback]).catch((error: AggregateError) => {
        // Preserve the useful system-voice error when neither provider works.
        throw error.errors[1]
      }),
      cancelled
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    controller.abort()
    // Release an unused fallback promise without ever starting a process.
    startFallback()
  }
}
