/**
 * Self-test for click-to-explain: `npm run verify:click`.
 *
 * Puts a page on screen built the way YouTube builds its transcript panel — a list
 * of buttons named "<spoken time> <text>" — and its player, with a caption window,
 * then sends real mouse clicks through the OS and checks that each line, and only a
 * line, comes back. This exercises the
 * click watcher, the accessibility read and the transcript rules together, so a
 * broken script or a missed click fails here rather than silently in daily use.
 *
 * What it cannot prove is that YouTube's markup is what this page imitates. That
 * check is one click on a real transcript.
 */
import { app, BrowserWindow, screen } from 'electron'
import koffi from 'koffi'
import { startClickWatcher, stopClickWatcher, type Click } from './clicks.js'
import { readTranscriptAtPoint } from './a11y.js'
import { cursorPosition } from './native/index.js'
import { dipToScreen } from './coords.js'

const LINES = [
  ['9 seconds', 'A few years ago, I broke into my own house.'],
  ['1 minute, 5 seconds', 'You have got whistleblowers saying that.'],
  ['2 minutes, 40 seconds', 'It does not have to inherently be a bad thing.']
]

const ROW_TOP = 56
const ROW_HEIGHT = 48
/** The video area sits below the rows and the plain paragraph. */
const PLAYER_TOP = ROW_TOP + 3 * ROW_HEIGHT + 60
const PLAYER_HEIGHT = 140
const CAPTION = 'so I quickly ran around and tried all the other doors'
/** An X-style player: captions drawn on the picture, nothing in the tree. */
const X_TOP = PLAYER_TOP + PLAYER_HEIGHT + 20
const X_HEIGHT = 160
const X_CAPTION = 'The president calls for federal involvement as opposition grows.'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let passed = 0
let failed = 0

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

interface Mouse {
  press: (x: number, y: number) => void
  release: (x: number, y: number) => void
  restore: () => void
}

/** Real mouse input through the OS, so the watcher sees exactly what a user's click is. */
function makeMouse(): Mouse {
  return process.platform === 'darwin' ? makeMacMouse() : makeWindowsMouse()
}

/**
 * Core Graphics posts the same events a real mouse would, which is the point: the
 * watcher polls the button state the window server keeps, and only genuine posted
 * events reach it.
 */
function makeMacMouse(): Mouse {
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  const CGPoint = koffi.struct('VerifyCGPoint', { x: 'double', y: 'double' })
  const CGEventCreateMouseEvent = cg.func('CGEventCreateMouseEvent', 'void *', [
    'void *',
    'uint32',
    CGPoint,
    'uint32'
  ])
  const CGEventPost = cg.func('CGEventPost', 'void', ['uint32', 'void *'])
  const CGWarpMouseCursorPosition = cg.func('CGWarpMouseCursorPosition', 'int32', [CGPoint])
  const CFRelease = cf.func('CFRelease', 'void', ['void *'])

  const kCGEventLeftMouseDown = 1
  const kCGEventLeftMouseUp = 2
  const kCGHIDEventTap = 0
  const original = cursorPosition()

  const post = (type: number, x: number, y: number): void => {
    CGWarpMouseCursorPosition({ x, y })
    const event = CGEventCreateMouseEvent(null, type, { x, y }, 0)
    if (!event) return
    CGEventPost(kCGHIDEventTap, event)
    CFRelease(event)
  }

  return {
    press: (x, y) => post(kCGEventLeftMouseDown, x, y),
    release: (x, y) => post(kCGEventLeftMouseUp, x, y),
    restore: () => CGWarpMouseCursorPosition({ x: original.x, y: original.y })
  }
}

function makeWindowsMouse(): Mouse {
  const user32 = koffi.load('user32.dll')
  const SetCursorPos = user32.func('int __stdcall SetCursorPos(int X, int Y)')
  const mouse_event = user32.func(
    'void __stdcall mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)'
  )
  const LEFTDOWN = 0x0002
  const LEFTUP = 0x0004
  const original = cursorPosition()

  return {
    press: (x, y) => {
      SetCursorPos(x, y)
      mouse_event(LEFTDOWN, 0, 0, 0, 0)
    },
    release: (x, y) => {
      SetCursorPos(x, y)
      mouse_event(LEFTUP, 0, 0, 0, 0)
    },
    restore: () => SetCursorPos(original.x, original.y)
  }
}

