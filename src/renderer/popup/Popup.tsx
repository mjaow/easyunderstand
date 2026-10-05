import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExplainState } from '@shared/types'
import { parseNotable, parseConcept } from '@core/notable'
import { playAudio, stopAudio } from './player'

/**
 * The English half of an example.
 *
 * The model returns the sentence then its Chinese translation on the next line.
 * Only the first line should be spoken — an American English voice handed Chinese
 * text produces nonsense.
 */
function exampleEnglish(example: string): string {
  return example.split('\n')[0]?.trim() ?? ''
}

/** Feels like "still working" rather than "broken" while the first tokens land. */
function Skeleton(): React.ReactElement {
  return (
    <div className="et-pulse space-y-2 py-1">
      <div className="h-3 w-3/4 rounded" style={{ background: 'var(--border)' }} />
      <div className="h-3 w-1/2 rounded" style={{ background: 'var(--border)' }} />
    </div>
  )
}

function SpeakButton({
  text,
  slow = false,
  compact = false,
  onStatus
}: {
  text: string
  slow?: boolean
  compact?: boolean
  onStatus: (msg: string | null) => void
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)

  const click = useCallback(async () => {
    // While this clip is playing the button becomes a stop button — a long passage
    // is exactly when you want to cut it short.
    if (playing) {
      stopAudio()
      return
    }
    if (busy || !text.trim()) return

    setBusy(true)
    onStatus(null)
    try {
      const res = await window.easytranslate.speak(text, slow)
      if (res.error || !res.url) {
        onStatus(res.error ?? 'Could not read that aloud.')
        return
      }
      if (res.fallbackReason) onStatus('Using the offline system voice — the online voice is unavailable.')
      setPlaying(true)
      await playAudio(res.url, () => setPlaying(false))
    } catch (err) {
      setPlaying(false)
      onStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, playing, text, slow, onStatus])

  const label = playing ? 'Stop' : slow ? 'Read slowly' : 'Read aloud'

  return (
    <button
      onClick={() => void click()}
      // Never disabled while playing, or there would be no way to stop it.
      disabled={busy && !playing}
      title={label}
      aria-label={label}
      className={`rounded-md leading-none transition-colors disabled:opacity-40 ${
        compact ? 'px-1 py-0.5 text-[11px]' : 'px-1.5 py-1 text-[13px]'
      }`}
      style={{ color: playing ? 'var(--accent)' : 'var(--text-muted)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-muted)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {playing ? '⏹' : slow ? '🐢' : '🔊'}
    </button>
  )
}

/** What the reader is told about where a pronunciation came from. */
const ATTESTED_TITLE = 'American English · CMU pronunciation dictionary'
const SYSTEM_TITLE = 'macOS dictionary · converted from NOAD respelling'
const UNVERIFIED_TITLE =
  'American English · model-generated pronunciation (unverified)'

/** Show the source on hover and visibly mark optional model-generated IPA. */
function Ipa({
  ipa,
  verified,
  system = false,
  className = ''
}: {
  ipa: string
  verified: boolean
  system?: boolean
  className?: string
}): React.ReactElement {
  return (
    <span
      className={`font-mono ${className}`}
      title={!verified ? UNVERIFIED_TITLE : system ? SYSTEM_TITLE : ATTESTED_TITLE}
      style={verified ? undefined : { opacity: 0.65, fontStyle: 'italic' }}
    >
      {ipa}
      {!verified && <span aria-label="unverified">°</span>}
    </span>
  )
}

function Section({
  label,
  action,
  children
}: {
  label?: string
  action?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-0.5">
      {(label || action) && (
        <div className="flex items-center gap-1">
          <div
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-subtle)' }}
          >
            {label}
          </div>
          {action}
        </div>
      )}
      <div className="text-[13px] leading-snug">{children}</div>
    </div>
  )
}

interface CopyNotice {
  kind: 'pending' | 'success' | 'error'
  text: string
  detail?: string
}

/**
 * Selecting text in the popup copies it.
 *
 * Not a shortcut taken for convenience — it is the only way out. The popup never takes
 * focus, so ⌘C and Ctrl+C go to whatever app does have focus, and binding the copy
 * chord so it reaches the popup instead is exactly what the copy-safety contract
 * forbids. A drag still selects perfectly well in a window that is not key, so the
 * selection itself is the gesture.
 *
 * On mouse-up rather than on every selection change: mid-drag the selection is not yet
 * what the user meant, and rewriting the clipboard on each character would be both
 * wasteful and wrong.
 *
 * Also supplies the explicit copy action for refinement, with the same feedback.
 */
function useCopyOnSelect(lookupText: string | undefined): {
  notice: CopyNotice | null
  copy: (text: string) => Promise<void>
} {
  const [notice, setNotice] = useState<CopyNotice | null>(null)
  const request = useRef(0)

  const copy = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) return
    const current = ++request.current
    setNotice({ kind: 'pending', text: 'Copying…' })
    try {
      const res = await window.easytranslate.copySelection(text)
      if (current !== request.current) return
      setNotice(
        res.ok
          ? { kind: 'success', text: 'Copied to clipboard', detail: copiedPreview(text) }
          : { kind: 'error', text: 'Copy failed', detail: res.error || 'Could not copy the selection. Please try again.' }
      )
    } catch (err) {
      if (current !== request.current) return
      setNotice({
        kind: 'error', text: 'Copy failed',
        detail: (err instanceof Error ? err.message : String(err)) || 'Could not copy the selection. Please try again.'
      })
    }
  }, [])

  useEffect(() => {
    let selecting = false
    const reset = (): void => {
      selecting = false
      request.current++
      setNotice(null)
    }
    reset()

    const start = (event: MouseEvent): void => {
      const target = event.target
      selecting =
        event.button === 0 && target instanceof Element &&
        target.closest('.et-selectable') !== null && target.closest('button') === null
    }

    const handle = async (event: MouseEvent): Promise<void> => {
      const shouldCopy = selecting && event.button === 0
      selecting = false
      if (!shouldCopy) return

      const selected = window.getSelection()?.toString().trim() ?? ''
      // A plain click clears the selection; that is not a request to copy anything.
      if (!selected) return

      // Copy once per gesture, even when the words match an earlier copy: another
      // app may have replaced the clipboard since then.
      await copy(selected)
    }

    // On the document rather than the content: a drag often ends outside the element
    // it started in, and the selection is still exactly what was wanted.
    const listener = (event: MouseEvent): void => void handle(event)
    const unsubscribe = window.easytranslate.onStopAudio(reset)
    document.addEventListener('mousedown', start)
    document.addEventListener('mouseup', listener)
    return () => {
      request.current++
      unsubscribe()
      document.removeEventListener('mousedown', start)
      document.removeEventListener('mouseup', listener)
    }
  }, [lookupText, copy])

  // Keep the result until the next copy, lookup, or close, so it cannot be missed.
  return { notice, copy }
}

