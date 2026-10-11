import { app } from 'electron'
import { appendFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AudioCache } from '../core/cache.js'
import { getSecret, loadConfig } from '../core/config.js'
import { SpeechService, type SpeechAudio, type SpeechTiming } from '../providers/tts/service.js'

let speech: SpeechService | undefined
let logQueue = Promise.resolve()

function logTiming(timing: SpeechTiming): void {
  const file = join(app.getPath('userData'), 'speech-timing.log')
  const entry = JSON.stringify({ at: new Date().toISOString(), ...timing }) + '\n'
  logQueue = logQueue.then(async () => {
    const bytes = await stat(file).then((value) => value.size, () => 0)
    if (bytes > 200_000) await writeFile(file, entry)
    else await appendFile(file, entry)
  }).catch(() => {})
}

function service(): SpeechService {
  return speech ??= new SpeechService(new AudioCache(join(app.getPath('userData'), 'audio')), logTiming)
}

export function synthesize(text: string, slow: boolean): Promise<SpeechAudio> {
  return service().synthesize(loadConfig(), text, slow, getSecret('tts'))
}

export function prefetchPronunciation(text: string): void {
  try {
    service().prefetch(loadConfig(), text, getSecret('tts'))
  } catch {
    // Cache or configuration failures in speculative work cannot break a lookup.
  }
}

export function cancelPronunciationPrefetch(): void {
  speech?.cancelPrefetch()
}
