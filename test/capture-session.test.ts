import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplainState } from '../src/shared/types.js'

const fixture = vi.hoisted(() => ({
  sentence: 'The server is ready and you can safely deploy the application now.',
  clipboardText: 'original clipboard',
  sequence: 1,
  deliverText: true,
  copyWrites: true,
  linkTitle: null as string | null,
  windowTitle: 'News - Browser',
  point: { x: 300, y: 200 },
  ownWindow: false,
  visible: false,
  shown: [] as ExplainState[],
  explain: vi.fn(async function* () {
    yield '## ZH\n服务器已就绪，现在可以安全地部署应用程序。'
  })
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  BrowserWindow: { getAllWindows: () => fixture.ownWindow ? [{
    isDestroyed: () => false, isVisible: () => true,
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 })
  }] : [] }, screen: {},
  ClipboardItem: class {
    constructor(readonly payload: Record<string, Blob>) {}
  },
  clipboard: {
    read: async () => [{
      types: fixture.clipboardText ? ['text/plain'] : [],
      getType: async () => new Blob([fixture.clipboardText])
    }],
    readText: async () => fixture.clipboardText,
    write: async (items: { payload: Record<string, Blob> }[]) => {
      fixture.clipboardText = await items[0].payload['text/plain'].text()
      fixture.sequence++
    },
    clear: () => { fixture.clipboardText = ''; fixture.sequence++ }
  }
}))
vi.mock('../src/main/native/index.js', () => ({
  IS_MACOS: false, copyChordLabel: () => 'Ctrl+C',
  foregroundWindowTitle: () => fixture.windowTitle, inputPermission: vi.fn(),
  cursorPosition: () => ({ ...fixture.point }),
  isAvailable: () => true,
  clipboardSequence: () => fixture.sequence,
  sendCopy: vi.fn(() => {
    if (!fixture.copyWrites) return 4
    fixture.clipboardText = ''
    fixture.sequence++
    if (fixture.deliverText) {
      setTimeout(() => { fixture.clipboardText = fixture.sentence }, 60)
    }
    return 4
  })
}))
vi.mock('../src/main/coords.js', () => ({ screenToDip: (point: unknown) => point }))
vi.mock('../src/main/a11y.js', () => ({
  readTranscriptAtPoint: vi.fn(),
  readLinkAtPoint: vi.fn(async () => fixture.linkTitle)
}))
vi.mock('../src/main/popup.js', () => ({
  showPopup: vi.fn((value: ExplainState) => { fixture.visible = true; fixture.shown.push(structuredClone(value)) }),
  updatePopup: vi.fn((value: ExplainState) => { if (fixture.visible) fixture.shown.push(structuredClone(value)) }),
  hidePopup: vi.fn(() => { fixture.visible = false; cancelInFlight() }),
  isPopupVisible: () => fixture.visible
}))
vi.mock('../src/core/config.js', () => ({
  loadConfig: () => ({ llm: { provider: 'openai', models: { openai: 'test-model' }, codeModel: '' } }),
  getSecret: () => null
}))
vi.mock('../src/core/cache.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/cache.js')>(),
  JsonLruCache: class { get(): undefined { return undefined }; set(): void {} },
  AudioCache: class {}
}))
vi.mock('../src/providers/llm/registry.js', () => ({
  createLlmProvider: () => ({ explain: fixture.explain }), describeError: vi.fn()
}))
vi.mock('../src/main/speech.js', () => ({ synthesize: vi.fn(), prefetchPronunciation: vi.fn(), cancelPronunciationPrefetch: vi.fn() }))

import { cancelInFlight, explainSelection, refineSelection, summarizeSelection, toggleOrExplain } from '../src/main/session.js'
import { hidePopup, showPopup, updatePopup } from '../src/main/popup.js'
import { sendCopy } from '../src/main/native/index.js'
import { readLinkAtPoint } from '../src/main/a11y.js'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  fixture.clipboardText = 'original clipboard'
  fixture.sequence = 1
  fixture.deliverText = true
  fixture.copyWrites = true
  fixture.linkTitle = null
  fixture.windowTitle = 'News - Browser'
  fixture.point = { x: 300, y: 200 }
  fixture.ownWindow = false
  fixture.visible = false
  vi.mocked(readLinkAtPoint).mockReset().mockImplementation(async () => fixture.linkTitle)
  fixture.shown = []
})
afterEach(() => { vi.useRealTimers() })

