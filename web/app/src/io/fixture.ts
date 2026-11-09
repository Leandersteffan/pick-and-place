// "Load demo": fetch the Fixture served by vite from web/fixtures (publicDir),
// first manifest.json, then every file it lists. Thin DOM wrapper over importFiles.
import { importFiles, type ImportResult } from './importer'
import { MANIFEST_NAME, readManifest } from './manifest'

export const FIXTURE_BASE = '/demo-v1/'

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url)
  if (!response.ok) return null
  return new Uint8Array(await response.arrayBuffer())
}

export async function loadFixture(base = FIXTURE_BASE): Promise<ImportResult> {
  let manifestBytes: Uint8Array | null
  try {
    manifestBytes = await fetchBytes(`${base}${MANIFEST_NAME}`)
  } catch (err) {
    return { ok: false, error: `Could not fetch ${base}${MANIFEST_NAME}: ${(err as Error).message}` }
  }
  if (!manifestBytes) return { ok: false, error: `${base}${MANIFEST_NAME} was not found` }
  const read = readManifest(manifestBytes)
  if (!read.ok) return { ok: false, error: read.error }

  const files: Record<string, Uint8Array> = { [MANIFEST_NAME]: manifestBytes }
  const names = Object.keys(read.manifest.files)
  const fetched = await Promise.all(
    names.map((name) => fetchBytes(`${base}${encodeURIComponent(name)}`).catch(() => null)),
  )
  names.forEach((name, i) => {
    const bytes = fetched[i]
    // A missing file becomes a hash-mismatch or missing-mesh warning in importFiles.
    if (bytes) files[name] = bytes
  })
  return importFiles(files, 'fixture', { name: 'demo-v1', inputLabel: `the demo fixture (${base})` })
}
