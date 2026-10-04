/** Dictionary IPA is the only pronunciation text allowed into the popup or cache. */
import dictionaryText from '../../resources/pronunciation/en_US.txt?raw'
import type { Explanation, ExplainRequest, PronunciationCandidate } from '../shared/types.js'
import { parseNotable } from './notable.js'
import { PRONUNCIATION_USAGE } from './pronunciation-usage.js'

// Version the data AND the selection rules. Older model-generated IPA must not be
// mistaken for a contextual choice made from the supplied dictionary candidates.
export const PRONUNCIATION_CACHE_VERSION = 'cmu-ipa-44accfb5-v1'

let dictionary: Map<string, readonly string[]> | undefined

function entries(): Map<string, readonly string[]> {
  if (!dictionary) {
    dictionary = new Map()
    for (const line of dictionaryText.split('\n')) {
      const [word, value] = line.trim().split('\t')
      if (!word || !value) continue
      const variants = [...new Set(value.split(', ').filter((ipa) => /^\/[^/]+\/$/.test(ipa)))]
      if (variants.length) dictionary.set(word, variants)
    }
  }
  return dictionary
}

function headword(term: string): string {
  const normalized = term.trim().toLowerCase().replace(/[‘’]/g, "'")
  if (entries().has(normalized)) return normalized
  // Selection punctuation and Markdown quotes are not part of the word. Preserve
  // internal apostrophes/hyphens and never turn a phrase into an unrelated headword.
  return normalized.replace(/^["'`“”([{]+|["'`“”)\]},.!?:;]+$/g, '')
}

export function lookupPronunciations(term: string): readonly string[] {
  return entries().get(headword(term)) ?? []
}

/** Give the explanation model a bounded choice, not a request to invent IPA. */
export function withPronunciationHints(req: ExplainRequest): ExplainRequest {
  if (req.mode === 'code' || req.mode === 'refine') return req
  const hints: Record<string, readonly PronunciationCandidate[]> = Object.create(null)
  const terms = req.mode === 'word'
    ? [req.text]
    : [...new Set(req.text.match(/[a-z]+(?:['’-][a-z]+)*/gi) ?? [])]
  for (const term of terms) {
    const variants = lookupPronunciations(term)
    // Single pronunciations can be filled locally; only ambiguous passage words
    // need extra prompt tokens. Cap hints even when the selection is a whole page.
    if (variants.length > (req.mode === 'word' ? 0 : 1)) {
      const word = headword(term)
      hints[word] = variants.map((ipa) => ({ ipa, usage: PRONUNCIATION_USAGE[word]?.[ipa] }))
    }
    if (Object.keys(hints).length >= 40) break
  }
  return { ...req, pronunciationHints: hints }
}

function dictionaryIpa(term: string, proposed: string | undefined, canChoose: boolean): string | undefined {
  const variants = lookupPronunciations(term)
  if (!variants.length) return undefined
  // An exact candidate may be selected from context, but never let a model's
  // near-match change vowels or stress. Unresolved choices remain explicit.
  if (canChoose && proposed && variants.includes(proposed.trim())) return proposed.trim()
  return variants.join(' or ')
}

/** Apply to every streamed snapshot, final answer, and cache hit before display. */
export function withDictionaryPronunciations(
  req: ExplainRequest,
  explanation: Explanation,
  complete = true
): Explanation {
  const result = { ...explanation }
  delete result.ipa
  const isCode = req.mode === 'code' || explanation.isCode

  if (req.mode === 'word' && !isCode) {
    const hasContext = !!req.context?.trim() && req.context.trim() !== req.text.trim()
    const supplied = Object.hasOwn(req.pronunciationHints ?? {}, headword(req.text))
    const ipa = dictionaryIpa(req.text, explanation.ipa, complete && hasContext && supplied)
    if (ipa) result.ipa = ipa
  }

  if (explanation.notable) {
    result.notable = explanation.notable.flatMap((line) => {
      const term = parseNotable(line)
      if (!term) return []
      const supplied = Object.hasOwn(req.pronunciationHints ?? {}, headword(term.term))
      const ipa = isCode ? undefined
        : dictionaryIpa(term.term, term.ipa, complete && req.mode === 'passage' && supplied)
      return [[term.term, ipa, term.gloss, term.example].filter(Boolean).join(' · ')]
    })
  }
  return result
}
