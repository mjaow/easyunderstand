import type { ExplainRequest } from '../shared/types.js'
import { ProviderError, type LlmProvider } from '../providers/llm/types.js'

class RefinementTimeout extends ProviderError {
  constructor() {
    super('The connection is still too slow. Click Try another version to retry.')
  }
}

/** Retry one stalled refinement, with the same original and previous version.
 * Each attempt has its own abort signal; a late response cannot leak into the
 * replacement. Healthy long replies may keep streaming for up to 60 seconds.
 */
export async function* streamRefinement(
  provider: Pick<LlmProvider, 'explain'> & Partial<Pick<LlmProvider, 'id'>>, req: ExplainRequest, parent: AbortSignal,
  onRestart: () => void
): AsyncIterable<string> {
  // Loading a local model on a CPU can legitimately take much longer than a
  // cloud round trip. Restarting it would only make that cold start slower.
  if (provider.id === 'ollama') {
    yield* provider.explain(req, parent)
    return
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    parent.throwIfAborted()
    const controller = new AbortController()
    let deadline: ReturnType<typeof setTimeout> | undefined
    let total: ReturnType<typeof setTimeout> | undefined
    let rejectStopped!: (error: unknown) => void
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject })
    // Attach immediately, including if a provider throws before its first next().
    void stopped.catch(() => {})
    const stop = (error: unknown): void => {
      rejectStopped(error)
      controller.abort(error)
    }
    const cancel = (): void => stop(parent.reason)
    const arm = (ms: number): void => {
      clearTimeout(deadline)
      deadline = setTimeout(() => stop(new RefinementTimeout()), ms)
    }
    parent.addEventListener('abort', cancel, { once: true })
    let iterator: AsyncIterator<string> | undefined
    let retry = false
    try {
      arm(attempt === 0 ? 5000 : 10000)
      total = setTimeout(() => stop(new ProviderError('The refinement took too long. Select fewer paragraphs and try again.')), 60000)
      iterator = provider.explain(req, controller.signal)[Symbol.asyncIterator]()
      while (true) {
        // Race independently of the SDK: cancellation must work even when its
        // network reader fails to settle after an abort.
        const next = await Promise.race([iterator.next(), stopped])
        controller.signal.throwIfAborted()
        if (next.done) return
        if (next.value) {
          arm(5000)
          yield next.value
        }
      }
    } catch (error) {
      parent.throwIfAborted()
      if (!(error instanceof RefinementTimeout) || attempt !== 0) throw error
      retry = true
    } finally {
      clearTimeout(deadline)
      clearTimeout(total)
      parent.removeEventListener('abort', cancel)
      controller.abort()
      // Do not wait on a stuck iterator to release the UI or start recovery.
      if (iterator?.return) void Promise.resolve(iterator.return()).catch(() => {})
    }
    if (retry) {
      parent.throwIfAborted()
      onRestart()
    }
  }
}
