/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/** Minimal stand-in for HTMLAudioElement — the player only uses these four members. */
class FakeAudio {
  static instances: FakeAudio[] = []
  paused = false
  currentTime = 0
  private handlers: Record<string, (() => void)[]> = {}

  constructor(public src: string) {
    FakeAudio.instances.push(this)
  }
  addEventListener(event: string, fn: () => void): void {
    ;(this.handlers[event] ??= []).push(fn)
  }
  play(): Promise<void> {
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  /** Simulate the clip reaching its end. */
  finish(): void {
    this.handlers['ended']?.forEach((fn) => fn())
  }
}

vi.stubGlobal('Audio', FakeAudio)

const { beginAudioRequest, isCurrentAudioRequest, playAudio, stopAudio, isPlaying } = await import('../src/renderer/popup/player.js')

describe('popup audio channel', () => {
  beforeEach(() => {
    stopAudio()
    FakeAudio.instances = []
  })

  it('starting a clip replaces the one already playing', async () => {
    // Several speaker buttons share one channel, so two must never overlap.
    const firstStopped = vi.fn()
    await playAudio('a.mp3', firstStopped)
    await playAudio('b.mp3', vi.fn())

    expect(FakeAudio.instances[0].paused).toBe(true)
    expect(firstStopped).toHaveBeenCalled()
    expect(isPlaying()).toBe(true)
  })

  it('stopAudio halts playback and notifies the owner', async () => {
    const stopped = vi.fn()
    await playAudio('a.mp3', stopped)
    stopAudio()

    expect(FakeAudio.instances[0].paused).toBe(true)
    expect(stopped).toHaveBeenCalledOnce()
    expect(isPlaying()).toBe(false)
  })

  it('clears state when a clip ends on its own', async () => {
    const stopped = vi.fn()
    await playAudio('a.mp3', stopped)
    FakeAudio.instances[0].finish()

    expect(stopped).toHaveBeenCalledOnce()
    expect(isPlaying()).toBe(false)
  })

  it('a superseded clip ending does not stop the current one', async () => {
    // The ended event can arrive after a newer clip has taken over.
    const firstStopped = vi.fn()
    const secondStopped = vi.fn()
    await playAudio('a.mp3', firstStopped)
    await playAudio('b.mp3', secondStopped)

    FakeAudio.instances[0].finish()

    expect(isPlaying()).toBe(true)
    expect(secondStopped).not.toHaveBeenCalled()
    expect(firstStopped).toHaveBeenCalledOnce()
  })

  it('invalidates pending audio on close and when a later button takes the channel', async () => {
    const stopped = vi.fn()
    const old = beginAudioRequest(stopped)
    stopAudio()
    await playAudio('late.mp3', stopped, old)
    expect(isCurrentAudioRequest(old)).toBe(false)
    expect(FakeAudio.instances).toHaveLength(0)
    expect(stopped).toHaveBeenCalledOnce()
    const next = beginAudioRequest(vi.fn())
    await playAudio('new.mp3', vi.fn(), next)
    expect(FakeAudio.instances.map(audio => audio.src)).toEqual(['new.mp3'])
  })

  it('stopping when nothing plays is harmless', () => {
    expect(() => stopAudio()).not.toThrow()
    expect(isPlaying()).toBe(false)
  })
})
