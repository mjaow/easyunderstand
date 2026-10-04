import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelTarget, UnderstandResponse } from '../extension/background.js'

let updated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0]
let activated: Parameters<typeof chrome.tabs.onActivated.addListener>[0]
let removed: Parameters<typeof chrome.tabs.onRemoved.addListener>[0]
let message: Parameters<typeof chrome.runtime.onMessage.addListener>[0]
const save = vi.fn(), read = vi.fn(), openPanel = vi.fn(), getTab = vi.fn()
let stored: Record<string, PanelTarget>
const tab = { id: 2, windowId: 1, active: true, url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'Old video - YouTube' } as chrome.tabs.Tab

beforeEach(async () => {
  vi.resetModules()
  stored = {}
  save.mockReset().mockImplementation(async values => { Object.assign(stored, values) })
  read.mockReset().mockImplementation(async () => ({ ...stored }))
  openPanel.mockReset().mockResolvedValue(undefined)
  getTab.mockReset().mockResolvedValue(tab)
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: (listener: typeof message) => { message = listener } } },
    action: { onClicked: { addListener: vi.fn() } },
    sidePanel: { open: openPanel },
    tabs: { get: getTab, onActivated: { addListener: (listener: typeof activated) => { activated = listener } },
      onRemoved: { addListener: (listener: typeof removed) => { removed = listener } },
      onUpdated: { addListener: (listener: typeof updated) => { updated = listener } } },
    storage: { session: { set: save, get: read, remove: async (key: string) => { delete stored[key] } } }
  })
  await import('../extension/background.js')
})
afterEach(() => vi.unstubAllGlobals())

function click(sender: chrome.runtime.MessageSender = { tab, url: tab.url }) {
  const respond = vi.fn<(response: UnderstandResponse) => void>()
  const pending = message({ action: 'understand', clickedAt: 1234 }, sender, respond)
  return { respond, pending }
}

describe('video panel target updates', () => {
  it('restores each tab request after switching away, including after a service-worker restart', async () => {
    message({ action: 'watch-plan' }, { tab, url: tab.url }, vi.fn())
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const original = stored['target:1']
    getTab.mockResolvedValueOnce({ ...tab, id: 3, url: 'https://www.youtube.com/' })
    activated({ tabId: 3, windowId: 1 })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(stored['target:1']).toMatchObject({ tabId: 3, start: false })
    vi.resetModules()
    await import('../extension/background.js')
    activated({ tabId: 2, windowId: 1 })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(3))
    expect(stored['target:1']).toEqual(original)
    expect(openPanel).toHaveBeenCalledTimes(1)
  })

  it('invalidates an inactive tab request on navigation without changing the active window target', async () => {
    click()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    getTab.mockResolvedValueOnce({ ...tab, id: 3 })
    activated({ tabId: 3, windowId: 1 })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    const active = stored['target:1']
    updated(2, { url: 'https://www.youtube.com/' }, { ...tab, active: false, url: 'https://www.youtube.com/' })
    updated(2, { url: tab.url }, { ...tab, active: false })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(4))
    expect(stored['target:1']).toEqual(active)
    activated({ tabId: 2, windowId: 1 })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(5))
    expect(stored['target:1']).toMatchObject({ tabId: 2, videoId: 'jNQXAC9IVRw', start: false })
    expect(stored['target:1'].clickedAt).toBeUndefined()
  })

  it('removes a closed tab receipt after its pending metadata update finishes', async () => {
    click()
    removed(2, { windowId: 1, isWindowClosing: false })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(stored['tab-target:2']).toBeUndefined())
  })

  it('preserves a separate watch-plan request through delayed metadata updates', async () => {
    const respond = vi.fn()
    message({ action: 'watch-plan', clickedAt: 1234 }, { tab, url: tab.url }, respond)
    updated(tab.id!, { title: 'Agent lecture - YouTube' }, { ...tab, title: 'Agent lecture - YouTube' })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(stored['target:1']).toMatchObject({ start: true, action: 'watch-plan', clickedAt: 1234, title: 'Agent lecture - YouTube' })
    expect(respond).toHaveBeenCalledWith({ ok: true })
  })
  it('publishes a title-only update after YouTube changes the URL before its title', async () => {
    updated(tab.id!, { url: tab.url }, tab)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(stored['target:1']).toMatchObject({ videoId: 'jNQXAC9IVRw', title: tab.title, start: false })
    updated(tab.id!, { title: 'New lecture - YouTube' }, { ...tab, title: 'New lecture - YouTube' })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(stored['target:1']).toMatchObject({ videoId: 'jNQXAC9IVRw', title: 'New lecture - YouTube', start: false })
  })
  it('does not replace the active target for an inactive tab or an unrelated update', async () => {
    updated(tab.id!, { title: 'Inactive video' }, { ...tab, active: false })
    updated(tab.id!, { status: 'loading' }, tab)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(stored['target:1']).toBeUndefined()
    expect(stored['tab-target:2']).toMatchObject({ start: false })
  })

  it('clears a saved request when navigation completes outside the YouTube URL permission', async () => {
    click()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    updated(2, { status: 'complete' }, { ...tab, active: false, url: undefined, title: undefined })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(stored['tab-target:2']).toMatchObject({ videoId: null, start: false })
  })

  it('keeps the click and its timing when a title update arrives before the panel opens', async () => {
    let finishOpening!: () => void
    openPanel.mockReturnValueOnce(new Promise<void>(resolve => { finishOpening = resolve }))
    const { respond } = click()
    updated(tab.id!, { title: 'New lecture - YouTube' }, { ...tab, title: 'New lecture - YouTube' })
    expect(save).not.toHaveBeenCalled()
    finishOpening()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(respond).toHaveBeenCalledWith({ ok: true })
    expect(stored['target:1']).toMatchObject({ videoId: 'jNQXAC9IVRw', title: 'New lecture - YouTube', start: true, clickedAt: 1234 })
    expect(stored['target:1'].token).toBe(save.mock.calls[0][0]['target:1'].token)
  })

  it('preserves an existing click after a service-worker restart and tab activation', async () => {
    stored['target:1'] = { tabId: 2, windowId: 1, videoId: 'jNQXAC9IVRw', title: 'Earlier title', start: true, token: 'saved-click', clickedAt: 1234 }
    activated({ tabId: 2, windowId: 1 })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(stored['target:1']).toMatchObject({ title: tab.title, start: true, token: 'saved-click', clickedAt: 1234 })
    expect(openPanel).not.toHaveBeenCalled()
  })

  it('clears the start request on a different video instead of resurrecting an old click', async () => {
    let finishOpening!: () => void
    openPanel.mockReturnValueOnce(new Promise<void>(resolve => { finishOpening = resolve }))
    click()
    const next = { ...tab, url: 'https://www.youtube.com/watch?v=B7yl7fEHeKM' }
    updated(tab.id!, { url: next.url }, next)
    finishOpening()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(stored['target:1']).toMatchObject({ videoId: 'B7yl7fEHeKM', start: false })
    expect(stored['target:1'].clickedAt).toBeUndefined()
  })

  it('does not carry a click into another tab showing the same video', async () => {
    click()
    getTab.mockResolvedValueOnce({ ...tab, id: 3 })
    activated({ tabId: 3, windowId: 1 })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(stored['target:1']).toMatchObject({ tabId: 3, videoId: 'jNQXAC9IVRw', start: false })
  })

  it('keeps the selected panel on another video without starting it automatically', async () => {
    stored['target:1'] = { tabId: 2, windowId: 1, videoId: 'jNQXAC9IVRw', title: tab.title!, start: true, token: 'plan-click', action: 'watch-plan' }
    updated(tab.id!, { url: 'https://www.youtube.com/watch?v=B7yl7fEHeKM' }, { ...tab, url: 'https://www.youtube.com/watch?v=B7yl7fEHeKM' })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(stored['target:1']).toMatchObject({ videoId: 'B7yl7fEHeKM', action: 'watch-plan', start: false })
    expect(openPanel).not.toHaveBeenCalled()
  })
})

