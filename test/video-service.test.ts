import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { VideoAnalysis, VideoEvent, VideoTranscript, VideoWatchPlan } from '../src/shared/video.js'
import type { GenerationRequest } from '../src/providers/llm/types.js'
import type { AppConfig } from '../src/shared/types.js'

const mocks = vi.hoisted(() => ({ directory: '', calls: [] as string[], replies: [] as unknown[],
  delayMs: 0, config: {} as AppConfig, providerConfigs: [] as AppConfig[], secretIds: [] as string[], providerKeys: [] as (string | null)[], providerModels: [] as string[] }))
vi.mock('electron', () => ({ app: { getPath: () => mocks.directory } }))
vi.mock('../src/core/config.js', () => ({
  __resetCache: () => {}, getSecret: (id: string) => { mocks.secretIds.push(id); return `test-${id}-key` },
  loadConfig: () => mocks.config
}))
vi.mock('../src/providers/llm/registry.js', () => ({ createLlmProvider: (config: AppConfig, key: string | null, model: string) => {
  mocks.providerConfigs.push(config); mocks.providerKeys.push(key); mocks.providerModels.push(model)
  return {
  async *generate(request: GenerationRequest) {
    mocks.calls.push(request.user)
    if (!mocks.replies.length) throw new Error('Unexpected model request')
    if (mocks.delayMs) await new Promise(resolve => setTimeout(resolve, mocks.delayMs))
    yield JSON.stringify(mocks.replies.shift())
  }
} } }))
import { handleVideo } from '../src/main/video-service.js'
const t: VideoTranscript = { videoId: 'B7yl7fEHeKM', title: 'Interview', language: 'en', automatic: true,
  duration: 3921, source: 'caption-track', complete: true,
  segments: [{ start: 327, duration: 3, text: 'Stagnation has risks too.' }, { start: 3880, duration: 5, text: 'My closing view is about totalitarianism.' }] }
