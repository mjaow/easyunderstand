import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig, LlmProviderId } from '../src/shared/types.js'
import { DEFAULT_CONFIG } from '../src/core/config.js'

const preconnect = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ session: { defaultSession: { preconnect } } }))
import { startLlmConnectionWarmup, warmLlmConnection } from '../src/main/llm-connection.js'

function config(provider: LlmProviderId = 'azure', baseUrl = 'https://example.openai.azure.com/openai/responses?api-version=2025-04-01-preview'): AppConfig {
  return { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, provider, baseUrls: { azure: baseUrl } } }
}

afterEach(() => { vi.useRealTimers(); preconnect.mockReset() })

describe('everyday model connection preparation', () => {
  it('opens one socket to the configured Azure origin without sending an API request', () => {
    warmLlmConnection(config())
    expect(preconnect).toHaveBeenCalledTimes(1)
    expect(preconnect).toHaveBeenCalledWith({ url: 'https://example.openai.azure.com', numSockets: 1 })
  })

  it('ignores other providers and invalid endpoints', () => {
    warmLlmConnection(config('openai'))
    warmLlmConnection(config('ollama'))
    warmLlmConnection(config('azure', 'invalid'))
    warmLlmConnection(config('azure', 'https://example.com/openai/responses?api-key=secret'))
    expect(preconnect).not.toHaveBeenCalled()
  })

  it('keeps startup usable when socket preparation fails', () => {
    preconnect.mockImplementationOnce(() => { throw new Error('offline') })
    expect(() => warmLlmConnection(config())).not.toThrow()
    warmLlmConnection(config())
    expect(preconnect).toHaveBeenCalledTimes(2)
  })

  it('refreshes idle connections using current settings and stops on shutdown', () => {
    vi.useFakeTimers()
    let current = config()
    const stop = startLlmConnectionWarmup(() => current)
    expect(preconnect).toHaveBeenCalledTimes(1)
    current = config('azure', 'https://second.openai.azure.com/openai/responses?api-version=2025-04-01-preview')
    vi.advanceTimersByTime(30000)
    expect(preconnect).toHaveBeenLastCalledWith({ url: 'https://second.openai.azure.com', numSockets: 1 })
    current = config('openai')
    vi.advanceTimersByTime(30000)
    expect(preconnect).toHaveBeenCalledTimes(2)
    current = config()
    stop()
    vi.advanceTimersByTime(30000)
    expect(preconnect).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