export async function runClickVerification(): Promise<void> {
  console.log('\nEasyUnderstand — click-to-explain self-test\n')

  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    console.log(`  There is no accessibility read for ${process.platform}; nothing to check here.\n`)
    app.exit(0)
    return
  }
  app.on('window-all-closed', () => {})

  const display = screen.getPrimaryDisplay()
  const bounds = { x: display.bounds.x + 100, y: display.bounds.y + 100, width: 900, height: 680 }

  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')

  // The shape of YouTube's transcript panel: each line is a role=button whose
  // aria-label is the spoken time and the text, with the visible parts aria-hidden.
  const rows = LINES.map(
    ([time, text], i) => `
      <div role="button" tabindex="0" aria-label="${time} ${text}"
           style="display:flex;gap:16px;margin:0 20px;height:${ROW_HEIGHT}px;align-items:center">
        <div aria-hidden="true" style="color:#065fd4">${i}:0${i}</div>
        <div aria-hidden="true">${text}</div>
      </div>`
  )
  await win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        `<title>EasyUnderstand self-test</title>
         <body style="margin:0;background:#fff;font:18px 'Segoe UI'">
           <h2 style="margin:16px 20px;height:24px;font-size:16px">Transcript</h2>
           ${rows.join('')}
           <p style="margin:16px 20px;height:28px">Related: How to stay calm when stressed</p>
           <div id="movie_player" class="html5-video-player ytp-fullscreen" tabindex="-1" aria-label="YouTube Video Player"
                style="position:relative;margin:0 20px;height:${PLAYER_HEIGHT}px;background:#000">
             <video class="video-stream html5-main-video" style="position:absolute;inset:0;width:100%;height:100%"></video>
             <div class="ytp-caption-window-container">
               <div id="caption-window-1" class="caption-window ytp-caption-window-bottom" tabindex="0" draggable="true" lang="en"
                    style="position:absolute;left:0;right:0;bottom:16px;text-align:center">
                 <span class="captions-text"><span class="caption-visual-line">
                   <span class="ytp-caption-segment" style="background:#000;color:#fff;padding:2px 6px">${CAPTION}</span>
                 </span></span>
               </div>
             </div>
           </div>
           <div role="group" aria-label="Embedded video" style="position:relative;margin:20px 20px 0;height:${X_HEIGHT}px;background:#111">
             <div aria-hidden="true" style="position:absolute;left:16px;top:12px;color:#fff;background:#c00;padding:4px 10px;font:700 22px 'Segoe UI'">GPS</div>
             <div aria-hidden="true" style="position:absolute;left:0;right:0;bottom:14px;text-align:center;color:#fff;font:600 26px 'Segoe UI'">${X_CAPTION}</div>
           </div>
         </body>`
      )
  )
  win.show()
  win.focus()
  await sleep(1200)

  const mouse = makeMouse()
  const clicks: Click[] = []
  startClickWatcher((c) => clicks.push(c))

  const clickAt = async (point: { x: number; y: number }): Promise<void> => {
    mouse.press(point.x, point.y)
    await sleep(40)
    mouse.release(point.x, point.y)
  }

  // Chromium builds its accessibility tree the first time a client asks, so warm it
  // up before measuring, as the real app's first click on a fresh window would.
  const warm = dipToScreen({ x: bounds.x + 300, y: bounds.y + 80 })
  await readTranscriptAtPoint(warm.x, warm.y)

  const rowCentre = (i: number): { x: number; y: number } =>
    dipToScreen({ x: bounds.x + 300, y: bounds.y + ROW_TOP + i * ROW_HEIGHT + ROW_HEIGHT / 2 })

  try {
    for (let i = 0; i < LINES.length; i++) {
      const point = rowCentre(i)
      const seen = clicks.length
      await clickAt(point)
      await sleep(120)
      check(clicks.length === seen, `a single click on line ${i + 1} is left alone`)

      await sleep(700) // well past the double-click window, so the next pair stands alone
      await clickAt(point)
      await sleep(80)
      await clickAt(point)
      await sleep(120)
      check(clicks.length === seen + 1, `a double-click on line ${i + 1} is reported once`)

      const started = Date.now()
      const { text } = await readTranscriptAtPoint(point.x, point.y)
      const elapsed = Date.now() - started
      const expected = LINES[i][1]
      check(
        text === expected,
        `line ${i + 1} read exactly`,
        text === expected ? `${elapsed}ms` : `got "${text}"`
      )
    }

    // The rest of the page is not a transcript, and must say so.
    const plain = dipToScreen({
      x: bounds.x + 200,
      y: bounds.y + ROW_TOP + LINES.length * ROW_HEIGHT + 30
    })
    const { text: other } = await readTranscriptAtPoint(plain.x, plain.y)
    check(other === null, 'ordinary text on the page is left alone', other ? `got "${other}"` : '')

    // A double-click on the video, while a caption is showing, reads the caption —
    // even though the point is nowhere near the caption's own text. This is the
    // shape of YouTube's real player: a "caption-window" group holding the words as
    // separate text nodes, confirmed against a live page.
    const video = dipToScreen({ x: bounds.x + 200, y: bounds.y + PLAYER_TOP + 30 })
    const { text: caption } = await readTranscriptAtPoint(video.x, video.y)
    check(
      caption === CAPTION,
      'a click on the video reads the caption on screen',
      caption ? `got "${caption}"` : 'got nothing'
    )

    // The primary monitor alone cannot catch DPI virtualisation in the Windows
    // reader. Exercise physical points near each monitor's far edge, including
    // secondary monitors with a different scale or a negative screen origin.
    for (const target of screen.getAllDisplays()) {
      const area = target.workArea
      win.setBounds({
        x: area.x + Math.max(0, area.width - bounds.width),
        y: area.y + Math.max(0, area.height - bounds.height),
        width: bounds.width,
        height: bounds.height
      })
      await sleep(200)
      const placed = win.getBounds()
      const label = `display ${target.id} at ${target.scaleFactor * 100}%`
      for (const [kind, offsetY, expected] of [
        ['transcript', ROW_TOP + ROW_HEIGHT / 2, LINES[0][1]],
        ['caption', PLAYER_TOP + 30, CAPTION]
      ] as const) {
        const point = dipToScreen({ x: placed.x + 300, y: placed.y + offsetY })
        const { text, read } = await readTranscriptAtPoint(point.x, point.y)
        check(text === expected, `${kind} read on ${label}`,
          text === expected ? '' : `at ${point.x},${point.y}: ${read?.chain.split('\n')[0] ?? 'no read'}`)
      }
    }
    win.setBounds(bounds)
    await sleep(200)

    // Removing CC leaves a video frame with no transcript text to explain.
    await win.webContents.executeJavaScript("document.querySelector('.ytp-caption-window-container').remove()")
    const { text: noCaption, read: playerRead } = await readTranscriptAtPoint(video.x, video.y)
    check(playerRead?.video != null, 'a YouTube player without captions is still identified')
    check(noCaption === null, 'a YouTube video without captions produces no text')

    // Text visible only in the picture must never become transcript evidence.
    const xVideo = dipToScreen({ x: bounds.x + 450, y: bounds.y + X_TOP + X_HEIGHT - 30 })
    const { text: xText, read: xRead } = await readTranscriptAtPoint(xVideo.x, xVideo.y)
    check(xRead?.video != null, 'an embedded video is identified without reading pixels')
    check(xText === null, 'text drawn into a video frame is ignored')

    // A drag is a selection, not a click.
    const seen = clicks.length
    const from = rowCentre(0)
    const to = dipToScreen({ x: bounds.x + 500, y: bounds.y + ROW_TOP + ROW_HEIGHT / 2 })
    mouse.press(from.x, from.y)
    await sleep(60)
    mouse.release(to.x, to.y)
    await sleep(120)
    check(clicks.length === seen, 'a drag is not treated as a click')
  } finally {
    stopClickWatcher()
    mouse.restore()
    win.destroy()
  }

  console.log(
    `\n${failed === 0 ? `All ${passed} click checks passed.` : `${failed} of ${passed + failed} FAILED.`}\n`
  )
  app.exit(failed === 0 ? 0 : 1)
}
