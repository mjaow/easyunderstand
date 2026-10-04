// Exercise the built Settings and real preload in an isolated hidden window.
// All IPC handlers use fixtures; no user settings, keys or provider APIs are read.
const { app, BrowserWindow, ipcMain } = require('electron')
const { resolve } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
const assert = require('node:assert/strict')
app.disableHardwareAcceleration()
const timer = setTimeout(() => app.exit(1), 20000)
const azure = process.argv.includes('--azure')
const legacy = process.argv.includes('--legacy')
const azureEveryday = process.argv.includes('--everyday-azure')
let config = {
  hotkeys: { explain: 'Control+Alt+E', refine: 'Control+Alt+R' }, doubleClickTranscripts: false, launchAtLogin: false,
  tts: { provider: 'system', systemVoice: '', azureRegion: 'eastus', azureVoice: '', slowRate: -40, autoPlay: false },
  llm: { provider: 'openai', models: { openai: 'qwen-flash' }, baseUrls: { openai: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }, codeModel: '',
    videoProvider: 'openai', videoModel: 'gemini-3.8-flash', videoBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }
}
if (azure) Object.assign(config.llm, {
  videoProtocol: 'azure-responses', videoModel: 'gpt-6-astra',
  videoBaseUrl: 'https://example.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview'
})
if (azureEveryday) {
  config.llm.provider = 'azure'
  config.llm.models.azure = 'gpt-6-luna'
  config.llm.codeModel = 'gpt-6-luna'
  config.llm.baseUrls.azure = 'https://fixture.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview'
}
const everyday = JSON.stringify([config.llm.provider, config.llm.models, config.llm.baseUrls])
let videoKey = false, videoTests = 0, everydayTests = 0
ipcMain.handle('config:get', () => ({ settingsApiVersion: legacy ? 2 : 4, config, providers: [{ id: 'openai', label: 'OpenAI', needsKey: true }, { id: 'azure', label: 'Azure OpenAI', needsKey: true }, { id: 'claude', label: 'Claude', needsKey: true }, { id: 'ollama', label: 'Ollama', needsKey: false }], platform: 'win32', captureAvailable: false, inputPermission: 'not-required' }))
ipcMain.handle('config:set', (_event, patch) => { config = { ...config, ...patch }; return config })
ipcMain.handle('config:secret-status', () => ({ openai: true, azure: azureEveryday, video: videoKey }))
ipcMain.handle('config:secret-set', (_event, { provider, value }) => {
  assert.equal(provider, 'video'); assert.equal(value, 'fixture-key'); videoKey = true; return { ok: true }
})
ipcMain.handle('config:hotkey-check', () => ({ ok: true }))
ipcMain.handle('config:llm-test', () => { everydayTests++; return { ok: true, message: 'Everyday tested.' } })
ipcMain.handle('config:video-test', () => { videoTests++; return { ok: videoKey, message: videoKey ? 'Working. Video model tested.' : 'No video API key is saved.' } })
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 560, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: resolve('out/preload/index.cjs') } })
  const run = async code => {
    try { return await win.webContents.executeJavaScript(code) }
    catch (error) { console.error('Settings verification script failed:', code); throw error }
  }
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await run(expression)) return; await new Promise(r => setTimeout(r, 50)) }
    throw new Error(`Timed out: ${expression}`)
  }
  await win.loadFile(resolve('out/renderer/settings/index.html'))
  if (legacy) {
    await waitFor('document.body.textContent.includes("Restart EasyUnderstand to finish the update")')
    assert.equal(await run('document.querySelectorAll("input,select").length'), 0)
    assert.equal(await run('document.body.textContent.includes("Test video model")'), false)
    assert.equal(videoTests, 0); assert.equal(everydayTests, 0); assert.equal(videoKey, false)
    console.log('Old background app is detected; model tests and config edits are unavailable until restart.')
    win.destroy(); clearTimeout(timer); app.exit(0); return
  }
  await waitFor('document.body.textContent.includes("YouTube analysis")')
  if (azureEveryday) {
    await run('window.everydayCard = [...document.querySelectorAll("section")].find(x => x.querySelector("h2")?.textContent === "Explanations"); void 0')
    assert.equal(await run('everydayCard.querySelector("select").value'), 'azure-luna')
    assert.equal(await run('everydayCard.textContent.includes("Azure deployment name") && everydayCard.textContent.includes("Azure Responses endpoint")'), true)
    assert.equal(await run('everydayCard.querySelector("input[type=password]").value'), '')
    assert.equal(await run('everydayCard.querySelector("input[type=password]").placeholder'), '••••••••••••')
    const endpoint = config.llm.baseUrls.azure
    await run('{ const select=everydayCard.querySelector("select"); select.value="azure-luna"; select.dispatchEvent(new Event("change",{bubbles:true})); void 0 }')
    await waitFor('everydayCard.querySelector("select").value === "azure-luna"')
    assert.equal(config.llm.baseUrls.azure, endpoint)
    assert.equal(config.llm.codeModel, 'gpt-6-luna')
  }
  await run('window.videoCard = [...document.querySelectorAll("section")].find(x => x.querySelector("h2")?.textContent === "YouTube analysis"); window.testButton = () => [...videoCard.querySelectorAll("button")].find(b => /Test video model|Testing/.test(b.textContent)); void 0')
  assert.equal(await run('videoCard.querySelector("select").value'), azure ? 'video-azure-astra' : 'video-gemini-flash')
  assert.equal(await run(`[...videoCard.querySelectorAll("input")].some(x => x.value === ${JSON.stringify(config.llm.videoModel)})`), true)
  assert.equal(await run('videoCard.querySelector("input[type=password]").value'), '')
  if (azure) {
    assert.equal(await run('videoCard.textContent.includes("Azure deployment name") && videoCard.textContent.includes("Azure Responses endpoint")'), true)
    assert.equal(await run(`videoCard.querySelector('select[aria-label="Video reasoning effort"]')?.value`), 'low')
    const endpoint = config.llm.videoBaseUrl
    await run('{ const select=videoCard.querySelector("select"); select.value="video-azure-luna"; select.dispatchEvent(new Event("change",{bubbles:true})); void 0 }')
    await waitFor('videoCard.querySelector("select").value === "video-azure-luna"')
    assert.equal(config.llm.videoModel, 'gpt-6-luna')
    assert.equal(config.llm.videoReasoningEffort, 'none')
    assert.equal(config.llm.videoBaseUrl, endpoint)
    assert.equal(await run('videoCard.querySelector("input[type=password]").value'), '')
  }
  await run('testButton().click()')
  await waitFor('videoCard.textContent.includes("No video API key")')
  await run('const input=videoCard.querySelector("input[type=password]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"fixture-key"); input.dispatchEvent(new Event("input",{bubbles:true})); void 0')
  await waitFor('testButton().disabled')
  await run('[...videoCard.querySelectorAll("button")].find(x => x.textContent === "Save").click()')
  await waitFor('videoCard.textContent.includes("Video key saved.")')
  assert.equal(config.llm.videoKeyScope, `${azure ? 'azure-responses|' : ''}openai|${config.llm.videoBaseUrl}`)
  await waitFor('!testButton().disabled')
  await run('testButton().click()')
  await waitFor('videoCard.textContent.includes("Working. Video model tested.")')
  assert.equal(videoTests, 2); assert.equal(everydayTests, 0)
  assert.equal(JSON.stringify([config.llm.provider, config.llm.models, config.llm.baseUrls]), everyday)
  if (azure) {
    await run(`const effort=videoCard.querySelector('select[aria-label="Video reasoning effort"]'); effort.value="low"; effort.dispatchEvent(new Event("change",{bubbles:true})); void 0`)
    await waitFor('!videoCard.textContent.includes("Working. Video model tested.")')
    assert.equal(config.llm.videoReasoningEffort, 'low')
    assert.equal(await run('videoCard.querySelector("select").value'), 'custom')
    await run('{ const select=videoCard.querySelector("select"); select.value="video-azure-luna"; select.dispatchEvent(new Event("change",{bubbles:true})); void 0 }')
    await waitFor('videoCard.querySelector("select").value === "video-azure-luna"')
    assert.equal(config.llm.videoReasoningEffort, 'none')
  }
  await run('videoCard.scrollIntoView({block:"start"}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  mkdirSync('out/verification', { recursive: true })
  writeFileSync(`out/verification/video-settings${azure ? '-azure' : ''}.png`, (await win.webContents.capturePage()).toPNG())
  if (azure) {
    await run('{ const select=videoCard.querySelector("select"); select.value="video-gemini-flash"; select.dispatchEvent(new Event("change",{bubbles:true})); void 0 }')
    await waitFor('videoCard.querySelector("select").value === "video-gemini-flash" && !videoCard.textContent.includes("Azure Responses endpoint")')
    assert.equal(config.llm.videoProtocol, 'standard')
    assert.equal(config.llm.videoBaseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai')
    assert.equal(await run('videoCard.textContent.includes("A dedicated key is saved for this endpoint.")'), false)
    assert.equal(JSON.stringify([config.llm.provider, config.llm.models, config.llm.baseUrls]), everyday)
  }
  console.log(`${azure ? 'Azure' : 'Gemini'} preset, blank initial key, dedicated key save, real preload routing, and independent connection test UI passed (fixture API).`)
  win.destroy(); clearTimeout(timer); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1) })
