import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamRefinement } from '../src/core/refine-generation.js'
import { OutputLimitError, ProviderError, type LlmProvider } from '../src/providers/llm/types.js'

const req = { mode: 'refine' as const, text: 'original', previousRefinement: 'previous' }
const signal = (): AbortSignal => new AbortController().signal
async function collect(explain: LlmProvider['explain'], parent = signal(), restart = vi.fn()): Promise<string> {
  let output = ''
  for await (const text of streamRefinement({ explain }, req, parent, () => { output = ''; restart() })) output += text
  return output
}
const hanging = (): AsyncIterable<string> => ({
  [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<string>>(() => {}) })
})
afterEach(() => vi.useRealTimers())

describe('refinement stall recovery', () => {
  it('leaves local model cold starts uninterrupted', async () => {
    vi.useFakeTimers()
    const explain = vi.fn(async function* () {
      await new Promise(resolve => setTimeout(resolve, 20000))
      yield 'Local result'
    })
    const restart = vi.fn()
    const run = (async () => {
      let output = ''
      for await (const text of streamRefinement({ id: 'ollama', explain }, req, signal(), restart)) output += text
      return output
    })()
    await vi.advanceTimersByTimeAsync(20000)
    expect(await run).toBe('Local result')
    expect(explain).toHaveBeenCalledTimes(1)
    expect(restart).not.toHaveBeenCalled()
  })
  it('retries after five seconds without text, preserving the exact original and previous version', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const explain = vi.fn<LlmProvider['explain']>((_req, abort) => {
      signals.push(abort)
      return signals.length === 1 ? hanging() : (async function* () { yield 'Complete result' })()
    })
    const restart = vi.fn()
    const run = collect(explain, signal(), restart)
    await vi.advanceTimersByTimeAsync(4999)
    expect(explain).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run).toBe('Complete result')
    expect(explain.mock.calls.map(([request]) => request)).toEqual([req, req])
    expect(signals[0].aborted).toBe(true)
    expect(restart).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('discards partial and late output from a stalled attempt without mixing versions', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const explain = vi.fn<LlmProvider['explain']>()
      .mockImplementationOnce(async function* () {
        yield 'Old partial'
        await new Promise<void>(resolve => { finish = resolve })
        yield ' late text'
      })
      .mockImplementationOnce(async function* () { yield 'New '; yield 'complete version' })
    const restart = vi.fn()
    const run = collect(explain, signal(), restart)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await run).toBe('New complete version')
    finish()
    await vi.advanceTimersByTimeAsync(10000)
    expect(explain).toHaveBeenCalledTimes(2)
    expect(restart).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows healthy long responses and does not retry them', async () => {
    vi.useFakeTimers()
    const explain = vi.fn(async function* () {
      for (let i = 0; i < 6; i++) {
        await new Promise(resolve => setTimeout(resolve, 4000))
        yield 'more '
      }
    })
    const run = collect(explain)
    await vi.advanceTimersByTimeAsync(24000)
    expect(await run).toBe('more '.repeat(6))
    expect(explain).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('gives the replacement ten seconds to start, then fails without an endless retry loop', async () => {
    vi.useFakeTimers()
    const explain = vi.fn(hanging)
    const run = expect(collect(explain)).rejects.toThrow('connection is still too slow')
    await vi.advanceTimersByTimeAsync(15000)
    await run
    expect(explain).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels immediately even if the SDK ignores abort, without starting a replacement', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const explain = vi.fn(hanging)
    const run = expect(collect(explain, controller.signal)).rejects.toThrow('User closed popup')
    controller.abort(new Error('User closed popup'))
    await run
    await vi.advanceTimersByTimeAsync(15000)
    expect(explain).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([new OutputLimitError(), new ProviderError('Invalid API key')])('preserves provider errors without retrying: %s', async error => {
    const explain = vi.fn(async function* () { yield 'partial'; throw error })
    await expect(collect(explain)).rejects.toBe(error)
    expect(explain).toHaveBeenCalledTimes(1)
  })
})
