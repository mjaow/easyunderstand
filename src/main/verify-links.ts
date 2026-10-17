/** Real Chromium + OS accessibility checks, without opening any link or using a model. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, clipboard, ipcMain, screen } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readLinkAtPoint } from './a11y.js'
import { captureSelection } from './capture.js'
import { dipToScreen, screenToDip } from './coords.js'
import { foregroundWindowTitle } from './native/index.js'
import { createPopupWindow, hidePopup, resizePopup, showPopup, updatePopup } from './popup.js'
import { IPC, type ExplainState } from '../shared/types.js'
import { forceForeground } from './verify.js'

export async function runLinkVerification(preloadPath: string): Promise<void> {
  app.on('window-all-closed', () => {})
  const area = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    x: area.x + 40, y: area.y + 40, width: 760, height: 560,
    frame: false, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  const html = `<!doctype html><meta charset="utf-8"><title>Link capture verification</title>
    <style>body{margin:20px;font:18px sans-serif} .row{display:block;margin:16px 0} h3{margin:0}</style>
    <a class="row" href="https://example.com/news"><h3 id="nested">Scientists discover a new planet beyond our solar system</h3></a>
    <a class="row" id="youtube" href="https://www.youtube.com/watch?v=fixture"
       aria-label="How telescopes reveal distant galaxies by Science Channel 2 days ago 100 views">
      <span>How telescopes reveal</span> <strong>distant galaxies</strong></a>
    <a class="row" id="label" href="https://example.com/label" aria-label="Understanding the next generation of computers"><span aria-hidden="true">▶</span></a>
    <a class="row" id="unicode" href="https://example.com/unicode">20:20 科学与未来 — today's news</a>
    <a class="row" id="empty" href="https://example.com/empty"><span aria-hidden="true">◆</span></a>
    <h3 class="row" id="plain">This heading is not a link</h3>
    <button class="row" id="button">This button is not a link</button>
    <input class="row" id="input" value="Editable text is not a link">
    <p id="selection">Preserve this selection.</p>`
  const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
  let popup: BrowserWindow | null = null
  let failed = false
  try {
    await win.loadURL(url)
    win.show()
    await new Promise(resolve => setTimeout(resolve, 300))
    const beforeClipboard = await clipboard.readText()
    const pointFor = async (id: string): Promise<{ x: number; y: number }> => {
      const rect = await win.webContents.executeJavaScript(`(() => {
        const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
        return {x:r.x+Math.min(20,r.width/2),y:r.y+r.height/2};
      })()`)
      const bounds = win.getContentBounds()
      return dipToScreen({ x: bounds.x + rect.x, y: bounds.y + rect.y })
    }
    const check = async (id: string, expected: string | null): Promise<void> => {
      const point = await pointFor(id)
      const title = await readLinkAtPoint(point.x, point.y)
      assert.equal(title, expected, id)
      console.log(`PASS ${id}: ${title ?? 'no link'}`)
    }
    await check('nested', 'Scientists discover a new planet beyond our solar system')
    await check('youtube', 'How telescopes reveal distant galaxies')
    await check('label', 'Understanding the next generation of computers')
    await check('unicode', "20:20 科学与未来 — today's news")
    for (const id of ['empty', 'plain', 'button', 'input']) await check(id, null)

    popup = createPopupWindow(preloadPath)
    ipcMain.on(IPC.popupResize, (_event, height: number) => resizePopup(height))
    await new Promise<void>(resolve => popup!.webContents.once('did-finish-load', () => resolve()))
    await new Promise(resolve => setTimeout(resolve, 150))
    const pending: ExplainState = {
      mode: 'passage', text: '', explanation: {}, status: 'capturing', captureProgress: 'Reading link title…'
    }

    await win.webContents.executeJavaScript(`(() => {
      const range = document.createRange(); range.selectNodeContents(document.getElementById('selection'));
      getSelection().removeAllRanges(); getSelection().addRange(range);
    })()`)
    for (const display of screen.getAllDisplays()) {
      const a = display.workArea
      win.setBounds({ x: a.x + Math.max(0, a.width - 760), y: a.y + Math.max(0, a.height - 560), width: 760, height: 560 })
      await new Promise(resolve => setTimeout(resolve, 150))
      const point = screenToDip(await pointFor('nested'))
      popup.setBounds({ x: Math.round(point.x + 18), y: Math.round(point.y + 18), width: 400, height: 180 })
      const foreground = foregroundWindowTitle()
      showPopup(pending, false)
      assert.equal(popup.isVisible(), true)
      await new Promise(resolve => setTimeout(resolve, 150))
      assert.match(await popup.webContents.executeJavaScript('document.body.innerText'), /Reading link title…/)
      assert.equal(foregroundWindowTitle(), foreground, 'opening the loading popup must not take focus')
      await check('nested', 'Scientists discover a new planet beyond our solar system')
      console.log(`PASS visible loading popup, display ${display.id}, scale ${display.scaleFactor}`)
      hidePopup()
    }

    forceForeground(win)
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(foregroundWindowTitle(), 'Link capture verification', 'the source must have focus before testing copy')
    showPopup(pending, false)
    const captured = await captureSelection()
    assert.ok(captured.ok && captured.text === 'Preserve this selection.', 'copy must still reach the source with the popup visible')
    assert.equal(foregroundWindowTitle(), 'Link capture verification')
    console.log('PASS selected text captured while loading popup is visible')

    const translating: ExplainState = {
      mode: 'passage', text: 'How telescopes reveal distant galaxies', explanation: {}, status: 'streaming'
    }
    updatePopup(translating)
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.match(await popup.webContents.executeJavaScript('document.body.innerText'), /Translating…/)
    updatePopup({ ...translating, explanation: { zh: '望远镜如何揭示' } })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.match(await popup.webContents.executeJavaScript('document.body.innerText'), /望远镜如何揭示/)
    await writeFile(join(app.getAppPath(), 'out/hover-progress.png'), (await popup.webContents.capturePage()).toPNG())
    updatePopup({ ...translating, status: 'done', explanation: { zh: '望远镜如何揭示遥远的星系' } })
    await new Promise(resolve => setTimeout(resolve, 150))
    const completed = await popup.webContents.executeJavaScript('document.body.innerText')
    assert.match(completed, /望远镜如何揭示遥远的星系/)
    assert.doesNotMatch(completed, /Translating…/)
    console.log('PASS source, partial translation and completed result in the same popup')
    assert.equal(await win.webContents.executeJavaScript('getSelection().toString()'), 'Preserve this selection.')
    assert.equal(await clipboard.readText(), beforeClipboard)
    assert.equal(win.webContents.getURL(), url)
    console.log('PASS selection, clipboard and page URL preserved')
  } catch (error) {
    failed = true
    console.error(error)
  } finally {
    hidePopup()
    popup?.destroy()
    ipcMain.removeAllListeners(IPC.popupResize)
    win.destroy()
    app.exit(failed ? 1 : 0)
  }
}
