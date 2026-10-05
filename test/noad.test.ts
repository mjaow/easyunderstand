/** NOAD respelling fixtures, including derived entries and unsupported input. */
import { describe, it, expect } from 'vitest'
import { ipaFromDefinition, respellingFor, respellingToIpa } from '../src/core/noad.js'

describe('respelling to IPA', () => {
  it.each([
    // The word that started this: absent from CMU, present here, and right.
    ['ˌrēprəˈdo͞osəb(ə)l', '/ˌɹipɹəˈdusəbəɫ/'],
    ['ˌīdemˈpōtnt', '/ˌaɪdɛmˈpoʊtnt/'],
    ['ˈônˌbôrdiNG', '/ˈɔnˌbɔɹdɪŋ/'],
    ['əbˌzərvəˈbilədē', '/əbˌzɝvəˈbɪɫədi/'],
    // Every vowel notation.
    ['ˈdebit', '/ˈdɛbɪt/'],
    ['ˈabsəns', '/ˈæbsəns/'],
    ['əˈkräpələs', '/əˈkɹɑpəɫəs/'],
    ['əbˈhôr', '/əbˈhɔɹ/'],
    ['kou', '/kaʊ/'],
    ['əˈpoint', '/əˈpɔɪnt/'],
    // The capital-letter digraphs, and the voiced/voiceless th distinction.
    ['əˈbrāZH(ə)n', '/əˈbɹeɪʒən/'],
    ['əˈCHēvm(ə)nt', '/əˈtʃivmənt/'],
    ['ˈalɡəˌriT͟Həm', '/ˈæɫɡəˌɹɪðəm/'],
    // Spelled-out initialisms keep their spaces.
    ['ˌes ˌbē ˈā', '/ˌɛs ˌbi ˈeɪ/']
  ])('converts %s', (respelling, ipa) => {
    expect(respellingToIpa(respelling)).toBe(ipa)
  })

  it('matches the bundled wordlist conventions, so one notation is shown throughout', () => {
    // The wordlist writes /ɹ/ and /ɫ/ rather than /r/ and /l/.
    const ipa = respellingToIpa('ˈalɡəˌriT͟Həm')!
    expect(ipa).toContain('ɹ')
    expect(ipa).toContain('ɫ')
    expect(ipa).not.toMatch(/[rl]/)
  })

  it('discards anything it cannot convert completely', () => {
    // A half-converted transcription with a stray ē in it would be worse than none.
    for (const bad of ['', '   ', 'no symbols like Ω here', 'ˈdebitΩ']) {
      expect(respellingToIpa(bad), bad).toBeUndefined()
    }
  })
})

describe('finding the respelling in a definition', () => {
  const REPRODUCIBLE =
    'reproducible re·pro·duc·i·ble | ˌrēprəˈdo͞osəb(ə)l, ˌrēprəˈjo͞osəb(ə)l | adjective able to be reproduced'

  it('takes the first of several listed pronunciations', () => {
    expect(respellingFor('reproducible', REPRODUCIBLE)).toBe('ˌrēprəˈdo͞osəb(ə)l')
    expect(ipaFromDefinition('reproducible', REPRODUCIBLE)).toBe('/ˌɹipɹəˈdusəbəɫ/')
  })

  it('refuses a definition for a different word', () => {
    // Asking for "maintainable" returns the entry for "maintain". Showing /mānˈtān/
    // for it would be plainly wrong.
    const maintain = 'maintain main·tain | mānˈtān | verb [with object] cause to continue'
    expect(respellingFor('maintainable', maintain)).toBeUndefined()
    expect(ipaFromDefinition('maintainable', maintain)).toBeUndefined()
    expect(respellingFor('maintain', maintain)).toBe('mānˈtān')
    // A match must not start partway through a non-ASCII or numbered headword.
    expect(ipaFromDefinition('reproducible', '2reproducible | ˌrēprəˈdo͞osəb(ə)l |')).toBeUndefined()
    expect(ipaFromDefinition('reproducible', 'éreproducible | ˌrēprəˈdo͞osəb(ə)l |')).toBeUndefined()
  })

  it('finds a word listed as a derivative of another entry', () => {
    // This is how "maintainable" and "observability" are actually filed: the entry is
    // the base word, and the derived forms carry their own pronunciations after it.
    const entry =
      'maintain main·tain | mānˈtān | verb cause to continue. ' +
      'DERIVATIVES maintainability | ˌmāntānəˈbilədē | noun maintainable | mānˈtānəbəl | adjective'
    expect(ipaFromDefinition('maintainable', entry)).toBe('/meɪnˈteɪnəbəɫ/')
    expect(ipaFromDefinition('maintainability', entry)).toBe('/ˌmeɪnteɪnəˈbɪɫədi/')
    // The base word still resolves to its own pronunciation, not a derivative's.
    expect(ipaFromDefinition('maintain', entry)).toBe('/meɪnˈteɪn/')
    // And a word merely mentioned in the prose gets nothing.
    expect(ipaFromDefinition('continue', entry)).toBeUndefined()
  })

  it('refuses an entry that has no pronunciation at all', () => {
    // A word with no respelling would otherwise let definition prose through — which
    // is how "the stinging tentacles of the jellyfish" once reached a transcription.
    const prose = 'stinging the stinging tentacles of the jellyfish. • a stinging pain: harsh'
    expect(ipaFromDefinition('stinging', prose)).toBeUndefined()
    expect(ipaFromDefinition('anything', null)).toBeUndefined()
    expect(ipaFromDefinition('anything', 'no bars at all here')).toBeUndefined()
  })
})
