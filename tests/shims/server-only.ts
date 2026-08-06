// Vitest shim for the "server-only" package.
//
// Next.js resolves "server-only" to a build-time guard that throws if the
// importing module ever reaches a client bundle. Outside Next's bundler
// (i.e. under Vitest/Node), that guard has no bundle to check, so the
// real package is a no-op here too — this file intentionally does nothing.
export {};
