/**
 * Prefer bundled pronunciations, then compatible system dictionary entries.
 * Model-generated IPA is optional and always labelled as unverified.
 */
import dictionaryText from '../../resources/pronunciation/en_US.txt?raw'
import type {
  Explanation,
  ExplainRequest,
  PronunciationAnchor,
  PronunciationCandidate
} from '../shared/types.js'
import { parseNotable } from './notable.js'
import { ipaFromDefinition } from './noad.js'
import { PRONUNCIATION_USAGE } from './pronunciation-usage.js'

/**
 * A second attested source, supplied by the platform when it has one.
 *
 * macOS ships the New Oxford American Dictionary, which has the derived vocabulary
 * CMU's wordlist misses. Injected rather than imported so this module stays pure and
 * testable, and so the renderer never pulls a native binding into its bundle.
 */
type DefinitionLookup = (word: string) => string | null

let systemDictionary: DefinitionLookup | null = null
const SYSTEM_CACHE_LIMIT = 1024
const systemCache = new Map<string, string | undefined>()

export function setSystemDictionary(lookup: DefinitionLookup | null): void {
  systemDictionary = lookup
  systemCache.clear()
}

/** The system dictionary's IPA for a word, if the platform has one and knows it. */
export function systemPronunciation(term: string): string | undefined {
  if (!systemDictionary) return undefined
  const word = headword(term)
  if (word.length > 120 || !/^[a-z]+(?:['-][a-z]+)*$/.test(word)) return undefined
  if (systemCache.has(word)) return systemCache.get(word)
  let ipa: string | undefined
  try {
    ipa = ipaFromDefinition(word, systemDictionary(word))
  } catch {
    // A dictionary that misbehaves must never take a lookup down with it.
  }
  // Remember misses too: enrichment runs on every streamed snapshot. Bound the
  // cache because many different words can be encountered during a long session.
  if (systemCache.size >= SYSTEM_CACHE_LIMIT) systemCache.delete(systemCache.keys().next().value!)
  systemCache.set(word, ipa)
  return ipa
}

// Version the data AND the selection rules. Older model-generated IPA must not be
// mistaken for a contextual choice made from the supplied dictionary candidates.
export const PRONUNCIATION_CACHE_VERSION = 'cmu-ipa-44accfb5-noad-v4'

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

/** A bundled stem can guide optional model IPA, but cannot verify the result. */
const MIN_STEM = 4

export function stemAnchor(term: string): PronunciationAnchor | undefined {
  const word = headword(term)
  if (lookupPronunciations(word).length || systemPronunciation(word)) return undefined
  for (let end = word.length - 1; end >= MIN_STEM; end--) {
    // The silent -e that "reproduce" keeps and "reproducible" drops.
    for (const candidate of [word.slice(0, end), `${word.slice(0, end)}e`]) {
      const [ipa] = lookupPronunciations(candidate)
      if (ipa) return { term: candidate, ipa }
    }
  }
  return undefined
}

/** Give the explanation model a bounded choice, not a request to invent IPA. */
export function withPronunciationHints(req: ExplainRequest, allowUnverified = false): ExplainRequest {
  if (req.mode === 'code' || req.mode === 'refine') return req
  const hints: Record<string, readonly PronunciationCandidate[]> = Object.create(null)
  const terms = req.mode === 'word'
    ? [req.text]
    : [...new Set(req.text.match(/[a-z]+(?:['’-][a-z]+)*/gi) ?? [])]
  for (const term of terms) {
    let variants = lookupPronunciations(term)
    if (!variants.length && req.mode === 'word') {
      const ipa = systemPronunciation(term)
      if (ipa) variants = [ipa]
    }
    // Single pronunciations can be filled locally; only ambiguous passage words
    // need extra prompt tokens. Cap hints even when the selection is a whole page.
    if (variants.length > (req.mode === 'word' ? 0 : 1)) {
      const word = headword(term)
      hints[word] = variants.map((ipa) => ({ ipa, usage: PRONUNCIATION_USAGE[word]?.[ipa] }))
    }
    if (Object.keys(hints).length >= 40) break
  }
  // Only for a single word. In a passage the hard words are the model's own choice,
  // and anchoring each one would cost more prompt than the answer is worth.
  const anchor = allowUnverified && req.mode === 'word' ? stemAnchor(req.text) : undefined
  return { ...req, pronunciationHints: hints, pronunciationAnchor: anchor, allowUnverifiedPronunciations: allowUnverified }
}

/** A well-formed broad transcription, and not the model's way of saying "I don't know". */
const IPA_SHAPE = /^\/[^/\s][^/]*\/$/

export function looksLikeIpa(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || /^[(（]?none[)）]?$/i.test(trimmed)) return false
  return IPA_SHAPE.test(trimmed)
}

/** Resolve an IPA and its source, always preferring an available dictionary. */
function resolveIpa(
  term: string,
  proposed: string | undefined,
  canChoose: boolean,
  allowUnverified: boolean
): { ipa: string; source: 'cmu' | 'system' | 'model' } | undefined {
  const variants = lookupPronunciations(term)
  if (!variants.length) {
    // The system may cover words missing from the bundled list.
    const fromSystem = systemPronunciation(term)
    if (fromSystem) return { ipa: fromSystem, source: 'system' }
    if (!allowUnverified || !looksLikeIpa(proposed)) return undefined
    return { ipa: proposed!.trim(), source: 'model' }
  }
  // An exact candidate may be selected from context, but never let a model's
  // near-match change vowels or stress. Unresolved choices remain explicit.
  if (canChoose && proposed && variants.includes(proposed.trim())) {
    return { ipa: proposed.trim(), source: 'cmu' }
  }
  return { ipa: variants.join(' or '), source: 'cmu' }
}

/** Apply to every streamed snapshot, final answer, and cache hit before display. */
export function withDictionaryPronunciations(
  req: ExplainRequest,
  explanation: Explanation,
  complete = true,
  allowUnverified = false
): Explanation {
  const result = { ...explanation }
  delete result.ipa
  delete result.unverifiedIpa
  delete result.systemDictionaryIpa
  const isCode = req.mode === 'code' || req.mode === 'refine' || explanation.isCode
  const unverified: string[] = []
  const system: string[] = []

  if (req.mode === 'word' && !isCode) {
    const hasContext = !!req.context?.trim() && req.context.trim() !== req.text.trim()
    const supplied = Object.hasOwn(req.pronunciationHints ?? {}, headword(req.text))
    // A cached system entry must not become a "model reading" when that source
    // is unavailable (for example, after moving the cache to Windows).
    const proposed = explanation.systemDictionaryIpa?.includes(req.text) ? undefined : explanation.ipa
    const resolved = resolveIpa(req.text, proposed, complete && hasContext && supplied, allowUnverified)
    if (resolved) {
      result.ipa = resolved.ipa
      if (resolved.source === 'model') unverified.push(req.text)
      if (resolved.source === 'system') system.push(req.text)
    }
  }

  if (explanation.notable) {
    result.notable = explanation.notable.flatMap((line) => {
      const term = parseNotable(line)
      if (!term) return []
      const supplied = Object.hasOwn(req.pronunciationHints ?? {}, headword(term.term))
      const proposed = explanation.systemDictionaryIpa?.includes(term.term) ? undefined : term.ipa
      const resolved = isCode ? undefined
        : resolveIpa(term.term, proposed, complete && req.mode === 'passage' && supplied, allowUnverified)
      if (resolved?.source === 'model') unverified.push(term.term)
      if (resolved?.source === 'system') system.push(term.term)
      return [[term.term, resolved?.ipa, term.gloss, term.example].filter(Boolean).join(' · ')]
    })
  }

  if (unverified.length) result.unverifiedIpa = unverified
  if (system.length) result.systemDictionaryIpa = system
  return result
}
