import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const probe = fileURLToPath(new URL('./fixtures/caption-dpi.ps1', import.meta.url))
const reader = fileURLToPath(new URL('../resources/transcript-at-point.ps1', import.meta.url))

// Real OS contract, no mocked DPI APIs and no second monitor required. This is
// the fast companion to verify:click's actual mixed-monitor caption hit tests.
describe.skipIf(process.platform !== 'win32')('Windows caption reader DPI', () => {
  it.each([
    { host: 'DPI-unaware', context: -1, awareness: 0 },
    { host: 'system-DPI-aware', context: -2, awareness: 1 }
  ])('uses physical coordinates even in a $host PowerShell host', async ({ context, awareness }) => {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', probe, '-ReaderPath', reader, '-InitialContext', String(context)
    ], { windowsHide: true, timeout: 10_000, encoding: 'utf8' })

    const result = stdout.split(/\r?\n/).find(line => line.startsWith('DPI_RESULT:'))
    expect(result, 'the reader must return from an off-screen miss').toBeDefined()
    expect(JSON.parse(result!.slice('DPI_RESULT:'.length))).toEqual({
      before: awareness,
      after: 2 // DPI_AWARENESS_PER_MONITOR_AWARE; never virtualise screen pixels.
    })
  }, 15_000)
})
