# kibitzer_summary telemetry event — QA evidence (2026-09-16)

Issue #8389 · PR #8390 · branch `feat/kibitzer-telemetry-summary` · base `dev` @ `ccbd810c7`.

## What was tested

One new once-per-session omo-native event, `kibitzer_summary`, plus the observer seam that feeds it
from the memory sidecar and the schema/QA surfaces that enumerate native events.

| Surface | Command | What it was meant to prove |
|---|---|---|
| Summary builder + registry | `bun test packages/omo-senpi/src/components/telemetry/omo-native-kibitzer-summary.test.ts` | field math (nudge counts, cadence quantiles, token sums, generations), idle-session suppression, one event per `session_shutdown`, no cross-session mixing, detach, model masking, allowlist conformance |
| Regression scope | `bun test packages/omo-senpi/src/components/telemetry packages/omo-senpi/src/components/memory/kibitzer` | the schema-registry extraction and the sidecar wiring changed nothing else; includes `schema-doc.test.ts` (generated reference is byte exact) |
| Native telemetry QA surface | `bun test script/qa` | the QA allowlist coverage source accepts exactly the declared native events |
| Bundle freshness | `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` on linux/x86_64 + node 24.20.0 | the committed plugin bundles match a rebuild on CI's platform |

All test runs executed on a remote ARM64 compute host (never the session machine), in a fresh worktree
of the pushed branch with `bun install --frozen-lockfile`.

## What was observed

At final HEAD `c500ff5e2`:

```
--- qa allowlist test:
 2 pass / 0 fail / 4 expect() calls        (script/qa/omo-native-telemetry-qa.test.ts)
--- telemetry + kibitzer scope:
 425 pass / 0 fail / 2244 expect() calls   (45 files)
--- script/qa scope:
 51 pass / 0 fail / 71 expect() calls      (5 files)
```

Failing-first proof, captured before the implementation existed (stubbed builder/registry, same test file):

```
 3 pass
 7 fail
 6 expect() calls
```

Those 7 were assertion failures (`expect(received).toEqual(expected)` on `nudges_delivered`, on the
captured-event list, and on snapshot presence), not import errors: a first RED attempt that failed on a
missing export was discarded and re-captured, because an import error proves nothing.

Bundle freshness, with a control run to separate this change from platform noise (same host, same node):

| artifact | unmodified `dev` (control) | this branch | committed |
|---|---|---|---|
| `plugin/extensions/omo.js` | clean | dirty | yes |
| `plugin/extensions/omo-init-deep-advisor.js` | clean | dirty | yes |
| `omo-codex/.../install-local.mjs` | **dirty** | dirty | no — install-generated, dirty on `dev` too |

Both committed artifacts were verified byte-identical to the Linux build before committing
(`omo.js` sha256 `b794a124…`, 1,190,148 bytes; `omo-init-deep-advisor.js` sha256 `11dcfcea…`, 76,404 bytes).

## Why it is enough

- The event's whole contract is a pure function from accumulated per-session signals to a property bag,
  plus one registration-order rule. Both are covered directly: the builder by value assertions, the
  registration by driving `session_shutdown` twice through the fake extension API and asserting exactly
  one capture, plus a two-session case that would catch a shared accumulator.
- The privacy boundary is enforced by construction rather than by assertion: the observer seam carries
  counts only, so a nudge path or hint has no route into the event. The allowlist test additionally
  asserts no key matches the forbidden `_path`/`_text`/`_prompt` suffixes, and one test asserts a private
  model id never appears verbatim in the serialized payload.
- The regression scope covers every module that the schema-registry extraction moved or re-exported.

## What was omitted

- **No live-session drive of an actual sidecar wake.** `kibitzer_summary` is emitted only when the memory
  sidecar actually woke, which needs recall enabled, a committed memory corpus, and a child model; the
  scripted telemetry QA harness has no memory setup. Rather than fake an emission to satisfy the
  harness's per-event presence loop, the event is declared in the QA coverage set and listed as
  session-conditional, so a dropped or misspelled event still fails the gate while an unproducible
  emission is not demanded. This is the honest limit of the automated evidence here.
- Raw install logs and provider payloads are not copied into this file; no tokens, auth headers or
  environment dumps were captured.
