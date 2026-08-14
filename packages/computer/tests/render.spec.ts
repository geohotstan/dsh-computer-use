/**
 * Pure helper contract: canonical spelling, the click addressing rule, the
 * action-request sanity rules, the bounded-tree truncation contract, and the
 * model-facing envelope. These are the exact helpers providers and the tool
 * consumer build on, so the seam pins their edges once.
 */

import { describe, expect, it } from 'vitest'
import {
  TREE_TRUNCATED_MARK,
  assertActionRequest,
  assertClickAddressing,
  formatAppStateEnvelope,
  normalizeDirection,
  normalizeMouseButton,
  truncateTreeChars,
  truncateTreeText,
} from '../src/render.ts'

describe('normalizeDirection', () => {
  it('maps every long and single-letter spelling to its canonical form', () => {
    expect(normalizeDirection('up')).toBe('up')
    expect(normalizeDirection('d')).toBe('down')
    expect(normalizeDirection('left')).toBe('left')
    expect(normalizeDirection('r')).toBe('right')
  })
})

describe('normalizeMouseButton', () => {
  it('maps every long and single-letter spelling to its canonical form', () => {
    expect(normalizeMouseButton('left')).toBe('left')
    expect(normalizeMouseButton('m')).toBe('middle')
    expect(normalizeMouseButton('right')).toBe('right')
  })
})

describe('assertClickAddressing', () => {
  it('accepts exactly one addressing mode', () => {
    expect(() => { assertClickAddressing({ app: 'a', elementIndex: 0 }) }).not.toThrow()
    expect(() => { assertClickAddressing({ app: 'a', x: 1, y: 2 }) }).not.toThrow()
  })

  it('rejects both modes together and neither mode', () => {
    expect(() => { assertClickAddressing({ app: 'a' }) }).toThrow(/exactly one addressing mode/)
    expect(() => { assertClickAddressing({ app: 'a', elementIndex: 0, x: 1, y: 2 }) }).toThrow(/exactly one addressing mode/)
  })

  it('rejects a half coordinate pair', () => {
    expect(() => { assertClickAddressing({ app: 'a', x: 1 }) }).toThrow(/require both x and y/)
    expect(() => { assertClickAddressing({ app: 'a', y: 1 }) }).toThrow(/require both x and y/)
  })
})

describe('assertActionRequest', () => {
  it('accepts a valid action request', () => {
    expect(() => { assertActionRequest({ app: 'TextEdit', elementIndex: 2, pages: 0.5 }) }).not.toThrow()
    expect(() => { assertActionRequest({ app: 'TextEdit', elementIndex: 0, action: 'Raise' }) }).not.toThrow()
  })

  it('rejects empty app identifiers', () => {
    expect(() => { assertActionRequest({ app: '  ' }) }).toThrow(/app must be a non-empty string/)
  })

  it('rejects invalid element indexes and page counts', () => {
    expect(() => { assertActionRequest({ app: 'a', elementIndex: -1 }) }).toThrow(/non-negative integer/)
    expect(() => { assertActionRequest({ app: 'a', elementIndex: 1.5 }) }).toThrow(/non-negative integer/)
    expect(() => { assertActionRequest({ app: 'a', pages: 0 }) }).toThrow(/positive number/)
    expect(() => { assertActionRequest({ app: 'a', pages: Number.NaN }) }).toThrow(/positive number/)
  })

  it('rejects empty action and key labels', () => {
    expect(() => { assertActionRequest({ app: 'a', action: '' }) }).toThrow(/action must be a non-empty string/)
    expect(() => { assertActionRequest({ app: 'a', key: ' ' }) }).toThrow(/key must be a non-empty string/)
  })
})

describe('truncateTreeText', () => {
  it('passes a text at or under the bound through unchanged', () => {
    expect(truncateTreeText('hello', 5)).toEqual({ text: 'hello', truncated: false })
    expect(truncateTreeText('hello', 100)).toEqual({ text: 'hello', truncated: false })
  })

  it('drops the tail and appends the mark when the text exceeds the bound', () => {
    const { text, truncated } = truncateTreeText('0'.repeat(100), 75)
    expect(truncated).toBe(true)
    expect(text.endsWith(TREE_TRUNCATED_MARK)).toBe(true)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(75)
    expect(text.startsWith('0')).toBe(true)
  })

  it('emits the mark itself cut to the bound when the bound cannot hold the mark', () => {
    const { text, truncated } = truncateTreeText('0123456789', 1)
    expect(truncated).toBe(true)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(1)
    expect(text).toBe(TREE_TRUNCATED_MARK.slice(0, 1))
  })

  it('respects multi-byte characters without splitting them', () => {
    const { text, truncated } = truncateTreeText('汉字'.repeat(14), 80)
    expect(truncated).toBe(true)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(80)
    expect(text.startsWith('汉字')).toBe(true)
    expect(text.endsWith(TREE_TRUNCATED_MARK)).toBe(true)
  })
})

describe('formatAppStateEnvelope', () => {
  it('returns the tree text verbatim (the official surface ships no wrapper)', () => {
    expect(formatAppStateEnvelope({ app: 'com.apple.TextEdit', text: '0 window' })).toBe('0 window')
  })
})

describe('truncateTreeChars', () => {
  it('caps the text at the character bound and reports the cut', () => {
    expect(truncateTreeChars('hello world', 5)).toEqual({ text: 'hello', truncated: true })
    expect(truncateTreeChars('hello', 5)).toEqual({ text: 'hello', truncated: false })
    expect(truncateTreeChars('hello', 10)).toEqual({ text: 'hello', truncated: false })
  })
})
