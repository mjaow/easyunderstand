import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureResult, Explanation, ExplainRequest, ExplainState } from '../src/shared/types.js'

const fixture = vi.hoisted(() => ({
  cache: new Map<string, Explanation>(), shown: [] as ExplainState[], visible: false, unverified: false,
  capture: vi.fn<() => Promise<CaptureResult>>(),
  explain: vi.fn<(req: ExplainRequest, signal: AbortSignal) => AsyncIterable<string>>(),
  provider: vi.fn(), prefetch: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: () => '/unused' }, BrowserWindow: { getAllWindows: () => [] }, clipboard: {} }))
vi.mock('../src/main/capture.js', () => ({ captureSelection: fixture.capture }))
vi.mock('../src/main/coords.js', () => ({ screenToDip: vi.fn() }))
vi.mock('../src/main/a11y.js', () => ({ readTranscriptAtPoint: vi.fn() }))
vi.mock('../src/main/native/index.js', () => ({
  IS_MACOS: false, copyChordLabel: () => 'Ctrl+C', foregroundWindowTitle: vi.fn(), inputPermission: vi.fn(),
  cursorPosition: () => ({ x: 300, y: 200 })
}))
vi.mock('../src/main/popup.js', () => ({
  showPopup: (state: ExplainState) => { fixture.visible = true; fixture.shown.push(structuredClone(state)) },
  updatePopup: (state: ExplainState) => fixture.shown.push(structuredClone(state)),
  hidePopup: () => { fixture.visible = false }, isPopupVisible: () => fixture.visible
}))
vi.mock('../src/core/config.js', () => ({
  loadConfig: () => ({ unverifiedPronunciations: fixture.unverified, llm: { provider: 'openai', models: { openai: 'everyday' }, codeModel: 'code-only' } }),
  getSecret: () => 'existing-key'
}))
vi.mock('../src/core/cache.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/cache.js')>(),
  JsonLruCache: class {
    get(key: string): Explanation | undefined { return fixture.cache.get(key) }
    set(key: string, value: Explanation): void { fixture.cache.set(key, value) }
  }
}))
vi.mock('../src/providers/llm/registry.js', () => ({
  createLlmProvider: fixture.provider,
  describeError: (_provider: string, error: Error) => ({ message: error.message })
}))
vi.mock('../src/main/speech.js', () => ({ synthesize: vi.fn(), prefetchPronunciation: fixture.prefetch, cancelPronunciationPrefetch: vi.fn() }))

import { explainSelection, refineSelection, summarizeSelection, explainLastAsCode, refineAgain, toggleOrExplain, toggleOrRefine, toggleOrSummarize } from '../src/main/session.js'
import { OutputLimitError } from '../src/providers/llm/types.js'

function select(raw: string): void {
  fixture.capture.mockResolvedValue({ ok: true, text: raw.replace(/\s+/g, ' '), raw, elapsedMs: 1 })
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.cache.clear(); fixture.shown = []; fixture.visible = false; fixture.unverified = false
  fixture.provider.mockReturnValue({ explain: fixture.explain })
  select('A trial reduced costs, but the findings are uncertain.')
  fixture.explain.mockImplementation(async function* (req) {
    yield req.mode === 'summary' ? 'Costs fell, but the findings remain uncertain.'
      : req.mode === 'refine' ? 'The trial reduced costs, but its findings remain uncertain.' : '## EN\nCosts fell.'
  })
})

