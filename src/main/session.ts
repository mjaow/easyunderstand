/**
 * Orchestrates one lookup: capture → explain → stream into the popup.
 */
import { app, BrowserWindow, clipboard, net } from 'electron'
import { appendFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaptureFailure, ExplainRequest, ExplainState } from '../shared/types.js'
import { captureSelection } from './capture.js'
import { screenToDip } from './coords.js'
import { readLinkAtPoint, readTranscriptAtPoint } from './a11y.js'
import { IS_MACOS, copyChordLabel, cursorPosition, foregroundWindowTitle, inputPermission } from './native/index.js'
import { showPopup, updatePopup, hidePopup, isPopupVisible } from './popup.js'
import { detectMode, SectionParser, systemPrompt } from '../core/explain.js'
import { RefinementParser } from '../core/refine.js'
import { SummaryParser } from '../core/summary.js'
import { streamRefinement } from '../core/refine-generation.js'
import {
  PRONUNCIATION_CACHE_VERSION,
  withDictionaryPronunciations,
  withPronunciationHints
} from '../core/pronunciation.js'
import { loadConfig, getSecret } from '../core/config.js'
import { JsonLruCache, cacheKey } from '../core/cache.js'
import { createLlmProvider, describeError } from '../providers/llm/registry.js'
import { OutputLimitError } from '../providers/llm/types.js'
import { prefetchPronunciation, cancelPronunciationPrefetch } from './speech.js'
export { synthesize } from './speech.js'
import type { Explanation } from '../shared/types.js'

/**
 * Why a copy might have gone nowhere, in the words of the platform it happened on.
 *
 * Both platforms have one cause the user cannot see and would never guess: Windows
 * silently drops synthetic input aimed at an elevated window (UIPI), and macOS
 * silently drops it from a process without Accessibility. Naming them is the whole
 * value of this message.
 */
const CAPTURE_MESSAGES: Record<CaptureFailure, string> = {
  'no-response':
    `Couldn't copy the selection. Try pressing ${copyChordLabel()} yourself: if that doesn't work ` +
    'either, this page blocks copying. Some news sites do. (It can also mean nothing is ' +
    'selected, or that ' +
    (IS_MACOS
      ? 'EasyUnderstand has not been allowed under Privacy & Security → Accessibility.)'
      : 'the app is running as administrator.)'),
  empty: 'No text was copied. Select the sentence and try again.',
  'not-text': 'The copied selection contains no plain text. Select a sentence and try again.',
  unreadable: 'Could not read the copied text. Select the sentence and try again.'
}

/** Prepended when the OS is refusing our keystrokes outright, which explains everything. */
function permissionNote(): string {
  if (!IS_MACOS || inputPermission() !== 'denied') return ''
  return (
    'macOS is blocking EasyUnderstand from reading your selection. Allow it under System ' +
    'Settings → Privacy & Security → Accessibility, then quit and start it again. '
  )
}

let explanationCache: JsonLruCache<Explanation> | null = null

function caches(): { explanations: JsonLruCache<Explanation> } {
  explanationCache ??= new JsonLruCache<Explanation>(join(app.getPath('userData'), 'explanations.json'))
  return { explanations: explanationCache }
}

let inFlight: AbortController | null = null
/** Repeated hotkeys must not borrow and restore the clipboard concurrently. */
let capturingSelection = false
/** Closing the loading popup must also cancel the pending capture's result. */
let captureInFlight: AbortController | null = null
/** What the popup is showing, so "explain this code" can ask again about it. */
let lastRequest: ExplainRequest | null = null
let lastRefinement: ExplainState | null = null
let refineAttempt = 0
type SelectionAction = 'explain' | 'refine' | 'summarize'
let popupAction: SelectionAction = 'explain'

/** Also called when Escape or the close button hides the popup. */
export function cancelInFlight(): void {
  cancelPronunciationPrefetch()
  captureInFlight?.abort()
  inFlight?.abort()
  inFlight = null
}

function emit(state: ExplainState, isNew: boolean): void {
  popupAction = state.mode === 'summary' ? 'summarize' : state.mode === 'refine' ? 'refine' : 'explain'
  if (isNew) showPopup(state)
  else updatePopup(state)
}

/** Hotkey handler: explain selected text, or the hovered link when nothing is selected. */
export async function explainSelection(): Promise<void> {
  await processSelection('explain')
}

/** Uses the same copy capture for editable textboxes and read-only selections. */
export async function refineSelection(): Promise<void> {
  await processSelection('refine')
}

export async function summarizeSelection(): Promise<void> {
  await processSelection('summarize')
}

