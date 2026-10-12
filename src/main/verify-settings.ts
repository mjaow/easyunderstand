import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { __resetCache } from '../core/config.js'
import { SETTINGS_API_VERSION } from '../shared/types.js'

/** Verify the real main handlers and built preload, without keys or API calls. */
export async function runSettingsVerification(registerIpc: () => void, preload: string): Promise<void> {
  const directory = process.env.EASYTRANSLATE_SETTINGS_VERIFY_DIR
  if (!directory) throw new Error('Run this verification with npm run verify:settings.')
  app.setPath('userData', directory)
  delete process.env.EASYTRANSLATE_VIDEO_API_KEY
  __resetCache()
  const timer = setTimeout(() => app.exit(1), 15000)
  let window: BrowserWindow | undefined
  let code = 0
  try {
    registerIpc()
    window = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    await window.loadURL('about:blank')
    const bootstrap = await window.webContents.executeJavaScript('window.easytranslate.getConfig()')
    assert.equal(bootstrap.settingsApiVersion, SETTINGS_API_VERSION)
    assert.equal(bootstrap.config.hotkeys.summarize, 'CommandOrControl+Alt+S')
    const result = await window.webContents.executeJavaScript('window.easytranslate.testVideoModel()')
    assert.equal(result.ok, false)
    assert.match(result.message, /video API key/)
    console.log('Real main → preload → renderer video-test IPC passed; missing key reported without an API call.')
  } catch (error) {
    console.error(error); code = 1
  } finally {
    window?.destroy(); clearTimeout(timer)
    // The parent removes the temporary profile after Electron releases its locks.
    app.exit(code)
  }
}
