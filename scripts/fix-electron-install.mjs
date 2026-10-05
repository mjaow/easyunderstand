/**
 * Repairs a half-installed Electron binary.
 *
 * Electron's installer downloads a zip and unpacks it with `extract-zip`.
 * On some Windows machines — typically where security software inspects large archive
 * writes — that extraction stops after the first entry, leaving a `dist/` containing
 * only LICENSES.chromium.html and no electron.exe. The download itself is fine and
 * checksum-valid, so re-running npm install doesn't help: it sees the cached zip and
 * repeats the same broken extraction.
 *
 * This unpacks the already-downloaded zip with the platform's own unzip instead, which
 * has no such problem. It's a no-op when Electron is healthy, so it is safe as a
 * postinstall step.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const distDir = join(electronDir, 'dist')
const exePath = join(distDir, 'electron.exe')

function ok(msg) {
  console.log(`[electron] ${msg}`)
}

if (!existsSync(electronDir)) {
  ok('not installed; nothing to repair.')
  process.exit(0)
}

if (process.platform !== 'win32') {
  ok('repair only applies to Windows.')
  process.exit(0)
}

// Electron 44 downloads its binary on first use, not during npm install. A fresh
// package with no dist directory is valid; only a partial extraction needs repair.
if (!existsSync(distDir)) {
  ok('binary not downloaded yet; Electron will install it on first launch.')
  process.exit(0)
}

if (existsSync(exePath) && statSync(exePath).size > 1_000_000) {
  ok('binary looks healthy.')
  process.exit(0)
}

// Find the cached zip that Electron already downloaded and verified.
const cacheRoot = join(homedir(), 'AppData', 'Local', 'electron', 'Cache')
if (!existsSync(cacheRoot)) {
  console.error('[electron] dist is incomplete and no download cache was found.')
  console.error('[electron] Try: npm rebuild electron')
  process.exit(1)
}

// Match the version actually installed. Picking "any cached zip" would happily
// restore a stale binary after an upgrade — which looks like the upgrade silently
// failing, because `electron --version` still reports the old one.
const wanted = JSON.parse(
  readFileSync(join(electronDir, 'package.json'), 'utf8')
).version
const wantedZip = new RegExp(`^electron-v${wanted.replace(/\./g, '\\.')}-win32-`)

let zipPath = null
for (const entry of readdirSync(cacheRoot)) {
  const dir = join(cacheRoot, entry)
  if (!statSync(dir).isDirectory()) continue
  const zip = readdirSync(dir).find((f) => wantedZip.test(f) && f.endsWith('.zip'))
  if (zip) zipPath = join(dir, zip)
}

if (!zipPath) {
  console.error(`[electron] dist is incomplete and no cached zip for v${wanted} was found.`)
  console.error('[electron] Download it first:  npx electron --version  (then re-run this)')
  console.error('[electron] Or force a reinstall:  npm rebuild electron')
  process.exit(1)
}

ok(`dist is incomplete — re-extracting from ${zipPath}`)

// PowerShell's ZipFile handles this archive where extract-zip stalls.
const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path '${distDir}') { Remove-Item -Recurse -Force '${distDir}' }
[System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath}', '${distDir}')
`.trim()

try {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: 'inherit'
  })
} catch (err) {
  console.error('[electron] extraction failed:', err.message)
  process.exit(1)
}

if (!existsSync(exePath)) {
  console.error('[electron] extraction completed but electron.exe is still missing.')
  process.exit(1)
}

// electron/index.js reads this to locate the binary.
writeFileSync(join(electronDir, 'path.txt'), 'electron.exe')
ok(`repaired — ${(statSync(exePath).size / 1e6).toFixed(0)}MB electron.exe restored.`)
