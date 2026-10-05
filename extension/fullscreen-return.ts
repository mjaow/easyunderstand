import type { UnderstandResponse } from './background.js'
import { videoIdFromUrl } from './panel-target.js'

/** Reopening browser chrome requires a real click; fullscreenchange cannot grant it. */
export function installFullscreenReturn(): void {
  let fullscreenVideo: string | null = null
  let revision = 0
  const remove = (): void => { document.getElementById('easytranslate-return-view')?.remove() }
  const reset = (): void => { revision++; fullscreenVideo = null; remove() }
  const buttonStyle = 'border:1px solid #7ebcb3;background:#163c36;color:#fff;border-radius:20px;padding:8px 16px;font:500 14px Roboto,Arial,sans-serif;cursor:pointer;'

  function showReturn(expectedVideo: string, expectedRevision: number): void {
    const box = document.createElement('aside')
    box.id = 'easytranslate-return-view'
    box.setAttribute('aria-label', 'Return to your watch plan')
    box.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483647;display:flex;align-items:center;gap:6px;padding:8px;background:#163c36;color:#fff;border-radius:24px;box-shadow:0 4px 18px #0004;'
    const button = document.createElement('button')
    button.type = 'button'; button.textContent = 'Return to plan'; button.style.cssText = buttonStyle
    const dismiss = document.createElement('button')
    dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.style.cssText = buttonStyle
    dismiss.setAttribute('aria-label', 'Dismiss return to plan')
    dismiss.addEventListener('click', reset)
    const feedback = document.createElement('span')
    feedback.setAttribute('role', 'status'); feedback.hidden = true
    feedback.style.cssText = 'max-width:220px;font:13px Roboto,Arial,sans-serif;'
    button.addEventListener('click', async () => {
      if (videoIdFromUrl(location.href) !== expectedVideo || expectedRevision !== revision) { reset(); return }
      button.disabled = true; feedback.hidden = true
      try {
        // Send synchronously inside the click, before awaiting any other work.
        const response: UnderstandResponse | undefined = await chrome.runtime.sendMessage({ action: 'resume-video-view' })
        if (!response?.ok) throw new Error('Could not open the plan.')
        remove()
      } catch {
        feedback.textContent = 'Could not reopen the plan. Try again, or use Plan watch below the video.'
        feedback.hidden = false
      } finally { button.disabled = false }
    })
    box.append(button, dismiss, feedback)
    document.body.append(box)
  }

  const changed = (): void => {
    const video = videoIdFromUrl(location.href)
    const previousVideo = fullscreenVideo
    const currentRevision = ++revision
    remove()
    fullscreenVideo = document.fullscreenElement ? video : null
    if (document.fullscreenElement || !video || previousVideo !== video) return
    try {
      if (!chrome.runtime?.id) return
      void chrome.runtime.sendMessage({ action: 'get-video-view' }).then((response: UnderstandResponse | undefined) => {
        if (response?.ok && response.action === 'watch-plan' && currentRevision === revision &&
            !document.fullscreenElement && videoIdFromUrl(location.href) === video) showReturn(video, currentRevision)
      }).catch(() => {})
    } catch { /* Reloaded extensions cannot query their previous worker. */ }
  }
  document.addEventListener('fullscreenchange', changed)
  document.addEventListener('yt-navigate-finish', reset)
  window.addEventListener('pagehide', event => {
    if (event.persisted) return
    reset()
    document.removeEventListener('fullscreenchange', changed)
    document.removeEventListener('yt-navigate-finish', reset)
  }, { once: true })
}
