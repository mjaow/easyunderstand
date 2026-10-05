import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppConfig, ExplainRequest } from '../src/shared/types.js'
import { AzureResponsesProvider, parseAzureResponsesEndpoint } from '../src/providers/llm/azure-responses.js'
import { videoKeyScope } from '../src/shared/video-settings.js'
import { resolveVideoConfig } from '../src/core/video-config.js'
import { chunkCaptions, summaryPrompt, parseSummary } from '../src/core/video.js'
import { generateVideoJson } from '../src/core/video-generation.js'
import { createLlmProvider } from '../src/providers/llm/registry.js'
import { probeProvider } from '../src/providers/llm/probe.js'
import { outputBudget, SectionParser, systemPrompt, userPrompt } from '../src/core/explain.js'
import { RefinementParser } from '../src/core/refine.js'
import { parseWatchPlanResponse, watchPlanPrompt } from '../src/core/watch-plan.js'
import type { VideoTranscript } from '../src/shared/video.js'
const secrets = vi.hoisted(() => ({ ids: [] as string[] }))
vi.mock('../src/core/config.js', () => ({ getSecret: (id: string) => { secrets.ids.push(id); return 'azure-video-fixture-key' } }))
import { createVideoProvider, testVideoModel } from '../src/main/video-model.js'

