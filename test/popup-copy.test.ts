/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Popup } from '../src/renderer/popup/Popup'
import type { ExplainState, PopupPayload } from '../src/shared/types'

const copySelection = vi.fn<(text: string) => Promise<{ ok: boolean; error?: string }>>()
const refineAgain = vi.fn()
let clipboardText: string
let update: (payload: PopupPayload) => void
const stopListeners = new Set<() => void>()
let container: HTMLDivElement
let root: Root

const state: ExplainState = {
  mode: 'passage', text: 'A source passage', status: 'done',
  explanation: { zh: 'Alpha beta gamma', en: 'Simple English explanation' }
}

function mouse(target: EventTarget, type: string, button = 0): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button }))
}

function textElement(): HTMLDivElement {
  return [...container.querySelectorAll('div')].find((el) => el.textContent === state.explanation.zh)!
}

function setSelection(): void {
  const range = document.createRange()
  range.setStart(textElement().firstChild!, 0)
  range.setEnd(textElement().firstChild!, 5)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
}

async function select(): Promise<void> {
  await act(async () => {
    mouse(textElement(), 'mousedown')
    setSelection()
    // A drag can finish outside the element where it began.
    mouse(document, 'mouseup')
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
  clipboardText = 'original clipboard'
  copySelection.mockReset().mockImplementation(async (text) => {
    clipboardText = text
    return { ok: true }
  })
  stopListeners.clear()
  refineAgain.mockReset()
  Object.defineProperty(window, 'easytranslate', {
    configurable: true,
    value: {
      onUpdate: (listener: typeof update) => { update = listener; return () => {} },
      onStopAudio: (listener: () => void) => {
        stopListeners.add(listener)
        return () => stopListeners.delete(listener)
      },
      copySelection,
      refineAgain,
      resize: vi.fn(),
      speak: vi.fn(async () => ({ error: 'Voice unavailable' }))
    }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(Popup)))
  await act(async () => update({ state }))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.getSelection()?.removeAllRanges()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pronunciation labels in the rendered popup', () => {
  it('distinguishes CMU, converted system entries and unverified model IPA', async () => {
    await act(async () => update({ state: {
      mode: 'word', text: 'Reproducible', status: 'done',
      explanation: { ipa: '/ˌɹipɹəˈdusəbəɫ/', systemDictionaryIpa: ['Reproducible'] }
    } }))
    const system = container.querySelector('[title="macOS dictionary · converted from NOAD respelling"]')
    expect(system?.textContent).toBe('/ˌɹipɹəˈdusəbəɫ/')
    expect(system?.querySelector('[aria-label="unverified"]')).toBeNull()

    await act(async () => update({ state: {
      mode: 'passage', text: 'A source passage', status: 'done', explanation: {
        notable: ['debit · /ˈdɛbɪt/ · 借记', 'reproducible · /ˌɹipɹəˈdusəbəɫ/ · 可复现的', 'unknownword · /test/ · 未知'],
        systemDictionaryIpa: ['reproducible'], unverifiedIpa: ['unknownword']
      }
    } }))
    expect(container.querySelector('[title="American English · CMU pronunciation dictionary"]')?.textContent).toBe('/ˈdɛbɪt/')
    expect(container.querySelector('[title="macOS dictionary · converted from NOAD respelling"]')?.textContent).toBe('/ˌɹipɹəˈdusəbəɫ/')
    expect(container.querySelector('[title="American English · model-generated pronunciation (unverified)"]')?.textContent).toBe('/test/°')
    expect(container.querySelectorAll('[aria-label="unverified"]')).toHaveLength(1)
  })
})

describe('copying from the rendered popup', () => {
  it('requests another refinement and clears copy feedback when the new attempt starts', async () => {
    expect(container.textContent).not.toContain('Try another version')
    const draft: ExplainState = { mode: 'refine', text: 'Original draft', status: 'done', refineAttempt: 1, explanation: { refined: 'First version' } }
    await act(async () => update({ state: draft }))
    const copyButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Copy refined text')!
    const retryButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Try another version')!
    await act(async () => copyButton.click())
    expect(container.textContent).toContain('Copied to clipboard')
    await act(async () => retryButton.click())
    expect(refineAgain).toHaveBeenCalledTimes(1)
    expect(refineAgain).toHaveBeenCalledWith()
    expect(copySelection).toHaveBeenCalledTimes(1)

    await act(async () => update({ state: { ...draft, status: 'streaming', refineAttempt: 2, explanation: {} } }))
    expect(retryButton.disabled).toBe(true)
    expect(copyButton.disabled).toBe(true)
    expect(container.textContent).not.toContain('Copied to clipboard')
    await act(async () => update({ state: { ...draft, refineAttempt: 2, explanation: { refined: 'Another version' } } }))
    expect(retryButton.disabled).toBe(false)
    await act(async () => copyButton.click())
    expect(clipboardText).toBe('Another version')
    expect(container.textContent).toContain('Copied to clipboard')
  })

  it('offers retry after a generation error and keeps a restored version copyable', async () => {
    const draft: ExplainState = { mode: 'refine', text: 'Original draft', status: 'error', error: 'Service unavailable', explanation: {} }
    await act(async () => update({ state: draft }))
    const retryButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Try another version')!
    expect(retryButton.disabled).toBe(false)
    await act(async () => retryButton.click())
    expect(refineAgain).toHaveBeenCalledTimes(1)
    await act(async () => update({ state: { ...draft, status: 'done', error: undefined, explanation: { refined: 'Previous version' }, refineRetryError: 'Service unavailable' } }))
    expect(container.textContent).toContain('Your previous version is still shown.')
    const copyButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Copy refined text')!
    expect(copyButton.disabled).toBe(false)
    await act(async () => copyButton.click())
    expect(clipboardText).toBe('Previous version')
  })

  it.each(['I received your message.\n\nI will reply tomorrow.', '我收到了你的消息。\n\n明天回复你。'])(
    'copies the whole refined result only after an explicit click: %s', async refined => {
      await act(async () => update({ state: { mode: 'refine', text: 'Original draft', status: 'streaming', explanation: { refined } } }))
      const button = [...container.querySelectorAll('button')].find(button => button.textContent === 'Copy refined text')!
      expect(button.disabled).toBe(true)
      expect(container.textContent).toContain('Refine · same language')
      expect(container.textContent).not.toContain('in plain english')
      expect(copySelection).not.toHaveBeenCalled()
      await act(async () => update({ state: { mode: 'refine', text: 'Original draft', status: 'done', explanation: { refined } } }))
      expect(button.disabled).toBe(false)
      await act(async () => button.click())
      expect(copySelection).toHaveBeenCalledTimes(1)
      expect(copySelection).toHaveBeenCalledWith(refined)
      expect(clipboardText).toBe(refined)
      expect(container.querySelector('[role="status"]')?.textContent).toContain('Copied')
    }
  )

  it('disables copying an incomplete refinement and shows its warning', async () => {
    await act(async () => update({ state: { mode: 'refine', text: 'Draft', status: 'done', explanation: { refined: 'Partial' }, warning: 'The answer was cut short.' } }))
    expect(container.textContent).toContain('The answer was cut short.')
    const button = [...container.querySelectorAll('button')].find(button => button.textContent === 'Copy refined text')!
    expect(button.disabled).toBe(true)
  })

  it('reports refinement copy failures and retries without copying labels or the original', async () => {
    await act(async () => update({ state: { mode: 'refine', text: 'Original', status: 'done', explanation: { refined: 'Refined' } } }))
    const button = [...container.querySelectorAll('button')].find(button => button.textContent === 'Copy refined text')!
    copySelection.mockResolvedValueOnce({ ok: false, error: 'Clipboard busy' })
    await act(async () => button.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Copy failed')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Clipboard busy')
    await act(async () => button.click())
    expect(clipboardText).toBe('Refined')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('copies once on release and copies the same words again after an external clipboard change', async () => {
    await act(async () => {
      mouse(textElement(), 'mousedown')
      setSelection()
    })
    expect(copySelection).not.toHaveBeenCalled()
    await act(async () => mouse(document, 'mouseup'))
    expect(clipboardText).toBe('Alpha')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Copied to clipboard')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('“Alpha”')

    // A second release without a new gesture must not copy the retained selection.
    await act(async () => mouse(document, 'mouseup'))
    expect(copySelection).toHaveBeenCalledTimes(1)
    clipboardText = 'copied in another app'
    await select()
    expect(clipboardText).toBe('Alpha')
    expect(copySelection).toHaveBeenCalledTimes(2)
  })

  it('allows the same words to be copied after hiding and opening another lookup', async () => {
    await select()
    await act(async () => stopListeners.forEach((listener) => listener()))
    expect(container.querySelector('[role="status"]')).toBeNull()
    await act(async () => update({ state: { ...state, text: 'Another source passage' } }))
    clipboardText = 'external copy'
    await select()
    expect(clipboardText).toBe('Alpha')
    expect(copySelection).toHaveBeenCalledTimes(2)
  })

  it('leaves the clipboard alone for a collapsed selection, controls, and non-left clicks', async () => {
    await act(async () => {
      mouse(textElement(), 'mousedown')
      window.getSelection()!.removeAllRanges()
      mouse(document, 'mouseup')
      setSelection()
      const speaker = container.querySelector('.et-selectable button')!
      mouse(speaker, 'mousedown')
      mouse(speaker, 'mouseup')
      mouse(textElement(), 'mousedown', 2)
      mouse(textElement(), 'mouseup', 2)
      mouse(container, 'mousedown')
      mouse(container, 'mouseup')
    })
    expect(copySelection).not.toHaveBeenCalled()
    expect(clipboardText).toBe('original clipboard')
  })

  it.each(['The clipboard is busy.', 'That is too much to copy.'])(
    'shows a returned copy failure and lets the same selection retry: %s', async (error) => {
      copySelection.mockResolvedValueOnce({ ok: false, error })
      await select()
      expect(container.textContent).toContain(error)
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Copy failed')
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(error)
      expect(container.querySelector('[role="status"]')).toBeNull()
      expect(clipboardText).toBe('original clipboard')
      await act(async () => vi.advanceTimersByTime(5000))
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(error)

      await select()
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(clipboardText).toBe('Alpha')
    }
  )

  it('shows rejected IPC calls and gives a fallback when a failure has no message', async () => {
    copySelection.mockRejectedValueOnce(new Error('Copy service unavailable'))
    await select()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Copy service unavailable')
    copySelection.mockResolvedValueOnce({ ok: false })
    await select()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not copy the selection. Please try again.')
  })

  it('keeps read-aloud failures visible alongside copy feedback', async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="Read aloud"]')!.click())
    expect(container.textContent).toContain('Voice unavailable')
    copySelection.mockResolvedValueOnce({ ok: false, error: 'Clipboard busy' })
    await select()
    expect(container.textContent).toContain('Voice unavailable')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Clipboard busy')
    await select()
    expect(container.textContent).toContain('Voice unavailable')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Copied to clipboard')
  })

  it('keeps confirmation visible until the next copy or lookup', async () => {
    await select()
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Copied to clipboard')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('“Alpha”')
    await select()
    expect(copySelection).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Copied to clipboard')
    await act(async () => update({ state: { ...state, text: 'Another lookup' } }))
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('shows progress on each attempt and waits for the clipboard result before confirming', async () => {
    await act(async () => update({ state: { mode: 'refine', text: 'Draft', status: 'done', explanation: { refined: 'Refined' } } }))
    const button = [...container.querySelectorAll('button')].find(button => button.textContent === 'Copy refined text')!
    await act(async () => button.click())
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Copied to clipboard')

    let finish!: (result: { ok: boolean; error?: string }) => void
    copySelection.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => button.click())
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Copying…')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Copying…')
    expect(container.textContent).not.toContain('Copied to clipboard')
    await act(async () => vi.advanceTimersByTime(5000))
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Copying…')

    await act(async () => finish({ ok: false, error: 'Clipboard busy' }))
    expect(button.disabled).toBe(false)
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Copy failed')
    await act(async () => button.click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Copied to clipboard')
  })

  it.each(['hide', 'new lookup'])('discards a late copy result after %s', async (action) => {
    let finish!: (result: { ok: boolean; error?: string }) => void
    copySelection.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await select()
    await act(async () => {
      if (action === 'hide') stopListeners.forEach((listener) => listener())
      else update({ state: { ...state, text: 'Another lookup' } })
    })
    await act(async () => finish({ ok: false, error: 'Late failure' }))
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
