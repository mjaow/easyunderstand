import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  create: vi.fn(), copy: vi.fn(), length: vi.fn(), read: vi.fn(), release: vi.fn(), load: vi.fn(), struct: vi.fn()
}))
vi.mock('koffi', () => ({ default: { load: native.load, struct: native.struct } }))

const input = { value: 'reproducible' }
const definition = { value: '' }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  native.create.mockReturnValue(input)
  native.copy.mockReturnValue(definition)
  native.length.mockImplementation(s => s.value.length)
  native.read.mockImplementation((s, buffer: Buffer, size: number) => {
    if (Buffer.byteLength(s.value, 'utf8') + 1 > size) return false
    buffer.write(s.value, 'utf8')
    return true
  })
  native.load.mockReturnValue({ func: (name: string) => ({
    CFStringCreateWithCString: native.create, DCSCopyTextDefinition: native.copy,
    CFStringGetLength: native.length, CFStringGetCString: native.read, CFRelease: native.release
  })[name] })
  definition.value = 'reproducible | ˌrēprəˈdo͞osəb(ə)l | adjective'
})

afterEach(() => vi.restoreAllMocks())

describe('macOS dictionary binding', () => {
  it('reads complete Unicode entries beyond 4 KB, including derivatives at the end', async () => {
    definition.value = '中文😀 definition '.repeat(1000) + 'maintainable | mānˈtānəbəl | adjective'
    const { systemDefinition } = await import('../src/main/native/dictionary-macos.js')
    expect(systemDefinition('reproducible')).toBe(definition.value)
    expect(native.copy).toHaveBeenCalledWith(null, input, { location: 0, length: input.value.length })
    expect(native.release.mock.calls).toEqual([[definition], [input]])
  })

  it.each(['missing', 'error', 'conversion', 'oversized'])('releases allocated strings on %s definitions', async failure => {
    if (failure === 'missing') native.copy.mockReturnValue(null)
    if (failure === 'error') native.copy.mockImplementation(() => { throw new Error('native failure') })
    if (failure === 'conversion') native.read.mockReturnValue(false)
    if (failure === 'oversized') native.length.mockImplementation(s => s === input ? input.value.length : 2_000_000)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { systemDefinition } = await import('../src/main/native/dictionary-macos.js')
    expect(systemDefinition('reproducible')).toBeNull()
    expect(native.release.mock.calls).toEqual(failure === 'missing' || failure === 'error' ? [[input]] : [[definition], [input]])
    if (failure === 'oversized') expect(native.read).not.toHaveBeenCalled()
  })

  it('does not truncate invalid lookup keys into different words', async () => {
    const { systemDefinition } = await import('../src/main/native/dictionary-macos.js')
    for (const key of ['', 'a'.repeat(121), 'word\u0000']) expect(systemDefinition(key)).toBeNull()
    expect(native.create).not.toHaveBeenCalled()
  })

  it('does not access native dictionary bindings outside macOS', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const { systemDefinition, systemDictionaryAvailable } = await import('../src/main/native/dictionary-macos.js')
    expect(systemDictionaryAvailable()).toBe(false)
    expect(systemDefinition('reproducible')).toBeNull()
    expect(native.load).not.toHaveBeenCalled()
    expect(native.struct).not.toHaveBeenCalled()
  })

  it('handles missing frameworks and allocation failure without leaking', async () => {
    native.load.mockImplementationOnce(() => { throw new Error('not installed') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let dictionary = await import('../src/main/native/dictionary-macos.js')
    expect(dictionary.systemDefinition('reproducible')).toBeNull()
    expect(dictionary.systemDictionaryAvailable()).toBe(false)
    expect(native.load).toHaveBeenCalledTimes(1)
    vi.resetModules()
    native.create.mockReturnValue(null)
    dictionary = await import('../src/main/native/dictionary-macos.js')
    expect(dictionary.systemDefinition('reproducible')).toBeNull()
    expect(native.release).not.toHaveBeenCalled()
  })
})
