// Vitest stub for the `server-only` package.
//
// The real package's `exports` map throws unconditionally unless resolved
// under Next's `react-server` condition (see `node_modules/server-only`),
// which Vitest's resolver does not set. Aliasing the bare specifier to this
// empty module (see vitest.config.ts) lets modules that import 'server-only'
// for its guard load under test, without weakening the guard in the real
// Next.js build (which resolves the real package, not this stub).
export {};