const idea = { title: 'Progress', claim: 'Stagnation has risks.', reasoning: 'Not explained here.', example: 'Not given.', caveat: 'A stated view.', sources: [1] }
const assessment = { claim: 'Stagnation is risky.', support: 'The speaker gives an assertion.', limits: 'The comparison remains untested.', test: '', sources: [1] }
const summary = { overview: 'Central argument.', takeaways: [{ text: 'Stagnation is also risky.', sources: [1] }], connections: 'An interpretation.', ideas: [idea], evaluation: [assessment], unanswered: [] }
let events: Omit<VideoEvent, 'id'>[]
const emit = (event: Omit<VideoEvent, 'id'>): void => { events.push(event) }
const signal = (): AbortSignal => new AbortController().signal
async function analyze(): Promise<VideoAnalysis> {
  mocks.replies.push(summary)
  await handleVideo({ id: 'a', action: 'analyze', transcript: t }, emit, signal())
  return events.at(-1)!.result as VideoAnalysis
}
beforeEach(() => {
  mocks.directory = mkdtempSync(join(tmpdir(), 'easytranslate-video-test-')); mocks.calls = []; mocks.replies = []; events = []
  mocks.delayMs = 0
  mocks.providerConfigs = []; mocks.secretIds = []; mocks.providerKeys = []; mocks.providerModels = []
  mocks.config = {
    hotkeys: { explain: 'Ctrl+Alt+E', refine: 'Ctrl+Alt+R' }, doubleClickTranscripts: false,
    unverifiedPronunciations: false, launchAtLogin: false,
    tts: { provider: 'system', systemVoice: '', azureRegion: '', azureVoice: '', slowRate: -40, autoPlay: false },
    llm: { provider: 'openai', codeModel: '', videoModel: 'test-model', models: { openai: 'translation-model' }, baseUrls: { openai: 'https://example.test/v1' },
      videoProvider: 'openai', videoBaseUrl: 'https://video.example.test/v1', videoKeyScope: 'openai|https://video.example.test/v1' }
  }
  vi.stubEnv('EASYTRANSLATE_VIDEO_API_KEY', '')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  // Recursive removal is limited to the exact temporary directory created above.
  if (dirname(resolve(mocks.directory)) !== resolve(tmpdir())) throw new Error('Unsafe test cleanup path')
  rmSync(mocks.directory, { recursive: true, force: true })
})
describe('video workflow', () => {
  const plan = { overview: 'Follow the reasoning through the ending.', sections: [{ firstCaption: 1, lastCaption: 2,
    title: 'Risks of stagnation', recommendation: 'focus', reason: 'Contains the argument and its conclusion.',
    learningTarget: 'Explain the proposed connection.', skipCondition: '', prerequisites: [] }] }
  const planRequest = () => ({ id: 'plan', action: 'watch-plan' as const, transcript: t })

  it('returns and caches a complete 768-caption watch plan from one request containing every caption', async () => {
    const transcript = { ...t, videoId: 'kaxh-zH_G0k', duration: 5096,
      segments: Array.from({ length: 768 }, (_, i) => ({ start: i * 5096 / 768, duration: 5096 / 768, text: `Synthetic lecture caption ${i + 1}.` })) }
    const { lastCaption: _end, ...first } = plan.sections[0]
    const starts = [1, 36, 117, 204, 356, 512, 689, 752]
    mocks.replies.push({ ...plan, sections: starts.map(firstCaption => ({ ...first, firstCaption })) })
    const request = { ...planRequest(), transcript }
    await handleVideo(request, emit, signal())
    const result = events.at(-1)!.result as VideoWatchPlan
    expect(mocks.calls).toHaveLength(1)
    for (let id = 1; id <= 768; id++) expect(mocks.calls[0]).toContain(`[${id}] (`)
    expect(result.sections.map(s => [s.firstCaption, s.lastCaption])).toEqual([
      [1, 35], [36, 116], [117, 203], [204, 355], [356, 511], [512, 688], [689, 751], [752, 768]
    ])
    await handleVideo(request, emit, signal())
    expect(events.at(-1)).toMatchObject({ cached: true, result })
    expect(mocks.calls).toHaveLength(1)
  })

  it('plans independently of the summary with the same video model/key, then caches by title and description', async () => {
    mocks.replies.push(plan)
    await handleVideo(planRequest(), emit, signal())
    expect(events.at(-1)).toMatchObject({ result: { model: 'test-model', sections: plan.sections } })
    expect(mocks.providerModels).toEqual(['test-model'])
    expect(mocks.secretIds).toEqual(['video'])
    expect(mocks.calls[0]).toContain(t.segments[1].text)
    expect(mocks.calls).toHaveLength(1)
    await handleVideo(planRequest(), emit, signal())
    expect(events.at(-1)?.cached).toBe(true)
    expect(mocks.calls).toHaveLength(1)
    for (const change of [{ title: 'A new lecture title' }, { description: 'Theory and derivations' }, { description: 'Implementation tutorial' }]) {
      mocks.replies.push(plan)
      await handleVideo({ ...planRequest(), transcript: { ...t, ...change } }, emit, signal())
      expect(events.at(-1)?.cached).not.toBe(true)
    }
    expect(mocks.calls).toHaveLength(4)
    await analyze()
    expect(mocks.calls).toHaveLength(5)
    await handleVideo({ id: 'clear', action: 'clear-cache' }, emit, signal())
    expect(events.at(-1)).toMatchObject({ result: { cleared: 5, failed: 0 } })
  })

  it('refreshes watch plans explicitly and isolates changed model settings', async () => {
    mocks.replies.push(plan, plan, plan)
    await handleVideo(planRequest(), emit, signal())
    await handleVideo({ ...planRequest(), fresh: true }, emit, signal())
    mocks.config.llm.videoModel = 'another-deployment'
    await handleVideo(planRequest(), emit, signal())
    expect(mocks.calls).toHaveLength(3)
    expect(events.at(-1)).toMatchObject({ result: { model: 'another-deployment' } })
  })

  it('does not cache malformed or cancelled plans or retry model requests silently', async () => {
    mocks.replies.push({ ...plan, sections: [{ ...plan.sections[0], lastCaption: 1 }] })
    await expect(handleVideo(planRequest(), emit, signal())).rejects.toThrow('the end of the lecture is missing.\nClick Plan watch to retry.')
    expect(mocks.calls).toHaveLength(1)
    expect(existsSync(join(mocks.directory, 'video-cache'))).toBe(false)
    mocks.replies.push(plan); mocks.delayMs = 30
    const controller = new AbortController()
    const pending = handleVideo(planRequest(), emit, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(existsSync(join(mocks.directory, 'video-cache'))).toBe(false)
  })

  it('regenerates incomplete cached ranges instead of treating them as model boundaries', async () => {
    mocks.replies.push(plan)
    await handleVideo(planRequest(), emit, signal())
    const directory = join(mocks.directory, 'video-cache')
    const file = join(directory, readdirSync(directory)[0])
    const { lastCaption: _end, ...boundary } = plan.sections[0]
    for (const invalid of [boundary, { ...boundary, lastCaption: 1 }]) {
      writeFileSync(file, JSON.stringify({ ...plan, sections: [invalid] }))
      mocks.replies.push({ ...plan, sections: [boundary] })
      await handleVideo(planRequest(), emit, signal())
      expect(events.at(-1)).toMatchObject({ result: { sections: plan.sections } })
      expect(events.at(-1)?.cached).not.toBe(true)
    }
    expect(mocks.calls).toHaveLength(3)
    await handleVideo(planRequest(), emit, signal())
    expect(events.at(-1)?.cached).toBe(true)
    expect(mocks.calls).toHaveLength(3)
  })

  it('rejects oversized descriptions before retrieving a secret or making a model request', async () => {
    await expect(handleVideo({ ...planRequest(), transcript: { ...t, description: 'x'.repeat(20001) } }, emit, signal())).rejects.toThrow(/complete caption transcript/)
    expect(mocks.secretIds).toEqual([])
    expect(mocks.calls).toEqual([])
  })
  it('clears video cache without credentials or a model call, then regenerates the next summary', async () => {
    const result = await analyze()
    const cache = join(mocks.directory, 'video-cache')
    writeFileSync(join(cache, `${'f'.repeat(64)}.json`), JSON.stringify({ ...result, translationModel: 'translator' }))
    const settings = join(mocks.directory, 'config.json')
    writeFileSync(settings, 'keep settings')
    const scope = mocks.config.llm.videoKeyScope
    mocks.config.llm.videoKeyScope = undefined
    const calls = mocks.calls.length, secrets = mocks.secretIds.length
    await handleVideo({ id: 'clear', action: 'clear-cache' }, emit, signal())
    expect(events.at(-1)).toEqual({ type: 'result', result: { cleared: 2, failed: 0 } })
    expect(mocks.calls).toHaveLength(calls)
    expect(mocks.secretIds).toHaveLength(secrets)
    expect(readdirSync(cache)).toEqual([])
    expect(readFileSync(settings, 'utf8')).toBe('keep settings')
    mocks.config.llm.videoKeyScope = scope
    await analyze()
    expect(mocks.calls).toHaveLength(calls + 1)
    expect(events.at(-1)?.cached).not.toBe(true)
  })

  it('uses a dedicated provider and key without changing explanation settings', async () => {
    mocks.config.llm = { ...mocks.config.llm, videoProvider: 'claude', videoBaseUrl: 'https://video.example.test', videoKeyScope: 'claude|https://video.example.test' }
    await analyze()
    expect(mocks.providerConfigs[0].llm.provider).toBe('claude')
    expect(mocks.providerConfigs[0].llm.baseUrls.claude).toBe('https://video.example.test')
    expect(mocks.providerKeys).toEqual(['test-video-key'])
    expect(mocks.secretIds).toEqual(['video'])
    expect(mocks.config.llm.provider).toBe('openai')
    expect(mocks.config.llm.baseUrls.openai).toBe('https://example.test/v1')
  })
  it('never routes a saved video key to a changed endpoint', async () => {
    mocks.config.llm = { ...mocks.config.llm, videoProvider: 'openai', videoBaseUrl: 'https://new.example.test', videoKeyScope: 'openai|https://old.example.test' }
    await expect(analyze()).rejects.toThrow(/Save the dedicated video API key/)
    expect(mocks.secretIds).toEqual([])
    expect(mocks.providerConfigs).toEqual([])
  })
  it('returns the summary first with all captions in one call, and reopens from cache', async () => {
    const result = await analyze()
    expect(result.ideas[0].sources).toEqual([1])
    expect(mocks.calls[0]).toContain('[2] My closing view is about totalitarianism.')
    expect(mocks.calls).toHaveLength(1)
    expect(result.overview).toBe('Central argument.')
    expect(result.takeaways).toEqual(summary.takeaways)
    expect(result.evaluation).toEqual([assessment])
    expect(events.some(e => e.type === 'idea')).toBe(false)
    const count = mocks.calls.length
    await handleVideo({ id: 'b', action: 'analyze', transcript: t }, emit, signal())
    expect(mocks.calls).toHaveLength(count)
    expect(events.at(-1)!.cached).toBe(true)
    expect(events.at(-1)!.timing).toEqual({ modelMs: 0 })
  })
  it('measures the full model request and makes exactly one new call for an explicit rerun', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    mocks.delayMs = 1250
    const first = analyze()
    await vi.advanceTimersByTimeAsync(1250)
    await first
    expect(events.at(-1)!.timing).toEqual({ modelMs: 1250 })
    mocks.delayMs = 750
    mocks.replies.push({ ...summary, overview: 'A fresh summary.' })
    const rerun = handleVideo({ id: 'fresh', action: 'analyze', transcript: t, fresh: true }, emit, signal())
    await vi.advanceTimersByTimeAsync(750)
    await rerun
    expect(mocks.calls).toHaveLength(2)
    expect(events.at(-1)!.cached).not.toBe(true)
    expect(events.at(-1)!.timing).toEqual({ modelMs: 750 })
    expect(events.at(-1)!.result).toMatchObject({ overview: 'A fresh summary.' })
    await handleVideo({ id: 'cached', action: 'analyze', transcript: t }, emit, signal())
    expect(mocks.calls).toHaveLength(2)
    expect(events.at(-1)!).toMatchObject({ cached: true, timing: { modelMs: 0 }, result: { overview: 'A fresh summary.' } })
  })
  it('cleans old saved summaries on ping without a model call, then regenerates on analysis', async () => {
    await analyze()
    const directory = join(mocks.directory, 'video-cache')
    const file = join(directory, readdirSync(directory)[0])
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    utimesSync(file, old, old)
    await handleVideo({ id: 'ping', action: 'ping' }, emit, signal())
    expect(existsSync(file)).toBe(false)
    expect(mocks.calls).toHaveLength(1)
    await analyze()
    expect(mocks.calls).toHaveLength(2)
    expect(events.at(-1)!.cached).not.toBe(true)
  })
  it('translates the same fields, preserves citations, and does no automatic translation', async () => {
    const english = await analyze()
    expect(mocks.calls.some(c => c.includes('Simplified Chinese'))).toBe(false)
    // Translation of cached analysis needs only the everyday credentials.
    mocks.config.llm.videoKeyScope = undefined
    mocks.replies.push({ strings: ['核心论点。', '一种解释。', '停滞同样有风险。', '进步', '停滞也有风险。', '这里没有解释。', '没有例子。', '说话者的观点。', '停滞有风险。', '说话者给出一个断言。', '比较尚未验证。', ''] })
    await handleVideo({ id: 'c', action: 'translate', transcript: t }, emit, signal())
    const chinese = events.at(-1)!.result as VideoAnalysis
    expect(chinese.evaluation).toEqual([{ claim: '停滞有风险。', support: '说话者给出一个断言。', limits: '比较尚未验证。', test: '', sources: [1] }])
    expect(chinese.ideas[0].sources).toEqual(english.ideas[0].sources)
    expect(chinese.ideas[0].claim).toBe('停滞也有风险。')
    expect(chinese.takeaways).toEqual([{ text: '停滞同样有风险。', sources: [1] }])
    expect(chinese.ideas).toHaveLength(english.ideas.length)
    expect(chinese.model).toBe('test-model')
    expect(chinese.translationModel).toBe('translation-model')
    expect(mocks.providerKeys).toEqual(['test-video-key', 'test-openai-key'])
    expect(mocks.providerModels).toEqual(['test-model', 'translation-model'])
    expect(mocks.providerConfigs.at(-1)!.llm.baseUrls.openai).toBe('https://example.test/v1')
    const count = mocks.calls.length
    await handleVideo({ id: 'cached', action: 'translate', transcript: t }, emit, signal())
    expect(events.at(-1)!.cached).toBe(true)
    expect(mocks.calls).toHaveLength(count)
    mocks.config.llm.models.openai = 'new-translation-model'
    mocks.replies.push({ strings: ['新译文。', '解释。', '停滞同样有风险。', '进步', '停滞也有风险。', '未解释。', '无例子。', '观点。', '停滞有风险。', '说话者给出一个断言。', '比较尚未验证。', ''] })
    await handleVideo({ id: 'changed', action: 'translate', transcript: t }, emit, signal())
    expect(mocks.calls).toHaveLength(count + 1)
    expect((events.at(-1)!.result as VideoAnalysis).translationModel).toBe('new-translation-model')
    // The everyday model change does not invalidate the English analysis.
    await handleVideo({ id: 'en', action: 'analyze', transcript: t }, emit, signal())
    expect(events.at(-1)!.cached).toBe(true)
  })
  it('answers from original captions even when a point is absent from the overview', async () => {
    await analyze()
    mocks.replies.push({ answer: 'The closing concern is totalitarianism.', sources: [2] }, { answer: 'He expresses concern about totalitarianism.', sources: [2] })
    await handleVideo({ id: 'q', action: 'question', transcript: t, question: 'What is his closing concern?' }, emit, signal())
    expect(mocks.calls.at(-2)).toContain('[2] My closing view is about totalitarianism.')
    expect(events.at(-1)!.result).toMatchObject({ sources: [2] })
    expect(mocks.providerKeys).toEqual(['test-video-key', 'test-video-key'])
  })
  it('rejects an invented evidence ID without a hidden second summary request', async () => {
    mocks.replies.push({ ...summary, ideas: [{ ...idea, sources: [999] }] })
    await expect(handleVideo({ id: 'a', action: 'analyze', transcript: t }, emit, signal())).rejects.toThrow(/outside/)
    expect(events.some(e => e.type === 'result')).toBe(false)
    expect(mocks.calls).toHaveLength(1)
  })
  it('returns and caches every valid theme beyond eight without a second model call', async () => {
    const ideas = Array.from({ length: 9 }, (_, index) => ({ ...idea, title: `Theme ${index + 1}` }))
    mocks.replies.push({ ...summary, ideas })
    await handleVideo({ id: 'extra-themes', action: 'analyze', transcript: t }, emit, signal())
    expect(events.at(-1)).toMatchObject({ type: 'result', result: { overview: summary.overview, ideas } })
    expect(mocks.calls).toHaveLength(1)
    await handleVideo({ id: 'cached-extra-themes', action: 'analyze', transcript: t }, emit, signal())
    expect(events.at(-1)).toMatchObject({ cached: true, result: { ideas } })
    expect(mocks.calls).toHaveLength(1)
  })
  it('returns and caches all supported takeaways beyond six without a second model call', async () => {
    const takeaways = Array.from({ length: 7 }, (_, index) => ({ text: `Supported point ${index + 1}.`, sources: [1, 2] }))
    mocks.replies.push({ ...summary, takeaways })
    await handleVideo({ id: 'extra-takeaways', action: 'analyze', transcript: t }, emit, signal())
    expect(events.at(-1)).toMatchObject({ type: 'result', result: { overview: summary.overview, takeaways } })
    expect(mocks.calls).toHaveLength(1)
    await handleVideo({ id: 'cached-extra-takeaways', action: 'analyze', transcript: t }, emit, signal())
    expect(events.at(-1)).toMatchObject({ cached: true, result: { takeaways } })
    expect(mocks.calls).toHaveLength(1)
  })
  it('rejects an unsupported seventh takeaway without caching or retrying', async () => {
    const takeaways = [...Array(6).fill(summary.takeaways[0]), { text: 'Unsupported point.', sources: [999] }]
    mocks.replies.push({ ...summary, takeaways })
    await expect(handleVideo({ id: 'bad-takeaway', action: 'analyze', transcript: t }, emit, signal())).rejects.toThrow(/outside/)
    expect(events.some(e => e.type === 'result')).toBe(false)
    expect(mocks.calls).toHaveLength(1)
    await analyze()
    expect(events.at(-1)!.cached).not.toBe(true)
    expect(mocks.calls).toHaveLength(2)
  })
  it('returns and caches cited unanswered questions as strings without a second model call', async () => {
    const question = 'How should we handle the closing concern?'
    const transcript = { ...t, segments: [...t.segments, { start: 3890, duration: 5, text: question }] }
    mocks.replies.push({ ...summary, unanswered: [{ question, sources: [3] }] })
    await handleVideo({ id: 'questions', action: 'analyze', transcript }, emit, signal())
    expect(events.at(-1)!.result).toMatchObject({ overview: summary.overview, unanswered: [question] })
    expect(mocks.calls).toHaveLength(1)
    await handleVideo({ id: 'cached-questions', action: 'analyze', transcript }, emit, signal())
    expect(events.at(-1)).toMatchObject({ cached: true, result: { unanswered: [question] } })
    expect(mocks.calls).toHaveLength(1)
  })
  it('rejects invalid unanswered question references without caching or retrying', async () => {
    mocks.replies.push({ ...summary, unanswered: [{ question: 'An unresolved question?', sources: [999] }] })
    await expect(handleVideo({ id: 'questions', action: 'analyze', transcript: t }, emit, signal())).rejects.toThrow(/outside/)
    expect(events.some(e => e.type === 'result')).toBe(false)
    expect(mocks.calls).toHaveLength(1)
    await analyze()
    expect(events.at(-1)!.cached).not.toBe(true)
    expect(mocks.calls).toHaveLength(2)
  })
  it('does not call a model for incomplete or cancelled input', async () => {
    await expect(handleVideo({ id: 'a', action: 'analyze', transcript: { ...t, complete: false } as unknown as VideoTranscript }, emit, signal())).rejects.toThrow(/complete/)
    const controller = new AbortController(); controller.abort()
    await expect(handleVideo({ id: 'a', action: 'analyze', transcript: t }, emit, controller.signal)).rejects.toThrow()
    expect(mocks.calls).toHaveLength(0)
  })
  it('sends even very long transcripts once, including every caption and the ending', async () => {
    const long = { ...t, segments: Array.from({ length: 31 }, (_, i) => ({ start: i * 10, duration: 10, text: `Caption-${i + 1}: ${'evidence '.repeat(535)}` })) }
    mocks.replies.push({ ...summary, ideas: [{ ...idea, sources: [1, 31] }] })
    await handleVideo({ id: 'long', action: 'analyze', transcript: long }, emit, signal())
    expect(mocks.calls).toHaveLength(1)
    expect(mocks.calls[0].length).toBeGreaterThan(70000)
    for (const [index, caption] of long.segments.entries()) expect(mocks.calls[0]).toContain(`[${index + 1}] ${caption.text}`)
    expect(events.at(-1)!.result).toMatchObject({ overview: summary.overview, ideas: [{ sources: [1, 31] }] })
  })
})
