/**
 * The floating explanation window.
 *
 * Everything here serves one requirement: the popup must never take focus. If it
 * does, the source app loses focus, the user's selection collapses, and their own
 * Ctrl+C stops working — which is exactly the Chrome-extension behaviour this app
 * exists to avoid.
 */
import { BrowserWindow, screen, globalShortcut, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { IPC, type ExplainState } from '../shared/types.js'
import { makeNonActivating } from './native/index.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Lock a window down to its own content.
 *
 * Explanation text comes from a model, which in turn read text from an arbitrary web
 * page — so it is untrusted input. It is rendered as text, never HTML, but these are
 * the belt-and-braces controls: the window can never navigate away from the bundled
 * files, and a link can only ever reach the OS as http(s).
 *
 * The scheme allowlist matters: shell.openExternal() will happily hand `file:`,
 * `ms-msdt:` and similar to the OS, which is a well-worn path to code execution.
 */
export function hardenWebContents(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Nothing should ever navigate these windows — they load one bundled file and stay
  // there. Devtools and dev-server URLs are the only legitimate exceptions.
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    console.warn('[security] blocked navigation to', url)
  })

  win.webContents.on('will-attach-webview', (event) => {
    // We never use <webview>; if one appears, something is wrong.
    event.preventDefault()
  })
}

export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

const WIDTH = 400
const INITIAL_HEIGHT = 180
const MIN_HEIGHT = 120
const MAX_HEIGHT = 620
/** Gap between the cursor and the popup, so it never sits under the pointer. */
const CURSOR_OFFSET = 18
const SCREEN_MARGIN = 8

let win: BrowserWindow | null = null
let escapeRegistered = false

export function createPopupWindow(preloadPath: string): BrowserWindow {
  win = new BrowserWindow({
    width: WIDTH,
    height: INITIAL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // On Windows this is unreliable on its own (electron#11049), so WS_EX_NOACTIVATE
    // is stamped on below as well. On macOS it is what makes the window refuse to
    // become key, and makeNonActivating() reads that back rather than assuming it.
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // 'screen-saver' is the highest z-order Electron exposes, so the popup stays above
  // full-screen video and other always-on-top windows.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.once('ready-to-show', () => {
    if (win) {
      const ok = makeNonActivating(win.getNativeWindowHandle())
      console.log(`[popup] non-activating style ${ok ? 'applied' : 'FAILED'}`)
    }
  })

  hardenWebContents(win)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/popup/index.html`)
  } else {
    void win.loadFile(join(here, '../renderer/popup/index.html'))
  }

  win.on('closed', () => {
    win = null
  })

  return win
}

/**
 * Place the popup near the cursor without letting it run off-screen.
 * Prefers below-right; flips to above or left when there isn't room.
 */
function positionNearCursor(height: number): void {
  if (!win) return

  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)

  let x = cursor.x + CURSOR_OFFSET
  let y = cursor.y + CURSOR_OFFSET

  if (x + WIDTH > workArea.x + workArea.width - SCREEN_MARGIN) {
    x = cursor.x - WIDTH - CURSOR_OFFSET
  }
  if (y + height > workArea.y + workArea.height - SCREEN_MARGIN) {
    y = cursor.y - height - CURSOR_OFFSET
  }

  // Clamp in case the flipped position also fell outside (small displays).
  x = Math.round(
    Math.max(workArea.x + SCREEN_MARGIN, Math.min(x, workArea.x + workArea.width - WIDTH - SCREEN_MARGIN))
  )
  y = Math.round(
    Math.max(workArea.y + SCREEN_MARGIN, Math.min(y, workArea.y + workArea.height - height - SCREEN_MARGIN))
  )

  win.setBounds({ x, y, width: WIDTH, height })
}

/**
 * Show the popup without activating it.
 *
 * `showInactive()` rather than `show()` is the whole point — `show()` would raise and
 * focus the window even with focusable:false.
 */
export function showPopup(state: ExplainState, reposition = true): void {
  if (!win || win.isDestroyed()) return

  if (reposition) positionNearCursor(win.getBounds().height || INITIAL_HEIGHT)

  win.webContents.send(IPC.popupStop)
  win.webContents.send(IPC.popupUpdate, { state })

  if (!win.isVisible()) win.showInactive()
  win.setAlwaysOnTop(true, 'screen-saver')
  registerEscape()
}

export function updatePopup(state: ExplainState): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  win.webContents.send(IPC.popupUpdate, { state })
}

/** Resize to the content height the renderer measured, keeping the window on-screen. */
export function resizePopup(contentHeight: number): void {
  if (!win || win.isDestroyed()) return
  const { x, y } = win.getBounds()
  const { workArea } = screen.getDisplayNearestPoint({ x, y })
  // A code explanation is long; let it use most of the screen before it scrolls.
  const maxHeight = Math.max(MAX_HEIGHT, Math.round(workArea.height * 0.85))
  const height = Math.round(Math.max(MIN_HEIGHT, Math.min(contentHeight, maxHeight)))
  if (height === win.getBounds().height) return

  // Growing downward can push the popup off the bottom; pull it up if so.
  const clampedY = Math.max(
    workArea.y + SCREEN_MARGIN,
    Math.min(y, workArea.y + workArea.height - height - SCREEN_MARGIN)
  )
  win.setBounds({ x, y: Math.round(clampedY), width: WIDTH, height })
}

export function hidePopup(): void {
  unregisterEscape()
  if (!win || win.isDestroyed()) return
  // Hiding the window does not stop its audio, so a long clip would carry on
  // talking to an empty screen.
  win.webContents.send(IPC.popupStop)
  if (win.isVisible()) win.hide()
}

export function isPopupVisible(): boolean {
  return !!win && !win.isDestroyed() && win.isVisible()
}

/**
 * Escape has to be a global shortcut, because a non-focusable window never receives
 * key events. It's registered only while the popup is up, so it doesn't swallow
 * Escape from every other app on the system.
 */
function registerEscape(): void {
  if (escapeRegistered) return
  escapeRegistered = globalShortcut.register('Escape', () => hidePopup())
}

function unregisterEscape(): void {
  if (!escapeRegistered) return
  globalShortcut.unregister('Escape')
  escapeRegistered = false
}
