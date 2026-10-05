import { describe, expect, it } from 'vitest'
import { SectionParser, userPrompt } from '../src/core/explain.js'
import { parseNotable } from '../src/core/notable.js'
import {
  lookupPronunciations,
  withDictionaryPronunciations,
  withPronunciationHints
} from '../src/core/pronunciation.js'
import type { ExplainRequest } from '../src/shared/types.js'
import { PRONUNCIATION_USAGE } from '../src/core/pronunciation-usage.js'

describe('bundled American pronunciation dictionary', () => {
  it('gives debit the correct vowel and first-syllable stress, including its plural', () => {
    expect(lookupPronunciations('debit')).toEqual(['/ˈdɛbɪt/'])
    expect(lookupPronunciations('debits')).toEqual(['/ˈdɛbɪts/'])
  })

  it('handles case, selection punctuation, curly apostrophes and hyphens', () => {
    expect(lookupPronunciations(' “DEBIT,” ')).toEqual(lookupPronunciations('debit'))
    expect(lookupPronunciations('don’t')).toEqual(lookupPronunciations("don't"))
    expect(lookupPronunciations('well-known')).not.toEqual([])
  })

  it('does not guess missing words, code, phrases or object properties', () => {
    for (const word of ['qzxnotaword', 'debit card', 'debit()', '__proto__', 'toString', '']) {
      expect(lookupPronunciations(word), word).toEqual([])
    }
  })

  it('attaches usage labels only to pronunciations actually present in the dictionary', () => {
    for (const [word, labels] of Object.entries(PRONUNCIATION_USAGE)) {
      for (const ipa of Object.keys(labels)) expect(lookupPronunciations(word)).toContain(ipa)
    }
  })
})

