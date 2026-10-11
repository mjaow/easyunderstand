/**
 * What the popup shows when the model runs out of room mid-answer.
 *
 * The bug this guards: the provider threw, the session replaced everything with an
 * error, and a translation that had reached its third paragraph was discarded — the
 * user saw only "the model stopped at its output limit", with none of the answer it
 * had already produced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Explanation, ExplainState } from '../src/shared/types.js'

const fixture = vi.hoisted(() => ({
  cache: new Map<string, Explanation>(),
  shown: [] as ExplainState[],
  // Two paragraphs land, then the model hits the ceiling part-way through the third.
  explain: vi.fn(async function* () {
    yield '## CODE\nno\n## ZH\n第一段。\n\n第二段。\n\n第三'
    const { CUT_SHORT, OutputLimitError, SELECT_LESS } = await import('../src/providers/llm/types.js')
    throw new OutputLimitError(CUT_SHORT, SELECT_LESS)
  })
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/unused' }, BrowserWindow: {}, screen: {}, clipboard: {}
}))
vi.mock('../src/main/capture.js', () => ({
  captureSelection: async () => ({
    ok: true,
    text: 'The committee met for three hours without reaching a decision.',
    raw: 'The committee met for three hours without reaching a decision.',
    elapsedMs: 1
  })
}))
vi.mock('../src/main/coords.js', () => ({ dipToScreenRect: vi.fn(), screenToDip: vi.fn() }))
vi.mock('../src/main/a11y.js', () => ({ readTranscriptAtPoint: vi.fn(), readCaptionFromVideo: vi.fn() }))
vi.mock('../src/main/native/index.js', () => ({
  IS_MACOS: true, copyChordLabel: () => '⌘C', foregroundWindowTitle: vi.fn(), inputPermission: vi.fn()
}))
vi.mock('../src/main/popup.js', () => ({
  showPopup: (v: ExplainState) => fixture.shown.push(structuredClone(v)),
  updatePopup: (v: ExplainState) => fixture.shown.push(structuredClone(v)),
  hidePopup: vi.fn(), isPopupVisible: () => false
}))
vi.mock('../src/core/config.js', () => ({
  loadConfig: () => ({ llm: { provider: 'openai', models: { openai: 'qwen-flash' }, codeModel: '' } }),
  getSecret: () => 'key'
}))
vi.mock('../src/core/cache.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/cache.js')>()),
  JsonLruCache: class {
    get(key: string): Explanation | undefined { return fixture.cache.get(key) }
    set(key: string, value: Explanation): void { fixture.cache.set(key, value) }
  },
  AudioCache: class {}
}))
vi.mock('../src/providers/llm/registry.js', () => ({
  createLlmProvider: () => ({ explain: fixture.explain }),
  describeError: () => ({ message: 'should not be used', hint: '' })
}))
vi.mock('../src/main/speech.js', () => ({ synthesize: vi.fn(), prefetchPronunciation: vi.fn(), cancelPronunciationPrefetch: vi.fn() }))

const { explainSelection } = await import('../src/main/session.js')

beforeEach(() => {
  fixture.cache.clear()
  fixture.shown.length = 0
  fixture.explain.mockClear()
})

describe('an answer cut short by the output limit', () => {
  it('keeps what arrived instead of replacing it with an error', async () => {
    await explainSelection()
    const last = fixture.shown.at(-1)

    expect(last?.status).toBe('done')
    expect(last?.error).toBeUndefined()
    expect(last?.explanation.zh).toContain('第一段')
    expect(last?.explanation.zh).toContain('第二段')
  })

  it('says it was cut short, beside the answer rather than instead of it', async () => {
    await explainSelection()
    const last = fixture.shown.at(-1)

    expect(last?.warning).toMatch(/cut short/i)
    expect(last?.warning).toMatch(/fewer paragraphs/i)
  })

  it('never caches a truncated answer', async () => {
    // Cached, it would be served for this selection for ever, and the user would
    // have no way to tell a stale half-answer from a fresh one.
    await explainSelection()
    expect(fixture.cache.size).toBe(0)

    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(2)
  })
})
