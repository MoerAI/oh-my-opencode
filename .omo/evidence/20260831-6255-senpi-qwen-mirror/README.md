# Issue #6255 Senpi fallback mirror QA

## What was tested

- `bun test packages/senpi-task/src/agents/builtin/fallback-chains.test.ts`
  - Proves the Senpi explore and librarian fallback table matches the intended pinned transcription.
- `bun test packages/model-core/src/model-requirements-agents.test.ts`
  - Confirms the canonical model-core chains still select `qwen3.7-plus`.
- `bun test packages/senpi-task/src/agents/builtin/builtin-agents.test.ts`
  - Checks the four curated Senpi agents and their runtime shape.
- `bun run typecheck:packages`
  - Type-checks all workspace packages.
- Runtime export probe:

  ```sh
  bun -e 'import { AGENT_FALLBACK_CHAINS } from "./packages/senpi-task/src/agents/builtin/fallback-chains.ts"; /* assert explore/librarian qwen rung */'
  ```

## What was observed

- Failing-first proof after updating only the independent transcription:
  - 5 passed, 1 failed.
  - Both failures reported received `qwen3.5-plus` where `qwen3.7-plus` was expected.
- After syncing the production mirror:
  - Mirror tests: 6 passed, 0 failed, 130 assertions.
  - Canonical model-core tests: 12 passed, 0 failed, 80 assertions.
  - Curated agent tests: 6 passed, 0 failed, 79 assertions.
  - Package typecheck exited successfully.
  - Runtime probe printed:

    ```text
    explore: qwen3.7-plus
    librarian: qwen3.7-plus
    ```
- Initial GitHub CI correctly rejected the source-only commit at `Verify committed Senpi plugin bundle is current`.
- After running `node packages/omo-senpi/plugin/scripts/build-extension.mjs`:
  - the four committed executable bundles containing `senpi-task` were regenerated;
  - `bun test packages/omo-senpi/plugin/scripts/build-extension.test.mjs` passed 12 tests with 27 assertions.

## Why this is enough

The regression is a literal drift between a hand-maintained Senpi table and its canonical model-core source. The failing equality test names both stale rungs, the green tests cover both copies, and the runtime import proves consumers receive the corrected exported values.

## What was omitted

Full dependency-install and compiler logs were summarized because they contain no additional behavioral evidence. No credentials, environment dumps, provider tokens, or private local configuration are included.