async function processSelection(action: SelectionAction): Promise<void> {
  if (capturingSelection) return
  cancelInFlight()
  lastRequest = null
  lastRefinement = null

  capturingSelection = true
  const controller = new AbortController()
  captureInFlight = controller
  const pending: ExplainState = {
    mode: action === 'summarize' ? 'summary' : action === 'refine' ? 'refine' : 'passage',
    text: '', explanation: {}, status: 'capturing',
    captureProgress: action === 'explain' ? 'Reading selection or link title…' : 'Reading selected text…'
  }
  let result
  try {
    // Save the hotkey's location before copy retries; the pointer may move while
    // waiting. Do not translate our own popup or a different tab after a switch.
    const point = action === 'explain' ? cursorPosition() : null
    const hover = point && !isOverOwnWindow(screenToDip(point))
      ? { ...point, windowTitle: foregroundWindowTitle() }
      : null
    // Acknowledge the shortcut before waiting for copy retries or accessibility.
    // The popup is non-activating, so the source app still receives the copy.
    emit(pending, true)
    result = await captureSelection()
    if (controller.signal.aborted) return
    if (!result.ok && (result.reason === 'no-response' || result.reason === 'empty') && hover &&
        foregroundWindowTitle() === hover.windowTitle) {
      emit({ ...pending, captureProgress: 'Reading link title…' }, false)
      const title = await readLinkAtPoint(hover.x, hover.y).catch(() => null)
      if (controller.signal.aborted) return
      if (title && foregroundWindowTitle() === hover.windowTitle) {
        result = { ok: true as const, text: title, raw: title, elapsedMs: result.elapsedMs }
      }
    }
  } catch {
    if (controller.signal.aborted) return
    result = { ok: false as const, reason: 'unreadable' as const, elapsedMs: 0 }
  } finally {
    capturingSelection = false
    if (captureInFlight === controller) captureInFlight = null
  }
  if (!result.ok) {
    emit({
      mode: action === 'summarize' ? 'summary' : action === 'refine' ? 'refine' : 'passage',
      text: '',
      explanation: {},
      status: 'error',
      error: permissionNote() + CAPTURE_MESSAGES[result.reason] +
        (action === 'explain' ? ' You can also hover over a link title and press the Explain shortcut.' : '')
    }, false)
    return
  }

  const mode = action === 'summarize' ? 'summary' : action === 'refine' ? 'refine' : detectMode(result.text)
  // Keep the acknowledged popup in place; updates must not reopen it or jump to
  // wherever the pointer moved during capture.
  await run({ mode, text: result.text, raw: result.raw }, false)
}

/**
 * Windows whose double-clicks are worth a look. A browser's title is its active
 * tab's on both platforms, so this is "a YouTube or X tab is in front". X titles its
 * pages "… / X".
 */
const VIDEO_WINDOW_TITLES = ['YouTube', '/ X']

/** One accessibility read at a time — clicks can come faster than PowerShell starts. */
let clickInFlight = false

function isOverOwnWindow(dip: { x: number; y: number }): boolean {
  return BrowserWindow.getAllWindows().some((win) => {
    if (win.isDestroyed() || !win.isVisible()) return false
    const b = win.getBounds()
    return dip.x >= b.x && dip.x < b.x + b.width && dip.y >= b.y && dip.y < b.y + b.height
  })
}

/** Keep recent misses, and start over once the file gets big rather than grow forever. */
async function logMiss(entry: string): Promise<void> {
  const file = join(app.getPath('userData'), 'last-click.log')
  try {
    const size = await stat(file).then((s) => s.size, () => 0)
    if (size > 200_000) await writeFile(file, entry)
    else await appendFile(file, entry)
  } catch {
    // Diagnostics must never get in the way of the click itself.
  }
}

/**
 * The user double-clicked somewhere. If it was a transcript line, explain it.
 *
 * Nothing is read unless a video page is in front, and nothing is shown unless the
 * double-click was on a line of transcript, or on a video while a caption is
 * exposed by the page — a related video, the comments, the feed all stay plain
 * clicks. Missing captions never fall back to reading video pixels or images.
 * Misses on a video page are written to last-click.log in the data folder, so a
 * line that fails to register can be diagnosed rather than guessed at.
 */
