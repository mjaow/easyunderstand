import { session } from 'electron'
import type { AppConfig } from '../shared/types.js'
import { parseAzureResponsesEndpoint } from '../providers/llm/azure-responses.js'

/** Prepare the socket used by net.fetch without sending a prompt or model request. */
export function warmLlmConnection(config: AppConfig): void {
  if (config.llm.provider !== 'azure') return
  try {
    const { baseURL } = parseAzureResponsesEndpoint(config.llm.baseUrls.azure ?? '')
    session.defaultSession.preconnect({ url: new URL(baseURL).origin, numSockets: 1 })
  } catch {
    // A failed speculative connection must not interrupt startup or settings.
    // The actual request still reports any endpoint or connection error.
  }
}

/** Keep a connection ready between hotkeys, including after an idle spell. */
export function startLlmConnectionWarmup(config: () => AppConfig): () => void {
  const warm = (): void => warmLlmConnection(config())
  warm()
  const timer = setInterval(warm, 30000)
  timer.unref()
  return () => clearInterval(timer)
}