describe('Understand video acknowledgement', () => {
  it('opens in the user gesture and responds only after the start request is saved', async () => {
    let finishSaving!: () => void
    save.mockReturnValueOnce(new Promise<void>(resolve => { finishSaving = resolve }))
    const { respond, pending } = click()
    expect(pending).toBe(true)
    expect(openPanel).toHaveBeenCalledWith({ windowId: 1 })
    expect(read).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(respond).not.toHaveBeenCalled()
    finishSaving()
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true }))
  })

  it.each(['throw', 'reject'])('returns a visible error when sidePanel.open fails by %s', async failure => {
    const error = new Error('sidePanel.open() may only be called in response to a user gesture.')
    if (failure === 'throw') openPanel.mockImplementationOnce(() => { throw error })
    else openPanel.mockRejectedValueOnce(error)
    const { respond } = click()
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: false, error: error.message }))
    expect(save).not.toHaveBeenCalled()
    const retry = click()
    await vi.waitFor(() => expect(retry.respond).toHaveBeenCalledWith({ ok: true }))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('reports a failed storage write and allows the next click to retry', async () => {
    save.mockRejectedValueOnce(new Error('Session storage unavailable'))
    const first = click()
    await vi.waitFor(() => expect(first.respond).toHaveBeenCalledWith({ ok: false, error: 'Session storage unavailable' }))
    const retry = click()
    await vi.waitFor(() => expect(retry.respond).toHaveBeenCalledWith({ ok: true }))
    expect(stored['target:1'].start).toBe(true)
  })

  it('accepts a YouTube document that navigated from home to a watch page', async () => {
    const { respond, pending } = click({ tab, url: 'https://www.youtube.com/' })
    expect(pending).toBe(true)
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true }))
  })

  it.each([
    { tab, url: 'https://www.youtube.com.evil.example/watch?v=jNQXAC9IVRw' },
    { url: tab.url },
    { tab: { ...tab, url: 'https://www.youtube.com/' }, url: 'https://www.youtube.com/' }
  ])('explicitly rejects an invalid source or missing video', sender => {
    const { respond, pending } = click(sender)
    expect(pending).not.toBe(true)
    expect(respond).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('Open a YouTube video') })
    expect(openPanel).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})
