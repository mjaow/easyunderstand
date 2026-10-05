// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelTarget, VideoAction } from '../extension/background.js'
import type { VideoEvent, VideoRequest, VideoTranscript } from '../src/shared/video.js'
import { watchPositionKey, watchViewKey } from '../extension/watch-view-state.js'

const transcript: VideoTranscript = {
  videoId: 'jNQXAC9IVRw', title: 'Current lecture', language: 'en', automatic: false,
  duration: 60, source: 'caption-track', complete: true,
  segments: [{ start: 0, duration: 60, text: 'Learn how the method works.' }]
}
const requests: VideoRequest[] = []
const stored: Record<string, unknown> = {}
let onChange: Parameters<typeof chrome.storage.onChanged.addListener>[0]
let onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0]
let onRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0]
const query = vi.fn(), readStorage = vi.fn(), executeScript = vi.fn()
let reply: (send: () => void, request: VideoRequest) => void
const get = (id: string): HTMLElement => document.getElementById(id)!
function target(action: VideoAction, token = 'first-click'): PanelTarget {
  return { tabId: 2, windowId: 1, videoId: transcript.videoId, title: transcript.title,
    start: true, token, action, clickedAt: performance.timeOrigin + performance.now() }
}
function publish(next: PanelTarget): void {
  stored['target:1'] = next
  onChange({ 'target:1': { newValue: next } }, 'session')
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function finished(action: VideoAction): Promise<void> {
  await vi.waitFor(() => {
    expect((get(action === 'watch-plan' ? 'plan-watch' : 'understand') as HTMLButtonElement).disabled).toBe(false)
    expect(get('error').hidden).toBe(true)
    expect(get(action === 'watch-plan' ? 'watch-result' : 'overview-card').hidden).toBe(false)
  })
}
function expectView(action: VideoAction): void {
  const planning = action === 'watch-plan'
  expect(get('panel-heading').textContent).toBe(planning ? 'Plan watch' : 'Understand video')
  expect(get('understand').hidden).toBe(planning)
  expect(get('plan-watch').hidden).toBe(!planning)
  expect(get('summary-view').hidden).toBe(planning)
  expect(get('summary-timing-view').hidden).toBe(planning)
  expect(get('watch-plan-section').hidden).toBe(!planning)
}

beforeEach(() => {
  vi.resetModules()
  requests.length = 0
  for (const key of Object.keys(stored)) delete stored[key]
  document.body.innerHTML = readFileSync('extension/sidepanel.html', 'utf8')
  document.documentElement.scrollTop = 0
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  query.mockReset().mockResolvedValue([{ id: 2, windowId: 1, url: `https://www.youtube.com/watch?v=${transcript.videoId}` }])
  readStorage.mockReset().mockImplementation(async () => ({ ...stored }))
  executeScript.mockReset().mockResolvedValue([{ result: { transcript } }])
  reply = send => queueMicrotask(send)
  vi.stubGlobal('chrome', {
    windows: { getCurrent: async () => ({ id: 1 }) },
    storage: { session: {
      get: readStorage,
      set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)) },
      remove: async (keys: string | string[]) => { for (const key of [keys].flat()) delete stored[key] }
    }, onChanged: { addListener: (listener: typeof onChange) => { onChange = listener } } },
    tabs: { query,
      onUpdated: { addListener: (listener: typeof onUpdated) => { onUpdated = listener } },
      onRemoved: { addListener: (listener: typeof onRemoved) => { onRemoved = listener } }
    },
    scripting: { executeScript },
    runtime: { connectNative: () => {
      let listener: (event: VideoEvent) => void
      let disconnected = false
      return {
        onMessage: { addListener: (callback: typeof listener) => { listener = callback } },
        onDisconnect: { addListener: vi.fn() },
        disconnect: () => { disconnected = true },
        postMessage: (request: VideoRequest) => {
          requests.push(request)
          const result: VideoEvent['result'] = request.action === 'clear-cache' ? { cleared: 1, failed: 0 }
            : request.action === 'ping' ? { model: 'fixture' }
            : request.action === 'watch-plan' ? { model: 'fixture', overview: 'Focus on the method.', sections: [{
              firstCaption: 1, lastCaption: 1, title: 'The method', recommendation: 'focus', reason: 'The core explanation.',
              learningTarget: 'Explain the method.', skipCondition: '', prerequisites: []
            }] }
              : { model: 'fixture', overview: 'How the method works.', takeaways: [], ideas: [], evaluation: [], connections: '', unanswered: [], sections: 1 }
          reply(() => { if (!disconnected) listener({ id: request.id, type: 'result', result }) }, request)
        }
      }
    } }
  })
})
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('one-click video panels', () => {
  it.each<VideoAction>(['analyze', 'watch-plan'])('opens only the %s view and starts it without a second click', async action => {
    stored['target:1'] = target(action)
    await import('../extension/sidepanel.js')
    await finished(action)
    expectView(action)
    expect(requests.map(request => request.action)).toEqual(['ping', action])
    publish({ ...target(action), title: 'Delayed title' })
    expect(requests.map(request => request.action)).toEqual(['ping', action])
  })

  it.each<VideoAction>(['analyze', 'watch-plan'])('loads %s when a previous panel recorded the click but closed before displaying it', async action => {
    stored['target:1'] = { ...target(action), clickedAt: 1 }
    stored['started:1'] = 'first-click'
    await import('../extension/sidepanel.js')
    await finished(action)
    expectView(action)
    expect(requests.map(request => request.action)).toEqual(['ping', action])
    expect(requests.at(-1)).toMatchObject({ fresh: false })
    if (action === 'analyze') expect(get('timing-opening').textContent).toBe('0.000 s')
  })

  it('keeps a first click that arrives during the initial storage read', async () => {
    const initialRead = deferred<Record<string, unknown>>()
    readStorage.mockReturnValueOnce(initialRead.promise)
    const opening = import('../extension/sidepanel.js')
    await vi.waitFor(() => expect(readStorage).toHaveBeenCalled())
    publish(target('watch-plan'))
    initialRead.resolve({ 'target:1': { ...target('analyze', 'old'), start: false } })
    await opening
    await finished('watch-plan')
    expectView('watch-plan')
    expect(requests.map(request => request.action)).toEqual(['ping', 'watch-plan'])
  })

  it.each<VideoAction>(['analyze', 'watch-plan'])('does not cancel the first %s click when a stale tab lookup finishes', async action => {
    const activeTab = deferred<chrome.tabs.Tab[]>()
    query.mockReturnValueOnce(activeTab.promise)
    const opening = import('../extension/sidepanel.js')
    await vi.waitFor(() => expect(query).toHaveBeenCalled())
    publish(target(action))
    activeTab.resolve([{ id: 99, windowId: 1, url: 'https://www.youtube.com/watch?v=old-video' } as chrome.tabs.Tab])
    await opening
    await finished(action)
    expectView(action)
    expect(requests.map(request => request.action)).toEqual(['ping', action])
    expect(get('video-title').textContent).toBe(transcript.title)
  })

  it('switches directly between the separate views from new page clicks', async () => {
    stored['target:1'] = target('analyze')
    await import('../extension/sidepanel.js')
    await finished('analyze')
    publish(target('watch-plan', 'plan-click'))
    await finished('watch-plan')
    expectView('watch-plan')
    publish(target('analyze', 'summary-click'))
    await finished('analyze')
    expectView('analyze')
    expect(requests.map(request => request.action)).toEqual(['ping', 'analyze', 'ping', 'watch-plan', 'ping', 'analyze'])
  })
})