describe('summary sessions', () => {
  it.each(['A short sentence.', '成本可能下降，但结果仍不确定。', '成本可能下降，但結果仍不確定。'])(
    'uses the everyday model and skips pronunciation for %s', async raw => {
      select(raw)
      await summarizeSelection()
      expect(fixture.explain).toHaveBeenCalledWith({ mode: 'summary', text: raw, raw }, expect.any(AbortSignal))
      expect(fixture.provider).toHaveBeenCalledWith(expect.anything(), 'existing-key', 'everyday', undefined)
      expect(fixture.prefetch).not.toHaveBeenCalled()
      expect(fixture.shown.at(-1)).toMatchObject({ mode: 'summary', status: 'done', explanation: { summary: expect.any(String) } })
    }
  )

  it('passes a whole article including its ending, without clipping or collapsing paragraphs', async () => {
    const raw = `${'Background information.\n\n'.repeat(3000)}The proposal was rejected.`
    select(raw)
    await summarizeSelection()
    expect(fixture.explain.mock.calls[0][0].raw).toBe(raw)
  })

  it('separates summary caches from explanation and refinement and keys on the full original', async () => {
    await explainSelection()
    await refineSelection()
    await summarizeSelection()
    fixture.unverified = true
    await summarizeSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(3)
    expect(fixture.cache.size).toBe(3)
    expect(fixture.shown.at(-1)).toMatchObject({ mode: 'summary', cached: true })
    select('A trial reduced costs,\n\nbut the findings are uncertain.')
    await summarizeSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(4)
  })

  it('switches between all three actions and dismisses only on the same shortcut', async () => {
    await refineSelection()
    toggleOrSummarize()
    await vi.waitFor(() => expect(fixture.shown.at(-1)).toMatchObject({ mode: 'summary', status: 'done' }))
    toggleOrExplain()
    await vi.waitFor(() => expect(fixture.shown.at(-1)).toMatchObject({ mode: 'passage', status: 'done' }))
    toggleOrSummarize()
    await vi.waitFor(() => expect(fixture.shown.at(-1)).toMatchObject({ mode: 'summary', status: 'done' }))
    toggleOrRefine()
    await vi.waitFor(() => expect(fixture.shown.at(-1)).toMatchObject({ mode: 'refine', status: 'done' }))
    toggleOrSummarize()
    await vi.waitFor(() => expect(fixture.shown.at(-1)).toMatchObject({ mode: 'summary', status: 'done' }))
    const captures = fixture.capture.mock.calls.length
    toggleOrSummarize()
    expect(fixture.visible).toBe(false)
    expect(fixture.capture).toHaveBeenCalledTimes(captures)
  })

  it('discards a cancelled summary even if its provider finishes after the next action', async () => {
    let finish!: () => void
    fixture.explain.mockImplementationOnce(async function* () {
      yield 'Partial summary'
      await new Promise<void>(resolve => { finish = resolve })
      yield 'Late content'
    })
    const pending = summarizeSelection()
    await vi.waitFor(() => expect(fixture.shown.at(-1)?.explanation.summary).toBe('Partial summary'))
    await refineSelection()
    expect(fixture.explain.mock.calls[0][1].aborted).toBe(true)
    const updates = fixture.shown.length
    finish()
    await pending
    expect(fixture.shown).toHaveLength(updates)
    expect(fixture.shown.at(-1)?.mode).toBe('refine')
    expect([...fixture.cache.values()].some(result => result.summary)).toBe(false)
  })

  it('reports empty captures without a model call and allows the summary shortcut to close the error', async () => {
    fixture.capture.mockResolvedValue({ ok: false, reason: 'empty', elapsedMs: 1 })
    await summarizeSelection()
    expect(fixture.shown.at(-1)).toMatchObject({ mode: 'summary', status: 'error', error: expect.stringContaining('No text was copied') })
    expect(fixture.explain).not.toHaveBeenCalled()
    toggleOrSummarize()
    expect(fixture.visible).toBe(false)
  })

  it('does not cache an empty reply', async () => {
    fixture.explain.mockImplementationOnce(async function* () { yield ' \n' })
    await summarizeSelection()
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'error', error: expect.stringContaining('no summary') })
    expect(fixture.cache.size).toBe(0)
  })

  it('marks a truncated summary incomplete and does not cache it', async () => {
    fixture.explain.mockImplementationOnce(async function* () { yield 'Partial summary'; throw new OutputLimitError() })
    await summarizeSelection()
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', warning: expect.stringContaining('cut short'), explanation: { summary: 'Partial summary' } })
    expect(fixture.cache.size).toBe(0)
  })

  it('keeps refinement and code actions from changing a summary', async () => {
    await summarizeSelection()
    await refineAgain()
    await explainLastAsCode()
    expect(fixture.explain).toHaveBeenCalledTimes(1)
  })
})
