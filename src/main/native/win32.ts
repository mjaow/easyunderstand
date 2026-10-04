/**
 * The Windows backend of the platform layer (see ./types.ts): thin koffi bindings
 * over the handful of Win32 calls EasyTranslate needs.
 *
 * koffi ships prebuilt binaries, so this needs no node-gyp and no VS Build Tools.
 * Everything here is Windows-only and degrades to a no-op elsewhere, so the rest of
 * the app (and the test suite) can run on any platform.
 */
import koffi from 'koffi'
import type { ButtonState, InputPermission, NativeBridge, Point } from './types.js'

export const IS_WINDOWS = process.platform === 'win32'

// --- virtual key codes ------------------------------------------------------
const VK_CONTROL = 0x11
const VK_SHIFT = 0x10
const VK_MENU = 0x12 // Alt
const VK_LWIN = 0x5b
const VK_RWIN = 0x5c
const VK_C = 0x43
const VK_LBUTTON = 0x01

const KEYEVENTF_KEYUP = 0x0002
const INPUT_KEYBOARD = 1

// --- window styles ----------------------------------------------------------
const GWL_EXSTYLE = -20
const WS_EX_NOACTIVATE = 0x08000000
const WS_EX_TOOLWINDOW = 0x00000080

interface Bindings {
  GetClipboardSequenceNumber: () => number
  SendInput: (count: number, inputs: unknown[], size: number) => number
  GetAsyncKeyState: (vk: number) => number
  GetForegroundWindow: () => number | bigint
  GetWindowLongPtrW: (hwnd: bigint, index: number) => number | bigint
  SetWindowLongPtrW: (hwnd: bigint, index: number, value: bigint) => number | bigint
  GetCursorPos: (out: { x: number; y: number }[]) => number
  GetWindowTextW: (hwnd: bigint, buffer: Buffer, max: number) => number
  INPUT: unknown
  inputSize: number
}

let bindings: Bindings | null = null
let loadError: string | null = null

function load(): Bindings | null {
  if (!IS_WINDOWS) return null
  if (bindings || loadError) return bindings

  try {
    const user32 = koffi.load('user32.dll')

    // INPUT is a tagged union. We only ever send keyboard events, but the union has
    // to be laid out in full or SendInput rejects the struct size (40 bytes on x64).
    const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
      wVk: 'uint16',
      wScan: 'uint16',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr'
    })
    const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
      dx: 'int32',
      dy: 'int32',
      mouseData: 'uint32',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr'
    })
    const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', {
      uMsg: 'uint32',
      wParamL: 'uint16',
      wParamH: 'uint16'
    })
    const INPUT_UNION = koffi.union('INPUT_UNION', {
      mi: MOUSEINPUT,
      ki: KEYBDINPUT,
      hi: HARDWAREINPUT
    })
    const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_UNION })
    koffi.struct('POINT', { x: 'long', y: 'long' })

    const inputSize = koffi.sizeof(INPUT)

    bindings = {
      GetClipboardSequenceNumber: user32.func('uint32 __stdcall GetClipboardSequenceNumber()'),
      SendInput: user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)'),
      GetAsyncKeyState: user32.func('int16 __stdcall GetAsyncKeyState(int vKey)'),
      GetForegroundWindow: user32.func('uintptr __stdcall GetForegroundWindow()'),
      GetWindowLongPtrW: user32.func('intptr __stdcall GetWindowLongPtrW(uintptr hWnd, int nIndex)'),
      SetWindowLongPtrW: user32.func(
        'intptr __stdcall SetWindowLongPtrW(uintptr hWnd, int nIndex, intptr dwNewLong)'
      ),
      GetCursorPos: user32.func('int __stdcall GetCursorPos(_Out_ POINT *lpPoint)'),
      GetWindowTextW: user32.func(
        'int __stdcall GetWindowTextW(uintptr hWnd, _Out_ uint8 *lpString, int nMaxCount)'
      ),
      INPUT,
      inputSize
    }
    return bindings
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err)
    console.error('[win32] failed to load user32 bindings:', loadError)
    return null
  }
}

/** True when the native bindings are available and usable. */
export function isAvailable(): boolean {
  return load() !== null
}

export function getLoadError(): string | null {
  load()
  return loadError
}

/**
 * Monotonic counter Windows bumps on every clipboard write, by any process.
 * Watching this is how we know a copy actually landed, instead of sleeping and hoping.
 * Returns 0 when unavailable.
 */
export function clipboardSequence(): number {
  const b = load()
  return b ? b.GetClipboardSequenceNumber() : 0
}

function keyEvent(vk: number, up: boolean): Record<string, unknown> {
  return {
    type: INPUT_KEYBOARD,
    u: { ki: { wVk: vk, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0 } }
  }
}

function isDown(b: Bindings, vk: number): boolean {
  // High bit of the SHORT means "currently held".
  return (b.GetAsyncKeyState(vk) & 0x8000) !== 0
}

