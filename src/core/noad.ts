/**
 * Turning the system dictionary's respelling into IPA.
 *
 * Compatible New Oxford American Dictionary entries use respelling rather than
 * IPA. The supported symbols are converted explicitly; unknown symbols are rejected.
 *
 * Pure, so the table can be tested without a Mac.
 *
 * Two deliberate choices. The output uses /ɹ/ and /ɫ/ to match the bundled wordlist's
 * conventions, so a reader does not see two different notations depending on which
 * source happened to have the word. And anything that fails to convert completely is
 * discarded rather than shown part-converted: a stray `ē` reaching the popup would be
 * worse than no pronunciation at all.
 */

/** Longest first — the digraphs are built from combining marks over two letters. */
const SYMBOLS: readonly (readonly [string, string])[] = [
  // NOAD's digraphs. o͞o is o + COMBINING DOUBLE MACRON + o.
  ['o͞o', 'u'],
  ['o͝o', 'ʊ'],
  ['T͟H', 'ð'], // voiced: the, rhythm
  ['CH', 'tʃ'],
  ['SH', 'ʃ'],
  ['ZH', 'ʒ'],
  ['TH', 'θ'], // voiceless: thin
  ['NG', 'ŋ'],
  // Diphthongs written as two plain letters.
  ['ou', 'aʊ'],
  ['oi', 'ɔɪ'],
  // The r-coloured schwa, which the bundled wordlist writes as a single symbol.
  ['ər', 'ɝ'],
  // Macron and diacritic vowels.
  ['ā', 'eɪ'],
  ['ē', 'i'],
  ['ī', 'aɪ'],
  ['ō', 'oʊ'],
  ['ä', 'ɑ'],
  ['ô', 'ɔ'],
  // Plain vowels.
  ['a', 'æ'],
  ['e', 'ɛ'],
  ['i', 'ɪ'],
  ['o', 'ɑ'],
  ['u', 'ʊ'],
  ['ə', 'ə'],
  // Consonants that differ from their spelling.
  ['y', 'j'],
  ['j', 'dʒ'],
  ['c', 'k'],
  ['ɡ', 'ɡ'],
  ['g', 'ɡ'],
  ['r', 'ɹ'],
  ['l', 'ɫ'],
  // Consonants that do not.
  ...['b', 'd', 'f', 'h', 'k', 'm', 'n', 'p', 's', 't', 'v', 'w', 'z'].map(
    (c) => [c, c] as const
  ),
  // Stress marks are already IPA's own, and a space separates spelled-out letters.
  ['ˈ', 'ˈ'],
  ['ˌ', 'ˌ'],
  [' ', ' ']
]

/**
 * A respelling NOAD could plausibly have written.
 *
 * The lookup returns a whole definition, and a word with no pronunciation would
 * otherwise let definition prose through — which is how "the stinging tentacles of the
 * jellyfish" once arrived where a transcription belonged.
 */
const PLAUSIBLE = /^[^.,;:•|]{1,40}$/

export function respellingToIpa(respelling: string): string | undefined {
  const source = respelling.trim()
  if (!source || !PLAUSIBLE.test(source)) return undefined

  let out = ''
  let i = 0
  outer: while (i < source.length) {
    // The parentheses around an optional sound: keep the sound, drop the brackets.
    if (source[i] === '(' || source[i] === ')') {
      i += 1
      continue
    }
    for (const [from, to] of SYMBOLS) {
      if (source.startsWith(from, i)) {
        out += to
        i += from.length
        continue outer
      }
    }
    // An unmapped symbol means the table does not cover this entry. Show nothing
    // rather than a transcription with a hole in it.
    return undefined
  }

  const trimmed = out.trim()
  return trimmed ? `/${trimmed}/` : undefined
}

/**
 * Every `headword | respelling |` pair a definition contains.
 *
 * The entry opens with one — `reproducible re·pro·duc·i·ble | ˌrēprəˈdo͞osəb(ə)l |` —
 * and its DERIVATIVES section carries more in the same shape:
 * `DERIVATIVES maintainability | ˌmāntānəˈbilədē | noun maintainable | mānˈtānəbəl |`.
 * Both are read, because a lookup for "maintainable" returns the entry for "maintain",
 * where the word asked for is a derivative rather than the headword.
 */
const PAIR = /(?:^|\s)([A-Za-z][A-Za-z'\u00b7-]*)\s*\|\s*([^|]+?)\s*\|/g

/**
 * The respelling for exactly `word`, or undefined.
 *
 * The word is matched exactly, never approximately. A lookup for "maintainable"
 * returns the entry for "maintain", and showing /mānˈtān/ for it would simply be
 * wrong — so a pair only counts when its headword is the word that was asked for,
 * with the syllable dots the dictionary prints taken back out.
 */
export function respellingFor(word: string, definition: string | null | undefined): string | undefined {
  if (!definition) return undefined
  const wanted = word.trim().toLowerCase()
  if (!wanted) return undefined

  for (const [, head, respelling] of definition.matchAll(PAIR)) {
    if (head.replace(/\u00b7/g, '').toLowerCase() !== wanted) continue
    // Several pronunciations are separated by commas; the first is the main one.
    const first = respelling.split(',')[0]?.trim()
    if (first) return first
  }
  return undefined
}

/** The system dictionary's pronunciation for a word, as IPA. */
export function ipaFromDefinition(word: string, definition: string | null | undefined): string | undefined {
  const respelling = respellingFor(word, definition)
  return respelling ? respellingToIpa(respelling) : undefined
}