describe('selected sentence to translated popup', () => {
  it.each([explainSelection, refineSelection, summarizeSelection])('acknowledges the shortcut before capture can finish', async start => {
    const pending = start()
    expect(showPopup).toHaveBeenCalledTimes(1)
    expect(fixture.visible).toBe(true)
    expect(fixture.shown[0]).toMatchObject({ status: 'capturing', text: '', explanation: {} })
    expect(fixture.shown[0]?.captureProgress).toContain('Reading')
    expect(sendCopy).not.toHaveBeenCalled()
    expect(fixture.explain).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    await pending
    expect(showPopup).toHaveBeenCalledTimes(1)
    expect(fixture.shown.at(-1)?.status).toBe('done')
  })

  it('shows the title before the first model token and displays partial translations', async () => {
    fixture.deliverText = false
    fixture.linkTitle = 'How the new telescope sees distant galaxies'
    let firstChunk!: () => void
    let finalChunk!: () => void
    const first = new Promise<void>(resolve => { firstChunk = resolve })
    const last = new Promise<void>(resolve => { finalChunk = resolve })
    fixture.explain.mockImplementationOnce(async function* () {
      await first
      yield '## ZH\n望远镜'
      await last
      yield '看见遥远的星系。'
    })
    const pending = explainSelection()
    toggleOrExplain()
    expect(hidePopup).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(fixture.shown.some(state => state.captureProgress === 'Reading link title…')).toBe(true)
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'streaming', text: fixture.linkTitle, explanation: {} })
    firstChunk()
    await vi.runAllTimersAsync()
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'streaming', explanation: { zh: '望远镜' } })
    finalChunk()
    await pending
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', explanation: { zh: '望远镜看见遥远的星系。' } })
    expect(showPopup).toHaveBeenCalledTimes(1)
    expect(fixture.clipboardText).toBe('original clipboard')
  })

  it.each(['copy', 'link'] as const)('stays closed when cancelled during %s capture', async phase => {
    fixture.deliverText = phase === 'copy'
    let finish!: (value: string | null) => void
    vi.mocked(readLinkAtPoint).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = explainSelection()
    if (phase === 'link') await vi.runAllTimersAsync()
    else await vi.advanceTimersByTimeAsync(10)
    hidePopup()
    const updatesBefore = vi.mocked(updatePopup).mock.calls.length
    if (phase === 'link') finish('A late link title')
    await vi.runAllTimersAsync()
    await pending
    expect(fixture.visible).toBe(false)
    expect(fixture.explain).not.toHaveBeenCalled()
    expect(showPopup).toHaveBeenCalledTimes(1)
    expect(updatePopup).toHaveBeenCalledTimes(updatesBefore)
    expect(fixture.clipboardText).toBe('original clipboard')

    fixture.deliverText = true
    const retry = explainSelection()
    await vi.runAllTimersAsync()
    await retry
    expect(fixture.shown.at(-1)?.status).toBe('done')
  })

  it('replaces the loading state with an error if capture throws', async () => {
    vi.mocked(sendCopy).mockImplementationOnce(() => { throw new Error('Capture unavailable') })
    const pending = explainSelection()
    await vi.runAllTimersAsync()
    await pending
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'error', error: expect.stringContaining('Could not read') })
    expect(showPopup).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['refine', refineSelection], ['summary', summarizeSelection]
  ] as const)('shares safe capture when %s and the other hotkeys are pressed together', async (mode, start) => {
    const first = start()
    const others = [explainSelection(), refineSelection(), summarizeSelection()]
    await vi.runAllTimersAsync()
    await Promise.all([first, ...others])
    expect(sendCopy).toHaveBeenCalledTimes(1)
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.explain).toHaveBeenCalledWith(
      expect.objectContaining({ mode, raw: fixture.sentence }), expect.any(AbortSignal)
    )
    expect(fixture.clipboardText).toBe('original clipboard')
  })
  it('captures delayed text and translates the whole sentence once during repeated hotkeys', async () => {
    fixture.linkTitle = 'A different title under the pointer'
    const first = explainSelection()
    const repeat = explainSelection()
    await vi.runAllTimersAsync()
    await Promise.all([first, repeat])

    expect(sendCopy).toHaveBeenCalledTimes(1)
    expect(readLinkAtPoint).not.toHaveBeenCalled()
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.explain).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'passage', text: fixture.sentence, raw: fixture.sentence }),
      expect.any(AbortSignal)
    )
    expect(fixture.shown.at(-1)).toMatchObject({
      status: 'done', text: fixture.sentence,
      explanation: { zh: '服务器已就绪，现在可以安全地部署应用程序。' }
    })
    expect(fixture.clipboardText).toBe('original clipboard')
  })

  it.each([true, false])('translates a hovered title after an empty copy (clipboard write: %s)', async copyWrites => {
    fixture.deliverText = false
    fixture.copyWrites = copyWrites
    fixture.linkTitle = 'How the new telescope sees distant galaxies'
    const first = explainSelection()
    const repeat = explainSelection()
    fixture.point = { x: 900, y: 700 }
    await vi.runAllTimersAsync()
    await Promise.all([first, repeat])
    expect(readLinkAtPoint).toHaveBeenCalledTimes(1)
    expect(readLinkAtPoint).toHaveBeenCalledWith(300, 200)
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.explain).toHaveBeenCalledWith(
      expect.objectContaining({ text: fixture.linkTitle, raw: fixture.linkTitle }), expect.any(AbortSignal)
    )
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', text: fixture.linkTitle })
    expect(fixture.clipboardText).toBe('original clipboard')
  })

  it.each([refineSelection, summarizeSelection])('keeps the other shortcuts selection-only', async start => {
    fixture.deliverText = false
    fixture.linkTitle = 'A title under the pointer'
    const pending = start()
    await vi.runAllTimersAsync()
    await pending
    expect(readLinkAtPoint).not.toHaveBeenCalled()
    expect(fixture.explain).not.toHaveBeenCalled()
    expect(fixture.shown.at(-1)?.status).toBe('error')
  })

  it.each(['own window', 'tab switch'])('does not borrow a link from an %s', async scenario => {
    fixture.deliverText = false
    fixture.linkTitle = 'Unrelated title'
    fixture.ownWindow = scenario === 'own window'
    const pending = explainSelection()
    if (scenario === 'tab switch') fixture.windowTitle = 'Another tab - Browser'
    await vi.runAllTimersAsync()
    await pending
    expect(readLinkAtPoint).not.toHaveBeenCalled()
    expect(fixture.explain).not.toHaveBeenCalled()
  })

  it('keeps repeated hotkeys serialized while accessibility is pending', async () => {
    fixture.deliverText = false
    let finish!: (value: string | null) => void
    vi.mocked(readLinkAtPoint).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = explainSelection()
    await vi.runAllTimersAsync()
    toggleOrExplain()
    expect(hidePopup).not.toHaveBeenCalled()
    await Promise.all([explainSelection(), refineSelection(), summarizeSelection()])
    expect(sendCopy).toHaveBeenCalledTimes(1)
    expect(readLinkAtPoint).toHaveBeenCalledTimes(1)
    finish('A video title with enough context to translate')
    await pending
    expect(fixture.explain).toHaveBeenCalledTimes(1)
  })

  it('ignores a tab switch during the accessibility read and recovers from reader failures', async () => {
    fixture.deliverText = false
    vi.mocked(readLinkAtPoint).mockImplementationOnce(async () => {
      fixture.windowTitle = 'Another tab - Browser'
      return 'Stale title'
    })
    const stale = explainSelection()
    await vi.runAllTimersAsync()
    await stale
    expect(fixture.explain).not.toHaveBeenCalled()
    vi.mocked(readLinkAtPoint).mockRejectedValueOnce(new Error('Unavailable'))
    const failed = explainSelection()
    await vi.runAllTimersAsync()
    await failed
    expect(fixture.shown.at(-1)?.status).toBe('error')
    fixture.deliverText = true
    const selected = explainSelection()
    await vi.runAllTimersAsync()
    await selected
    expect(fixture.shown.at(-1)?.status).toBe('done')
  })

  it('reports an empty capture accurately and lets the next selection translate', async () => {
    fixture.deliverText = false
    const failed = explainSelection()
    await vi.runAllTimersAsync()
    await failed
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'error', error: expect.stringContaining('No text was copied') })
    expect(fixture.explain).not.toHaveBeenCalled()

    fixture.deliverText = true
    const retry = explainSelection()
    await vi.runAllTimersAsync()
    await retry
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', text: fixture.sentence })
    expect(fixture.clipboardText).toBe('original clipboard')
  })
})