describe('dictionary pronunciation enrichment', () => {
  const debit: ExplainRequest = { mode: 'word', text: 'debit' }

  it('replaces a cached or freshly generated wrong IPA without altering the explanation', () => {
    const raw = { ipa: '/dɪˈbɪt/', pos: 'noun', zh: '借记', example: 'A debit appeared.' }
    expect(withDictionaryPronunciations(debit, raw)).toEqual({ ...raw, ipa: '/ˈdɛbɪt/' })
    expect(raw.ipa).toBe('/dɪˈbɪt/')
  })

  it('never exposes generated IPA while a response streams', () => {
    const parser = new SectionParser()
    for (const char of '## IPA\n/dɪˈbɪt/\n## POS\nnoun\n') {
      const shown = withDictionaryPronunciations(debit, parser.push(char), false)
      expect(shown.ipa).toBe('/ˈdɛbɪt/')
    }
  })

  it('keeps the model’s IPA for a word the dictionary lacks, marked unverified', () => {
    // The wordlist has no "reproducible" — and neither does Wiktionary, because a
    // word built from parts gets left out. A labelled reading beats a blank.
    const req: ExplainRequest = { mode: 'word', text: 'reproducible' }
    const answer = { ipa: '/ˌriɹəˈdusəbəɫ/', zh: '可复现的' }

    const shown = withDictionaryPronunciations(req, answer, true, true)
    expect(shown.ipa).toBe('/ˌriɹəˈdusəbəɫ/')
    expect(shown.unverifiedIpa).toEqual(['reproducible'])

    // Off by default: measured, the model gets about half of these wrong, and half-wrong
    // IPA is worse than none for a reader who cannot tell which half.
    const withheld = withDictionaryPronunciations(req, answer)
    expect(withheld.ipa).toBeUndefined()
    expect(withheld.unverifiedIpa).toBeUndefined()
    expect(withheld.zh).toBe('可复现的')
  })

  it('anchors an absent word to the nearest word the dictionary does know', () => {
    // Asked cold, qwen-flash dropped a syllable from "reproducible". Shown the stem
    // first, it got it right.
    const req = withPronunciationHints({ mode: 'word', text: 'reproducible' }, true)
    expect(req.pronunciationAnchor).toEqual({ term: 'reproduce', ipa: lookupPronunciations('reproduce')[0] })
    expect(userPrompt(req)).toContain('not in the dictionary')
    expect(userPrompt(req)).toContain('reproduce')

    // A word the dictionary has needs no anchor, and must not be given one.
    expect(withPronunciationHints({ mode: 'word', text: 'debit' }).pronunciationAnchor).toBeUndefined()
  })

  it('waits for the closing slash before showing an unverified reading', () => {
    // Mid-stream the transcription is half-written. A pronunciation that appeared one
    // symbol at a time would read as a different word with every chunk.
    const parser = new SectionParser()
    const shown: (string | undefined)[] = []
    const req: ExplainRequest = { mode: 'word', text: 'reproducible' }
    for (const char of '## IPA\n/ˌriɹəˈdusəbəɫ/\n## POS\nadjective\n') {
      shown.push(withDictionaryPronunciations(req, parser.push(char), false, true).ipa)
    }
    // Nothing until it is whole, then only ever the whole thing.
    expect([...new Set(shown.filter(Boolean))]).toEqual(['/ˌriɹəˈdusəbəɫ/'])
  })

  it('shows nothing rather than a non-pronunciation', () => {
    // Only the shape can be checked, never the phonetics — but "(none)" and prose
    // must not reach the popup dressed as a transcription.
    for (const proposed of ['(none)', '（none）', 'unknown', '', 'ri-pro-DUCE-ible']) {
      const result = withDictionaryPronunciations({ mode: 'word', text: 'qzxnotaword' }, { ipa: proposed }, true, true)
      expect(result.ipa, proposed).toBeUndefined()
      expect(result.unverifiedIpa, proposed).toBeUndefined()
    }
  })

  it('leaves the explanation alone when there is no pronunciation to show', () => {
    const result = withDictionaryPronunciations(
      { mode: 'word', text: 'qzxnotaword' },
      { ipa: '(none)', zh: '解释', en: 'The explanation still works.' }
    )
    expect(result).toEqual({ zh: '解释', en: 'The explanation still works.' })
  })

  it('shows all read variants when no sentence disambiguates the word', () => {
    const req = withPronunciationHints({ mode: 'word', text: 'read' })
    expect(withDictionaryPronunciations(req, { ipa: '/ˈɹɛd/' }).ipa)
      .toBe('/ˈɹɛd/ or /ˈɹid/')
    expect(withDictionaryPronunciations({ ...req, context: 'read' }, { ipa: '/ˈɹid/' }).ipa)
      .toBe('/ˈɹɛd/ or /ˈɹid/')
  })

  it.each([
    ['I read the book yesterday.', '/ˈɹɛd/'],
    ['I read every day.', '/ˈɹid/']
  ])('accepts only a dictionary candidate selected for: %s', (context, ipa) => {
    const req = withPronunciationHints({ mode: 'word', text: 'read', context })
    expect(userPrompt(req)).toContain(context)
    expect(userPrompt(req)).toContain('past tense or past participle')
    expect(userPrompt(req)).toContain('base form, infinitive, or present tense')
    expect(req.pronunciationHints?.read.map((candidate) => candidate.ipa)).toEqual(['/ˈɹɛd/', '/ˈɹid/'])
    expect(withDictionaryPronunciations(req, { ipa }).ipa).toBe(ipa)
    expect(withDictionaryPronunciations(req, { ipa: '/riˈd/' }).ipa).toBe('/ˈɹɛd/ or /ˈɹid/')
    expect(withDictionaryPronunciations(req, { ipa }, false).ipa).toBe('/ˈɹɛd/ or /ˈɹid/')
  })

  it('cannot treat unsupplied candidates from an old answer as a contextual selection', () => {
    const req: ExplainRequest = { mode: 'word', text: 'read', context: 'I read yesterday.' }
    expect(withDictionaryPronunciations(req, { ipa: '/ˈɹid/' }).ipa).toBe('/ˈɹɛd/ or /ˈɹid/')
  })

  it('replaces passage IPA while preserving the term, Chinese meaning and example', () => {
    const req = withPronunciationHints({ mode: 'passage', text: 'I read about a debit yesterday.' })
    const result = withDictionaryPronunciations(req, {
      notable: [
        'debit · /dɪˈbɪt/ · 借记 · A debit appeared.',
        'read · /ˈɹɛd/ · 阅读 · I read yesterday.',
        'qzxnotaword · /invented/ · 未知词 · An example.'
      ]
    }, true, true)
    expect(result.notable?.map(parseNotable)).toEqual([
      // In the dictionary: its entry wins, whatever the model proposed.
      { term: 'debit', ipa: '/ˈdɛbɪt/', gloss: '借记', example: 'A debit appeared.' },
      { term: 'read', ipa: '/ˈɹɛd/', gloss: '阅读', example: 'I read yesterday.' },
      // Not in the dictionary: the model's reading is kept, and listed as unverified.
      { term: 'qzxnotaword', ipa: '/invented/', gloss: '未知词', example: 'An example.' }
    ])
    expect(result.unverifiedIpa).toEqual(['qzxnotaword'])
    expect(withDictionaryPronunciations(req, result, true, true)).toEqual(result)
  })

  it('removes model IPA from code responses and does not send dictionary hints for code', () => {
    for (const mode of ['word', 'code'] as const) {
      const req = withPronunciationHints({ mode, text: 'read' })
      const result = withDictionaryPronunciations(req, {
        isCode: true, ipa: '/invented/', notable: ['read · /invented/ · 读取']
      })
      expect(result.ipa).toBeUndefined()
      expect(parseNotable(result.notable![0])?.ipa).toBeUndefined()
    }
    expect(withPronunciationHints({ mode: 'code', text: 'read' }).pronunciationHints).toBeUndefined()
  })

  it('keeps the hint budget bounded and does not add unambiguous passage words', () => {
    const text = 'read live record debit '.repeat(1000)
    const hints = withPronunciationHints({ mode: 'passage', text }).pronunciationHints!
    expect(Object.keys(hints)).toEqual(['read', 'live', 'record'])
    expect(Object.keys(hints).length).toBeLessThanOrEqual(40)
    expect(hints.read.map((candidate) => candidate.ipa)).toEqual(lookupPronunciations('read'))
  })
})
