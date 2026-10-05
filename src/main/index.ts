import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  dialog,
  shell,
  systemPreferences
} from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { IPC, SETTINGS_API_VERSION, type AppConfig, type SecretId } from '../shared/types.js'
import { createPopupWindow, hidePopup, resizePopup, hardenWebContents } from './popup.js'
import { registerHotkeys, unregisterHotkeys, bindingsFor, checkAvailability } from './hotkeys.js'
import {
  synthesize,
  toggleOrExplain,
  toggleOrRefine,
  cancelInFlight,
  flushCaches,
  explainClickedTranscript,
  explainLastAsCode,
  refineAgain,
  copySelection
} from './session.js'
import { loadConfig, saveConfig, setSecret, hasSecret, getSecret } from '../core/config.js'
import { LLM_PROVIDERS } from '../providers/llm/registry.js'
import { probeConfigured } from '../providers/llm/probe.js'
import { testVideoModel } from './video-model.js'
import { pruneVideoCache } from '../core/video-cache.js'
import { IS_MACOS, inputPermission, isAvailable, getLoadError } from './native/index.js'
import { startClickWatcher, stopClickWatcher } from './clicks.js'
import { setSystemDictionary } from '../core/pronunciation.js'
import { systemDefinition, systemDictionaryAvailable } from './native/dictionary-macos.js'
import { startLlmConnectionWarmup, warmLlmConnection } from './llm-connection.js'

const here = dirname(fileURLToPath(import.meta.url))

// Keep the original identity for encrypted keys, data and the single-instance
// lock when the product's display name changes. The video worker uses it too.
app.setName('easytranslate')
app.setPath('userData', join(app.getPath('appData'), 'easytranslate'))

let tray: Tray | null = null
let settingsWindow: BrowserWindow | null = null
let hotkeysPaused = false

/**
 * The preload is built as CommonJS (index.cjs) so the renderers can run sandboxed.
 * The other names are fallbacks for older build output.
 */
function preloadPath(): string {
  for (const name of ['index.cjs', 'index.mjs', 'index.js']) {
    const candidate = join(here, '../preload', name)
    if (existsSync(candidate)) return candidate
  }
  return join(here, '../preload/index.cjs')
}

const VERIFY_CAPTURE = process.argv.includes('--verify-capture')
const PROBE_HOTKEYS = process.argv.includes('--probe-hotkeys')
const VERIFY_HOTKEYS = process.argv.includes('--verify-hotkeys')
const VERIFY_CLICK = process.argv.includes('--verify-click')
const VERIFY_CODE = process.argv.includes('--verify-code')
const VERIFY_REFINE = process.argv.includes('--verify-refine')
const VERIFY_SETTINGS = process.argv.includes('--verify-settings')

if (VERIFY_CAPTURE) {
  // Self-test mode: skip the single-instance lock and the tray entirely.
  void app.whenReady().then(async () => {
    const { runCaptureVerification } = await import('./verify.js')
    await runCaptureVerification()
  })
} else if (VERIFY_HOTKEYS) {
  void app.whenReady().then(async () => {
    const { runHotkeyVerification } = await import('./verify-hotkeys.js')
    runHotkeyVerification()
  })
} else if (VERIFY_CLICK) {
  void app.whenReady().then(async () => {
    const { runClickVerification } = await import('./verify-click.js')
    await runClickVerification()
  })
} else if (VERIFY_CODE) {
  void app.whenReady().then(async () => {
    const { runCodeVerification } = await import('./verify-code.js')
    await runCodeVerification()
  })
} else if (VERIFY_REFINE) {
  void app.whenReady().then(async () => {
    const { runRefineVerification } = await import('./verify-refine.js')
    await runRefineVerification()
  })
} else if (PROBE_HOTKEYS) {
  void app.whenReady().then(async () => {
    const { runHotkeyProbe } = await import('./probe-hotkeys.js')
    runHotkeyProbe()
  })
} else if (VERIFY_SETTINGS) {
  void app.whenReady().then(async () => {
    const { runSettingsVerification } = await import('./verify-settings.js')
    await runSettingsVerification(registerIpc, preloadPath())
  })
} else if (!app.requestSingleInstanceLock()) {
  // A second instance would fight over the same global hotkeys, so hand off instead.
  app.quit()
} else {
  app.on('second-instance', () => openSettings())
  void app.whenReady().then(main)
}