/**
 * Send a clean Ctrl+C to whatever window currently has focus.
 *
 * The subtlety: our hotkey is itself a chord (Ctrl+Alt+E or Ctrl+Alt+R), so when it
 * fires the user is still *physically holding* Ctrl and Alt. A naive Ctrl+C would
 * reach the target as Ctrl+Alt+C and copy nothing. Press Control again before
 * releasing the other modifiers, then send C and release Control, all in one
 * SendInput batch. Keeping Control down masks Alt's menu activation: releasing
 * every modifier first can move focus to a menu before the copy reaches the editor.
 *
 * We deliberately do NOT re-press those modifiers afterwards: the user's fingers are
 * still on them, so releasing generates real key-ups. Re-pressing risks a stuck key.
 *
 * @returns number of events accepted by Windows, or -1 if the bindings are unavailable.
 */
export function sendCopy(): number {
  const b = load()
  if (!b) return -1

  // Press Control before releasing Alt: releasing every modifier first can
  // activate a Windows menu, which then consumes the copy instead of the textbox.
  const events: Record<string, unknown>[] = [keyEvent(VK_CONTROL, false)]

  for (const vk of [VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]) {
    if (isDown(b, vk)) events.push(keyEvent(vk, true))
  }

  events.push(keyEvent(VK_C, false))
  events.push(keyEvent(VK_C, true))
  events.push(keyEvent(VK_CONTROL, true))

  return b.SendInput(events.length, events, b.inputSize)
}

/** HWND of the focused window, as an integer handle. 0n when unavailable. */
export function foregroundWindow(): bigint {
  const b = load()
  return b ? BigInt(b.GetForegroundWindow()) : 0n
}

/** Title of the focused window — a browser's is its active tab's title. */
export function foregroundWindowTitle(): string {
  const b = load()
  if (!b) return ''
  const hwnd = BigInt(b.GetForegroundWindow())
  if (hwnd === 0n) return ''
  const buffer = Buffer.alloc(1024)
  const length = b.GetWindowTextW(hwnd, buffer, buffer.length / 2)
  return length > 0 ? buffer.toString('utf16le', 0, length * 2) : ''
}

/**
 * The left mouse button: whether it is held right now, and whether it was pressed
 * at all since the previous call. The second answer catches a press-and-release that
 * fell entirely between two polls — the OS records it in the low bit of the state.
 */
export function leftButtonState(): ButtonState {
  const b = load()
  if (!b) return { down: false, pressedSince: false }
  const state = b.GetAsyncKeyState(VK_LBUTTON)
  return { down: (state & 0x8000) !== 0, pressedSince: (state & 0x0001) !== 0 }
}

/** Pointer position in physical screen pixels. (0,0) when unavailable. */
export function cursorPosition(): Point {
  const b = load()
  if (!b) return { x: 0, y: 0 }
  const out = [{ x: 0, y: 0 }]
  b.GetCursorPos(out)
  return { x: out[0].x, y: out[0].y }
}

/**
 * Stamp WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW onto a window.
 *
 * Electron's `focusable: false` is unreliable on Windows (electron#11049) — windows
 * still steal focus on show(). Setting the extended style ourselves is what actually
 * guarantees the popup never takes focus, which is what keeps the user's selection
 * alive and their Ctrl+V working. TOOLWINDOW additionally keeps it out of Alt-Tab.
 *
 * @param handle Buffer from BrowserWindow.getNativeWindowHandle()
 */
export function makeNonActivating(handle: Buffer): boolean {
  const b = load()
  if (!b) return false
  try {
    const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))
    if (hwnd === 0n) return false
    // Coerce explicitly: koffi returns a Number here whenever the style fits in
    // a double, and mixing that with BigInt throws.
    const current = BigInt(b.GetWindowLongPtrW(hwnd, GWL_EXSTYLE))
    const next = current | BigInt(WS_EX_NOACTIVATE) | BigInt(WS_EX_TOOLWINDOW)
    b.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next)

    // Read it back. This flag is what keeps the user's selection alive and their
    // Ctrl+V working, so "we called the setter" isn't good enough — confirm it stuck.
    const applied = BigInt(b.GetWindowLongPtrW(hwnd, GWL_EXSTYLE))
    const stuck = (applied & BigInt(WS_EX_NOACTIVATE)) !== 0n
    if (!stuck) console.error('[win32] WS_EX_NOACTIVATE did not stick; popup may steal focus')
    return stuck
  } catch (err) {
    console.error('[win32] makeNonActivating failed:', err)
    return false
  }
}

/**
 * Windows asks nobody's permission to synthesise input into a window of the same or
 * lower integrity level. The one case it refuses — an elevated target — is not a
 * permission the user can grant, so it is reported as a capture failure instead.
 */
function inputPermission(): InputPermission {
  return 'not-required'
}

export const win32Bridge: NativeBridge = {
  platform: 'win32',
  isAvailable,
  getLoadError,
  inputPermission,
  clipboardSequence,
  sendCopy,
  foregroundWindowTitle,
  leftButtonState,
  cursorPosition,
  makeNonActivating,
  // GetAsyncKeyState records a press that fell between two polls, so 15ms is fast
  // enough that no human click is missed and cheap enough to be invisible.
  clickPollMs: 15
}
