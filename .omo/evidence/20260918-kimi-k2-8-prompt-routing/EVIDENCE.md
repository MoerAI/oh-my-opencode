# QA evidence - Kimi K2.8 Preview shares the K2.7 prompt (#8466)

Date: 2026-09-18
Change: `model-core` gains `isKimiK28Model` / `isKimiK2CodeModel`; the four opencode prompt-routing sites (prompts-core variant table, Sisyphus family resolver, Sisyphus Junior prompt source, Metis prompt switch) resolve the K2 coding family instead of K2.7 alone.

## What was tested

A real `opencode serve` (v1.18.18) with this plugin loaded from source
(`"plugin": ["file://<repo>/packages/omo-opencode/src/index.ts"]`), driven through its
HTTP surface: `GET /agent` returns every agent's baked `prompt`, which is exactly what
the routing change selects. For each model id under test the sandbox rewrites
`~/.omo/omo.jsonc` to pin `agents.sisyphus.model` and `agents.metis.model`, restarts the
server, and classifies the returned prompt body by a marker unique to each variant:

- `running on Kimi K2.7` -> the K2.7 Sisyphus prompt
- `You are Sisyphus - an AI orchestrator from OhMyOpenCode` -> the K2.6 Sisyphus prompt
- `Kimi K2.7` inside the Metis prompt -> `METIS_K2_7_SYSTEM_PROMPT`

Driver: [`qa-live-opencode.sh`](./qa-live-opencode.sh), run once against a worktree at
`origin/dev` (`9ba073a8b`, "before") and once against this branch ("after").

```
bash qa-live-opencode.sh <repo> before   # -> before-agent-prompts.txt
bash qa-live-opencode.sh <repo> after    # -> after-agent-prompts.txt
```

## Isolation

Every run allocates a fresh `mktemp -d` and points `XDG_DATA_HOME`, `XDG_CONFIG_HOME`,
`XDG_CACHE_HOME`, `XDG_STATE_HOME` **and `HOME`** inside it, so both opencode's database
and the plugin's `~/.omo/omo.jsonc` are sandbox-local; `OPENCODE_DISABLE_AUTOUPDATE` and
`OPENCODE_DISABLE_MODELS_FETCH` are set. The host `~/.config/opencode`,
`~/.local/share/opencode/opencode.db` and `~/.omo` are never read or written - the
sandbox `HOME` makes that structural rather than a promise, and the trap removes the
sandbox on every exit path.

## What was observed

| model id | before (dev) | after (this branch) |
|---|---|---|
| `kimi-for-coding/kimi-for-coding` (K2.8 Preview) | sisyphus=**kimi-k2-6**, metis=base | sisyphus=**kimi-k2-7**, metis=k2-7 |
| `kimi-for-coding/kimi-for-coding-highspeed` (K2.7 Code HighSpeed) | sisyphus=**kimi-k2-6**, metis=base | sisyphus=**kimi-k2-7**, metis=k2-7 |
| `moonshotai/kimi-k2.8` | sisyphus=**kimi-k2-6**, metis=base | sisyphus=**kimi-k2-7**, metis=k2-7 |
| `opencode-go/kimi-k2.7-code` (control) | sisyphus=kimi-k2-7, metis=k2-7 | sisyphus=kimi-k2-7, metis=k2-7 |
| `moonshotai/kimi-k2.6` (control) | sisyphus=kimi-k2-6, metis=base | sisyphus=kimi-k2-6, metis=base |
| `opencode-go/kimi-k3` (control) | K3 prompt (neither marker) | K3 prompt (neither marker) |

Raw output: [`before-agent-prompts.txt`](./before-agent-prompts.txt),
[`after-agent-prompts.txt`](./after-agent-prompts.txt). The prompt byte counts move with
the family (25,374 for K2.7, 33,822 for K2.6, 26,405 for K3), so the classification is
corroborated by size and not only by the marker string. `resolved=` echoes the model the
plugin actually baked against, which rules out a silent fallback to another model.

## Why it is enough

The endpoint returns the prompt opencode itself hands the model, produced by the real
plugin through the real model-resolution path, so this exercises the shipped surface
rather than a unit seam. Three ids flip and three controls hold, in one run each, on the
same binary and the same sandbox recipe - a change that routed too broadly would have
moved `kimi-k2.6` or `kimi-k3` as well.

Unit coverage runs alongside it: the detector tests, the prompts-core variant table, the
Sisyphus family map, the Sisyphus Junior source map, the Atlas routing table, and the
Metis prompt switch each pin the new ids.

## What was omitted

No live model call was made, so no provider quota was spent and no transcript exists:
prompt selection is decided before the first request, and `GET /agent` reads it directly.
`kimi-for-coding` is not an authenticated provider on this machine, so the Kimi Code ids
were exercised through the plugin's agent-model override rather than a signed-in session;
the override path is the same one the resolver uses for a configured model. No secrets,
tokens or host paths outside the sandbox appear in the captured output.