export async function explainClickedTranscript(click: { x: number; y: number }): Promise<void> {
  if (clickInFlight) return

  const title = foregroundWindowTitle()
  if (!VIDEO_WINDOW_TITLES.some((t) => title.includes(t))) return
  if (isOverOwnWindow(screenToDip(click))) return

  clickInFlight = true
  try {
    const { text, read } = await readTranscriptAtPoint(click.x, click.y)

    if (!text) {
      const report = read
        ? [`button: ${read.button ?? '-'}`, `line: ${read.line ?? '-'}`, read.chain].join('\n')
        : 'the accessibility read returned nothing'
      void logMiss(
        [`${new Date().toISOString()}  ${title}`, `at ${click.x},${click.y}`, report, '', ''].join('\n')
      )
      return
    }
    cancelInFlight()
    await run({ mode: detectMode(text), text }, true)
  } finally {
    clickInFlight = false
  }
}

/**
 * The popup's "Explain this code" button: the same selection, asked about as code.
 * A second step rather than a guess up front — the ordinary answer came first, the
 * model flagged the selection as code in it, and this is the user taking the offer.
 */
export async function explainLastAsCode(): Promise<void> {
  if (!lastRequest || lastRequest.mode === 'refine' || lastRequest.mode === 'summary') return
  cancelInFlight()
  await run({ mode: 'code', text: lastRequest.text, raw: lastRequest.raw }, false)
}

/** Reuse the original selection; clicking the popup must never capture it again. */
export async function refineAgain(): Promise<void> {
  if (!lastRequest || lastRequest.mode !== 'refine' || capturingSelection || inFlight || !isPopupVisible()) return
  await run({
    mode: 'refine', text: lastRequest.text, raw: lastRequest.raw,
    previousRefinement: lastRefinement?.explanation.refined
  }, false, true)
}

async function run(req: ExplainRequest, isNew: boolean, fresh = false): Promise<void> {
  if (req.mode === 'word') prefetchPronunciation(req.text)
  const config = loadConfig()
  req = withPronunciationHints(req, config.unverifiedPronunciations)
  lastRequest = req
  const previous = fresh ? lastRefinement : null
  if (isNew || req.mode !== 'refine') lastRefinement = null
  const attempt = req.mode === 'refine' ? ++refineAttempt : undefined
  const { explanations } = caches()
  // Whether a word the dictionary lacks may show the model's reading instead of
  // nothing. Off unless the user asked for it — see the setting's own note.
  const unverifiedIpa = config.unverifiedPronunciations
  const plainText = req.mode === 'refine' || req.mode === 'summary'
  const pronunciation = req.mode === 'word' || req.mode === 'passage'
  // Code may go to a stronger model; everything else stays on the everyday one.
  const model =
    (req.mode === 'code' && config.llm.codeModel.trim()) || config.llm.models[config.llm.provider]
  // The prompt is part of the key: a cached answer is only as good as the prompt that
  // produced it, and an improved prompt must not keep serving the old answer.
  const key = cacheKey(
    config.llm.provider, model, req.mode, systemPrompt(req.mode),
    plainText ? req.raw ?? req.text : req.text, req.context,
    pronunciation ? PRONUNCIATION_CACHE_VERSION : undefined,
    ...(pronunciation && unverifiedIpa ? ['unverified-ipa'] : [])
  )

  // An explicit retry always calls the model; its completed result becomes the
  // selection's latest cached version for the next ordinary hotkey lookup.
  const cached = fresh ? undefined : explanations.get(key)
  if (cached) {
    const state: ExplainState = {
      mode: req.mode,
      text: req.text,
      raw: req.raw,
      context: req.context,
      explanation: withDictionaryPronunciations(req, cached, true, unverifiedIpa),
      status: 'done',
      model,
      cached: true,
      refineAttempt: attempt
    }
    if (req.mode === 'refine') lastRefinement = state
    emit(state, isNew)
    return
  }

  const state: ExplainState = {
    mode: req.mode,
    text: req.text,
    raw: req.raw,
    context: req.context,
    explanation: {},
    status: 'streaming',
    model,
    refineAttempt: attempt
  }
  emit(state, isNew)

  const fail = (message: string): void => {
    emit(previous
      ? { ...previous, refineAttempt: attempt, refineRetryError: message }
      : { ...state, status: 'error', error: message }, false)
  }

  let provider
  try {
    // Chromium's connection pool avoids the long network stalls measured with
    // Node fetch on this desktop. The endpoint, key, model and prompt stay intact.
    provider = createLlmProvider(config, getSecret(config.llm.provider), model,
      config.llm.provider === 'azure' ? (input, init) => net.fetch(input instanceof URL ? input.href : input, init) : undefined)
  } catch (err) {
    const e = describeError(config.llm.provider, err)
    fail([e.message, e.hint].filter(Boolean).join(' '))
    return
  }

  const controller = new AbortController()
  inFlight = controller
  let parser = req.mode === 'summary' ? new SummaryParser()
    : req.mode === 'refine' ? new RefinementParser() : new SectionParser()

  try {
    const response = req.mode === 'refine'
      ? streamRefinement(provider, req, controller.signal, () => {
        parser = new RefinementParser()
        state.explanation = {}
        state.refineAttempt = ++refineAttempt
        state.refineProgress = 'Connection is slow. Retrying…'
        updatePopup(state)
      })
      : provider.explain(req, controller.signal)
    for await (const chunk of response) {
      if (controller.signal.aborted) return
      state.refineProgress = undefined
      state.explanation = withDictionaryPronunciations(req, parser.push(chunk), false, unverifiedIpa)
      updatePopup(state)
    }
    if (controller.signal.aborted) return
    const parsed = parser.end()
    if (req.mode === 'summary' && !parsed.summary) {
      throw new Error('The model returned no summary. Select the text and try again.')
    }
    if (req.mode === 'refine' && !parsed.refined) {
      throw new Error('The model returned no refined text. Try again.')
    }
    if (req.previousRefinement && parsed.refined?.replace(/\s+/g, ' ').trim() === req.previousRefinement.replace(/\s+/g, ' ').trim()) {
      throw new Error('The model returned the same wording. Please try again.')
    }
    state.explanation = withDictionaryPronunciations(req, parsed, true, unverifiedIpa)
    state.status = 'done'
    state.refineProgress = undefined
    if (req.mode === 'refine') lastRefinement = state

    // Only cache a result that actually parsed — caching an empty or malformed
    // answer would make a transient failure permanent.
    if (Object.keys(parsed).length > 0) explanations.set(key, state.explanation)
    updatePopup(state)
  } catch (err) {
    if (controller.signal.aborted) return

    if (previous) {
      const e = describeError(config.llm.provider, err)
      fail([e.message, e.hint].filter(Boolean).join(' '))
      return
    }

    // Running out of output tokens is not like the other failures: everything that
    // streamed before it is a real, readable answer. Replacing it with an error
    // threw away a translation that had got most of the way there.
    const partial = parser.end()
    if (err instanceof OutputLimitError && Object.keys(partial).length > 0) {
      state.explanation = withDictionaryPronunciations(req, partial, true, unverifiedIpa)
      state.status = 'done'
      state.warning = [err.message, err.hint].filter(Boolean).join(' ')
      // Deliberately not cached. A truncated answer stored under this key would be
      // served for this selection for ever, with no way for the user to tell.
      updatePopup(state)
      return
    }

    const e = describeError(config.llm.provider, err)
    state.status = 'error'
    state.error = [e.message, e.hint].filter(Boolean).join(' ')
    updatePopup(state)
  } finally {
    if (inFlight === controller) inFlight = null
  }
}

