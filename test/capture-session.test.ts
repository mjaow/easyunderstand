import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplainState } from '../src/shared/types.js'

const fixture = vi.hoisted(() => ({
  sentence: 'The server is ready and you can safely deploy the application now.',
  clipboardText: 'original clipboard',
  sequence: 1,
  deliverText: true,
  shown: [] as ExplainState[],
  explain: vi.fn(async function* () {
    yield '## ZH\n服务器已就绪，现在可以安全地部署应用程序。'
  })
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/unused' }, BrowserWindow: {}, screen: {},
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
  foregroundWindowTitle: vi.fn(), inputPermission: vi.fn(),
  isAvailable: () => true,
  clipboardSequence: () => fixture.sequence,
  sendCopy: vi.fn(() => {
    fixture.clipboardText = ''
    fixture.sequence++
    if (fixture.deliverText) {
      setTimeout(() => { fixture.clipboardText = fixture.sentence }, 60)
    }
    return 4
  })
}))
vi.mock('../src/main/coords.js', () => ({ screenToDip: vi.fn() }))
vi.mock('../src/main/a11y.js', () => ({ readTranscriptAtPoint: vi.fn() }))
vi.mock('../src/main/popup.js', () => ({
  showPopup: (value: ExplainState) => fixture.shown.push(structuredClone(value)),
  updatePopup: (value: ExplainState) => fixture.shown.push(structuredClone(value)),
  hidePopup: vi.fn(), isPopupVisible: () => false
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
vi.mock('../src/providers/tts/registry.js', () => ({ speak: vi.fn() }))

import { explainSelection, refineSelection } from '../src/main/session.js'
import { sendCopy } from '../src/main/native/index.js'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  fixture.clipboardText = 'original clipboard'
  fixture.sequence = 1
  fixture.deliverText = true
  fixture.shown = []
})
afterEach(() => { vi.useRealTimers() })

describe('selected sentence to translated popup', () => {
  it('shares safe capture between refinement and explanation when both hotkeys are pressed', async () => {
    const refine = refineSelection()
    const explain = explainSelection()
    await vi.runAllTimersAsync()
    await Promise.all([refine, explain])
    expect(sendCopy).toHaveBeenCalledTimes(1)
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.explain).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'refine', raw: fixture.sentence }), expect.any(AbortSignal)
    )
    expect(fixture.clipboardText).toBe('original clipboard')
  })
  it('captures delayed text and translates the whole sentence once during repeated hotkeys', async () => {
    const first = explainSelection()
    const repeat = explainSelection()
    await vi.runAllTimersAsync()
    await Promise.all([first, repeat])

    expect(sendCopy).toHaveBeenCalledTimes(1)
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