function main(): void {
  const stopConnectionWarmup = startLlmConnectionWarmup(loadConfig)
  app.on('before-quit', stopConnectionWarmup)
  const cleanVideoCache = (): void => pruneVideoCache(join(app.getPath('userData'), 'video-cache'))
  cleanVideoCache()
  const videoCacheCleanup = setInterval(cleanVideoCache, 60 * 60 * 1000)
  videoCacheCleanup.unref()
  app.on('before-quit', () => clearInterval(videoCacheCleanup))
  // This is a tray app: closing the settings window must not quit it, and on Windows
  // there's no dock to hide from.
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  })

  // On macOS the same idea is an accessory app: no dock icon, no menu bar of its own,
  // and — the part that matters here — showing a window never pulls the app forward
  // and never takes focus off whatever the user is reading.
  if (IS_MACOS) app.dock?.hide()

  // Register the optional native dictionary without coupling core to native bindings.
  if (systemDictionaryAvailable()) setSystemDictionary(systemDefinition)

  createPopupWindow(preloadPath()).on('hide', cancelInFlight)
  createTray()
  registerIpc()

  // Nothing works until a model key is pasted, and a new user cannot be expected
  // to find a tray icon. Open Settings on a first run rather than sit there silently.
  if (process.argv.includes('--settings') || !hasSecret(loadConfig().llm.provider)) openSettings()
  applyHotkeys()
  applyClickWatcher()

  announceCaptureProblems()
}

/**
 * Say at startup when the app cannot read a selection, rather than letting every
 * hotkey press fail mutely.
 *
 * Two different problems, and on macOS the second is the common one: the bindings
 * load fine, but macOS refuses synthetic keystrokes from a process the user has not
 * granted Accessibility, and refuses them without a word.
 */
function announceCaptureProblems(): void {
  if (!isAvailable()) {
    void dialog.showMessageBox({
      type: 'error',
      title: 'EasyUnderstand',
      message: 'Text capture is unavailable.',
      detail:
        process.platform === 'win32' || IS_MACOS
          ? `Could not load the ${IS_MACOS ? 'macOS' : 'Windows'} input bindings.\n\n${getLoadError() ?? ''}`
          : `EasyUnderstand supports Windows and macOS. There is no text capture for ${process.platform}.`
    })
    return
  }

  if (inputPermission() === 'denied') void askForAccessibility()
}

/**
 * Walk the user to the Accessibility switch.
 *
 * macOS reads the grant once, when the process starts, so a permission granted
 * while the app is running does not take effect until it is restarted — which is
 * why this says so rather than polling and pretending otherwise.
 */
async function askForAccessibility(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'EasyUnderstand',
    message: 'EasyUnderstand needs Accessibility permission.',
    detail:
      'macOS will not let any app read your selection until you allow it. Open' +
      ` Privacy & Security → Accessibility, switch on ${app.isPackaged ? 'EasyUnderstand' : 'Electron'},` +
      ' then quit and start it again — macOS only checks this when an app launches.' +
      (app.isPackaged
        ? ''
        : '\n\nIt is listed as Electron rather than EasyUnderstand because this build' +
          " runs on Electron's own binary."),
    buttons: ['Open System Settings', 'Later'],
    defaultId: 0
  })
  if (response !== 0) return
  // Electron's own prompt is easy to miss and does not appear at all for a build
  // that is not signed, so the switch itself is opened instead.
  systemPreferences.isTrustedAccessibilityClient(true)
  void shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  )
}

// ------------------------------------------------------------ login item

/**
 * Start at login. Installed from source, the executable is a bare electron.exe,
 * which on its own opens Electron's default app — the app directory has to be
 * passed as an argument, the same way the installer's shortcuts do it.
 */
function applyLoginItem(openAtLogin: boolean): void {
  app.setLoginItemSettings({
    openAtLogin,
    // macOS registers the bundle itself and rejects a path into it, so only Windows
    // gets the explicit executable and app directory.
    ...(IS_MACOS
      ? {}
      : { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] })
  })
}

