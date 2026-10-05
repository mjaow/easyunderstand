import { videoIdFromUrl, type PanelTarget } from './panel-target.js'
import { createVideoPanel, type VideoPanel } from './video-panel.js'
import { watchPositionKey, watchViewKey, type SavedWatchPosition, type SavedWatchView } from './watch-view-state.js'

const template = document.getElementById('panel-template') as HTMLTemplateElement
const panels = new Map<number, VideoPanel>()
let activeTabId: number | undefined
let savedViews: Record<string, unknown> = {}
const currentWindow = await chrome.windows.getCurrent()
const key = `target:${currentWindow.id}`
const startedKey = `started:${currentWindow.id}`

function removePanel(tabId: number): void {
  panels.get(tabId)?.dispose()
  panels.delete(tabId)
}

function setTarget(next: PanelTarget): void {
  if (activeTabId !== next.tabId) panels.get(activeTabId!)?.hide()
  let panel = panels.get(next.tabId)
  if (!panel) {
    const root = document.createElement('div')
    root.append(template.content.cloneNode(true))
    panel = createVideoPanel(root, startedKey, () => {
      savedViews = {}
      for (const [tabId, other] of panels) if (tabId !== next.tabId) other.reset()
    }, savedViews[watchViewKey(next.tabId)] as SavedWatchView | undefined,
    savedViews[watchPositionKey(next.tabId)] as SavedWatchPosition | undefined)
    delete savedViews[watchViewKey(next.tabId)]
    delete savedViews[watchPositionKey(next.tabId)]
    panels.set(next.tabId, panel)
  }
  activeTabId = next.tabId
  panel.show()
  panel.setTarget(next)
}

// URL changes in background tabs must invalidate their old view too. A timestamp
// or title change on the same video is not navigation to another page.
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  const panel = panels.get(tabId)
  // Outside the YouTube host permission Chrome can omit the URL. Completion
  // still tells us that an inaccessible page replaced the saved video.
  if (tabId !== activeTabId && panel && (change.url !== undefined || change.status === 'complete') &&
      panel.videoId !== videoIdFromUrl(change.url ?? tab.url)) removePanel(tabId)
})
chrome.tabs.onRemoved.addListener(tabId => removePanel(tabId))
window.addEventListener('pagehide', event => {
  for (const panel of panels.values()) panel.savePosition()
  // A suspended document can return unchanged; only dispose a destroyed view.
  if (event.persisted) return
  for (const tabId of panels.keys()) removePanel(tabId)
})

let initializing = true
let pendingTarget: PanelTarget | undefined
const pendingSavedChanges = new Map<string, unknown>()
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return
  for (const [changedKey, change] of Object.entries(changes)) {
    if (changedKey.startsWith('watch-view:v1:') || changedKey.startsWith('watch-position:v1:')) {
      if (initializing) pendingSavedChanges.set(changedKey, change.newValue)
      else if (change.newValue === undefined) delete savedViews[changedKey]
      else savedViews[changedKey] = change.newValue
    }
  }
  if (changes[key]?.newValue) {
    if (initializing) pendingTarget = changes[key].newValue as PanelTarget
    else setTarget(changes[key].newValue as PanelTarget)
  }
})
const stored = await chrome.storage.session.get(null)
savedViews = stored
for (const [changedKey, value] of pendingSavedChanges) {
  if (value === undefined) delete savedViews[changedKey]
  else savedViews[changedKey] = value
}
pendingSavedChanges.clear()
// Deduplicate within each tab view, not across panel lifetimes: a closed panel
// may have recorded a click without ever showing its result.
const initialTarget = (pendingTarget ?? stored[key]) as PanelTarget | undefined
initializing = false
if (initialTarget) setTarget(initialTarget.token === stored[startedKey] ? { ...initialTarget, clickedAt: undefined } : initialTarget)
else {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  // Preserve a page click that arrived while the initial tab lookup was pending.
  if (activeTabId === undefined && tab?.id !== undefined) {
    setTarget({ tabId: tab.id, windowId: tab.windowId, videoId: videoIdFromUrl(tab.url), title: tab.title ?? '', start: false, token: '' })
  }
}
