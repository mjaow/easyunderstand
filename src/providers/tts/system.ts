import { execFile } from 'node:child_process'
import { readFile, writeFile, unlink, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TtsError, type SynthResult, type TtsProvider } from './types.js'

const EXEC_TIMEOUT_MS = 15000

/** Wait for process exit before cleaning its files, including after cancellation. */
function runVoice(file: string, argv: string[], label: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = execFile(file, argv, { timeout: EXEC_TIMEOUT_MS, windowsHide: true }, (err, _out, stderr) => {
      signal?.removeEventListener('abort', cancel)
      if (signal?.aborted) reject(signal.reason)
      else if (err) reject(new TtsError(`The ${label} system voice failed.`, stderr?.trim() || err.message))
      else resolve()
    })
    const cancel = (): void => { child.kill() }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
  })
}

/** SAPI takes an integer from -10 to 10; ours is a percentage offset. */
export function sapiRate(rate: number): number {
  return Math.max(-10, Math.min(10, Math.round(rate / 10)))
}

/**
 * The macOS voice to use when Settings names none.
 *
 * Not the system default: on a Mac set up in another language that is a voice with
 * the wrong accent, and hearing American English is the point of read-aloud here.
 * Samantha ships with every macOS. `say` silently falls back to the default voice
 * if a name it does not know is asked for, so this can never make things worse.
 */
const DEFAULT_MAC_VOICE = 'Samantha'

/**
 * `say` takes words per minute, and its own default is 175.
 *
 * Clamped either side because a rate at the extremes is not slower or faster so much
 * as unintelligible, and the turtle button exists to be understood.
 */
export function sayRate(rate: number): number {
  return Math.max(60, Math.min(400, Math.round(175 * (1 + rate / 100))))
}

/**
 * The voice the operating system already has: SAPI on Windows, `say` on macOS.
 *
 * Less natural than the neural voices, but it always works: no network, no API key,
 * nothing to break. It carries read-aloud whenever the online provider can't.
 *
 * On both platforms the selected text reaches the synthesiser through a file, never
 * a command line — it comes from an arbitrary web page, and nothing the user selects
 * should be able to be read as script or as an argument.
 */
export class SystemTtsProvider implements TtsProvider {
  readonly id = 'system' as const
  readonly label = 'System voice (offline)'

  constructor(private readonly voiceName?: string) {}

  async synth(text: string, rate: number, signal?: AbortSignal): Promise<SynthResult> {
    signal?.throwIfAborted()
    if (process.platform === 'darwin') return this.synthMac(text, rate, signal)
    if (process.platform === 'win32') return this.synthWindows(text, rate, signal)
    throw new TtsError(`There is no offline voice for ${process.platform}.`)
  }

  // ------------------------------------------------------------------ macOS

  /**
   * `say` writes the audio straight to a WAV file, so there is no script at all
   * here — the text goes in a file and the file's path is an argument.
   */
  private async synthMac(text: string, rate: number, signal?: AbortSignal): Promise<SynthResult> {
    const dir = await mkdtemp(join(tmpdir(), 'easytranslate-'))
    const inFile = join(dir, 'in.txt')
    const outFile = join(dir, 'out.wav')

    try {
      await writeFile(inFile, text, 'utf8')

      const argv = [
        '-o',
        outFile,
        // 16-bit little-endian PCM in a RIFF wrapper: what an <audio> element in the
        // popup will play without a codec, and what the Windows path already returns.
        '--data-format=LEI16@22050',
        '-r',
        String(sayRate(rate)),
        '-v',
        this.voiceName || DEFAULT_MAC_VOICE,
        '-f',
        inFile
      ]

      await runVoice('/usr/bin/say', argv, 'macOS', signal)

      const data = await readFile(outFile)
      if (data.length === 0) throw new TtsError('The system voice produced no audio.')
      return { data, mime: 'audio/wav' }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  // ---------------------------------------------------------------- Windows

  private async synthWindows(text: string, rate: number, signal?: AbortSignal): Promise<SynthResult> {
    const dir = await mkdtemp(join(tmpdir(), 'easytranslate-'))
    const inFile = join(dir, 'in.txt')
    const outFile = join(dir, 'out.wav')

    try {
      // The text comes from arbitrary web pages, so it never goes near the command
      // line — PowerShell reads it from a file. Nothing the user selects can be
      // interpreted as script.
      await writeFile(inFile, text, 'utf8')
      await this.runSapi(inFile, outFile, rate, signal)
      const data = await readFile(outFile)
      if (data.length === 0) throw new TtsError('The system voice produced no audio.')
      return { data, mime: 'audio/wav' }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async runSapi(inFile: string, outFile: string, rate: number, signal?: AbortSignal): Promise<void> {
    const scriptFile = inFile.replace(/in\.txt$/, 'speak.ps1')

    // Everything variable arrives as a positional argument, so neither the selected
    // text nor the voice name is ever parsed as script. Note this needs -File, not
    // -Command: only -File populates $args.
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($args[0], [System.Text.Encoding]::UTF8)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($args.Count -gt 3 -and $args[3]) { try { $synth.SelectVoice($args[3]) } catch { } }
  if ($synth.Voice.Culture.Name -ne 'en-US') {
    # Fall back to any adult en-US voice rather than the system default, since the
    # whole point is hearing an American accent.
    try {
      $synth.SelectVoiceByHints(
        [System.Speech.Synthesis.VoiceGender]::NotSet,
        [System.Speech.Synthesis.VoiceAge]::Adult, 0,
        [System.Globalization.CultureInfo]::GetCultureInfo('en-US'))
    } catch { }
  }
  $synth.Rate = [int]$args[2]
  $synth.SetOutputToWaveFile($args[1])
  $synth.Speak($text)
} finally {
  $synth.Dispose()
}
`.trim()

    await writeFile(scriptFile, script, 'utf8')

    const argv = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptFile,
      inFile,
      outFile,
      String(sapiRate(rate))
    ]
    if (this.voiceName) argv.push(this.voiceName)

    try {
      await runVoice('powershell.exe', argv, 'Windows', signal)
    } finally {
      await unlink(scriptFile).catch(() => {})
    }
  }
}
