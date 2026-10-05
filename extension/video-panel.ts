import { clockTime, type VideoAnalysis, type VideoAnswer, type VideoCacheClearResult, type VideoEvent, type VideoIdea, type VideoRequest, type VideoTranscript, type VideoWatchPlan } from '../src/shared/video.js'
import type { PanelTarget, VideoAction } from './panel-target.js'
import { VideoNativeClient } from './native-client.js'
import { SummaryTiming } from './summary-timing.js'
import { analysisText, hasDetail } from '../src/shared/video-export.js'
import { WatchPlanPanel } from './watch-plan-panel.js'
import { clearSavedWatchViews, watchPositionKey, watchViewKey, type SavedWatchPosition, type SavedWatchView } from './watch-view-state.js'

export interface VideoPanel {
  readonly videoId: string | null
  setTarget(next: PanelTarget): void
  show(): void
  hide(): void
  reset(): void
  savePosition(): void
  dispose(): void
}

/** Keep a tab's view and in-flight work alive until that tab navigates or closes. */
export function createVideoPanel(root: HTMLElement, startedKey: string, clearOtherPanels: () => void,
  savedView?: SavedWatchView, savedPosition?: SavedWatchPosition): VideoPanel {
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!
  let target: PanelTarget | null = null
  let transcript: VideoTranscript | null = null
  let english: VideoAnalysis | null = null
  let chinese: VideoAnalysis | null = null
  let displayedAnalysis: VideoAnalysis | null = null
  const nativeClient = new VideoNativeClient()
  let generation = 0
  let busy = false
  let refreshNext = false
  let activeView: VideoAction = 'analyze'
  let lastStartToken = ''
  const timing = new SummaryTiming(root)
  const history: { question: string; answer: string }[] = []
  let watchPanel: WatchPlanPanel
  let scrollTop = 0
  let positionTimer: ReturnType<typeof setTimeout> | undefined

  function position(): SavedWatchPosition {
    return { token: target!.token, scrollTop: root.isConnected
      ? (document.scrollingElement ?? document.documentElement).scrollTop : scrollTop,
      expanded: [...get('watch-ranges').querySelectorAll('details')].map(detail => detail.open),
      transcriptOpen: get<HTMLDetailsElement>('transcript-section').open }
  }
  function savePosition(): void {
    clearTimeout(positionTimer)
    positionTimer = undefined
    if (!target?.videoId || !watchPanel.hasPlan || activeView !== 'watch-plan') return
    void chrome.storage.session.set({ [watchPositionKey(target.tabId)]: position() }).catch(() => {})
  }
  function schedulePositionSave(): void {
    if (root.isConnected && positionTimer === undefined) positionTimer = setTimeout(savePosition, 150)
  }

  function status(message: string): void { get('status').textContent = message }
  function error(message: string): void { get('error').textContent = message; get('error').hidden = false }
  function renderVideoTitle(): void {
    // Captured player metadata belongs to the checked video ID; tab titles can lag.
    const title = transcript?.videoId === target?.videoId && transcript?.title.trim() ? transcript.title : target?.title ?? ''
    get('video-title').textContent = target?.videoId ? title.replace(/ - YouTube$/, '') : 'Open a YouTube video to get started.'
  }
  function setBusy(value: boolean): void {
    busy = value
    for (const id of ['chinese', 'ask', 'clear-cache']) get<HTMLButtonElement>(id).disabled = value
    get<HTMLButtonElement>('understand').disabled = value || !target?.videoId
    get<HTMLButtonElement>('plan-watch').disabled = value || !target?.videoId
    get('plan-watch').textContent = watchPanel?.hasPlan ? 'Plan again' : 'Plan watch'
    get('understand').textContent = refreshNext ? 'Summarize again' : 'Understand video'
    get('understand').title = refreshNext ? 'Make a fresh model request to compare speed.' : 'Summarize the complete transcript.'
    get('cancel').hidden = !value
    get<HTMLButtonElement>('copy-summary').disabled = value || !displayedAnalysis
    watchPanel?.setBusy(value)
    if (!value && !root.isConnected) nativeClient.disconnect()
  }
  function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag); e.textContent = text; e.className = className; return e
  }
  function stop(releaseHelper = true): void {
    generation++
    timing.stop('Cancelled')
    if (busy && activeView === 'watch-plan') get('watch-status').textContent = 'Watch plan cancelled. You can try again.'
    if (releaseHelper) nativeClient.disconnect()
    else nativeClient.cancelPending()
    setBusy(false)
  }
  function sourceButtons(ids: number[], initial = 3): HTMLElement {
    const box = element('div', '', 'sources')
    if (!transcript || !target) return box
    const snapshot = transcript
    const tabId = target.tabId
    const unique = [...new Set(ids)]
    const addSource = (id: number): void => {
      const s = snapshot.segments[id - 1]
      if (!s) return
      const b = element('button', clockTime(s.start), 'timestamp')
      b.title = s.text
      b.addEventListener('click', () => {
        void chrome.scripting.executeScript({ target: { tabId }, func: (videoId: string, seconds: number) => {
          if (new URL(location.href).searchParams.get('v') !== videoId) return false
          const video = document.querySelector('video')
          if (!video) return false
          video.currentTime = seconds
          return true
        }, args: [snapshot.videoId, s.start] }).then(r => { if (!r[0]?.result) error('Open the original video before jumping to its timestamps.') }).catch(e => error(String(e)))
      })
      box.append(b)
    }
    unique.slice(0, initial).forEach(addSource)
    if (unique.length > initial) {
      const more = element('button', `+${unique.length - initial} sources`, 'timestamp')
      more.addEventListener('click', () => { more.remove(); unique.slice(initial).forEach(addSource) }, { once: true })
      box.append(more)
    }
    return box
  }
  function renderIdea(idea: VideoIdea): void {
    const card = element('details', '', 'idea')
    card.append(element('summary', idea.title), element('p', idea.claim, 'claim'))
    for (const [label, value] of [['Explanation', idea.reasoning], ['Example', idea.example], ['Caveat', idea.caveat]]) {
      if (!hasDetail(value)) continue
      const paragraph = element('p', '', 'detail-text')
      paragraph.append(element('strong', `${label}: `), document.createTextNode(value))
      card.append(paragraph)
    }
    const evidence = element('details', '', 'evidence')
    const count = new Set(idea.sources).size
    evidence.append(element('summary', `Sources · ${count} caption ${count === 1 ? 'reference' : 'references'}`), sourceButtons(idea.sources))
    for (const id of idea.sources.slice(0, 3)) {
      const s = transcript?.segments[id - 1]
      if (s) evidence.append(element('p', `“${s.text}”`, 'excerpt'))
    }
    card.append(evidence)
    get('ideas').append(card)
    get('ideas-section').hidden = false
  }
  function renderAnalysis(analysis: VideoAnalysis, language: 'en' | 'zh'): void {
    displayedAnalysis = analysis
    get('copy-status').textContent = ''
    get('overview-card').hidden = false
    get('overview').textContent = analysis.overview
    get('takeaways').replaceChildren(...(analysis.takeaways ?? []).map(takeaway => {
      const item = element('li')
      item.append(element('p', takeaway.text), sourceButtons(takeaway.sources, 2))
      return item
    }))
    get('takeaways-section').hidden = !analysis.takeaways?.length
    get('connections').textContent = analysis.connections
    get('connections-details').hidden = !hasDetail(analysis.connections)
    get('ideas').replaceChildren()
    analysis.ideas.forEach(renderIdea)
    get('ideas-section').hidden = !analysis.ideas.length
    get('idea-count').textContent = `· ${analysis.ideas.length} key themes`
    const evaluations = analysis.evaluation ?? []
    get('evaluation').replaceChildren(...evaluations.map(item => {
      const card = element('article', '', 'assessment')
      card.append(element('h3', item.claim))
      for (const [label, value] of [['Support offered', item.support], ['Assumptions and limits', item.limits], ['Evidence to check', item.test]]) {
        if (!hasDetail(value)) continue
        const paragraph = element('p', '', 'detail-text')
        paragraph.append(element('strong', `${label}: `), document.createTextNode(value))
        card.append(paragraph)
      }
      card.append(sourceButtons(item.sources, 2))
      return card
    }))
    get('evaluation-section').hidden = !evaluations.length
    get('evaluation-count').textContent = `· ${evaluations.length} ${evaluations.length === 1 ? 'point' : 'points'}`
    get('unanswered').replaceChildren(...analysis.unanswered.map(x => element('li', x)))
    get('unanswered-section').hidden = !analysis.unanswered.length
    get('languages').hidden = false
    get('questions-section').hidden = false
    get('english').setAttribute('aria-pressed', String(language === 'en'))
    get('chinese').setAttribute('aria-pressed', String(language === 'zh'))
    get('chinese').textContent = chinese ? '中文' : 'Translate to Chinese'
    get('source-meta').textContent = `${transcript?.language} · ${transcript?.automatic ? 'Automatic captions' : 'YouTube captions'} · ${transcript?.segments.length} segments · ${clockTime(transcript?.duration ?? 0)} video · ${analysis.model}${analysis.translationModel ? ` · Translated by ${analysis.translationModel}` : ''}`
  }
  async function copyAnalysis(): Promise<void> {
    if (!displayedAnalysis || !transcript || busy) return
    const revision = generation
    const analysis = displayedAnalysis
    try {
      await navigator.clipboard.writeText(analysisText(analysis, transcript))
      if (revision === generation && analysis === displayedAnalysis) get('copy-status').textContent = 'Copied summary, breakdowns, critical assessment and timestamp links.'
    } catch {
      if (revision === generation && analysis === displayedAnalysis) get('copy-status').textContent = 'Could not copy. Keep this panel focused and try again.'
    }
  }
  function renderTranscript(): void {
    if (!transcript) return
    renderVideoTitle()
    // Count the captured caption text only, using Unicode word boundaries rather
    // than spaces so unspaced languages also get a meaningful word count.
    const segmenter = new Intl.Segmenter('en', { granularity: 'word' })
    const encoder = new TextEncoder()
    let words = 0, bytes = 0
    for (const caption of transcript.segments) {
      const text = caption.text.trim()
      for (const part of segmenter.segment(text)) if (part.isWordLike) words++
      bytes += encoder.encode(text).length
    }
    // A local size heuristic, not a model-specific tokenizer or billed usage.
    // Include separators between captions, but exclude IDs and prompt metadata.
    const estimatedTokens = Math.ceil((bytes + Math.max(0, transcript.segments.length - 1)) / 4)
    get('transcript-size').textContent = `Captured ${words.toLocaleString('en-US')} words · ≈${estimatedTokens.toLocaleString('en-US')} tokens (estimated)`
    get('transcript-size').title = 'Caption text only, including caption annotations. Excludes title, timestamps, citation IDs, and instructions. Tokens are a rough estimate (UTF-8 bytes ÷ 4); actual counts vary by model and language. This is not billed usage.'
    get('transcript-size').hidden = false
    get('transcript-section').hidden = false
    get('transcript').replaceChildren()
    // Render on demand to keep long videos responsive.
    const fillTranscript = (): void => {
      if (!transcript || !get<HTMLDetailsElement>('transcript-section').open || get('transcript').childElementCount) return
      const fragment = document.createDocumentFragment()
      transcript!.segments.forEach((s, i) => {
        const row = element('div', '', 'caption-row')
        row.append(sourceButtons([i + 1]), element('span', s.text)); fragment.append(row)
      })
      get('transcript').append(fragment)
    }
    get<HTMLDetailsElement>('transcript-section').ontoggle = fillTranscript
    fillTranscript()
  }
  function native(request: VideoRequest, revision: number, report = status): Promise<VideoEvent> {
    return nativeClient.request(request, message => { if (revision === generation) report(message) })
  }
  /** Let the rendered summary reach a paint before freezing the end-to-end clock. */
  function afterDisplay(): Promise<void> {
    if (document.hidden || !root.isConnected) return Promise.resolve()
    return new Promise(resolve => {
      let frame = 0
      const finish = (): void => {
        cancelAnimationFrame(frame)
        document.removeEventListener('visibilitychange', onVisibility)
        resolve()
      }
      const onVisibility = (): void => { if (document.hidden) finish() }
      document.addEventListener('visibilitychange', onVisibility)
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish) })
    })
  }
  function selectView(view: VideoAction): void {
    activeView = view
    const planning = view === 'watch-plan'
    const label = planning ? 'Plan watch' : 'Understand video'
    if (root.isConnected) document.title = `${label} · EasyUnderstand`
    get('panel-heading').textContent = label
    get('panel-tag').textContent = planning ? 'WATCH PLAN' : 'SUMMARY'
    get('understand').hidden = planning
    get('plan-watch').hidden = !planning
    get('summary-view').hidden = view !== 'analyze'
    get('summary-timing-view').hidden = view !== 'analyze'
    get('watch-plan-section').hidden = view !== 'watch-plan'
    get('panel-note').textContent = planning
      ? 'Your viewing guide uses the title, description, and complete captions with your video model.'
      : 'Your summary uses the complete captions with your video model. Optional Chinese translation uses your everyday model.'
  }

  /** Both buttons collect metadata/captions directly, without calling the other workflow. */
  async function loadVideo(capturedTarget: PanelTarget, revision: number,
    onModel: (model: string) => void = () => {}, onCaptured: () => void = () => {}): Promise<VideoTranscript | undefined> {
    let failed = false, selectedModel = ''
    try {
      const connection = native({ id: crypto.randomUUID(), action: 'ping' }, revision).then(event => {
        if (failed || revision !== generation) return
        selectedModel = (event.result as { model: string }).model
        onModel(selectedModel)
      })
      const capture = (async () => {
        const result = await chrome.scripting.executeScript({ target: { tabId: capturedTarget.tabId }, world: 'MAIN', files: ['collector.js'] })
        if (failed || revision !== generation) return
        const captured = result[0]?.result as { transcript?: VideoTranscript; error?: string } | undefined
        if (!captured?.transcript) throw new Error(captured?.error ?? 'YouTube did not return a readable transcript.')
        if (captured.transcript.videoId !== capturedTarget.videoId) throw new Error('The video changed during capture. Try again.')
        transcript = captured.transcript
        renderTranscript(); onCaptured()
        if (!selectedModel) status('Captions ready. Waiting for EasyUnderstand to connect…')
        return captured.transcript
      })()
      const [, capturedTranscript] = await Promise.all([connection, capture])
      if (revision !== generation || !capturedTranscript) return
      get('source-meta').textContent = `${capturedTranscript.language} · ${capturedTranscript.segments.length} caption segments · ${clockTime(capturedTranscript.duration)} video · ${selectedModel}`
      return capturedTranscript
    } catch (e) { failed = true; throw e }
  }

  async function planVideo(): Promise<void> {
    if (!target?.videoId || busy) return
    const revision = ++generation, capturedTarget = target
    selectView('watch-plan'); setBusy(true); get('error').hidden = true
    get('watch-status').textContent = 'Reading the title, description, and complete captions…'
    status('Loading video information for the watch plan…')
    try {
      const capturedTranscript = await loadVideo(capturedTarget, revision)
      if (revision !== generation || !capturedTranscript) return
      status('Planning what to focus on, skim, or skip…')
      const event = await native({ id: crypto.randomUUID(), action: 'watch-plan', transcript: capturedTranscript, fresh: watchPanel.hasPlan }, revision,
        message => { get('watch-status').textContent = message })
      if (revision !== generation) return
      const plan = event.result as VideoWatchPlan
      watchPanel.show(plan, capturedTranscript, capturedTarget.tabId)
      get('watch-status').textContent = `${event.cached ? 'Saved plan' : 'Watch plan ready'} · ${plan.model}`
      status('Watch plan ready. Click a time range to jump to that section.')
      // Save on completion, not just unload: browsers need not finish async work
      // after destroying the panel. Scroll/disclosure updates use a separate key.
      const view: SavedWatchView = { videoId: capturedTranscript.videoId, token: capturedTarget.token, transcript: capturedTranscript, plan }
      void chrome.storage.session.set({ [watchViewKey(capturedTarget.tabId)]: view,
        [watchPositionKey(capturedTarget.tabId)]: position() }).catch(() => {})
    } catch (e) {
      if (revision === generation) {
        nativeClient.disconnect(); error(e instanceof Error ? e.message : String(e))
        get('watch-status').textContent = 'Watch plan did not finish. You can retry.'
        status('Watch planning did not finish. Click Plan watch to retry.')
      }
    } finally { if (revision === generation) setBusy(false) }
  }

  async function analyze(clickedAt?: number): Promise<void> {
    if (!target?.videoId || busy) return
    const revision = ++generation; const capturedTarget = target
    selectView('analyze')
    timing.start(clickedAt)
    get('error').hidden = true; setBusy(true)
    english = null; chinese = null; displayedAnalysis = null
    get('copy-status').textContent = ''
    transcript = null
    get('transcript-section').hidden = true; get('transcript-size').hidden = true
    get('source-meta').replaceChildren(); get('transcript-size').replaceChildren()
    history.length = 0; get('conversation').replaceChildren()
    get('ideas').replaceChildren(); get('overview-card').hidden = true; get('languages').hidden = true
    get('ideas-section').hidden = true; get<HTMLDetailsElement>('ideas-section').open = false
    get<HTMLDetailsElement>('connections-details').open = false
    get('evaluation-section').hidden = true; get<HTMLDetailsElement>('evaluation-section').open = false
    get('evaluation').replaceChildren()
    get('questions-section').hidden = true; get('unanswered-section').hidden = true
    try {
      status('Loading captions and connecting to EasyUnderstand… YouTube may open its transcript panel.')
      timing.loadingTranscript()
      const capturedTranscript = await loadVideo(capturedTarget, revision, model => timing.model(model), () => timing.loadedTranscript())
      if (revision !== generation || !capturedTranscript) return
      timing.requestingModel()
      const event = await native({ id: crypto.randomUUID(), action: 'analyze', transcript: capturedTranscript, fresh: refreshNext }, revision)
      if (revision !== generation) return
      timing.receivedResult()
      english = event.result as VideoAnalysis; renderAnalysis(english, 'en')
      timing.model(english.model)
      await afterDisplay()
      if (revision !== generation) return
      timing.finish(event)
      refreshNext = true
      status(`${event.cached ? 'Saved summary' : 'Summary ready'} · Based on the whole caption transcript. Open the breakdown to explore further.`)
    } catch (e) { if (revision === generation) { nativeClient.disconnect(); timing.stop('Failed'); error(e instanceof Error ? e.message : String(e)); status('Analysis did not finish. You can retry.'); get('ideas').replaceChildren(); get('ideas-section').hidden = true } }
    finally { if (revision === generation) setBusy(false) }
  }
  async function translate(): Promise<void> {
    if (!transcript || !english || busy) return
    if (chinese) { renderAnalysis(chinese, 'zh'); return }
    const revision = generation; setBusy(true); get('error').hidden = true
    try {
      const event = await native({ id: crypto.randomUUID(), action: 'translate', transcript }, revision)
      if (revision !== generation) return
      chinese = event.result as VideoAnalysis; renderAnalysis(chinese, 'zh'); status('Chinese translation ready. English is preserved.')
    } catch (e) { if (revision === generation) error(e instanceof Error ? e.message : String(e)) }
    finally { if (revision === generation) setBusy(false) }
  }
  async function clearCache(): Promise<void> {
    if (busy) return
    const revision = generation; setBusy(true); get('error').hidden = true
    get('cancel').hidden = true // A completed local deletion cannot be cancelled.
    status('Clearing saved video summaries and watch plans…')
    try {
      const event = await native({ id: crypto.randomUUID(), action: 'clear-cache' }, revision)
      if (revision !== generation) return
      const result = event.result as VideoCacheClearResult
      if (!Number.isInteger(result?.cleared) || !Number.isInteger(result?.failed)) throw new Error('The helper did not confirm whether the video cache was cleared.')
      await clearSavedWatchViews()
      if (revision !== generation) return
      clearOtherPanels()
      english = null; chinese = null; displayedAnalysis = null; transcript = null; history.length = 0
      watchPanel.reset()
      selectView(activeView)
      timing.reset(); refreshNext = false
      for (const id of ['overview-card', 'ideas-section', 'evaluation-section', 'unanswered-section', 'transcript-section', 'transcript-size', 'questions-section', 'languages']) get(id).hidden = true
      for (const id of ['overview', 'takeaways', 'copy-status', 'connections', 'ideas', 'evaluation', 'unanswered', 'transcript', 'transcript-size', 'conversation', 'source-meta']) get(id).replaceChildren()
      status(result.failed
        ? `Cleared ${result.cleared} saved entries. Some entries could not be removed.`
        : result.cleared ? `Cache cleared · ${result.cleared} saved ${result.cleared === 1 ? 'entry' : 'entries'} removed. The next ${activeView === 'watch-plan' ? 'plan' : 'summary'} will use your model.`
        : `Video cache is already empty. The next ${activeView === 'watch-plan' ? 'plan' : 'summary'} will use your model.`)
      if (result.failed) error(`${result.failed} saved ${result.failed === 1 ? 'entry could' : 'entries could'} not be removed. Close other EasyUnderstand video panels and retry.`)
    } catch (e) {
      if (revision === generation) { error(e instanceof Error ? e.message : String(e)); status('Could not confirm that the video cache was cleared. You can retry.') }
    } finally { if (revision === generation) setBusy(false) }
  }
  async function ask(event: Event): Promise<void> {
    event.preventDefault()
    const question = get<HTMLTextAreaElement>('question').value.trim()
    if (!question || !transcript || !english || busy) return
    const revision = generation; setBusy(true); get('error').hidden = true
    try {
      const response = await native({ id: crypto.randomUUID(), action: 'question', transcript, question,
        history: history.slice(-4).map(h => `Q: ${h.question}\nA: ${h.answer}`).join('\n').slice(-16000) }, revision)
      if (revision !== generation) return
      const answer = response.result as VideoAnswer
      history.push({ question, answer: answer.answer })
      const box = element('div', answer.answer, 'answer'); box.append(sourceButtons(answer.sources))
      get('conversation').append(element('p', question, 'question'), box)
      get<HTMLTextAreaElement>('question').value = ''; status('Answered from the caption transcript.')
    } catch (e) { if (revision === generation) error(e instanceof Error ? e.message : String(e)) }
    finally { if (revision === generation) setBusy(false) }
  }
  function startTarget(next: PanelTarget): void {
    if (!next.start || !next.videoId || next.token === lastStartToken) return
    if (busy) stop(false)
    lastStartToken = next.token
    // This receipt is only for timing. A new panel has no displayed result, so it
    // must load the requested action even if an earlier panel started that click.
    void chrome.storage.session.set({ [startedKey]: lastStartToken }).catch(() => {})
    if (next.action === 'watch-plan') void planVideo()
    else void analyze(next.clickedAt)
  }
  function setTarget(next: PanelTarget): void {
    if (target?.videoId === next.videoId && target?.tabId === next.tabId) {
      target = next
      renderVideoTitle()
      startTarget(next)
      return
    }
    stop(!next.videoId); target = next; transcript = null; english = null; chinese = null; displayedAnalysis = null; history.length = 0
    watchPanel.reset()
    selectView(next.action ?? activeView)
    timing.reset(); refreshNext = false; setBusy(false)
    for (const id of ['overview-card', 'ideas-section', 'evaluation-section', 'unanswered-section', 'transcript-section', 'transcript-size', 'questions-section', 'languages', 'error']) get(id).hidden = true
    for (const id of ['ideas', 'evaluation', 'takeaways', 'copy-status', 'conversation', 'source-meta']) get(id).replaceChildren()
    renderVideoTitle()
    get<HTMLButtonElement>('understand').disabled = !next.videoId
    get<HTMLDetailsElement>('ideas-section').open = false
    get<HTMLDetailsElement>('evaluation-section').open = false
    status(activeView === 'watch-plan' ? 'Plan what to focus on, skim, or skip in this video.' : 'Understand the ideas and arguments in this video.')
    if (savedView && activeView === 'watch-plan' && savedView.videoId === next.videoId && savedView.token === next.token &&
        savedView.transcript.videoId === next.videoId) {
      transcript = savedView.transcript
      if (savedPosition?.token === next.token) get<HTMLDetailsElement>('transcript-section').open = savedPosition.transcriptOpen
      renderTranscript()
      watchPanel.show(savedView.plan, transcript, next.tabId)
      lastStartToken = next.token
      get('watch-status').textContent = `Watch plan ready · ${savedView.plan.model}`
      status('Watch plan ready. Click a time range to jump to that section.')
      if (savedPosition?.token === next.token) {
        get('watch-ranges').querySelectorAll('details').forEach((detail, index) => { detail.open = savedPosition.expanded[index] ?? detail.open })
        get<HTMLDetailsElement>('transcript-section').open = savedPosition.transcriptOpen
        scrollTop = savedPosition.scrollTop
        if (root.isConnected) (document.scrollingElement ?? document.documentElement).scrollTop = scrollTop
      }
      savedView = undefined
      setBusy(false)
      return
    }
    savedView = undefined
    if (next.videoId && root.isConnected) nativeClient.warmup()
    startTarget(next)
  }
  get('understand').addEventListener('click', () => void analyze())
  get('plan-watch').addEventListener('click', () => void planVideo())
  get('clear-cache').addEventListener('click', () => void clearCache())
  get('cancel').addEventListener('click', () => { stop(); status(activeView === 'watch-plan' ? 'Watch planning cancelled. Click Plan watch to try again.' : english ? 'Stopped. Your summary is still available.' : 'Cancelled. Click Understand video to try again.') })
  get('english').addEventListener('click', () => { if (english) renderAnalysis(english, 'en') })
  get('chinese').addEventListener('click', () => void translate())
  get('copy-summary').addEventListener('click', () => void copyAnalysis())
  get('question-form').addEventListener('submit', e => void ask(e))
  watchPanel = new WatchPlanPanel({ generation: () => generation, isBusy: () => busy, error }, root)
  document.addEventListener('scroll', schedulePositionSave, { passive: true })
  root.addEventListener('toggle', schedulePositionSave, true)

  return {
    get videoId() { return target?.videoId ?? null },
    setTarget,
    show() {
      if (root.isConnected) return
      document.body.append(root)
      selectView(activeView)
      const scrolling = document.scrollingElement ?? document.documentElement
      scrolling.scrollTop = scrollTop
    },
    hide() {
      savePosition()
      scrollTop = (document.scrollingElement ?? document.documentElement).scrollTop
      root.remove()
      if (!busy) nativeClient.disconnect()
    },
    reset() {
      savedView = undefined
      clearTimeout(positionTimer); positionTimer = undefined
      const previous = target
      target = null
      if (previous) setTarget({ ...previous, start: false })
    },
    savePosition,
    dispose() {
      clearTimeout(positionTimer)
      document.removeEventListener('scroll', schedulePositionSave)
      root.removeEventListener('toggle', schedulePositionSave, true)
      stop(); root.remove()
    }
  }
}
