import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureResult, Explanation, ExplainRequest, ExplainState } from '../src/shared/types.js'

const fixture = vi.hoisted(() => ({
  cache: new Map<string, Explanation>(), shown: [] as ExplainState[], visible: false,
  capture: vi.fn<() => Promise<CaptureResult>>(),
  explain: vi.fn<(req: ExplainRequest, signal: AbortSignal) => AsyncIterable<string>>(),
  provider: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: () => '/unused' }, BrowserWindow: {}, clipboard: {} }))
vi.mock('../src/main/capture.js', () => ({ captureSelection: fixture.capture }))
vi.mock('../src/main/coords.js', () => ({ screenToDip: vi.fn() }))
vi.mock('../src/main/a11y.js', () => ({ readTranscriptAtPoint: vi.fn() }))
vi.mock('../src/main/native/index.js', () => ({
  IS_MACOS: false, copyChordLabel: () => 'Ctrl+C', foregroundWindowTitle: vi.fn(), inputPermission: vi.fn()
}))
vi.mock('../src/main/popup.js', () => ({
  showPopup: (state: ExplainState) => { fixture.visible = true; fixture.shown.push(structuredClone(state)) },
  updatePopup: (state: ExplainState) => fixture.shown.push(structuredClone(state)),
  hidePopup: () => { fixture.visible = false }, isPopupVisible: () => fixture.visible
}))
vi.mock('../src/core/config.js', () => ({
  loadConfig: () => ({ llm: { provider: 'openai', models: { openai: 'everyday' }, codeModel: 'code-only' } }),
  getSecret: () => 'existing-key'
}))
vi.mock('../src/core/cache.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/cache.js')>(),
  JsonLruCache: class {
    get(key: string): Explanation | undefined { return fixture.cache.get(key) }
    set(key: string, value: Explanation): void { fixture.cache.set(key, value) }
  },
  AudioCache: class {}
}))
vi.mock('../src/providers/llm/registry.js', () => ({
  createLlmProvider: fixture.provider,
  describeError: (_provider: string, error: Error) => ({ message: error.message })
}))
vi.mock('../src/providers/tts/registry.js', () => ({ speak: vi.fn() }))

import { cancelInFlight, explainSelection, refineSelection, refineAgain, toggleOrExplain, toggleOrRefine } from '../src/main/session.js'
import { OutputLimitError } from '../src/providers/llm/types.js'

function select(text: string, raw = text): void {
  fixture.capture.mockResolvedValue({ ok: true, text, raw, elapsedMs: 1 })
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.cache.clear(); fixture.shown = []; fixture.visible = false
  fixture.provider.mockReturnValue({ explain: fixture.explain })
  select('i has a question')
  fixture.explain.mockImplementation(async function* (req) {
    yield req.mode === 'refine' ? 'I have a question.' : '## EN\nA question.'
  })
})
afterEach(() => vi.useRealTimers())

