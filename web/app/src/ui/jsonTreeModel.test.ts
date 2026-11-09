import { describe, expect, it } from 'vitest'
import { formatBytes, jsonChildren, jsonLeaf, jsonSummary } from './jsonTreeModel'

describe('jsonTreeModel', () => {
  it('splits branches into entries and leaves into null', () => {
    expect(jsonChildren({ a: 1, b: [2] })).toEqual([['a', 1], ['b', [2]]])
    expect(jsonChildren([5, 6])).toEqual([['0', 5], ['1', 6]])
    expect(jsonChildren(3)).toBeNull()
    expect(jsonChildren(null)).toBeNull()
  })

  it('summarises and prints leaves like JSON', () => {
    expect(jsonSummary({ x: 1, y: 2 })).toBe('{ 2 keys }')
    expect(jsonSummary([1])).toBe('[ 1 item ]')
    expect(jsonLeaf('pcb')).toEqual({ text: '"pcb"', kind: 'string' })
    expect(jsonLeaf(2.8)).toEqual({ text: '2.8', kind: 'number' })
    expect(jsonLeaf(false)).toEqual({ text: 'false', kind: 'boolean' })
    expect(jsonLeaf(null)).toEqual({ text: 'null', kind: 'null' })
  })

  it('formats byte counts', () => {
    expect(formatBytes(84)).toBe('84 B')
    expect(formatBytes(14_200)).toBe('14.2 kB')
    expect(formatBytes(1_310_000)).toBe('1.31 MB')
  })
})
