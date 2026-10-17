import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Element {
  role: string
  title?: string
  value?: string
  parent?: Element
  children?: Element[]
}
const fixture = vi.hoisted(() => ({
  leaf: null as Element | null,
  trusted: true,
  release: vi.fn(),
  attribute: vi.fn((element: Element, name: string) =>
    ({ AXRole: element.role, AXTitle: element.title, AXValue: element.value })[name] ?? '')
}))
vi.mock('../src/main/native/ax.js', () => ({
  axAvailable: () => true, axTrusted: () => fixture.trusted,
  elementAtPoint: () => fixture.leaf,
  attributeString: fixture.attribute,
  attributeStringList: () => [], elementRect: () => null,
  attributeElement: (element: Element) => element.parent ?? null,
  mapAttributeElements: (element: Element, _name: string, fn: (child: Element) => unknown, limit = 512) =>
    (element.children ?? []).slice(0, limit).map(fn),
  release: fixture.release
}))
import { readLinkAtPointMac } from '../src/main/a11y-macos.js'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  fixture.leaf = null
  fixture.trusted = true
})
afterEach(() => vi.restoreAllMocks())

describe('macOS hovered link capture', () => {
  it('reads the complete title across nested nodes, without appended YouTube metadata', () => {
    const link: Element = { role: 'AXLink', title: 'How telescopes work by Science Channel 100 views' }
    const heading: Element = { role: 'AXHeading', parent: link }
    const first: Element = { role: 'AXStaticText', value: 'How telescopes', parent: heading }
    const second: Element = { role: 'AXStaticText', value: 'work', parent: heading }
    heading.children = [first, second]
    link.children = [heading]
    fixture.leaf = first
    expect(readLinkAtPointMac(300, 200)).toBe('How telescopes work')
    expect(fixture.release.mock.calls).toEqual([[first], [heading], [link]])
  })

  it('uses an accessible name for image-only links without reading a destination', () => {
    fixture.leaf = { role: 'AXLink', title: '探索宇宙 — new discoveries' }
    expect(readLinkAtPointMac(300, 200)).toBe('探索宇宙 — new discoveries')
    expect(fixture.attribute.mock.calls.some(([, attribute]) => attribute === 'AXURL')).toBe(false)
  })

  it.each(['AXTextField', 'AXTextArea', 'AXComboBox', 'AXWebArea', 'AXWindow'])('does not climb out of %s to find an unrelated link', role => {
    fixture.leaf = { role, parent: { role: 'AXLink', title: 'Unrelated title' } }
    expect(readLinkAtPointMac(300, 200)).toBeNull()
    expect(fixture.release.mock.calls).toEqual([[fixture.leaf]])
  })

  it('returns no title for ordinary text, unnamed links, or denied permissions', () => {
    fixture.leaf = { role: 'AXStaticText', value: 'Ordinary heading' }
    expect(readLinkAtPointMac(300, 200)).toBeNull()
    fixture.leaf = { role: 'AXLink' }
    expect(readLinkAtPointMac(300, 200)).toBeNull()
    fixture.trusted = false
    fixture.leaf = { role: 'AXLink', title: 'Should not read' }
    expect(readLinkAtPointMac(300, 200)).toBeNull()
  })

  it('bounds pathological ancestor and child trees and releases references on failure', () => {
    const cycle: Element = { role: 'AXGroup' }
    cycle.parent = cycle
    fixture.leaf = cycle
    expect(readLinkAtPointMac(300, 200)).toBeNull()
    expect(fixture.attribute.mock.calls.length).toBeLessThan(20)
    const link: Element = { role: 'AXLink', title: 'Accessible fallback' }
    link.children = [link]
    fixture.leaf = link
    expect(readLinkAtPointMac(300, 200)).toBe('Accessible fallback')
    fixture.release.mockClear()
    fixture.attribute.mockImplementationOnce(() => { throw new Error('Element disappeared') })
    expect(readLinkAtPointMac(300, 200)).toBeNull()
    expect(fixture.release).toHaveBeenCalledWith(link)
  })
})