describe('refinement sessions', () => {
  it('cancels a stalled request when the popup hides, without an automatic retry', async () => {
    vi.useFakeTimers()
    fixture.explain.mockImplementationOnce(async function* () {
      await new Promise(() => {})
    })
    const run = refineSelection()
    await vi.advanceTimersByTimeAsync(1)
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    fixture.visible = false
    cancelInFlight()
    await run
    await vi.advanceTimersByTimeAsync(15000)
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.explain.mock.calls[0][1].aborted).toBe(true)
    expect(fixture.cache.size).toBe(0)
  })
  it('shows stall recovery, replaces partial text, and caches only the complete replacement', async () => {
    vi.useFakeTimers()
    fixture.explain.mockImplementationOnce(async function* () {
      yield 'Old unfinished text'
      await new Promise(() => {})
    }).mockImplementationOnce(async function* () { yield 'Complete replacement.' })
    const run = refineSelection()
    await vi.advanceTimersByTimeAsync(5000)
    await run
    expect(fixture.capture).toHaveBeenCalledTimes(1)
    expect(fixture.explain).toHaveBeenCalledTimes(2)
    expect(fixture.shown.some(state => state.refineProgress === 'Connection is slow. Retrying…' && !state.explanation.refined)).toBe(true)
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', explanation: { refined: 'Complete replacement.' } })
    expect(fixture.shown.at(-1)?.refineProgress).toBeUndefined()
    expect([...fixture.cache.values()]).toEqual([{ refined: 'Complete replacement.' }])
  })
  it.each(['i has a question', 'recieve', '这个句子不太通顺', '这个 API 有点 slow'])('uses refinement regardless of selection length or language: %s', async text => {
    select(text)
    await refineSelection()
    expect(fixture.explain).toHaveBeenCalledWith({ mode: 'refine', text, raw: text }, expect.any(AbortSignal))
    expect(fixture.provider).toHaveBeenCalledWith(expect.anything(), 'existing-key', 'everyday', undefined)
    expect(fixture.shown.at(-1)).toMatchObject({ mode: 'refine', status: 'done', explanation: { refined: 'I have a question.' } })
  })

  it('keeps refinement cache separate from explanations and preserves source paragraph structure', async () => {
    await explainSelection()
    await refineSelection()
    await refineSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(2)
    expect(fixture.shown.at(-1)).toMatchObject({ mode: 'refine', cached: true })
    select('i has a question', 'i has\n\na question')
    await refineSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(3)
    expect(fixture.explain.mock.calls.at(-1)?.[0].raw).toBe('i has\n\na question')
  })

  it('switches actions on a visible popup and closes only when the same hotkey repeats', async () => {
    await explainSelection()
    select('Another selection from an editable textbox.')
    toggleOrRefine()
    await vi.waitFor(() => expect(fixture.shown.at(-1)).toMatchObject({ mode: 'refine', status: 'done' }))
    expect(fixture.shown.at(-1)?.text).toBe('Another selection from an editable textbox.')
    toggleOrRefine()
    expect(fixture.visible).toBe(false)
    await refineSelection()
    toggleOrExplain()
    await vi.waitFor(() => expect(fixture.shown.at(-1)).toMatchObject({ mode: 'passage', status: 'done' }))
    expect(fixture.visible).toBe(true)
    toggleOrExplain()
    expect(fixture.visible).toBe(false)
  })

  it('cancels a streaming refinement without caching or publishing its late completion', async () => {
    let finish!: () => void
    fixture.explain.mockImplementation(async function* () {
      yield 'Partial text'
      await new Promise<void>(resolve => { finish = resolve })
    })
    const pending = refineSelection()
    await vi.waitFor(() => expect(fixture.shown.at(-1)?.explanation.refined).toBe('Partial text'))
    const count = fixture.shown.length
    toggleOrRefine()
    expect(fixture.explain.mock.calls[0][1].aborted).toBe(true)
    finish()
    await pending
    expect(fixture.visible).toBe(false)
    expect(fixture.shown).toHaveLength(count)
    expect(fixture.cache.size).toBe(0)
  })

  it('reports empty captures in refinement mode without requesting the model', async () => {
    fixture.capture.mockResolvedValue({ ok: false, reason: 'empty', elapsedMs: 1 })
    await refineSelection()
    expect(fixture.shown.at(-1)).toMatchObject({ mode: 'refine', status: 'error', error: expect.stringContaining('No text was copied') })
    expect(fixture.explain).not.toHaveBeenCalled()
    toggleOrRefine()
    expect(fixture.visible).toBe(false)
  })

  it('keeps truncated text with a warning and does not cache it', async () => {
    fixture.explain.mockImplementation(async function* () { yield '部分内容'; throw new OutputLimitError() })
    await refineSelection()
    expect(fixture.shown.at(-1)).toMatchObject({ mode: 'refine', status: 'done', explanation: { refined: '部分内容' }, warning: expect.stringContaining('cut short') })
    expect(fixture.cache.size).toBe(0)
  })

  it('reports an empty model reply as a retryable error', async () => {
    fixture.explain.mockImplementation(async function* () { yield ' \n' })
    await refineSelection()
    expect(fixture.shown.at(-1)).toMatchObject({ mode: 'refine', status: 'error', error: expect.stringContaining('no refined text') })
    expect(fixture.cache.size).toBe(0)
  })

  it('bypasses the cache and uses the original selection plus only the latest version on each retry', async () => {
    select('i has a question', 'i has\n\na question')
    await refineSelection()
    await refineSelection()
    expect(fixture.shown.at(-1)?.cached).toBe(true)
    const previousAttempt = fixture.shown.at(-1)?.refineAttempt
    select('Different selection in another app')
    fixture.explain.mockImplementationOnce(async function* () { yield 'I have something to ask.' })
    await refineAgain()
    expect(fixture.capture).toHaveBeenCalledTimes(2)
    expect(fixture.explain).toHaveBeenCalledTimes(2)
    expect(fixture.explain.mock.calls.at(-1)?.[0]).toEqual({
      mode: 'refine', text: 'i has a question', raw: 'i has\n\na question',
      previousRefinement: 'I have a question.'
    })
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', explanation: { refined: 'I have something to ask.' } })
    expect(fixture.shown.at(-1)?.cached).not.toBe(true)
    expect(fixture.shown.at(-1)?.refineAttempt).not.toBe(previousAttempt)

    fixture.explain.mockImplementationOnce(async function* () { yield 'There is a question I would like to ask.' })
    await refineAgain()
    expect(fixture.explain.mock.calls.at(-1)?.[0].previousRefinement).toBe('I have something to ask.')
    expect(fixture.cache.size).toBe(1)
    expect([...fixture.cache.values()][0].refined).toBe('There is a question I would like to ask.')
  })

  it.each(['provider failure', 'truncated reply', 'same wording'])('keeps the complete version available after a retry returns %s', async failure => {
    await refineSelection()
    fixture.explain.mockImplementationOnce(async function* () {
      if (failure === 'same wording') { yield 'I have a question.'; return }
      yield 'Incomplete'
      throw failure === 'truncated reply' ? new OutputLimitError() : new Error('Service unavailable')
    })
    await refineAgain()
    expect(fixture.shown.at(-1)).toMatchObject({
      status: 'done', explanation: { refined: 'I have a question.' }, refineRetryError: expect.any(String)
    })
    expect(fixture.shown.at(-1)?.warning).toBeUndefined()
    expect([...fixture.cache.values()][0].refined).toBe('I have a question.')
    fixture.explain.mockImplementationOnce(async function* () { yield 'I have something to ask.' })
    await refineAgain()
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', explanation: { refined: 'I have something to ask.' } })
    expect(fixture.shown.at(-1)?.refineRetryError).toBeUndefined()
  })

  it('retries an initial generation failure without asking the user to select again', async () => {
    fixture.explain.mockImplementationOnce(async function* () { throw new Error('Service unavailable') })
    await refineSelection()
    await refineAgain()
    expect(fixture.capture).toHaveBeenCalledTimes(1)
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', explanation: { refined: 'I have a question.' } })
  })

  it('ignores repeated retry clicks during generation and cancels the retry when closed', async () => {
    await refineSelection()
    let finish!: () => void
    fixture.explain.mockImplementationOnce(async function* () {
      yield 'Another'
      await new Promise<void>(resolve => { finish = resolve })
      yield ' version'
    })
    const pending = refineAgain()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await refineAgain()
    expect(fixture.explain).toHaveBeenCalledTimes(2)
    toggleOrRefine()
    const count = fixture.shown.length
    finish()
    await pending
    expect(fixture.shown).toHaveLength(count)
    expect([...fixture.cache.values()][0].refined).toBe('I have a question.')
    await refineAgain()
    expect(fixture.explain).toHaveBeenCalledTimes(2)
    await explainSelection()
    await refineAgain()
    expect(fixture.explain).toHaveBeenCalledTimes(3)
  })
})
