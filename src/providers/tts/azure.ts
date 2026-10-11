import { TtsError, type SynthResult, type TtsProvider } from './types.js'

/**
 * Azure Speech neural voices over plain HTTPS.
 *
 * These are the same neural voices Edge's Read Aloud uses, reached through the
 * official REST API instead of the unofficial WebSocket one — which matters because
 * many corporate networks block that WebSocket upgrade outright. An ordinary HTTPS
 * POST goes wherever normal web traffic goes.
 *
 * The free tier covers 500k characters a month, which is far more than a reader gets
 * through, so in practice this costs nothing.
 */
const TIMEOUT_MS = 15000
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

export class AzureTtsProvider implements TtsProvider {
  readonly id = 'online' as const
  readonly label = 'Natural voice (Azure)'

  constructor(
    private readonly apiKey: string | null,
    private readonly region: string,
    private readonly voice: string
  ) {
    if (!apiKey) {
      throw new TtsError('No Azure Speech key.', 'Add one under Read aloud in Settings.')
    }
    if (!region.trim()) {
      throw new TtsError('No Azure region set.', 'e.g. eastus — see Settings.')
    }
  }

  async synth(text: string, rate: number, signal?: AbortSignal): Promise<SynthResult> {
    signal?.throwIfAborted()
    const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey!,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
          'User-Agent': 'EasyTranslate'
        },
        body: ssml(text, this.voice, rate)
      })

      if (!res.ok) throw new TtsError('Azure voice unavailable.', explain(res.status))

      const data = Buffer.from(await res.arrayBuffer())
      if (data.length === 0) throw new TtsError('Azure returned no audio.')
      return { data, mime: 'audio/mpeg' }
    } catch (err) {
      signal?.throwIfAborted()
      if (err instanceof TtsError) throw err
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TtsError('Azure voice timed out.')
      }
      throw new TtsError('Could not reach Azure Speech.', 'Check your connection and region.')
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Escape text for XML.
 *
 * The selection comes from arbitrary web pages, so an unescaped `&` or `<` would
 * produce malformed SSML — and worse, page text could inject its own SSML tags.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function ssml(text: string, voice: string, rate: number): string {
  const body = escapeXml(text)
  // prosody takes a signed relative percentage, which is exactly how the slow button
  // is expressed, so no conversion is needed.
  const inner =
    rate === 0 ? body : `<prosody rate='${rate > 0 ? '+' : ''}${rate}%'>${body}</prosody>`
  return `<speak version='1.0' xml:lang='en-US'><voice name='${voice}'>${inner}</voice></speak>`
}

function explain(status: number): string {
  if (status === 401 || status === 403) return 'The key was rejected, or it is from a different region.'
  if (status === 429) return 'Rate limited, or the free monthly quota is used up.'
  if (status === 400) return 'That voice name may not exist in this region.'
  return `Azure returned ${status}.`
}