describe('video views belong to their tabs', () => {
  it('restores a completed plan after the browser destroys and recreates the sidebar', async () => {
    stored['target:1'] = target('watch-plan')
    await import('../extension/sidepanel.js')
    await finished('watch-plan')
    get('watch-ranges').querySelector('details')!.open = true
    ;(get('transcript-section') as HTMLDetailsElement).open = true
    document.documentElement.scrollTop = 320
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(get('watch-result')).toBeNull()
    expect(stored[watchViewKey(2)]).toMatchObject({ token: 'first-click', transcript, plan: { overview: 'Focus on the method.' } })
    expect(stored[watchPositionKey(2)]).toMatchObject({ scrollTop: 320, expanded: [true], transcriptOpen: true })
    document.body.innerHTML = readFileSync('extension/sidepanel.html', 'utf8')
    document.documentElement.scrollTop = 0
    vi.resetModules()
    await import('../extension/sidepanel.js')
    await finished('watch-plan')
    expectView('watch-plan')
    expect(get('watch-ranges').querySelector('details')!.open).toBe(true)
    expect((get('transcript-section') as HTMLDetailsElement).open).toBe(true)
    expect(get('transcript').querySelectorAll('.caption-row')).toHaveLength(transcript.segments.length)
    expect(document.documentElement.scrollTop).toBe(320)
    expect(requests.map(request => request.action)).toEqual(['ping', 'watch-plan'])
    expect(executeScript).toHaveBeenCalledTimes(1)
    executeScript.mockResolvedValueOnce([{ result: true }])
    get('watch-ranges').querySelector<HTMLButtonElement>('.timestamp')!.click()
    expect(executeScript).toHaveBeenLastCalledWith(expect.objectContaining({ target: { tabId: 2 }, args: [transcript.videoId, 0] }))
    get('plan-watch').click()
    await finished('watch-plan')
    expect(requests.at(-1)).toMatchObject({ action: 'watch-plan', fresh: true })
  })

  it('keeps a suspended sidebar document intact when it returns', async () => {
    stored['target:1'] = target('watch-plan')
    await import('../extension/sidepanel.js')
    await finished('watch-plan')
    const result = get('watch-result')
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(get('watch-result')).toBe(result)
    expect(result.hidden).toBe(false)
    expect(requests.map(request => request.action)).toEqual(['ping', 'watch-plan'])
  })

  it.each(['while loading', 'after loading'])('honors a saved-view deletion from another window %s', async when => {
    const original = target('watch-plan')
    stored['target:1'] = original
    await import('../extension/sidepanel.js')
    await finished('watch-plan')
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    stored['target:1'] = { ...target('analyze', 'other-tab'), tabId: 3, videoId: null, start: false }
    document.body.innerHTML = readFileSync('extension/sidepanel.html', 'utf8')
    const earlier = structuredClone(stored)
    const read = deferred<Record<string, unknown>>()
    readStorage.mockClear().mockReturnValueOnce(read.promise)
    vi.resetModules()
    const opening = import('../extension/sidepanel.js')
    await vi.waitFor(() => expect(readStorage).toHaveBeenCalled())
    if (when === 'after loading') { read.resolve(earlier); await opening }
    delete stored[watchViewKey(2)]
    onChange({ [watchViewKey(2)]: { oldValue: earlier[watchViewKey(2)] } }, 'session')
    if (when === 'while loading') { read.resolve(earlier); await opening }
    publish({ ...original, start: false })
    expect(get('watch-result').hidden).toBe(true)
    expect(requests.map(request => request.action)).toEqual(['ping', 'watch-plan'])
  })

  it.each(['different video', 'same video after navigating back'])('does not restore a closed view for a %s', async reason => {
    stored['target:1'] = target('watch-plan')
    await import('../extension/sidepanel.js')
    await finished('watch-plan')
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    stored['target:1'] = { ...target('watch-plan', 'new-page'), start: false,
      videoId: reason === 'different video' ? 'another-video' : transcript.videoId }
    document.body.innerHTML = readFileSync('extension/sidepanel.html', 'utf8')
    vi.resetModules()
    await import('../extension/sidepanel.js')
    expect(get('watch-result').hidden).toBe(true)
    expect(requests.map(request => request.action)).toEqual(['ping', 'watch-plan'])
  })

  it.each<VideoAction>(['analyze', 'watch-plan'])('restores %s with its expanded sections and scroll position without another request', async action => {
    const original = target(action)
    stored['target:1'] = original
    await import('../extension/sidepanel.js')
    await finished(action)
    const result = get(action === 'watch-plan' ? 'watch-result' : 'overview-card')
    const details = action === 'watch-plan' ? get('watch-ranges').querySelector('details')! : get('connections-details') as HTMLDetailsElement
    details.open = true
    document.documentElement.scrollTop = 320
    publish({ ...original, title: 'Updated title' })
    expect(document.documentElement.scrollTop).toBe(320)
    publish({ ...target('analyze', 'other-tab'), tabId: 3, videoId: null, start: false })
    expect(result.isConnected).toBe(false)
    expect(get('watch-result').hidden).toBe(true)
    document.documentElement.scrollTop = 50
    publish(original)
    expectView(action)
    expect(get(action === 'watch-plan' ? 'watch-result' : 'overview-card')).toBe(result)
    expect(result.hidden).toBe(false)
    expect(details.open).toBe(true)
    expect(document.documentElement.scrollTop).toBe(320)
    expect(requests.map(request => request.action)).toEqual(['ping', action])
    expect(executeScript).toHaveBeenCalledTimes(1)
    if (action === 'watch-plan') {
      executeScript.mockResolvedValueOnce([{ result: true }])
      get('watch-ranges').querySelector<HTMLButtonElement>('.timestamp')!.click()
      expect(executeScript).toHaveBeenLastCalledWith(expect.objectContaining({ target: { tabId: 2 }, args: [transcript.videoId, 0] }))
    }
  })

  it('keeps distinct selected views for two tabs showing the same video', async () => {
    const plan = target('watch-plan')
    const summary = { ...target('analyze', 'summary-click'), tabId: 3 }
    stored['target:1'] = plan
    await import('../extension/sidepanel.js')
    await finished('watch-plan')
    publish(summary)
    await finished('analyze')
    publish(plan)
    expectView('watch-plan')
    publish(summary)
    expectView('analyze')
    expect(requests.map(request => request.action)).toEqual(['ping', 'watch-plan', 'ping', 'analyze'])
  })

  it('finishes a pending plan in its original tab without changing another tab or window', async () => {
    let finishPlan!: () => void
    reply = (send, request) => { if (request.action === 'watch-plan') finishPlan = send; else queueMicrotask(send) }
    const original = target('watch-plan')
    stored['target:1'] = original
    await import('../extension/sidepanel.js')
    await vi.waitFor(() => expect(finishPlan).toBeTypeOf('function'))
    const planResult = get('watch-result')
    publish({ ...target('analyze', 'other-tab'), tabId: 3 })
    await finished('analyze')
    const title = document.title
    onChange({ 'target:99': { newValue: { ...original, windowId: 99 } } }, 'session')
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new Event('visibilitychange'))
    finishPlan()
    await vi.waitFor(() => expect(planResult.hidden).toBe(false))
    expectView('analyze')
    expect(document.title).toBe(title)
    window.dispatchEvent(new Event('focus'))
    publish(original)
    await finished('watch-plan')
    expect(get('watch-result')).toBe(planResult)
    expect(requests.filter(request => request.action === 'watch-plan')).toHaveLength(1)
  })

  it('clears a plan when the original tab navigates to another page', async () => {
    stored['target:1'] = target('watch-plan')
    await import('../extension/sidepanel.js')
    await finished('watch-plan')
    publish({ ...target('watch-plan', 'navigation'), videoId: 'another-video', start: false })
    expect(get('watch-result').hidden).toBe(true)
    expect(get('plan-watch').textContent).toBe('Plan watch')
    publish({ ...target('watch-plan', 'back'), start: false })
    expect(get('watch-result').hidden).toBe(true)
    expect(requests.map(request => request.action)).toEqual(['ping', 'watch-plan'])
  })

  it.each(['navigation', 'inaccessible page', 'close'])('discards an inactive tab after %s instead of restoring stale content', async reason => {
    const original = target('watch-plan')
    stored['target:1'] = original
    await import('../extension/sidepanel.js')
    await finished('watch-plan')
    const result = get('watch-result')
    publish({ ...target('analyze', 'other-tab'), tabId: 3, videoId: null, start: false })
    if (reason === 'navigation') onUpdated(2, { url: 'https://www.youtube.com/' }, {} as chrome.tabs.Tab)
    else if (reason === 'inaccessible page') onUpdated(2, { status: 'complete' }, {} as chrome.tabs.Tab)
    else onRemoved(2, { windowId: 1, isWindowClosing: false })
    publish({ ...original, start: false, token: 'back' })
    expect(get('watch-result')).not.toBe(result)
    expect(get('watch-result').hidden).toBe(true)
  })

  it('retains an inactive plan through timestamp-only changes', async () => {
    const original = target('watch-plan')
    stored['target:1'] = original
    await import('../extension/sidepanel.js')
    await finished('watch-plan')
    const result = get('watch-result')
    publish({ ...target('analyze', 'other-tab'), tabId: 3, videoId: null, start: false })
    onUpdated(2, { url: `https://www.youtube.com/watch?v=${transcript.videoId}&t=30s` }, {} as chrome.tabs.Tab)
    publish(original)
    expect(get('watch-result')).toBe(result)
    expect(result.hidden).toBe(false)
  })

  it('clears retained plans in other tabs when the cache is cleared', async () => {
    const original = target('watch-plan')
    stored['target:1'] = original
    await import('../extension/sidepanel.js')
    await finished('watch-plan')
    publish({ ...target('watch-plan', 'other-tab'), tabId: 3 })
    await finished('watch-plan')
    get('clear-cache').click()
    await vi.waitFor(() => expect(get('status').textContent).toContain('Cache cleared'))
    expect(stored[watchViewKey(2)]).toBeUndefined()
    expect(stored[watchViewKey(3)]).toBeUndefined()
    publish(original)
    expect(get('watch-result').hidden).toBe(true)
    expect(get('plan-watch').textContent).toBe('Plan watch')
    expect(requests.filter(request => request.action === 'watch-plan')).toHaveLength(2)
  })
})