// ----------------------------------------------------------------- hotkeys

/**
 * Double-clicking a transcript line is the other way in, and it obeys the same
 * pause as the hotkey — "pause" should mean the app does nothing at all.
 */
function applyClickWatcher(): void {
  const wanted = loadConfig().doubleClickTranscripts && !hotkeysPaused && isAvailable()
  if (wanted) startClickWatcher((click) => void explainClickedTranscript(click))
  else stopClickWatcher()
}

function applyHotkeys(announce = true): void {
  if (hotkeysPaused) {
    unregisterHotkeys()
    stopClickWatcher()
    refreshTrayMenu()
    return
  }

  const config = loadConfig()
  const result = registerHotkeys(
    bindingsFor(config, { explain: toggleOrExplain, refine: toggleOrRefine })
  )

  // A reassignment is only useful if it sticks, so persist what actually bound —
  // otherwise the same conflict would be rediscovered on every launch.
  const { explain, refine } = result.resolved
  if ((explain && explain !== config.hotkeys.explain) || (refine && refine !== config.hotkeys.refine)) {
    saveConfig({ hotkeys: {
      explain: explain || config.hotkeys.explain,
      refine: refine || config.hotkeys.refine
    } })
  }

  refreshTrayMenu()
  if (!announce) return

  if (result.failed.length > 0) {
    void dialog.showMessageBox({
      type: 'warning',
      title: 'EasyUnderstand',
      message: 'Some hotkeys could not be registered.',
      detail:
        result.failed.map((f) => `${f.description}: ${f.wanted} — ${f.why}`).join('\n') +
        '\n\nPick a different shortcut in Settings. Run "npm run probe:hotkeys" to list' +
        ' which combinations are free on this machine.',
      buttons: ['Open Settings', 'Ignore'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) openSettings()
    })
  } else if (result.reassigned.length > 0) {
    // Informational, not a warning: everything works, it just moved.
    void dialog.showMessageBox({
      type: 'info',
      title: 'EasyUnderstand',
      message: 'Some shortcuts were already in use, so they were moved.',
      detail:
        result.reassigned
          .map((r) => `${r.description}\n    ${r.wanted} was taken  →  now ${r.got}`)
          .join('\n\n') + '\n\nThese are saved. Change them any time in Settings.',
      buttons: ['OK', 'Open Settings'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 1) openSettings()
    })
  }
}

// -------------------------------------------------------------------- tray

/**
 * The menu bar wants a 16pt icon, where the tray wants the 32px one as it is.
 *
 * Handing macOS the 32px image directly gives a 32pt icon — twice the height of the
 * menu bar. So the same file is offered as a 16pt image with the original as its
 * Retina representation, which keeps it sharp rather than resampled.
 *
 * Not a template image: the icon's two tones are how it is recognised, and a template
 * keeps only the alpha, which would flatten it into a plain black disc.
 */
function trayIcon(): Electron.NativeImage {
  const source = nativeImage.createFromPath(join(here, '../../resources/tray.png'))
  if (source.isEmpty()) return nativeImage.createEmpty()
  if (!IS_MACOS) return source

  const icon = source.resize({ width: 16, height: 16 })
  icon.addRepresentation({ scaleFactor: 2, width: 16, height: 16, buffer: source.toPNG() })
  return icon
}

function createTray(): void {
  tray = new Tray(trayIcon())
  tray.setToolTip('EasyUnderstand')
  // A left click on macOS opens the menu, as every other menu bar item does; on
  // Windows the menu is the right click and a left click is the shortcut to Settings.
  if (!IS_MACOS) tray.on('click', () => openSettings())
  refreshTrayMenu()
}

