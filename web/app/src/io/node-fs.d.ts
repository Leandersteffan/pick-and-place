// Minimal typing for the one Node API the io tests use to read fixture files.
// The app has no @types/node; tests run in Vitest's Node environment.
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array
  export function readdirSync(path: string | URL): string[]
}
