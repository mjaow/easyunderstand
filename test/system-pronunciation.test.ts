import { afterEach, describe, expect, it, vi } from 'vitest'
import { SectionParser, userPrompt } from '../src/core/explain.js'
import { lookupPronunciations, setSystemDictionary, systemPronunciation, withDictionaryPronunciations, withPronunciationHints } from '../src/core/pronunciation.js'

const definition = 'reproducible re·pro·duc·i·ble | ˌrēprəˈdo͞osəb(ə)l | adjective'
const ipa = '/ˌɹipɹəˈdusəbəɫ/'

afterEach(() => setSystemDictionary(null))

describe('system dictionary fallback', () => {
  it('looks up a word once across prompt construction, streaming, final output and cache hits', () => {
    const lookup = vi.fn(() => definition)
    setSystemDictionary(lookup)
    const req = withPronunciationHints({ mode: 'word', text: 'Reproducible' })
    expect(req.pronunciationHints?.reproducible).toEqual([{ ipa }])
    const parser = new SectionParser()
    for (const chunk of '## IPA\n/wrong/\n## ZH\n可复现的') {
      expect(withDictionaryPronunciations(req, parser.push(chunk), false)).toMatchObject({
        ipa, systemDictionaryIpa: ['Reproducible']
      })
    }
    const result = withDictionaryPronunciations(req, parser.end())
    expect(withDictionaryPronunciations(req, result)).toEqual(result)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith('reproducible')
  })

  it('memoizes misses and thrown lookups, and clears them when the dictionary changes', () => {
    const lookup = vi.fn(() => null)
    setSystemDictionary(lookup)
    expect(systemPronunciation('reproducible')).toBeUndefined()
    expect(systemPronunciation(' “REPRODUCIBLE,” ')).toBeUndefined()
    expect(lookup).toHaveBeenCalledTimes(1)
    const broken = vi.fn(() => { throw new Error('unavailable') })
    setSystemDictionary(broken)
    expect(systemPronunciation('reproducible')).toBeUndefined()
    expect(systemPronunciation('reproducible')).toBeUndefined()
    expect(broken).toHaveBeenCalledTimes(1)
    setSystemDictionary(() => definition)
    expect(systemPronunciation('reproducible')).toBe(ipa)
  })

  it('bounds remembered lookups and rejects phrases and oversized keys', () => {
    const lookup = vi.fn(() => null)
    setSystemDictionary(lookup)
    systemPronunciation('reproducible')
    for (let i = 0; i < 1100; i++) {
      systemPronunciation(`unknown${String.fromCharCode(97 + Math.floor(i / 676), 97 + Math.floor(i / 26) % 26, 97 + i % 26)}`)
    }
    lookup.mockClear()
    systemPronunciation('reproducible')
    expect(lookup).toHaveBeenCalledTimes(1)
    lookup.mockClear()
    for (const term of ['', 'a phrase', 'a'.repeat(121), 'word\u0000']) systemPronunciation(term)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('keeps CMU authoritative and strips stale source metadata', () => {
    const lookup = vi.fn(() => definition)
    setSystemDictionary(lookup)
    const req = withPronunciationHints({ mode: 'word', text: 'debit' })
    expect(withDictionaryPronunciations(req, {
      ipa: '/wrong/', unverifiedIpa: ['debit'], systemDictionaryIpa: ['debit']
    })).toEqual({ ipa: lookupPronunciations('debit')[0] })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('does not relabel cached system IPA as model output when the dictionary disappears', () => {
    setSystemDictionary(() => definition)
    const req = withPronunciationHints({ mode: 'word', text: 'reproducible' })
    const cached = withDictionaryPronunciations(req, { notable: ['reproducible · 可复现的'] })
    setSystemDictionary(null)
    const shown = withDictionaryPronunciations(req, cached, true, true)
    expect(shown.ipa).toBeUndefined()
    expect(shown.notable).toEqual(['reproducible · 可复现的'])
    expect(shown.unverifiedIpa).toBeUndefined()
    expect(shown.systemDictionaryIpa).toBeUndefined()
  })

  it('enriches notable words without querying every word in the passage', () => {
    const lookup = vi.fn(() => definition)
    setSystemDictionary(lookup)
    const req = withPronunciationHints({ mode: 'passage', text: 'This unfamiliar vocabulary is reproducible.' })
    expect(lookup).not.toHaveBeenCalled()
    const answer = withDictionaryPronunciations(req, {
      notable: ['reproducible · /wrong/ · 可复现的 · An example.', 'debit · 借记']
    })
    expect(answer.notable?.[0]).toBe(`reproducible · ${ipa} · 可复现的 · An example.`)
    expect(answer.systemDictionaryIpa).toEqual(['reproducible'])
    expect(answer.unverifiedIpa).toBeUndefined()
  })

  it('requests model IPA and stem anchors only when the setting is enabled', () => {
    const disabled = withPronunciationHints({ mode: 'word', text: 'reproducible' })
    expect(disabled.pronunciationAnchor).toBeUndefined()
    expect(userPrompt(disabled)).not.toContain('Unverified pronunciations enabled')
    const enabled = withPronunciationHints({ mode: 'word', text: 'reproducible' }, true)
    expect(enabled.pronunciationAnchor?.term).toBe('reproduce')
    expect(userPrompt(enabled)).toContain('Unverified pronunciations enabled')
  })
})
