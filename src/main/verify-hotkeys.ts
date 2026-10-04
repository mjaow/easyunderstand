/**
 * Self-test for hotkey registration: `npm run verify:hotkeys`.
 *
 * Hotkeys are the app's entire input surface, and a broken binding is invisible —
 * the key just does nothing. These assertions cover the behaviours that matter:
 * clipboard shortcuts are refused, conflicts fall back instead of failing, and the
 * availability check Settings relies on tells the truth.
 *
 * Loaded dynamically from a CLI flag, so none of it ships in the normal startup path.
 */
import { app, globalShortcut } from 'electron'
import { registerHotkeys, unregisterHotkeys, checkAvailability, isForbidden } from './hotkeys.js'

let passed = 0
let failed = 0

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

/**
 * Accelerators for the "binds as asked" assertions.
 *
 * Deliberately NOT the app's real defaults: a running EasyUnderstand holds those, so
 * the test instance would see them as taken and report a conflict that isn't real.
 * Function-key combinations are rarely claimed by anything.
 */
const FREE_A = 'CommandOrControl+Alt+F9'
const FREE_B = 'CommandOrControl+Shift+F9'

export function runHotkeyVerification(): void {
  console.log('\nEasyUnderstand — hotkey self-test\n')

  const noop = (): void => {}

  // A running instance holds its own shortcuts, which would look exactly like a
  // third-party conflict. Refuse to report misleading results.
  if (!globalShortcut.register(FREE_A, noop)) {
    console.log(`  Cannot run: ${FREE_A} is already held by something.`)
    console.log('  Quit any running EasyUnderstand and try again.\n')
    app.exit(2)
    return
  }
  globalShortcut.unregister(FREE_A)

  // --- clipboard shortcuts can never be bound -----------------------------
  //
  // Both spellings on both platforms: what copies is Ctrl+C on Windows and Command+C
  // on macOS, and the config can hold either, however it was recorded.
  for (const bad of [
    'Control+C',
    'Control+V',
    'Control+X',
    'Command+C',
    'Command+V',
    'Command+X',
    'CommandOrControl+C'
  ]) {
    check(isForbidden(bad), `${bad} is refused outright`)
  }
  check(
    isForbidden(process.platform === 'darwin' ? 'Command+C' : 'Control+C'),
    "this platform's own copy shortcut is refused"
  )
  check(!isForbidden('Control+Alt+E'), 'an ordinary shortcut is not refused')

  const refused = registerHotkeys([
    { id: 'explain', accelerator: 'Control+C', handler: noop, description: 'Explain' }
  ])
  check(
    !globalShortcut.isRegistered('Control+C'),
    'refusing Ctrl+C actually leaves it unbound'
  )
  check(
    refused.resolved.explain !== 'Control+C',
    'a refused shortcut is never reported as resolved',
    refused.resolved.explain || '(none)'
  )
  unregisterHotkeys()

  // --- a free shortcut binds as asked -------------------------------------
  const clean = registerHotkeys([
    { id: 'explain', accelerator: FREE_A, handler: noop, description: 'Explain' }
  ])
  check(clean.resolved.explain === FREE_A, 'preferred shortcut bound', clean.resolved.explain)
  check(clean.reassigned.length === 0, 'nothing was moved unnecessarily')
  check(globalShortcut.isRegistered(FREE_A), 'the binding is live with the OS')
  unregisterHotkeys()

  const pair = registerHotkeys([
    { id: 'explain', accelerator: FREE_A, handler: noop, description: 'Explain' },
    { id: 'refine', accelerator: FREE_B, handler: noop, description: 'Refine' }
  ])
  check(pair.resolved.explain === FREE_A && pair.resolved.refine === FREE_B,
    'explanation and refinement have independent live shortcuts')
  check(globalShortcut.isRegistered(FREE_A) && globalShortcut.isRegistered(FREE_B),
    'both actions are registered with the OS')
  unregisterHotkeys()

  const duplicate = registerHotkeys([
    { id: 'explain', accelerator: FREE_A, handler: noop, description: 'Explain' },
    { id: 'refine', accelerator: FREE_A, handler: noop, description: 'Refine' }
  ])
  check(duplicate.resolved.explain === FREE_A && !!duplicate.resolved.refine && duplicate.resolved.refine !== FREE_A,
    'a duplicate refinement shortcut falls back without taking the explanation shortcut')
  unregisterHotkeys()

  // --- an unbindable shortcut falls back rather than failing ---------------
  //
  // A shortcut owned by *another process* can't be simulated from here:
  // registerHotkeys() begins with unregisterAll(), which would release any squat we
  // took, and the conflict would vanish before the test ran. A forbidden accelerator
  // exercises exactly the same fallback path — tryRegister() returns a reason, and
  // the walk through FALLBACKS proceeds identically.
  const unbindable = 'Control+C'

  const contended = registerHotkeys([
    { id: 'explain', accelerator: unbindable, handler: noop, description: 'Explain' }
  ])
  check(
    contended.failed.length === 0,
    'a conflict does not leave the action unbound',
    contended.failed.map((f) => f.why).join('; ')
  )
  check(
    contended.reassigned.length === 1,
    'the conflict is reported as a reassignment'
  )
  check(
    !!contended.resolved.explain && contended.resolved.explain !== unbindable,
    'it moved to a different shortcut',
    `now ${contended.resolved.explain}`
  )
  check(
    globalShortcut.isRegistered(contended.resolved.explain),
    'the fallback is actually bound'
  )
  unregisterHotkeys()

  // --- the availability check Settings relies on ---------------------------
  check(checkAvailability(FREE_A).ok, 'a free shortcut reports available')
  check(!checkAvailability('Control+C').ok, 'a clipboard shortcut reports unavailable')
  check(!checkAvailability('').ok, 'an empty shortcut reports unavailable')
  check(!checkAvailability('NotAKey+++').ok, 'nonsense syntax reports unavailable')
  check(
    !globalShortcut.isRegistered(FREE_A),
    'checking availability leaves nothing bound behind'
  )

  const held = FREE_B
  globalShortcut.register(held, noop)
  const taken = checkAvailability(held)
  check(taken.ok, 'a shortcut we already hold is not reported as a conflict')
  unregisterHotkeys()

  console.log(`\n${failed === 0 ? `All ${passed} hotkey checks passed.` : `${failed} of ${passed + failed} FAILED.`}\n`)
  app.exit(failed === 0 ? 0 : 1)
}