const req = { system: 'Use only supplied captions. Return JSON.', user: '[101] Cold dough rises slowly.', maxTokens: 7000, json: true }
let server: Server, endpoint: string, status: number, events: unknown[], hang: boolean
let calls: { path: string; key?: string; authorization?: string; body: Record<string, unknown> }[]
beforeEach(async () => {
  secrets.ids = []; calls = []; status = 200; hang = false
  events = [
    { type: 'response.created', response: { status: 'in_progress' } },
    { type: 'response.output_text.delta', delta: '{"answer":"Cold dough rises slowly.","sources":[101]}' },
    { type: 'response.completed', response: { status: 'completed' } }
  ]
  vi.stubEnv('EASYTRANSLATE_VIDEO_API_KEY', '')
  // Explicit client configuration must override unrelated environment routing.
  vi.stubEnv('OPENAI_BASE_URL', 'https://wrong.example.invalid/v1')
  vi.stubEnv('OPENAI_API_VERSION', 'wrong-version')
  server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    calls.push({ path: request.url!, key: request.headers['api-key'] as string | undefined,
      authorization: request.headers.authorization, body })
    if (status !== 200) {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'TestError', message: 'Fixture Azure error' } })); return
    }
    // Reproduce Azure's input-only JSON check: top-level instructions do not count.
    if (body.text?.format?.type === 'json_object' && !/json/i.test(JSON.stringify(body.input))) {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: "Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'." } })); return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
    if (!hang) response.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/openai/responses?api-version=2025-04-01-preview`
})
afterEach(async () => { vi.unstubAllEnvs(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
function config(): AppConfig {
  const c: AppConfig = {
    hotkeys: { explain: '', refine: '' }, doubleClickTranscripts: false, launchAtLogin: false,
    tts: { provider: 'system', systemVoice: '', azureRegion: '', azureVoice: '', slowRate: -40, autoPlay: false },
    llm: { provider: 'openai', models: { openai: 'qwen-flash' }, baseUrls: { openai: 'https://everyday.example.invalid/v1' }, codeModel: '',
      videoProvider: 'openai', videoProtocol: 'azure-responses', videoBaseUrl: endpoint, videoModel: 'gpt-6-astra' }
  }
  c.llm.videoKeyScope = videoKeyScope(c.llm)
  return c
}
async function generate(provider = new AzureResponsesProvider({ apiKey: 'azure-video-fixture-key', baseUrl: endpoint, model: 'gpt-6-astra' })): Promise<string> {
  let result = ''; for await (const text of provider.generate(req, new AbortController().signal)) result += text
  return result
}

describe('Azure Responses adapter', () => {
  it('generates a validated watch plan through the configured Azure GPT-6 Luna deployment', async () => {
    const c = config()
    c.llm.videoModel = 'gpt-6-luna'; c.llm.videoReasoningEffort = 'none'
    const transcript: VideoTranscript = { videoId: 'lecturetest', title: 'Chain rule', language: 'en', automatic: false,
      duration: 30, complete: true, source: 'caption-track', segments: [{ start: 0, duration: 30, text: 'Multiply local derivatives along the computation path.' }] }
    const plan = { overview: 'Understand the chain rule.', sections: [{ firstCaption: 1, title: 'Chain rule',
      recommendation: 'focus', reason: 'The central method.', learningTarget: 'Explain why local derivatives multiply.', skipCondition: '', prerequisites: [] }] }
    events = [{ type: 'response.output_text.delta', delta: JSON.stringify(plan) }, { type: 'response.completed', response: { status: 'completed' } }]
    const result = await generateVideoJson(createVideoProvider(c), watchPlanPrompt(transcript), new AbortController().signal,
      value => parseWatchPlanResponse(value, transcript, c.llm.videoModel), () => {}, { attempts: 1 })
    expect(result.model).toBe('gpt-6-luna')
    expect(result.sections[0]).toMatchObject({ firstCaption: 1, lastCaption: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ key: 'azure-video-fixture-key', path: '/openai/responses?api-version=2025-04-01-preview',
      body: { model: 'gpt-6-luna', reasoning: { effort: 'none' }, store: false, text: { format: { type: 'json_object' } } } })
    expect(secrets.ids).toEqual(['video'])
  })
  it.each(['word', 'passage', 'refine', 'code'] as const)('routes everyday %s explanations through Azure without JSON mode', async mode => {
    const c = config()
    c.llm.provider = 'azure'
    c.llm.models.azure = 'gpt-6-luna'
    c.llm.baseUrls.azure = endpoint
    c.llm.codeModel = 'my-code-deployment'
    const model = mode === 'code' ? c.llm.codeModel : c.llm.models.azure
    const p = createLlmProvider(c, 'everyday-azure-fixture-key', model)
    const reply = mode === 'code'
      ? '## LANG\nPython\n## ZH\n计算平均值。\n## EN\nComputes the average.\n## WHY\nCombines the values and divides by their count.\n## STEPS\n- Sum the values.\n- Divide by their count.\n## ISSUES\n- An empty list causes division by zero.'
      : mode === 'refine' ? 'The engineer reverted the change.'
      : '## CODE\nno\n## ZH\n工程师撤销了改动。\n## EN\nThe engineer undid the change.'
    events[1] = { type: 'response.output_text.delta', delta: reply }
    const parser = mode === 'refine' ? new RefinementParser() : new SectionParser()
    const raw = mode === 'code' ? 'def avg(xs):\n    return sum(xs) / len(xs)' : 'The engineer rolled back the change.'
    const request = { mode, text: raw, raw }
    for await (const delta of p.explain(request, new AbortController().signal)) parser.push(delta)
    const parsed = parser.end()
    if (mode === 'refine') expect(parsed.refined).toBe(reply)
    else { expect(parsed.zh).toBeTruthy(); expect(parsed.en).toBeTruthy() }
    if (mode === 'code') { expect(parsed.lang).toBe('Python'); expect(parsed.issues).toHaveLength(1) }
    expect(p.id).toBe('azure')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: '/openai/responses?api-version=2025-04-01-preview', key: 'everyday-azure-fixture-key', authorization: undefined,
      body: { model, instructions: systemPrompt(mode), input: userPrompt(request), reasoning: { effort: 'none' }, stream: true, store: false,
        max_output_tokens: outputBudget(request) + (mode === 'code' ? 2000 : 0) } })
    expect(calls[0].body).not.toHaveProperty('text')
    expect(c.llm.videoModel).toBe('gpt-6-astra')
    expect(secrets.ids).toEqual([])
  })
  it.each([
    { label: 'long translation', mode: 'passage', text: 'x'.repeat(1000) },
    { label: 'long refinement', mode: 'refine', text: 'x'.repeat(1000) },
    { label: 'long raw selection', mode: 'passage', text: 'collapsed text', raw: 'x'.repeat(1000) }
  ] satisfies (ExplainRequest & { label: string })[])('preserves output headroom for $label', async request => {
    const provider = new AzureResponsesProvider({ apiKey: 'fixture-key', baseUrl: endpoint, model: 'gpt-6-luna', reasoningEffort: 'none' })
    for await (const _delta of provider.explain(request, new AbortController().signal)) { /* drain */ }
    expect(calls).toHaveLength(1)
    expect(calls[0].body.max_output_tokens).toBe(outputBudget(request) + 2000)
  })
  it.each([undefined, 'low'] as const)('reserves reasoning tokens with effort %s', async reasoningEffort => {
    const provider = new AzureResponsesProvider({ apiKey: 'fixture-key', baseUrl: endpoint, model: 'gpt-6-luna', reasoningEffort })
    const request: ExplainRequest = { mode: 'refine', text: 'Please review this change.' }
    for await (const _delta of provider.explain(request, new AbortController().signal)) { /* drain */ }
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ reasoning: { effort: 'low' }, max_output_tokens: outputBudget(request) + 2000 })
  })
  it.each([403, 404])('reports Azure deployment HTTP %s without trying a public model catalogue', async code => {
    const c = config(); c.llm.provider = 'azure'; c.llm.models.azure = 'gpt-6-luna'; c.llm.baseUrls.azure = endpoint
    status = code
    const result = await probeProvider(c, 'everyday-azure-fixture-key')
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining(String(code)) })
    expect(result.message).not.toContain('key is valid')
    expect(result.models).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].key).toBe('everyday-azure-fixture-key')
  })
  it('parses the supplied full URL without duplicating /openai or losing its API version', () => {
    expect(parseAzureResponsesEndpoint('https://example.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview')).toEqual({
      baseURL: 'https://example.cognitiveservices.azure.com/openai', apiVersion: '2025-04-01-preview'
    })
  })
  it.each([
    'https://example.cognitiveservices.azure.com/',
    'https://example.cognitiveservices.azure.com/openai/deployments/test/chat/completions?api-version=2024-12-01-preview',
    'https://example.cognitiveservices.azure.com/openai/responses',
    'https://example.cognitiveservices.azure.com/openai/responses?api-version=wrong',
    'https://example.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview&api-version=2024-12-01-preview'
  ])('rejects an ambiguous endpoint: %s', value => {
    expect(() => parseAzureResponsesEndpoint(value)).toThrow()
  })
  it('uses Azure api-key authentication, the exact deployment and the Responses schema', async () => {
    expect(JSON.parse(await generate())).toMatchObject({ sources: [101] })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: '/openai/responses?api-version=2025-04-01-preview', key: 'azure-video-fixture-key', authorization: undefined,
      body: { model: 'gpt-6-astra', input: expect.stringContaining(req.user), instructions: req.system, max_output_tokens: 7000,
        reasoning: { effort: 'low' }, text: { format: { type: 'json_object' } }, stream: true, store: false } })
    expect(calls[0].body).not.toHaveProperty('messages')
    expect(calls[0].body).not.toHaveProperty('max_completion_tokens')
  })
  it('routes the real connection test through Azure using only the dedicated video key', async () => {
    const c = config()
    expect(await testVideoModel(c)).toMatchObject({ ok: true })
    expect(secrets.ids).toEqual(['video'])
    expect(calls[0].path).toBe('/openai/responses?api-version=2025-04-01-preview')
    expect(c.llm.models.openai).toBe('qwen-flash')
    expect(c.llm.baseUrls.openai).toBe('https://everyday.example.invalid/v1')
    expect(calls[0].body.reasoning).toEqual({ effort: 'low' })
  })
  it.each(['gpt-6-luna', 'my-fast-transcript-deployment'])('sends explicit none reasoning for deployment %s', async deployment => {
    const c = config()
    c.llm.videoModel = deployment
    c.llm.videoReasoningEffort = 'none'
    expect(await testVideoModel(c)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: '/openai/responses?api-version=2025-04-01-preview', key: 'azure-video-fixture-key',
      body: { model: deployment, reasoning: { effort: 'none' }, text: { format: { type: 'json_object' } } } })
    expect(secrets.ids).toEqual(['video'])
  })
  it('runs the production whole-transcript summary with valid citation IDs', async () => {
    const chunk = chunkCaptions([{ start: 0, duration: 5, text: 'Baker: Cold dough rises slowly.' }])[0]
    const prompt = summaryPrompt(chunk.text)
    const result = { overview: 'The baker says cold dough rises slowly.', takeaways: [{ text: 'Cold dough rises slowly.', sources: [1] }], connections: '', evaluation: [], ideas: [{ title: 'Cold dough', claim: 'The baker says cold dough rises slowly.',
      reasoning: 'Not explained in this section', example: 'Not provided in this section',
      caveat: 'Not provided in this section', sources: [1] }], unanswered: [] }
    events[1] = { type: 'response.output_text.delta', delta: JSON.stringify(result) }
    expect(await generateVideoJson(createVideoProvider(config()), prompt, new AbortController().signal,
      value => parseSummary(value, chunk), () => {}, { attempts: 1 })).toEqual(result)
    expect(calls).toHaveLength(1)
    expect(calls[0].body.instructions).toEqual(expect.stringContaining('JSON'))
    expect(calls[0].body.input).toEqual(expect.stringContaining(chunk.text))
  })
  it('leaves non-JSON input and output format unchanged', async () => {
    const provider = createVideoProvider(config())
    let output = ''
    for await (const text of provider.generate({ ...req, json: false }, new AbortController().signal)) output += text
    expect(output).toContain('Cold dough')
    expect(calls[0].body.input).toBe(req.user)
    expect(calls[0].body.instructions).toBe(req.system)
    expect(calls[0].body).not.toHaveProperty('text')
  })
  it('requires saving an Azure key instead of reusing a standard-protocol key', () => {
    const c = config(); c.llm.videoKeyScope = `openai|${endpoint}`
    expect(() => createVideoProvider(c)).toThrow(/dedicated video API key/)
    expect(secrets.ids).toEqual([])
    const standard = { ...c, llm: { ...c.llm, videoProtocol: 'standard' as const } }
    expect(resolveVideoConfig(c).endpoint).not.toBe(resolveVideoConfig(standard).endpoint)
  })
  it.each([401, 403, 404, 429])('reports Azure HTTP %s without hidden retries', async code => {
    status = code
    expect(await testVideoModel(config())).toMatchObject({ ok: false, message: expect.stringContaining(String(code)) })
    expect(calls).toHaveLength(1)
  })
  it.each([
    { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
    { type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } },
    { type: 'response.failed', response: { error: { message: 'Fixture failure' } } },
    { type: 'response.refusal.delta', delta: 'Fixture refusal' }
  ])('fails on $type even when preceding text looks like valid JSON', async event => {
    events[2] = event
    await expect(generate()).rejects.toThrow(/Azure/)
    expect(calls).toHaveLength(1)
  })
  it('does not accept a stream that ended before response.completed', async () => {
    events.pop()
    await expect(generate()).rejects.toThrow(/ended before completion/)
  })
  it('finishes at response.completed even when the server leaves HTTP open', async () => {
    hang = true
    const transport = vi.fn<typeof fetch>((input, init) => fetch(input, init))
    const c = config(); c.llm.provider = 'azure'; c.llm.models.azure = 'gpt-6-luna'; c.llm.baseUrls.azure = endpoint
    const provider = createLlmProvider(c, 'everyday-azure-fixture-key', undefined, transport)
    const controller = new AbortController()
    const guard = setTimeout(() => controller.abort(new Error('Waited for HTTP close')), 1000)
    try {
      let output = ''
      for await (const text of provider.generate(req, controller.signal)) output += text
      expect(output).toContain('Cold dough')
      expect(controller.signal.aborted).toBe(false)
      expect(transport).toHaveBeenCalledTimes(1)
      expect(calls[0].key).toBe('everyday-azure-fixture-key')
    } finally { clearTimeout(guard) }
  })
  it('aborts an active Azure stream when the user cancels', async () => {
    events.pop(); hang = true
    const provider = new AzureResponsesProvider({ apiKey: 'azure-video-fixture-key', baseUrl: endpoint, model: 'gpt-6-astra' })
    const controller = new AbortController()
    const stream = provider.generate(req, controller.signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toContain('Cold dough')
    controller.abort()
    await expect(stream.next()).rejects.toThrow()
  })
})
