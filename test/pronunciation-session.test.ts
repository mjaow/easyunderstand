import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Explanation, ExplainState } from '../src/shared/types.js'
import { cacheKey } from '../src/core/cache.js'
import { systemPrompt } from '../src/core/explain.js'
import { setSystemDictionary } from '../src/core/pronunciation.js'

const fixture = vi.hoisted(() => ({
  cache: new Map<string, Explanation>(),
  shown: [] as ExplainState[],
  text: 'debit',
  unverified: false,
  chunks: ['## CODE\nno\n## IPA\n/dɪ', 'ˈbɪt/\n## POS\nnoun\n## ZH\n借记'],
  explain: vi.fn(async function* () {
    for (const chunk of fixture.chunks) yield chunk
  })
}))

vi.mock('electron', () => ({ app: { getPath: () => '/unused' }, BrowserWindow: {}, screen: {} }))
vi.mock('../src/main/capture.js', () => ({
  captureSelection: async () => ({ ok: true, text: fixture.text, raw: fixture.text, elapsedMs: 1 })
}))
vi.mock('../src/main/coords.js', () => ({ screenToDip: vi.fn() }))
vi.mock('../src/main/a11y.js', () => ({ readTranscriptAtPoint: vi.fn() }))
vi.mock('../src/main/native/index.js', () => ({
  IS_MACOS: false, copyChordLabel: () => 'Ctrl+C', foregroundWindowTitle: vi.fn(), inputPermission: vi.fn()
}))
vi.mock('../src/main/popup.js', () => ({
  showPopup: (value: ExplainState) => fixture.shown.push(structuredClone(value)),
  updatePopup: (value: ExplainState) => fixture.shown.push(structuredClone(value)),
  hidePopup: vi.fn(), isPopupVisible: () => false
}))
vi.mock('../src/core/config.js', () => ({
  loadConfig: () => ({ unverifiedPronunciations: fixture.unverified, llm: { provider: 'openai', models: { openai: 'qwen-flash' }, codeModel: '' } }),
  getSecret: () => null
}))
vi.mock('../src/core/cache.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/core/cache.js')>(),
  JsonLruCache: class {
    get(key: string): Explanation | undefined { return fixture.cache.get(key) }
    set(key: string, value: Explanation): void { fixture.cache.set(key, value) }
  },
  AudioCache: class {}
}))
vi.mock('../src/providers/llm/registry.js', () => ({
  createLlmProvider: () => ({ explain: fixture.explain }), describeError: vi.fn()
}))
vi.mock('../src/providers/tts/registry.js', () => ({ speak: vi.fn() }))

import { explainSelection, refineSelection } from '../src/main/session.js'

beforeEach(() => {
  fixture.cache.clear()
  fixture.shown.length = 0
  fixture.explain.mockClear()
  fixture.text = 'debit'
  fixture.unverified = false
  fixture.chunks = ['## CODE\nno\n## IPA\n/dɪ', 'ˈbɪt/\n## POS\nnoun\n## ZH\n借记']
})
afterEach(() => setSystemDictionary(null))

describe('pronunciation in the lookup session', () => {
  it('reuses existing refinement caches regardless of the pronunciation setting', async () => {
    fixture.text = 'A draft to improve.'
    const key = cacheKey('openai', 'qwen-flash', 'refine', systemPrompt('refine'), fixture.text, undefined, undefined)
    fixture.cache.set(key, { refined: 'An improved draft.' })
    for (const enabled of [false, true]) {
      fixture.unverified = enabled
      await refineSelection()
      expect(fixture.shown.at(-1)).toMatchObject({ mode: 'refine', cached: true, explanation: { refined: 'An improved draft.' } })
    }
    expect(fixture.explain).not.toHaveBeenCalled()
  })

  it('separates cached answers by the unverified setting and applies it to provider requests', async () => {
    fixture.text = 'reproducible'
    fixture.chunks = ['## IPA\n/ˌɹipɹəˈdusəbəɫ/\n## ZH\n可复现的']
    await explainSelection()
    expect(fixture.shown.at(-1)?.explanation.ipa).toBeUndefined()
    expect(fixture.explain).toHaveBeenLastCalledWith(expect.objectContaining({ allowUnverifiedPronunciations: false }), expect.any(AbortSignal))
    fixture.unverified = true
    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(2)
    expect(fixture.explain).toHaveBeenLastCalledWith(expect.objectContaining({ allowUnverifiedPronunciations: true }), expect.any(AbortSignal))
    expect(fixture.shown.at(-1)?.explanation.unverifiedIpa).toEqual(['reproducible'])
    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(2)
    fixture.unverified = false
    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(2)
    expect(fixture.shown.at(-1)).toMatchObject({ cached: true, explanation: { zh: '可复现的' } })
    expect(fixture.shown.at(-1)?.explanation.ipa).toBeUndefined()
  })

  it('keeps system IPA and its provenance across streaming and cached lookups', async () => {
    fixture.text = 'reproducible'
    const lookup = vi.fn(() => 'reproducible | ˌrēprəˈdo͞osəb(ə)l | adjective')
    setSystemDictionary(lookup)
    await explainSelection()
    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(fixture.shown.at(-1)).toMatchObject({ cached: true, explanation: {
      ipa: '/ˌɹipɹəˈdusəbəɫ/', systemDictionaryIpa: ['reproducible']
    } })
  })

  it('sends dictionary hints and displays only dictionary IPA through streaming and repeat lookups', async () => {
    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledWith(
      expect.objectContaining({ pronunciationHints: { debit: [{ ipa: '/ˈdɛbɪt/', usage: undefined }] } }),
      expect.any(AbortSignal)
    )
    expect(fixture.shown.filter((s) => s.explanation.ipa).map((s) => s.explanation.ipa))
      .toEqual(['/ˈdɛbɪt/', '/ˈdɛbɪt/', '/ˈdɛbɪt/'])
    expect([...fixture.cache.values()][0].ipa).toBe('/ˈdɛbɪt/')

    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.shown.at(-1)).toMatchObject({ cached: true, explanation: { ipa: '/ˈdɛbɪt/' } })
  })

  it('invalidates pre-dictionary cached answers instead of trusting their old IPA choice', async () => {
    const legacyKey = cacheKey('openai', 'qwen-flash', 'word', systemPrompt('word'), 'debit', undefined)
    fixture.cache.set(legacyKey, { ipa: '/dɪˈbɪt/', zh: 'stale answer' })
    await explainSelection()
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', explanation: { ipa: '/ˈdɛbɪt/', zh: '借记' } })
    expect(fixture.shown.some((s) => s.explanation.zh === 'stale answer')).toBe(false)
  })
})
