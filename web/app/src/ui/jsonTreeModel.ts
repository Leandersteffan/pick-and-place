// Pure helpers for the read-only JSON tree in the side panel. No React import.

export type JsonLeafKind = 'string' | 'number' | 'boolean' | 'null' | 'other'

/** Child entries of an object or array, or null for a leaf. */
export function jsonChildren(value: unknown): [string, unknown][] | null {
  if (Array.isArray(value)) return value.map((v, i) => [String(i), v])
  if (value !== null && typeof value === 'object') return Object.entries(value as Record<string, unknown>)
  return null
}

/** Collapsed summary of a branch: `{ 6 keys }` or `[ 3 items ]`. */
export function jsonSummary(value: unknown): string {
  if (Array.isArray(value)) return `[ ${value.length} ${value.length === 1 ? 'item' : 'items'} ]`
  const n = Object.keys(value as object).length
  return `{ ${n} ${n === 1 ? 'key' : 'keys'} }`
}

/** Leaf text as JSON would print it, plus its kind for colouring. */
export function jsonLeaf(value: unknown): { text: string; kind: JsonLeafKind } {
  if (value === null) return { text: 'null', kind: 'null' }
  switch (typeof value) {
    case 'string':
      return { text: JSON.stringify(value), kind: 'string' }
    case 'number':
      return { text: Number.isFinite(value) ? String(value) : 'null', kind: 'number' }
    case 'boolean':
      return { text: String(value), kind: 'boolean' }
    default:
      return { text: String(value), kind: 'other' }
  }
}

/** Human-readable byte count: "812 B", "14.2 kB", "1.31 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1e6) return `${(bytes / 1000).toFixed(1)} kB`
  return `${(bytes / 1e6).toFixed(2)} MB`
}