function refreshTrayMenu(): void {
  if (!tray) return
  const config = loadConfig()

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Explain selection  (${config.hotkeys.explain})`, click: () => toggleOrExplain() },
      { label: `Refine selection  (${config.hotkeys.refine})`, click: () => toggleOrRefine() },
      { type: 'separator' },
      {
        label: 'Pause',
        type: 'checkbox',
        checked: hotkeysPaused,
        click: (item) => {
          hotkeysPaused = item.checked
          applyHotkeys()
          applyClickWatcher()
        }
      },
      { label: 'Settings…', click: () => openSettings() },
      {
        label: 'Open data folder',
        click: () => void shell.openPath(app.getPath('userData'))
      },
      { type: 'separator' },
      { label: 'Quit EasyUnderstand', click: () => app.quit() }
    ])
  )
  tray.setToolTip(hotkeysPaused ? 'EasyUnderstand — paused' : 'EasyUnderstand')
}

// ---------------------------------------------------------------- settings

function openSettings(): void {
  // An accessory app is not in the window server's activation order, so asking for
  // focus is not enough on macOS — the app itself has to come forward first.
  if (IS_MACOS) app.focus({ steal: true })

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 560,
    height: 720,
    title: 'EasyUnderstand Settings',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  hardenWebContents(settingsWindow)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void settingsWindow.loadURL(`${devUrl}/settings/index.html`)
  else void settingsWindow.loadFile(join(here, '../renderer/settings/index.html'))

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

// --------------------------------------------------------------------- ipc

function registerIpc(): void {
  ipcMain.on(IPC.popupClose, () => hidePopup())
  ipcMain.on(IPC.popupExplainCode, () => void explainLastAsCode())
  ipcMain.on(IPC.popupRefineAgain, () => void refineAgain())

  ipcMain.handle(IPC.popupCopySelection, (_e, text: unknown) =>
    copySelection(typeof text === 'string' ? text : '')
  )

  ipcMain.on(IPC.popupResize, (_e, height: unknown) => {
    if (typeof height === 'number' && Number.isFinite(height)) resizePopup(height)
  })

  ipcMain.handle(IPC.ttsSpeak, async (_e, payload: { text?: unknown; slow?: unknown }) => {
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (!text) return { error: 'Nothing to read.' }
    try {
      return await synthesize(text, payload?.slow === true)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.configGet, () => ({
    settingsApiVersion: SETTINGS_API_VERSION,
    config: loadConfig(),
    providers: LLM_PROVIDERS,
    captureAvailable: isAvailable(),
    // Settings talks about the OS constantly — the copy chord, where keys are
    // encrypted, which offline voice you get — so it is told which one it is on.
    platform: process.platform,
    inputPermission: inputPermission()
  }))

  ipcMain.handle(IPC.configSet, (_e, patch: Partial<AppConfig>) => {
    const saved = saveConfig(patch ?? {})
    // Hotkeys and the login item are OS-level state, so they have to be re-applied
    // whenever settings change rather than read on demand. No dialog here — Settings
    // reports availability inline as you type.
    applyHotkeys(false)
    applyClickWatcher()
    applyLoginItem(saved.launchAtLogin)
    warmLlmConnection(saved)
    // Re-read: applyHotkeys may have reassigned a conflicting shortcut and saved
    // again, and Settings must show what is actually bound, not what was requested.
    return loadConfig()
  })

  ipcMain.handle(
    IPC.configSecretSet,
    (_e, payload: { provider: SecretId; value: string }) =>
      setSecret(payload.provider, payload.value ?? '')
  )

  ipcMain.handle(IPC.hotkeyCheck, (_e, accelerator: unknown) =>
    typeof accelerator === 'string'
      ? checkAvailability(accelerator)
      : { ok: false, why: 'Enter a shortcut.' }
  )

  ipcMain.handle(IPC.llmTest, async () => {
    const config = loadConfig()
    return probeConfigured(config, getSecret(config.llm.provider))
  })

  ipcMain.handle(IPC.videoTest, () => testVideoModel(loadConfig()))

  ipcMain.handle(IPC.configSecretStatus, () =>
    Object.fromEntries([
      ...LLM_PROVIDERS.map((p) => [p.id, hasSecret(p.id)]),
      ['tts', hasSecret('tts')],
      ['video', hasSecret('video')]
    ])
  )
}

// --------------------------------------------------------------- shutdown

app.on('will-quit', () => {
  unregisterHotkeys()
  stopClickWatcher()
  flushCaches()
})
