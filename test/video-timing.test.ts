// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { SummaryTiming } from '../extension/summary-timing.js'

let now = 0
let timing: SummaryTiming
const read = (id: string): string => document.getElementById(`timing-${id}`)!.textContent!
beforeEach(() => {
  document.body.innerHTML = readFileSync('extension/sidepanel.html', 'utf8')
  document.body.append((document.getElementById('panel-template') as HTMLTemplateElement).content.cloneNode(true))
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  timing = new SummaryTiming()
})
afterEach(() => { timing.reset(); vi.restoreAllMocks() })
function run(cached = false, modelMs: number | undefined = 200) {
  timing.start(performance.timeOrigin - 600)
  now = 900; timing.loadingTranscript()
  now = 1000; timing.loadedTranscript()
  timing.requestingModel()
  now = 1300; timing.receivedResult()
  now = 1340; timing.finish({ id: 'test', type: 'result', cached, timing: modelMs === undefined ? undefined : { modelMs } })
}
describe('summary stage timings', () => {
  it('separates opening, connection, transcript, model, transfer and display without losing elapsed time', () => {
    run()
    expect(read('opening')).toBe('0.600 s')
    expect(read('connection')).toBe('0.900 s')
    expect(read('transcript')).toBe('0.10 s')
    expect(read('request')).toBe('0.20 s')
    expect(read('transfer')).toBe('0.100 s')
    expect(read('display')).toBe('0.040 s')
    expect(read('app')).toBe('1.64 s')
    expect(read('total')).toBe('1.94 s')
  })
  it('attributes a cached request to helper and transfer with zero model time', () => {
    run(true)
    expect(read('request')).toBe('Not called (cached)')
    expect(read('transfer')).toBe('0.300 s')
    expect(read('app')).toBe('1.84 s')
    expect(read('source')).toBe('Cached summary · No model call')
  })
  it('keeps independently measured stages available when model timing is missing', () => {
    // Explicitly omit timing; the helper may be an older installation.
    timing.start(); now += 10; timing.loadingTranscript(); now += 10; timing.loadedTranscript()
    timing.requestingModel(); now += 10; timing.receivedResult(); now += 10; timing.finish({ id: 'old', type: 'result' })
    expect(read('request')).toBe('Unavailable')
    expect(read('transfer')).toBe('Unavailable')
    expect(read('app')).toBe('Unavailable')
    expect(read('display')).toBe('0.010 s')
    expect(read('opening')).toBe('0.000 s')
  })
  it('counts only the connection wait left after parallel caption loading', () => {
    timing.start(); timing.loadingTranscript()
    now = 200; timing.loadedTranscript()
    now = 800; timing.requestingModel()
    now = 1200; timing.receivedResult()
    now = 1250; timing.finish({ id: 'parallel', type: 'result', timing: { modelMs: 300 } })
    expect(read('connection')).toBe('0.600 s')
    expect(read('transcript')).toBe('0.20 s')
    expect(read('app')).toBe('0.75 s')
    expect(read('total')).toBe('1.25 s')
  })
  it('adds no connection wait when the warmed helper is ready before captions', () => {
    timing.start(); timing.loadingTranscript()
    now = 200; timing.loadedTranscript(); timing.requestingModel()
    now = 600; timing.receivedResult(); timing.finish({ id: 'warm', type: 'result', timing: { modelMs: 400 } })
    expect(read('connection')).toBe('0.000 s')
    expect(read('app')).toBe('0.00 s')
    expect(read('total')).toBe('0.60 s')
  })
  it('freezes cancelled runs without presenting them as completed measurements', () => {
    timing.start(); now = 100; timing.loadingTranscript(); now = 150; timing.stop('Cancelled')
    expect(read('label')).toBe('Cancelled after')
    expect(read('transcript')).toContain('unfinished')
    expect(read('request')).toBe('Not called')
    expect(read('transfer')).toBe('Not completed')
    expect(read('display')).toBe('Not completed')
  })
})
