/**
 * The dictionary macOS already has.
 *
 * Dictionary Services is what Dictionary.app and the Look Up menu read, and on a
 * default install that includes the New Oxford American Dictionary — which has the
 * words CMU's wordlist does not: "reproducible", "idempotent", "onboarding". It is a
 * plain C API in CoreServices, already present, offline, and needs no permission.
 *
 * It returns a whole definition, with the pronunciation near the front in NOAD's own
 * respelling. Converting that to IPA happens in core/noad.ts, where it can be tested.
 */
import koffi from 'koffi'

const kCFStringEncodingUTF8 = 0x08000100

/** Bound native output while allowing long entries with derivatives at the end. */
const MAX_DEFINITION_LENGTH = 1_000_000

interface Bindings {
  copyTextDefinition: (dictionary: unknown, text: unknown, range: unknown) => unknown
  stringCreate: (alloc: unknown, text: string, encoding: number) => unknown
  stringGetCString: (s: unknown, buffer: Buffer, size: number, encoding: number) => boolean
  stringGetLength: (s: unknown) => number
  release: (obj: unknown) => void
}

let bindings: Bindings | null = null
let attempted = false

function load(): Bindings | null {
  if (attempted) return bindings
  attempted = true
  if (process.platform !== 'darwin') return null
  try {
    const CFRange = koffi.struct('DCSCFRange', { location: 'int64', length: 'int64' })
    const services = koffi.load('/System/Library/Frameworks/CoreServices.framework/CoreServices')
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    bindings = {
      // A null dictionary means "whichever dictionaries the user has active".
      copyTextDefinition: services.func('DCSCopyTextDefinition', 'void *', ['void *', 'void *', CFRange]),
      stringCreate: cf.func('CFStringCreateWithCString', 'void *', ['void *', 'str', 'uint32']),
      stringGetCString: cf.func('CFStringGetCString', 'bool', ['void *', 'char *', 'int64', 'uint32']),
      stringGetLength: cf.func('CFStringGetLength', 'int64', ['void *']),
      release: cf.func('CFRelease', 'void', ['void *'])
    }
    return bindings
  } catch (err) {
    console.error('[dictionary] Dictionary Services unavailable:', err)
    bindings = null
    return null
  }
}

export function systemDictionaryAvailable(): boolean {
  return load() !== null
}

/**
 * The system dictionary's definition of a word, or null.
 *
 * Null covers every ordinary case: not macOS, no dictionary enabled, or simply a word
 * it does not have.
 */
export function systemDefinition(word: string): string | null {
  const b = load()
  if (!b) return null
  // One line, no control characters: this is a lookup key, not free text.
  const term = word.trim()
  if (!term || term.length > 120 || /[\u0000-\u001f\u007f]/.test(term)) return null

  let text: unknown = null
  let definition: unknown = null
  try {
    text = b.stringCreate(null, term, kCFStringEncodingUTF8)
    if (!text) return null
    definition = b.copyTextDefinition(null, text, {
      location: 0,
      length: Number(b.stringGetLength(text))
    })
    if (!definition) return null

    const length = Number(b.stringGetLength(definition))
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_DEFINITION_LENGTH) return null
    // CFStringGetCString fails unless the ENTIRE string fits. Each UTF-16 code
    // unit needs at most three UTF-8 bytes, plus one byte for the terminator.
    const buffer = Buffer.alloc(length * 3 + 1)
    if (!b.stringGetCString(definition, buffer, buffer.length, kCFStringEncodingUTF8)) {
      return null
    }
    const end = buffer.indexOf(0)
    return end < 0 ? null : buffer.toString('utf8', 0, end)
  } catch (err) {
    console.error('[dictionary] lookup failed:', err)
    return null
  } finally {
    if (definition) b.release(definition)
    if (text) b.release(text)
  }
}
