import type { TtsProviderId } from '../../shared/types.js'

export interface SynthResult {
  data: Buffer
  /** MIME type of `data`, so the renderer can build a correct data URL. */
  mime: string
}

export interface TtsProvider {
  readonly id: TtsProviderId
  readonly label: string
  /**
   * @param rate Relative speed as a percentage offset; 0 is normal, -40 is the
   *             turtle button. Providers clamp to whatever they support.
   */
  synth(text: string, rate: number, signal?: AbortSignal): Promise<SynthResult>
}

export class TtsError extends Error {
  constructor(
    message: string,
    readonly hint?: string
  ) {
    super(message)
    this.name = 'TtsError'
  }
}
