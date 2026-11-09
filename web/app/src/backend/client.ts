// Backend client (design section 8). The Web_App talks to the Backend through
// the Vite dev proxy, so every URL is relative (`/api/...`) and no CORS setup
// is needed in the browser. Pure module: no React, no store imports.

/** Base URL for the Backend; empty means same origin (the Vite proxy forwards /api). */
export const API_BASE = ''

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Thrown when the Backend cannot be reached at all (connection refused, DNS, proxy 5xx without JSON). */
export class BackendUnreachableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackendUnreachableError'
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

/** Reads a JSON body; returns null when the body is empty or not JSON. */
export async function readJson(res: Response): Promise<unknown> {
  let text: string
  try {
    text = await res.text()
  } catch {
    return null
  }
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Default fetch, resolved at call time so tests can replace `globalThis.fetch`. */
export function defaultFetch(): FetchLike {
  return (input, init) => globalThis.fetch(input, init)
}

/** Decodes standard base64 to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
