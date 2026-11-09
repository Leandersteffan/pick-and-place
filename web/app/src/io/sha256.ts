// SHA-256 of raw bytes as lowercase hex, through Web Crypto.
// `globalThis.crypto.subtle` exists in browsers (secure context, which includes
// http://127.0.0.1) and in Node 20, so the same code runs in Vitest.

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer: the input may be a view into a larger buffer
  // (fflate output), and digest() hashes the whole underlying buffer otherwise.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  const view = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, '0')
  return hex
}
