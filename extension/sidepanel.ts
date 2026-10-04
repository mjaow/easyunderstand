import { videoIdFromUrl, type PanelTarget } from './panel-target.js'
import { createVideoPanel, type VideoPanel } from './video-panel.js'

const template = document.getElementById('panel-template') as HTMLTemplateElement
const panels = new Map<number, VideoPanel>()
let activeTabId: number | undefined
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
      for (const [tabId, other] of panels) if (tabId !== next.tabId) other.reset()
    })
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
window.addEventListener('pagehide', () => {
  for (const tabId of panels.keys()) removePanel(tabId)
})

let initializing = true
let pendingTarget: PanelTarget | undefined
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[key]?.newValue) {
    if (initializing) pendingTarget = changes[key].newValue as PanelTarget
    else setTarget(changes[key].newValue as PanelTarget)
  }
})
const stored = await chrome.storage.session.get([key, startedKey])
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
