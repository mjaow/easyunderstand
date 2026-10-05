import { videoIdFromUrl, type PanelTarget, type VideoAction } from './panel-target.js'
import { watchPositionKey, watchViewKey, type SavedWatchView } from './watch-view-state.js'
export type { PanelTarget, VideoAction } from './panel-target.js'
export type UnderstandResponse = { ok: true; action?: VideoAction } | { ok: false; error: string }
function targetFor(tab: chrome.tabs.Tab, start: boolean, clickedAt?: number, action: VideoAction = 'analyze'): PanelTarget {
  return { tabId: tab.id!, windowId: tab.windowId, videoId: videoIdFromUrl(tab.url), title: tab.title ?? '', start, token: crypto.randomUUID(), clickedAt, action }
}
const updates = new Map<number, Promise<void>>()
function publishTarget(next: PanelTarget, ready: Promise<void> = Promise.resolve(), active = true): Promise<void> {
  const key = `target:${next.windowId}`
  const tabKey = `tab-target:${next.tabId}`
  // Serialize writes, including across a cold service-worker start. A title or
  // timestamp update must not erase a click while the panel is still loading.
  const update = Promise.allSettled([updates.get(next.windowId), ready]).then(async ([, availability]) => {
    if (availability.status === 'rejected') throw availability.reason
    if (!next.start || next.action === 'watch-plan') {
      const stored = await chrome.storage.session.get([key, tabKey, watchViewKey(next.tabId)])
      const previous = (stored[tabKey] ?? stored[key]) as PanelTarget | undefined
      const saved = stored[watchViewKey(next.tabId)] as SavedWatchView | undefined
      const sameVideo = previous?.tabId === next.tabId && previous.videoId === next.videoId
      const reopenPlan = next.start && previous?.action === 'watch-plan' && sameVideo &&
        saved?.videoId === next.videoId && saved?.token === previous.token
      if (sameVideo && (!next.start || reopenPlan)) {
        next = { ...previous, windowId: next.windowId, title: next.title }
      } else if (!next.start && previous?.action) {
        next = { ...next, action: previous.action }
      }
      if (previous?.tabId === next.tabId && previous.videoId !== next.videoId) {
        await chrome.storage.session.remove([watchViewKey(next.tabId), watchPositionKey(next.tabId)])
      }
    }
    await chrome.storage.session.set({ [tabKey]: next, ...(active ? { [key]: next } : {}) })
  })
  updates.set(next.windowId, update)
  const cleanup = (): void => { if (updates.get(next.windowId) === update) updates.delete(next.windowId) }
  void update.then(cleanup, cleanup)
  return update
}
async function open(tab: chrome.tabs.Tab, clickedAt = performance.timeOrigin + performance.now(), action: VideoAction = 'analyze', resume = false): Promise<void> {
  // Call open synchronously in the user gesture; async work can lose that gesture.
  const opened = chrome.sidePanel.open({ windowId: tab.windowId })
  await publishTarget(targetFor(tab, !resume, resume ? undefined : clickedAt, action), opened)
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse: (response: UnderstandResponse) => void) => {
  if (!['understand', 'watch-plan', 'get-video-view', 'resume-video-view'].includes(message?.action)) return
  let youtube = false
  try { youtube = new URL(sender.url ?? '').origin === 'https://www.youtube.com' } catch { /* no page URL */ }
  if (!youtube || sender.tab?.id === undefined || !targetFor(sender.tab, false).videoId) {
    sendResponse({ ok: false, error: 'Open a YouTube video, refresh the page, and try again.' })
    return
  }
  if (message.action === 'get-video-view') {
    const tab = sender.tab
    const tabId = sender.tab.id
    void chrome.storage.session.get([`tab-target:${tabId}`, watchViewKey(tabId)]).then(stored => {
      const previous = stored[`tab-target:${tabId}`] as PanelTarget | undefined
      const saved = stored[watchViewKey(tabId)] as SavedWatchView | undefined
      const matches = previous?.videoId === videoIdFromUrl(tab.url)
      const hasPlan = matches && saved?.videoId === previous?.videoId && saved?.token === previous?.token
      sendResponse({ ok: true, action: hasPlan ? previous?.action ?? 'analyze' : undefined })
    }).catch(e => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    return true
  }
  void open(sender.tab, typeof message.clickedAt === 'number' && Number.isFinite(message.clickedAt) ? message.clickedAt : undefined,
    message.action === 'watch-plan' ? 'watch-plan' : 'analyze', message.action === 'resume-video-view')
    .then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  // Keep the response channel open until the browser confirms the panel opened
  // and its start request was saved. Sending a message alone is not success.
  return true
})
chrome.action.onClicked.addListener(tab => { void open(tab).catch(e => console.error('Could not open EasyUnderstand:', e)) })
chrome.tabs.onActivated.addListener(info => {
  void chrome.tabs.get(info.tabId).then(tab => publishTarget(targetFor(tab, false))).catch(e => console.error('Could not update EasyUnderstand:', e))
})
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  // YouTube often updates the watch URL before the tab title during navigation.
  if (change.url !== undefined || change.title !== undefined || change.status === 'complete') {
    void publishTarget(targetFor(tab, false), undefined, tab.active).catch(e => console.error('Could not update EasyUnderstand:', e))
  }
})
chrome.tabs.onRemoved.addListener((tabId, info) => {
  // Let any earlier metadata write finish before deleting this tab's receipt.
  void Promise.allSettled([updates.get(info.windowId)]).then(() => chrome.storage.session.remove([
    `tab-target:${tabId}`, watchViewKey(tabId), watchPositionKey(tabId)
  ]))
    .catch(e => console.error('Could not clear EasyUnderstand tab:', e))
})
