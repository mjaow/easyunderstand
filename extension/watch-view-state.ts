import type { VideoTranscript, VideoWatchPlan } from '../src/shared/video.js'

/** Session-only view data survives the browser destroying a closed side panel. */
export interface SavedWatchView {
  videoId: string
  token: string
  transcript: VideoTranscript
  plan: VideoWatchPlan
}
export interface SavedWatchPosition {
  token: string
  scrollTop: number
  expanded: boolean[]
  transcriptOpen: boolean
}
export const watchViewKey = (tabId: number): string => `watch-view:v1:${tabId}`
export const watchPositionKey = (tabId: number): string => `watch-position:v1:${tabId}`

export async function clearSavedWatchViews(): Promise<void> {
  const stored = await chrome.storage.session.get(null)
  const keys = Object.keys(stored).filter(key => key.startsWith('watch-view:v1:') || key.startsWith('watch-position:v1:'))
  if (keys.length) await chrome.storage.session.remove(keys)
}
