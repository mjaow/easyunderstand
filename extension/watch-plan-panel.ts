import { clockTime, type VideoTranscript, type VideoWatchPlan } from '../src/shared/video.js'
import { nextFocusRange, watchEstimate, watchRanges, WATCH_LABELS, type WatchRange } from '../src/shared/watch-plan.js'

interface Hooks {
  generation: () => number
  isBusy: () => boolean
  error: (message: string) => void
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); e.textContent = text; e.className = className; return e
}

/** Own the plan separately from the summary and its English/Chinese controls. */
export class WatchPlanPanel {
  private transcript: VideoTranscript | null = null
  private tabId = 0
  private plan: VideoWatchPlan | null = null
  private ranges: WatchRange[] = []
  private get = <T extends HTMLElement = HTMLElement>(id: string): T => this.root.querySelector<T>(`#${id}`)!

  constructor(private readonly hooks: Hooks, private readonly root: ParentNode = document) {
    const get = this.get
    get('next-focus').addEventListener('click', () => void this.nextFocus())
  }

  get hasPlan(): boolean { return this.plan !== null }

  reset(): void {
    const get = this.get
    this.transcript = null; this.plan = null; this.ranges = []
    get('watch-plan-section').hidden = true
    get('watch-result').hidden = true
    get('watch-ranges').replaceChildren()
    get('watch-status').textContent = ''
  }

  setBusy(busy: boolean): void {
    const get = this.get
    get<HTMLButtonElement>('next-focus').disabled = busy || !this.plan
  }

  show(plan: VideoWatchPlan, transcript: VideoTranscript, tabId: number): void {
    const get = this.get
    this.plan = plan; this.transcript = transcript; this.tabId = tabId
    this.render()
    get('watch-plan-section').hidden = false
  }

  private render(): void {
    const get = this.get
    if (!this.plan || !this.transcript) return
    const plan = this.plan
    this.ranges = watchRanges(plan, this.transcript)
    const estimate = watchEstimate(this.ranges)
    get('watch-overview').textContent = plan.overview
    const minutes = Math.ceil(estimate.routeSeconds / 60)
    get('watch-estimate').textContent = `≈${minutes} min route · ${Math.ceil(estimate.focusSeconds / 60)} min focus · ${Math.ceil(this.transcript.duration / 60)} min full video`
    get('watch-estimate').title = 'Focus and visual checks at 1×, skim at 1.5×, skipped sections excluded. Pauses and practice add time. Playback speed is unchanged.'
    const estimates = element('p', 'Estimate: focus and visual checks at 1×, skim at 1.5×. Pauses and practice add time.', 'meta')
    get('watch-ranges').replaceChildren(estimates, ...this.ranges.map(range => {
      const card = element('article', '', `watch-range watch-${range.recommendation}`)
      const header = element('div', '', 'watch-range-heading')
      const time = element('button', `${clockTime(range.start)}–${clockTime(range.end)}`, 'timestamp')
      time.type = 'button'; time.title = `Jump to ${range.title}`
      time.addEventListener('click', () => void this.seek(range.start))
      header.append(element('span', WATCH_LABELS[range.recommendation], 'watch-badge'), time)
      card.append(header, element('h3', range.title))
      const detail = element('details', '')
      detail.append(element('summary', 'Why this section'))
      detail.append(element('p', range.reason))
      for (const [label, value] of [['Learning target', range.learningTarget], ['Skip only when', range.skipCondition]]) {
        if (!value) continue
        const p = element('p', '')
        p.append(element('strong', `${label}: `), document.createTextNode(value)); detail.append(p)
      }
      if (range.prerequisites.length) {
        const names = range.prerequisites.map(id => plan.sections.find(s => s.firstCaption === id)?.title).filter(Boolean)
        detail.append(element('p', `Before this: ${names.join('; ')}`))
      }
      // Skip conditions must be visible before the viewer decides to jump over content.
      detail.open = range.recommendation === 'skip' || range.recommendation === 'check'
      card.append(detail)
      return card
    }))
    get('watch-result').hidden = false
  }

  private async seek(seconds: number): Promise<void> {
    const transcript = this.transcript, revision = this.hooks.generation()
    if (!transcript) return
    try {
      const result = await chrome.scripting.executeScript({ target: { tabId: this.tabId },
        func: (videoId: string, time: number) => {
          if (new URL(location.href).searchParams.get('v') !== videoId) return false
          const video = document.querySelector('video')
          if (!video) return false
          video.currentTime = time
          return true
        }, args: [transcript.videoId, seconds] })
      if (revision === this.hooks.generation() && !result[0]?.result) throw new Error('Open the original video before jumping to its watch plan.')
    } catch (e) { if (revision === this.hooks.generation()) this.hooks.error(String(e)) }
  }

  private async nextFocus(): Promise<void> {
    const get = this.get
    const transcript = this.transcript, revision = this.hooks.generation()
    if (!transcript || !this.plan || this.hooks.isBusy()) return
    try {
      const result = await chrome.scripting.executeScript({ target: { tabId: this.tabId }, func: (videoId: string) => {
        if (new URL(location.href).searchParams.get('v') !== videoId) return null
        return document.querySelector('video')?.currentTime ?? null
      }, args: [transcript.videoId] })
      if (revision !== this.hooks.generation()) return
      const seconds = result[0]?.result
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new Error('Open the original video before jumping to its watch plan.')
      const next = nextFocusRange(this.ranges, seconds)
      if (next) await this.seek(next.start)
      else get('watch-status').textContent = 'No later focus section. Use the timestamps to revisit any section.'
    } catch (e) { if (revision === this.hooks.generation()) this.hooks.error(String(e)) }
  }
}
