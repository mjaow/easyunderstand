import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipaFromDefinition, respellingFor } from '../src/core/noad.js'
import { setSystemDictionary, withDictionaryPronunciations } from '../src/core/pronunciation.js'
import { systemDefinition, systemDictionaryAvailable } from '../src/main/native/dictionary-macos.js'

afterEach(() => {
  setSystemDictionary(null)
  vi.restoreAllMocks()
})

describe('real platform dictionary integration', () => {
  it('loads only on macOS and preserves bundled pronunciations on both platforms', () => {
    const errors = vi.spyOn(console, 'error')
    expect(systemDictionaryAvailable()).toBe(process.platform === 'darwin')
    if (systemDictionaryAvailable()) setSystemDictionary(systemDefinition)
    expect(withDictionaryPronunciations({ mode: 'word', text: 'debit' }, { ipa: '/wrong/' }))
      .toEqual({ ipa: '/ˈdɛbɪt/' })
    expect(withDictionaryPronunciations({ mode: 'word', text: 'read' }, { ipa: '/wrong/' }))
      .toEqual({ ipa: '/ˈɹɛd/ or /ˈɹid/' })
    for (const word of ['reproducible', 'maintainable', 'qzxnotaword']) {
      const definition = systemDefinition(word)
      if (process.platform !== 'darwin') expect(definition).toBeNull()
      else expect(definition === null || typeof definition === 'string').toBe(true)
    }
    expect(errors).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform !== 'darwin')('converts an installed NOAD entry through the real C API', context => {
    const definition = systemDefinition('reproducible')
    // Dictionary content depends on installed/enabled dictionaries, even on Mac.
    // The preceding smoke test still validates the native calls when NOAD is absent.
    if (!respellingFor('reproducible', definition)) context.skip()
    const ipa = ipaFromDefinition('reproducible', definition)
    expect(ipa).toBe('/ˌɹipɹəˈdusəbəɫ/')
    setSystemDictionary(systemDefinition)
    expect(withDictionaryPronunciations({ mode: 'word', text: 'reproducible' }, {}))
      .toMatchObject({ ipa, systemDictionaryIpa: ['reproducible'] })
  })
})
