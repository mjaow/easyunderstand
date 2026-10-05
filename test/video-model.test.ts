import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppConfig } from '../src/shared/types.js'
const secret = vi.hoisted(() => ({ value: 'video-test-key' as string | null, ids: [] as string[] }))
vi.mock('../src/core/config.js', () => ({ getSecret: (id: string) => { secret.ids.push(id); return secret.value } }))
import { testVideoModel } from '../src/main/video-model.js'

let server: Server, config: AppConfig
let status: number, response: unknown, requests: { authorization?: string; body: Record<string, unknown> }[]
beforeEach(async () => {
  secret.value = 'video-test-key'; secret.ids = []; requests = []; status = 200
  response = { answer: 'Because cold dough rises more slowly, judge readiness by expansion rather than a fixed timer.', sources: [101, 102] }
  vi.stubEnv('EASYTRANSLATE_VIDEO_API_KEY', '')
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push({ authorization: req.headers.authorization, body: JSON.parse(body) })
    if (status !== 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Test rejection', type: 'test' } })); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(response) }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  config = {
    hotkeys: { explain: '', refine: '' }, doubleClickTranscripts: false,
    unverifiedPronunciations: false, launchAtLogin: false,
    tts: { provider: 'system', systemVoice: '', azureRegion: '', azureVoice: '', slowRate: -40, autoPlay: false },
    llm: { provider: 'openai', models: { openai: 'everyday-model' }, baseUrls: { openai: 'https://daily.example.invalid/v1' }, codeModel: '',
      videoProvider: 'openai', videoModel: 'gemini-3.8-flash', videoBaseUrl: base, videoKeyScope: `openai|${base}` }
  }
})
afterEach(async () => { vi.unstubAllEnvs(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })

describe('video connection test', () => {
  it('calls the exact video model using only the video key and checks streamed JSON', async () => {
    expect(await testVideoModel(config)).toMatchObject({ ok: true })
    expect(secret.ids).toEqual(['video'])
    expect(requests).toHaveLength(1)
    expect(requests[0].authorization).toBe('Bearer video-test-key')
    expect(requests[0].body).toMatchObject({ model: 'gemini-3.8-flash', stream: true, response_format: { type: 'json_object' }, max_tokens: 1200 })
    expect(config.llm.models.openai).toBe('everyday-model')
  })
  it('refuses a key bound to a different endpoint before making a request', async () => {
    config.llm.videoKeyScope = 'openai|https://old.example.invalid/v1'
    expect(await testVideoModel(config)).toMatchObject({ ok: false, message: expect.stringMatching(/dedicated video API key/) })
    expect(secret.ids).toEqual([])
    expect(requests).toHaveLength(0)
  })
  it('reports a missing video key without falling back to the everyday key', async () => {
    secret.value = null
    expect(await testVideoModel(config)).toMatchObject({ ok: false, message: expect.stringMatching(/No video API key/) })
    expect(secret.ids).toEqual(['video'])
    expect(requests).toHaveLength(0)
  })
  it.each([401, 403, 404, 429])('reports HTTP %s without retrying or claiming model access', async code => {
    status = code
    expect(await testVideoModel(config)).toMatchObject({ ok: false, message: expect.stringContaining(String(code)) })
    expect(requests).toHaveLength(1)
  })
  it('does not pass a response with invented caption references', async () => {
    response = { answer: 'Unsupported.', sources: [1] }
    expect(await testVideoModel(config)).toMatchObject({ ok: false, message: expect.stringMatching(/outside/) })
    expect(requests).toHaveLength(2)
  })
})
