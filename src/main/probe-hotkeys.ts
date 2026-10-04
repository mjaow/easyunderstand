/**
 * Hotkey availability probe: `npm run probe:hotkeys`.
 *
 * Reports which accelerators this machine will actually let EasyUnderstand bind, so
 * picking a working pair is a lookup rather than trial and error.
 *
 * Caveat worth knowing: this tests the OS call Electron itself uses — RegisterHotKey
 * on Windows, RegisterEventHotKey on macOS. An app that grabs keys ahead of that, with
 * a low-level keyboard hook or a CGEventTap — many IMEs do, and so do some vendor
 * utilities — will not show up as a conflict here, yet can still swallow the key
 * before it reaches us. A combination that passes here but doesn't fire in practice is
 * almost certainly one of those. On macOS, System Settings → Keyboard → Keyboard
 * Shortcuts lists the ones the system itself has taken.
 *
 * Loaded dynamically from a CLI flag, so none of it ships in the normal startup path.
 */
import { app, globalShortcut } from 'electron'
import { loadConfig } from '../core/config.js'
import { FALLBACKS, isForbidden } from './hotkeys.js'

/**
 * Candidates worth considering, roughly in order of how comfortable they are to hit
 * one-handed while the other hand is on the mouse selecting text.
 */
const WINDOWS_CANDIDATES = [
  'Control+Alt+Space',
  'Control+Alt+R',
  'Control+Alt+E',
  'Control+Alt+D',
  'Control+Alt+F',
  'Control+Alt+G',
  'Control+Alt+Q',
  'Control+Alt+W',
  'Control+Alt+A',
  'Control+Alt+S',
  'Control+Alt+Z',
  'Control+Alt+1',
  'Control+Alt+2',
  'Control+Shift+Space',
  'Control+Shift+E',
  'Control+Shift+D',
  'Control+Shift+F',
  'Control+Shift+Q',
  'Alt+Q',
  'Alt+W',
  'Alt+E',
  'Alt+D',
  'F8',
  'F9',
  'Control+F8',
  'Control+F9',
  'Alt+F8',
  'Alt+F9'
]

/**
 * The same idea in macOS's terms. Command is the modifier that is actually free
 * there — Control+Alt combinations are where the system keeps its own shortcuts, and
 * a bare ⌥letter is a dead key for typing accented characters.
 */
const MAC_CANDIDATES = [
  'Command+Alt+E',
  'Command+Alt+D',
  'Command+Alt+Q',
  'Command+Alt+F',
  'Command+Alt+G',
  'Command+Alt+W',
  'Command+Alt+Z',
  'Command+Alt+1',
  'Command+Alt+2',
  'Command+Shift+E',
  'Command+Shift+D',
  'Control+Alt+E',
  'Control+Alt+D',
  'Control+Shift+E',
  'F8',
  'F9',
  'Command+F8',
  'Command+F9'
]

const CANDIDATES = process.platform === 'darwin' ? MAC_CANDIDATES : WINDOWS_CANDIDATES

interface Probe {
  accelerator: string
  status: 'free' | 'taken' | 'forbidden' | 'invalid'
  note?: string
}

function probe(accelerator: string): Probe {
  if (isForbidden(accelerator)) {
    return { accelerator, status: 'forbidden', note: 'would shadow a clipboard shortcut' }
  }
  try {
    // register() returns false when another process already owns the combination.
    const got = globalShortcut.register(accelerator, () => {})
    if (got) globalShortcut.unregister(accelerator)
    return { accelerator, status: got ? 'free' : 'taken' }
  } catch (err) {
    return { accelerator, status: 'invalid', note: err instanceof Error ? err.message : String(err) }
  }
}

export function runHotkeyProbe(): void {
  const config = loadConfig()
  const configured = new Set(Object.values(config.hotkeys))

  console.log('\nEasyUnderstand — hotkey availability\n')

  const results = [...new Set([...configured, ...FALLBACKS.explain, ...FALLBACKS.refine, ...CANDIDATES])].map(probe)
  const pad = Math.max(...results.map((r) => r.accelerator.length))

  for (const r of results) {
    const mark = r.status === 'free' ? 'free  ' : r.status === 'taken' ? 'TAKEN ' : r.status.toUpperCase()
    const current = configured.has(r.accelerator) ? '  <- currently configured' : ''
    console.log(`  ${mark}  ${r.accelerator.padEnd(pad)}${r.note ? `  (${r.note})` : ''}${current}`)
  }

  // Learned the hard way: a running EasyUnderstand holds its own hotkeys, so they
  // probe as "taken" and look like a third-party conflict. Same for instances left
  // behind by an earlier dev run.
  console.log('\n  Note: quit any running EasyUnderstand first — it holds its own')
  console.log('  shortcuts, which then show up here as TAKEN.')

  const free = results.filter((r) => r.status === 'free').map((r) => r.accelerator)
  const takenConfigured = results.filter((r) => configured.has(r.accelerator) && r.status !== 'free')

  console.log(`\n  ${free.length} of ${results.length} candidates are free.`)

  if (takenConfigured.length > 0) {
    console.log('\n  Some configured hotkeys are NOT available:')
    for (const r of takenConfigured) console.log(`    ${r.accelerator} — ${r.status}`)
    console.log(`\n  Suggested replacements: ${free.slice(0, 2).join('  and  ') || '(none free)'}`)
  } else {
    console.log('  Your configured hotkeys are available.')
  }
  console.log('')

  globalShortcut.unregisterAll()
  app.exit(0)
}
