import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplainState } from '../src/shared/types.js'
import type { PointRead } from '../src/core/transcript.js'
import { transcriptLineAt } from '../src/core/transcript.js'

const fixture = vi.hoisted(() => ({
  title: 'Lecture - YouTube',
  read: null as PointRead | null,
  shown: [] as ExplainState[],
  explain: vi.fn(async function* () { yield '## ZH\n这是字幕的翻译。' })
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: {}
}))
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(async () => ({ size: 0 })),
  appendFile: vi.fn(async () => {}), writeFile: vi.fn(async () => {})
}))
vi.mock('../src/main/native/index.js', () => ({
  IS_MACOS: false, copyChordLabel: () => 'Ctrl+C',
  foregroundWindowTitle: () => fixture.title, inputPermission: vi.fn()
}))
vi.mock('../src/main/coords.js', () => ({ screenToDip: (point: unknown) => point }))
vi.mock('../src/main/capture.js', () => ({ captureSelection: vi.fn() }))
vi.mock('../src/main/a11y.js', () => ({
  readTranscriptAtPoint: vi.fn(async () => ({
    text: fixture.read ? transcriptLineAt(fixture.read) : null,
    read: fixture.read
  }))
}))
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
vi.mock('../src/main/speech.js', () => ({ synthesize: vi.fn(), prefetchPronunciation: vi.fn(), cancelPronunciationPrefetch: vi.fn() }))

import { explainClickedTranscript } from '../src/main/session.js'
import { readTranscriptAtPoint } from '../src/main/a11y.js'

const point = { x: 300, y: 200 }
const video = { x: 0, y: 0, width: 640, height: 360 }
const caption = 'The server is ready and you can safely deploy the application now.'

beforeEach(() => {
  vi.clearAllMocks()
  fixture.title = 'Lecture - YouTube'
  fixture.shown = []
  fixture.read = { button: null, line: null, caption: null, video, chain: 'html5-video-player' }
})

describe('transcript-only video clicks', () => {
  it.each(['Lecture - YouTube', 'Embedded video / X'])(
    'leaves a video without accessible captions alone on %s', async title => {
      fixture.title = title
      await expect(explainClickedTranscript(point)).resolves.toBeUndefined()
      expect(readTranscriptAtPoint).toHaveBeenCalledWith(point.x, point.y)
      expect(fixture.explain).not.toHaveBeenCalled()
      expect(fixture.shown).toEqual([])
    }
  )

  it('does not substitute image text when the accessibility read fails', async () => {
    fixture.read = null
    await explainClickedTranscript(point)
    expect(fixture.explain).not.toHaveBeenCalled()
    expect(fixture.shown).toEqual([])
  })

  it('does not explain the player time readout when captions are off', async () => {
    fixture.read!.line = '0:07 / 1:30'
    await explainClickedTranscript(point)
    expect(fixture.explain).not.toHaveBeenCalled()
    expect(fixture.shown).toEqual([])
  })

  it.each(['caption', 'transcript'] as const)('still explains the page-provided %s', async source => {
    fixture.read = source === 'caption'
      ? { button: null, line: null, caption, video, chain: 'html5-video-player' }
      : { button: `1 minute, 5 seconds ${caption}`, line: null, caption: null, video: null, chain: '' }
    await explainClickedTranscript(point)
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.explain).toHaveBeenCalledWith(
      expect.objectContaining({ text: caption }), expect.any(AbortSignal)
    )
    expect(fixture.shown.at(-1)).toMatchObject({ status: 'done', text: caption })

    // A later frame without captions cannot reuse the previous caption.
    fixture.read = { button: null, line: null, caption: null, video, chain: 'html5-video-player' }
    const shown = fixture.shown.length
    await explainClickedTranscript(point)
    expect(fixture.explain).toHaveBeenCalledTimes(1)
    expect(fixture.shown).toHaveLength(shown)
  })
})
