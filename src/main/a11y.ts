/**
 * Reading what sits under a screen point from the application's own accessibility
 * tree, to recognise a click on a transcript line.
 *
 * Text comes only from captions or transcript lines exposed by the app itself.
 * Video frames and images are never read as text.
 *
 * Two trees, one answer. Windows goes through UI Automation in a PowerShell script
 * (resources/transcript-at-point.ps1); macOS goes through the Accessibility API in
 * process (a11y-macos.ts). Both produce a `PointRead`, and the rules that decide
 * whether it is a transcript line live in core/transcript.ts for both.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalize } from './capture.js'
import { readPointMac } from './a11y-macos.js'
import { parsePointRead, transcriptLineAt, type PointRead } from '../core/transcript.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Generous enough for a cold accessibility tree — Chromium builds one lazily the
 * first time a client asks — but short enough that a miss still feels prompt.
 */
const TIMEOUT_MS = 6000

function scriptPath(): string {
  for (const candidate of [
    join(here, '../../resources/transcript-at-point.ps1'),
    join(process.resourcesPath ?? '', 'resources/transcript-at-point.ps1')
  ]) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return join(here, '../../resources/transcript-at-point.ps1')
}

/** Everything the accessibility tree reports at a point. Null where it cannot be read. */
export async function readPoint(x: number, y: number): Promise<PointRead | null> {
  if (process.platform === 'darwin') return readPointMac(x, y)
  if (process.platform !== 'win32') return null

  const script = scriptPath()
  if (!existsSync(script)) return null

  return new Promise<PointRead | null>((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        String(Math.round(x)),
        String(Math.round(y))
      ],
      { timeout: TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(err ? null : parsePointRead(stdout ?? ''))
    )
  })
}

export interface TranscriptRead {
  /** The transcript line, or null when the point is not on one. */
  text: string | null
  /** What the tree reported, so a miss can be understood after the fact. */
  read: PointRead | null
}

/** The transcript line at a screen point, if there is one. */
export async function readTranscriptAtPoint(x: number, y: number): Promise<TranscriptRead> {
  const read = await readPoint(x, y)
  if (!read) return { text: null, read }
  const line = transcriptLineAt(read)
  return { text: line ? normalize(line) : null, read }
}
