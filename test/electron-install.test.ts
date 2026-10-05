import { execFile } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

it.skipIf(process.platform !== 'win32')('allows npm postinstall before Electron 44 downloads its binary', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'easytranslate-electron-install-'))
  try {
    mkdirSync(join(directory, 'scripts'))
    mkdirSync(join(directory, 'node_modules', 'electron'), { recursive: true })
    const script = join(directory, 'scripts', 'fix-electron-install.mjs')
    copyFileSync(fileURLToPath(new URL('../scripts/fix-electron-install.mjs', import.meta.url)), script)
    const { stdout, stderr } = await execFileAsync(process.execPath, [script], { windowsHide: true })
    expect(stdout).toContain('Electron will install it on first launch')
    expect(stderr).toBe('')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
