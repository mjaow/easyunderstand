import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  bindings: new Map<string, () => void>(),
  unavailable: new Set<string>(),
  stored: ''
}))
vi.mock('electron', () => {
  const key = (value: string): string => value.toUpperCase().replace(/COMMANDORCONTROL|CMDORCTRL/g, process.platform === 'darwin' ? 'COMMAND' : 'CONTROL').replace(/CTRL/g, 'CONTROL')
  return {
    app: { getPath: () => '/unused' }, safeStorage: {},
    globalShortcut: {
      isRegistered: (value: string) => fixture.bindings.has(key(value)),
      register: (value: string, handler: () => void) => {
        const normalized = key(value)
        if (fixture.bindings.has(normalized) || fixture.unavailable.has(value)) return false
        fixture.bindings.set(normalized, handler)
        return true
      },
      unregister: (value: string) => fixture.bindings.delete(key(value)),
      unregisterAll: () => fixture.bindings.clear()
    }
  }
})
vi.mock('node:fs', () => ({
  readFileSync: () => fixture.stored, existsSync: () => !!fixture.stored,
  writeFileSync: (_file: string, value: string) => { fixture.stored = value }, mkdirSync: () => {}
}))
import { DEFAULT_CONFIG, loadConfig, saveConfig, __resetCache } from '../src/core/config.js'
import { bindingsFor, FALLBACKS, registerHotkeys } from '../src/main/hotkeys.js'

beforeEach(() => {
  fixture.bindings.clear(); fixture.unavailable.clear(); fixture.stored = ''; __resetCache()
})

describe('independent selection hotkeys', () => {
  it('adds defaults to old settings and persists custom keys independently', () => {
    fixture.stored = JSON.stringify({ hotkeys: { explain: 'F8' } })
    expect(loadConfig().hotkeys).toEqual({ ...DEFAULT_CONFIG.hotkeys, explain: 'F8' })
    saveConfig({ hotkeys: { ...loadConfig().hotkeys, refine: 'F9' } })
    __resetCache()
    expect(loadConfig().hotkeys).toEqual({ ...DEFAULT_CONFIG.hotkeys, explain: 'F8', refine: 'F9' })
    saveConfig({ hotkeys: { ...loadConfig().hotkeys, summarize: 'F10' } })
    __resetCache()
    expect(loadConfig().hotkeys).toEqual({ explain: 'F8', refine: 'F9', summarize: 'F10' })
  })

  it('binds all defaults to their own handlers', () => {
    const handlers = { explain: vi.fn(), refine: vi.fn(), summarize: vi.fn() }
    const result = registerHotkeys(bindingsFor(DEFAULT_CONFIG, handlers))
    expect(result.resolved).toEqual(DEFAULT_CONFIG.hotkeys)
    expect(result.failed).toEqual([])
    for (const handler of fixture.bindings.values()) handler()
    expect(handlers.explain).toHaveBeenCalledTimes(1)
    expect(handlers.refine).toHaveBeenCalledTimes(1)
    expect(handlers.summarize).toHaveBeenCalledTimes(1)
  })

  it('resolves a duplicate physical shortcut without losing either action', () => {
    const config = { ...DEFAULT_CONFIG, hotkeys: {
      ...DEFAULT_CONFIG.hotkeys,
      explain: 'CommandOrControl+Alt+E',
      refine: process.platform === 'darwin' ? 'Command+Alt+E' : 'Control+Alt+E'
    } }
    const result = registerHotkeys(bindingsFor(config, { explain: vi.fn(), refine: vi.fn(), summarize: vi.fn() }))
    expect(result.resolved).toEqual(DEFAULT_CONFIG.hotkeys)
    expect(result.reassigned).toEqual([expect.objectContaining({ id: 'refine' })])
    expect(fixture.bindings.size).toBe(3)
  })

  it('reserves a configured refinement key before choosing an explanation fallback', () => {
    const config = { ...DEFAULT_CONFIG, hotkeys: { ...DEFAULT_CONFIG.hotkeys, explain: 'Control+C', refine: FALLBACKS.explain[0] } }
    const result = registerHotkeys(bindingsFor(config, { explain: vi.fn(), refine: vi.fn(), summarize: vi.fn() }))
    expect(result.resolved.refine).toBe(config.hotkeys.refine)
    expect(result.resolved.explain).toBe(FALLBACKS.explain[1])
    expect(result.reassigned).toEqual([expect.objectContaining({ id: 'explain' })])
  })

  it('falls back when the refinement shortcut is taken and reports exhausted alternatives', () => {
    fixture.unavailable.add(DEFAULT_CONFIG.hotkeys.refine)
    const bindings = bindingsFor(DEFAULT_CONFIG, { explain: vi.fn(), refine: vi.fn(), summarize: vi.fn() })
    expect(registerHotkeys(bindings).resolved.refine).toBe(FALLBACKS.refine[1])
    FALLBACKS.refine.forEach(key => fixture.unavailable.add(key))
    const result = registerHotkeys(bindings)
    expect(result.resolved.explain).toBe(DEFAULT_CONFIG.hotkeys.explain)
    expect(result.resolved.refine).toBe('')
    expect(result.failed).toEqual([expect.objectContaining({ id: 'refine' })])
  })

  it('keeps existing custom shortcuts when summary conflicts or cannot bind', () => {
    const config = { ...DEFAULT_CONFIG, hotkeys: { explain: 'F8', refine: 'F9', summarize: 'F8' } }
    const bindings = bindingsFor(config, { explain: vi.fn(), refine: vi.fn(), summarize: vi.fn() })
    expect(registerHotkeys(bindings).resolved).toEqual({ ...config.hotkeys, summarize: FALLBACKS.summarize[0] })
    FALLBACKS.summarize.forEach(key => fixture.unavailable.add(key))
    const result = registerHotkeys(bindings)
    expect(result.resolved).toEqual({ explain: 'F8', refine: 'F9', summarize: '' })
    expect(result.failed).toEqual([expect.objectContaining({ id: 'summarize' })])
  })
})
