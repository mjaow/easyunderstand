export type VideoAction = 'analyze' | 'watch-plan'
export interface PanelTarget { tabId: number; windowId: number; videoId: string | null; title: string; start: boolean; token: string; clickedAt?: number; action?: VideoAction }

export function videoIdFromUrl(url?: string): string | null {
  try {
    const u = new URL(url ?? '')
    return u.origin === 'https://www.youtube.com' && u.pathname === '/watch' ? u.searchParams.get('v') : null
  } catch { return null }
}