/**
 * A selection's worth of text is longer than any explanation the popup can show, so
 * anything past this is not a selection — it is a bug or a payload, and either way it
 * has no business on the user's clipboard.
 */
const MAX_COPY_CHARS = 20_000

/**
 * Put what the user selected in the popup on the clipboard.
 *
 * This is the one place the app writes the clipboard and leaves it written. The
 * capture path borrows it and always puts the original back; selecting text in the
 * popup or clicking Copy refined text explicitly asks to replace it. Their own ⌘C
 * would reach whatever app has focus.
 */
export async function copySelection(text: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false }
  if (trimmed.length > MAX_COPY_CHARS) return { ok: false, error: 'That is too much to copy.' }

  try {
    // Awaited, not fired and forgotten: Electron's clipboard is asynchronous, so
    // otherwise the popup would report a copy that had not happened yet, and a failure
    // would surface as an unhandled rejection rather than a message.
    await clipboard.writeText(trimmed)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Repeating the same action dismisses it; the other hotkey starts a new capture. */
export function toggleOrExplain(): void {
  toggleSelection('explain')
}

export function toggleOrRefine(): void {
  toggleSelection('refine')
}

export function toggleOrSummarize(): void {
  toggleSelection('summarize')
}

function toggleSelection(action: SelectionAction): void {
  // A retry press while reading is an acknowledgement, not a request to hide or
  // borrow the clipboard twice. Escape and the close button still cancel it.
  if (capturingSelection) return
  if (isPopupVisible() && popupAction === action) {
    cancelInFlight()
    hidePopup()
    return
  }
  void processSelection(action)
}

export function flushCaches(): void {
  explanationCache?.flush()
}
