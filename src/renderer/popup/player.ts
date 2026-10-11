/**
 * A single audio channel for the whole popup.
 *
 * There are several speaker buttons — the selection, the plain-English line, the
 * example, and each hard word with its own example. Left to themselves they would
 * each spawn an independent Audio element, so two could talk over each other and
 * neither could be stopped. One shared channel means starting anything stops
 * whatever was playing, and there is always exactly one thing to stop.
 */

type StopListener = () => void

let audio: HTMLAudioElement | null = null
let notifyStopped: StopListener | null = null
let requestId = 0

/** Claim the channel before requesting audio, so late responses cannot take it back. */
export function beginAudioRequest(whenStopped: StopListener): number {
  stopAudio()
  notifyStopped = whenStopped
  return requestId
}

export function isCurrentAudioRequest(id: number): boolean {
  return id === requestId
}

/**
 * Play a clip, replacing anything already playing.
 *
 * @param whenStopped called when the clip ends, or when something else interrupts
 *                    it — so the button that started it can reset itself.
 */
export async function playAudio(url: string, whenStopped: StopListener, id?: number): Promise<void> {
  if (id === undefined) beginAudioRequest(whenStopped)
  else if (!isCurrentAudioRequest(id)) return

  const el = new Audio(url)
  audio = el
  notifyStopped = whenStopped

  el.addEventListener('ended', () => {
    // Only clear if this clip is still the current one; a later clip may have
    // replaced it between the event firing and this handler running.
    if (audio === el) {
      audio = null
      notifyStopped = null
      whenStopped()
    }
  })

  try {
    await el.play()
  } catch (err) {
    if (audio === el) {
      audio = null
      notifyStopped = null
      whenStopped()
      throw err
    }
  }
}

/** Stop whatever is playing. Safe to call when nothing is. */
export function stopAudio(): void {
  requestId++
  const previous = notifyStopped
  if (audio) {
    audio.pause()
    audio.currentTime = 0
  }
  audio = null
  notifyStopped = null
  // Told after the state is cleared, so a listener that starts a new clip sees a
  // clean channel rather than re-entering this function.
  previous?.()
}

export function isPlaying(): boolean {
  return audio !== null
}