/** Short enough to read at a glance, quoted so it is clear what landed. */
function copiedPreview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ')
  const shown = oneLine.length > 32 ? `${oneLine.slice(0, 32)}…` : oneLine
  return `“${shown}”`
}

export function Popup(): React.ReactElement | null {
  const [state, setState] = useState<ExplainState | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return window.easytranslate.onUpdate(({ state: next }) => {
      // A new lookup replaces the old one, so its audio should not linger.
      stopAudio()
      setState(next)
      setStatus(null)
    })
  }, [])

  // The window only hides, it is never destroyed, so playback has to be stopped
  // explicitly when it goes away.
  useEffect(() => window.easytranslate.onStopAudio(() => stopAudio()), [])

  const { notice: copyNotice, copy } = useCopyOnSelect(state ? `${state.mode}\0${state.raw ?? state.text}\0${state.refineAttempt ?? ''}` : undefined)

  // Size the window to whatever the content actually needs.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    // scrollHeight, not the bounding box: the card is clamped to the window, so its
    // own height stops growing at the limit and would report the window back to
    // itself. scrollHeight keeps reporting what the content actually needs.
    const report = (): void => window.easytranslate.resize(el.scrollHeight + 2)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [state])

  if (!state) return null

  const { explanation: ex, mode } = state
  const isWord = mode === 'word'
  const isCode = mode === 'code'
  const isRefine = mode === 'refine'
  // The model's verdict on the ordinary answer: offer the code explanation as a step.
  const offerCode = !isCode && !isRefine && ex.isCode === true
  // A snippet's headline is its first line: twelve lines of code must not become a
  // twelve-line header.
  const shaped = state.raw ?? state.text
  const firstLine = shaped.split('\n')[0] ?? ''
  const headline = isCode
    ? `${firstLine.slice(0, 70)}${firstLine.length > 70 || shaped.includes('\n') ? '…' : ''}`
    : isWord || state.text.length <= 90
      ? state.text
      : `${state.text.slice(0, 90)}…`
  const empty = Object.keys(ex).length === 0
  // Matched on the display term, so the renderer never needs the 126k-entry wordlist.
  const unverifiedIpa = new Set(ex.unverifiedIpa ?? [])
  const systemDictionaryIpa = new Set(ex.systemDictionaryIpa ?? [])

  return (
    // The card itself scrolls, not this wrapper, which only supplies the margin the
    // shadow needs. It has to be this way round: `position: sticky` sticks within its
    // nearest scrolling ancestor, and an `overflow: hidden` card in between — which is
    // what used to clip the corners — stopped the header sticking to anything at all.
    // `overflow-y: auto` clips to the rounded corners just as well.
    <div className="p-1.5" style={{ maxHeight: '100vh' }}>
      <div
        ref={contentRef}
        className="rounded-xl border"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--shadow)',
          // 12px is this wrapper's own padding, top and bottom.
          maxHeight: 'calc(100vh - 12px)',
          overflowY: 'auto'
        }}
      >
        {/* ---------------------------------------------------------- header */}
        {/* Sticky, because a long answer scrolls and this row carries both the words
            being explained and the only way to close the popup. Scrolling them off the
            top left the reader unable to see what was asked or to dismiss the answer —
            Escape still works, but a close button you cannot reach is a broken one. */}
        <div
          className="sticky top-0 z-10 flex items-start gap-1.5 border-b px-3 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}
        >
          <div className="et-selectable min-w-0 flex-1">
            {isRefine && (
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                Refine · same language
              </div>
            )}
            <div className={`font-semibold leading-snug ${isCode ? 'font-mono text-[12px]' : 'text-[14px]'}`}>
              {headline || 'EasyUnderstand'}
            </div>
            {/* One quiet line: the language for code, IPA and part of speech for a word,
                and always which model answered — so the source of an answer is never
                a mystery, and a stale cache entry says so. */}
            {(ex.lang || (isWord && (ex.ipa || ex.pos)) || state.model) && (
              <div
                className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px]"
                style={{ color: 'var(--text-muted)' }}
              >
                {isCode && ex.lang && <span className="italic">{ex.lang}</span>}
                {isWord && ex.ipa && (
                  <Ipa ipa={ex.ipa} verified={!unverifiedIpa.has(state.text)} system={systemDictionaryIpa.has(state.text)} />
                )}
                {isWord && ex.pos && <span className="italic">{ex.pos}</span>}
                {state.model && (
                  <span
                    className="ml-auto text-[10px]"
                    style={{ color: 'var(--text-subtle)' }}
                    title={state.cached ? 'Served from the cache of an earlier answer' : 'The model that answered'}
                  >
                    {state.model}
                    {state.cached ? ' · cached' : ''}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center">
            {/* Code is not read aloud; the English explanation below has its own button. */}
            {!isCode && !isRefine && <SpeakButton text={state.text} onStatus={setStatus} />}
            {!isCode && !isRefine && <SpeakButton text={state.text} slow onStatus={setStatus} />}
            <button
              onClick={() => window.easytranslate.close()}
              title="Close (Esc)"
              className="rounded-md px-1.5 py-1 text-[13px] leading-none"
              style={{ color: 'var(--text-subtle)' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------ body */}
        {/* Selectable, and selecting is what copies — see useCopyOnSelect above. */}
        <div className="et-selectable space-y-2.5 px-3 py-2.5">
          {state.status === 'error' ? (
            <div className="text-[13px] leading-snug" style={{ color: 'var(--danger)' }}>
              {state.error}
            </div>
          ) : (
            <>
              {empty && state.status === 'streaming' && <Skeleton />}

              {isRefine && (
                <Section label="refined text">
                  {ex.refined && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{ex.refined}</div>}
                </Section>
              )}

              {offerCode && (
                <button
                  onClick={() => window.easytranslate.explainAsCode()}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium"
                  style={{ background: 'var(--accent)', color: 'var(--surface)' }}
                >
                  This looks like code — explain what it does
                </button>
              )}

              {/* pre-line, because a multi-paragraph selection gets a multi-paragraph
                  answer and HTML would otherwise run them all together. */}
              {ex.zh && (
                <div
                  className="text-[15px] font-medium leading-snug"
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {ex.zh}
                </div>
              )}
              {ex.en && (
                <Section
                  label="in plain english"
                  action={<SpeakButton text={ex.en} compact onStatus={setStatus} />}
                >
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'pre-line' }}>{ex.en}</span>
                </Section>
              )}
              {ex.here && (
                <Section label={state.context?.trim() && state.context.trim() !== state.text.trim() ? 'in context' : 'usage'}>
                  <span style={{ color: 'var(--text)' }}>{ex.here}</span>
                </Section>
              )}
              {ex.example && (
                <Section
                  label="example"
                  action={
                    <>
                      <SpeakButton text={exampleEnglish(ex.example)} compact onStatus={setStatus} />
                      <SpeakButton
                        text={exampleEnglish(ex.example)}
                        slow
                        compact
                        onStatus={setStatus}
                      />
                    </>
                  }
                >
                  {ex.example.split('\n').map((line, i) => (
                    <div key={i} style={{ color: i === 0 ? 'var(--text)' : 'var(--text-muted)' }}>
                      {line}
                    </div>
                  ))}
                </Section>
              )}
              {ex.why && (
                <Section label="why it matters">
                  <span style={{ color: 'var(--text)', whiteSpace: 'pre-line' }}>{ex.why}</span>
                </Section>
              )}
              {ex.steps && ex.steps.length > 0 && (
                <Section label="step by step">
                  <ol className="space-y-0.5 pl-4" style={{ listStyle: 'decimal' }}>
                    {ex.steps.map((step, i) => (
                      <li key={i} style={{ color: 'var(--text)' }}>
                        {step}
                      </li>
                    ))}
                  </ol>
                </Section>
              )}
              {ex.design && ex.design.length > 0 && (
                <Section label="why it is written this way">
                  <ul className="space-y-1 pl-4" style={{ listStyle: 'disc' }}>
                    {ex.design.map((line, i) => (
                      <li key={i} style={{ color: 'var(--text)' }}>
                        {line}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {ex.issues && ex.issues.length > 0 && (
                <Section label="watch out">
                  <ul className="space-y-1 pl-4" style={{ listStyle: 'disc' }}>
                    {ex.issues.map((line, i) => (
                      <li key={i} style={{ color: 'var(--danger)' }}>
                        {line}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {ex.concepts && ex.concepts.length > 0 && (
                <Section label="concepts worth knowing">
                  <ul className="space-y-1">
                    {ex.concepts.map((item, i) => {
                      const c = parseConcept(item)
                      if (!c) return null
                      return (
                        <li key={i} className="flex items-baseline gap-1.5">
                          <span className="font-mono text-[12px] font-medium" style={{ color: 'var(--text)' }}>
                            {c.term}
                          </span>
                          <SpeakButton text={c.term} compact onStatus={setStatus} />
                          {c.detail && <span style={{ color: 'var(--text-muted)' }}>{c.detail}</span>}
                        </li>
                      )
                    })}
                  </ul>
                </Section>
              )}
              {ex.notable && ex.notable.length > 0 && (
                <Section label="words worth knowing">
                  <ul className="space-y-1">
                    {ex.notable.map((item, i) => {
                      const t = parseNotable(item)
                      if (!t) return null
                      return (
                        <li key={i}>
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-medium" style={{ color: 'var(--text)' }}>
                              {t.term}
                            </span>
                            {t.ipa && (
                              <Ipa
                                ipa={t.ipa}
                                verified={!unverifiedIpa.has(t.term)}
                                system={systemDictionaryIpa.has(t.term)}
                                className="text-[11px]"
                              />
                            )}
                            <SpeakButton text={t.term} compact onStatus={setStatus} />
                            {t.gloss && (
                              <span style={{ color: 'var(--text-muted)' }}>{t.gloss}</span>
                            )}
                          </div>
                          {t.example && (
                            <div className="flex items-baseline gap-1 pl-2 text-[12px]">
                              <span className="italic" style={{ color: 'var(--text-subtle)' }}>
                                {t.example}
                              </span>
                              <SpeakButton text={t.example} compact onStatus={setStatus} />
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </Section>
              )}
            </>
          )}

          {isRefine && state.text.trim() && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void copy(ex.refined ?? '')}
                disabled={state.status !== 'done' || !ex.refined || !!state.warning || copyNotice?.kind === 'pending'}
                className="rounded-md px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--surface)' }}
              >
                {copyNotice?.kind === 'pending' ? 'Copying…' : 'Copy refined text'}
              </button>
              <button
                onClick={() => window.easytranslate.refineAgain()}
                disabled={state.status === 'streaming' || copyNotice?.kind === 'pending'}
                className="rounded-md border px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40"
                style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
                title="Try different wording with the same meaning and language"
              >
                {state.status === 'streaming' ? 'Refining…' : 'Try another version'}
              </button>
            </div>
          )}

          {state.refineRetryError && (
            <div role="alert" className="text-[12px]" style={{ color: 'var(--danger)' }}>
              Couldn’t create another version. {state.refineRetryError} Your previous version is still shown.
            </div>
          )}

          {isRefine && state.status === 'streaming' && state.refineProgress && (
            <div role="status" className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {state.refineProgress}
            </div>
          )}

          {/* An answer that was cut short is still an answer. The caveat goes beside
              it, never in place of it. */}
          {state.warning && state.status !== 'error' && (
            <div
              className="rounded-md px-2 py-1 text-[11px] leading-snug"
              style={{ background: 'var(--surface-muted)', color: 'var(--text-muted)' }}
            >
              {state.warning}
            </div>
          )}

          {status && (
            <div className="text-[11px]" style={{ color: 'var(--text-subtle)' }}>
              {status}
            </div>
          )}
        </div>

        {copyNotice && (
          <div
            role={copyNotice.kind === 'error' ? 'alert' : 'status'}
            aria-atomic="true"
            className="sticky bottom-0 z-10 border-t px-3 py-2 text-[12px]"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: copyNotice.kind === 'error' ? 'var(--danger)' : 'var(--accent)'
            }}
          >
            <div className="flex items-center gap-1.5 font-medium">
              <span aria-hidden="true">{copyNotice.kind === 'success' ? '✓' : copyNotice.kind === 'error' ? '!' : '…'}</span>
              <span>{copyNotice.text}</span>
            </div>
            {copyNotice.detail && (
              <div className="mt-0.5 break-words text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {copyNotice.detail}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
