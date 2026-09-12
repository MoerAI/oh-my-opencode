# PR 7491 base refresh

## What was tested

Merged dev `6be71c45e6afc21b3865b14a0c96021702bac0cd` into PR head
`633dae6554a34a6d4a26bd514d4433d5f0f42625` without conflicts.
No new production logic was authored.

- Bun 1.4.0: `bun test packages/omo-native/test`.
- Node 24.18.0 syntax checks for the native entry and four changed JS modules.
- `tsgo --noEmit -p packages/omo-native/tsconfig.json`.
- `bun run build:omo-native`.
- Twenty-two isolated executions of the actual native launcher and installed
  Senpi 2026.9.12, split between Node and Bun execution paths.

## What was observed

The native suite passed: 304 tests, 871 assertions, 31 files, zero failures
or skips. Type/syntax checks passed. The native build found all 40 required
artifacts.

Real executions covered filename/header mismatch, partial and ambiguous IDs,
header lookup, session-directory overrides, argument separators, explicit
paths, quoting, and version output. Twenty diagnostic cases used version
exit; two cases exercised actual engine rejection without version exit.
Both rejection cases emitted the diagnostic and then the engine's missing
session error, exiting 1 as expected.

Every child used a synthetic, allowlisted environment with isolated home,
agent, XDG, cache and temporary paths. No credentials were inherited.
Protected host configuration hashes and existing dirty checkout hashes were
unchanged. All children exited.

## Why this is sufficient

The refresh preserves the PR's diagnostic behavior while incorporating the
upstream launcher changelog support. Package tests, type checks, payload
build and the actual launcher/engine boundary cover the integration.

## Limitations and omissions

Windows execution and successful interactive session resumption were not
tested. LSP rejected access to the sibling worktree; command-line validators
passed instead. Historical evidence whitespace warnings remain unchanged.
Initial validation used an older Bun accidentally; the accepted results
above are from the subsequent single complete Bun 1.4.0 run.

Detailed logs and the replay driver are retained locally. Machine-specific
paths, host hashes, private configuration and raw environment values are
omitted from this public summary.
