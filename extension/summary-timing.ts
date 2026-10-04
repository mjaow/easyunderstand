import type { VideoEvent } from '../src/shared/video.js'

const duration = (ms: number, precision = 2): string => `${(Math.max(0, ms) / 1000).toFixed(precision)} s`

/** One click-to-result clock, independent of provider progress or later actions. */
export class SummaryTiming {
  constructor(private readonly root: ParentNode = document) {}
  private get = <T extends HTMLElement = HTMLElement>(id: string): T => this.root.querySelector<T>(`#${id}`)!
  private started = 0
  private openingMs = 0
  private transcriptStarted: number | null = null
  private transcriptMs = 0
  private transcriptDone = false
  private requestStarted: number | null = null
  private requestMs = 0
  private displayStarted: number | null = null
  private ticker: ReturnType<typeof setInterval> | null = null

  start(clickedAt?: number): void {
    const get = this.get
    this.reset()
    this.started = performance.now()
    // Content script and panel have different time origins. Carry the original
    // click across contexts once, then use a monotonic local clock for the run.
    this.openingMs = clickedAt === undefined ? 0 : Math.max(0, performance.timeOrigin + this.started - clickedAt)
    get('timing').hidden = false
    get('timing-label').textContent = 'Elapsed'
    get('timing-model').textContent = 'Connecting to your video model…'
    get('timing-opening').textContent = duration(this.openingMs, 3)
    get('timing-connection').textContent = 'In progress'
    get('timing-transcript').textContent = 'Waiting'
    get('timing-request').textContent = 'Waiting'
    get('timing-transfer').textContent = 'Waiting'
    get('timing-display').textContent = 'Waiting'
    get('timing-app').textContent = 'In progress'
    get<HTMLDetailsElement>('timing-app-details').open = false
    get('timing-note').textContent = 'From your click until the summary is ready to display.'
    this.tick()
    this.ticker = setInterval(() => this.tick(), 100)
  }

  model(name: string): void { this.get('timing-model').textContent = name }

  loadingTranscript(): void {
    const get = this.get
    this.transcriptStarted = performance.now()
    get('timing-connection').textContent = 'Alongside captions'
    this.tick()
  }

  loadedTranscript(): void {
    const get = this.get
    if (this.transcriptStarted !== null) this.transcriptMs = performance.now() - this.transcriptStarted
    this.transcriptStarted = null
    this.transcriptDone = true
    get('timing-transcript').textContent = duration(this.transcriptMs)
    get('timing-connection').textContent = 'In progress'
  }

  requestingModel(): void {
    const get = this.get
    this.requestStarted = performance.now()
    // Captions and the helper connect in parallel. Charge only preparation and
    // connection waiting not already counted as transcript loading.
    get('timing-connection').textContent = duration(this.requestStarted - this.started - this.transcriptMs, 3)
    get('timing-request').textContent = 'In progress'
    get('timing-transfer').textContent = 'In progress'
  }

  receivedResult(): void {
    const get = this.get
    this.displayStarted = performance.now()
    if (this.requestStarted !== null) this.requestMs = this.displayStarted - this.requestStarted
    get('timing-display').textContent = 'In progress'
  }

  finish(event: VideoEvent): void {
    const get = this.get
    if (this.ticker === null) return
    const now = performance.now()
    const total = this.openingMs + now - this.started
    this.clearTicker()
    get('timing-label').textContent = event.cached ? 'Saved summary loaded' : 'Summary ready'
    get('timing-total').textContent = duration(total)
    const modelMs = event.cached ? 0 : event.timing?.modelMs
    // Keep the origin and model cost visible even when the breakdown is closed.
    get('timing-source').textContent = event.cached
      ? 'Cached summary · No model call'
      : 'Fresh model response'
    get('timing-source').hidden = false
    get('timing-request').textContent = event.cached ? 'Not called (cached)' : modelMs === undefined ? 'Unavailable' : duration(modelMs)
    get('timing-app').textContent = modelMs === undefined ? 'Unavailable' : duration(total - this.transcriptMs - modelMs)
    get('timing-transfer').textContent = modelMs === undefined ? 'Unavailable' : duration(this.requestMs - modelMs, 3)
    get('timing-display').textContent = this.displayStarted === null ? 'Unavailable' : duration(now - this.displayStarted, 3)
    get('timing-note').textContent = event.cached
      ? 'Loaded from your saved summary. Summarize again makes a fresh model request.'
      : 'Model time includes waiting for the provider, receiving the answer, and checking it. Summarize again makes a fresh request.'
  }

  stop(outcome: 'Cancelled' | 'Failed'): void {
    const get = this.get
    if (this.ticker === null) return
    this.tick()
    this.clearTicker()
    get('timing-label').textContent = `${outcome} after`
    if (this.transcriptStarted !== null) get('timing-transcript').textContent += ' (unfinished)'
    get('timing-request').textContent = this.requestStarted !== null ? 'Not completed' : 'Not called'
    if (this.requestStarted === null) get('timing-connection').textContent = 'Not completed'
    get('timing-app').textContent = 'Not completed'
    get('timing-transfer').textContent = 'Not completed'
    get('timing-display').textContent = 'Not completed'
    get('timing-note').textContent = 'Stopped before a complete summary. This is not a completed speed measurement.'
  }

  reset(): void {
    const get = this.get
    this.clearTicker()
    this.transcriptStarted = null
    this.transcriptMs = 0
    this.transcriptDone = false
    this.requestStarted = null
    this.requestMs = 0
    this.displayStarted = null
    get('timing-source').hidden = true
    get('timing-source').textContent = ''
    get('timing').hidden = true
  }

  private elapsed(): number { return this.openingMs + performance.now() - this.started }
  private tick(): void {
    const get = this.get
    get('timing-total').textContent = duration(this.elapsed())
    if (this.transcriptDone && this.requestStarted === null) get('timing-connection').textContent = duration(performance.now() - this.started - this.transcriptMs, 3)
    if (this.transcriptStarted !== null) get('timing-transcript').textContent = duration(performance.now() - this.transcriptStarted)
  }
  private clearTicker(): void {
    if (this.ticker !== null) clearInterval(this.ticker)
    this.ticker = null
  }
}
