# projection-engine

An interactive projection-mapping engine for a live demo. An Electron app with
two windows: a React **editor** (trace the faces of a physical set, put content
on them, group and animate it) and a Pixi.js v8 **output** window that draws on
the projector. One clock drives every position; all stored state is normalized
`[0,1]`, never pixels.

This README is the map. The documents it points at are the territory.

## Start here — reading order for a new owner

| # | File | What it is |
|---|---|---|
| 1 | `CLAUDE.md` | The operating rules. Written for an AI coding session, but they are the project's rules for anyone: which documents are authoritative, hard rules, how a session opens and closes. |
| 2 | `SPEC.md` | **Authoritative.** §3 is the invariants (I-1 … I-18). §7 is the directory layout. §11 is what ships, §12 what is cut. Version 4.0. Changes go through a `SPEC-CHANGE-PROPOSED` entry in the log, never a direct edit. |
| 3 | `CHECKLIST.md` | The phase tracker (blocks, deliverables, gates). Frozen at v4.0 while the sprint runs. |
| 4 | `SPRINT.md` + `SPRINT_CHECKLIST.md` | The three-day reel sprint: work order and its blocks. **`SPRINT_CHECKLIST.md` "State now" is the latest true description of the tree.** `SPRINT.md` §8 is the procedure that closes the sprint; it has not been run yet. |
| 5 | `BUILD_LOG.md` | Append-only session log, one entry per session, ~7,800 lines. Read the last few entries, not the file. |
| 6 | `UI_PLAN.md` | A proposal for the UI and API. Not authoritative. |
| 7 | `measurements/GATE0-RUNS.md` | Measurement runs and their conditions. |

## Requirements

- Node 24 (`.nvmrc`). Built and measured on macOS; Electron 44, Pixi.js 8.20,
  React 19, Vite 8, Vitest 4.
- No native dependencies beyond what `npm install` fetches.

## Commands

| Command | Does |
|---|---|
| `npm install` | Install. |
| `npm run dev` | Start Vite, compile the Electron side, launch Electron against the dev server. |
| `npm test` | Vitest, no GPU. 50 files, 1221 tests at handoff. |
| `npm run typecheck` | Both TypeScript projects (`tsconfig.node.json`, `tsconfig.web.json`). |
| `npm run test:render` | Build the web side and run the golden-frame renderer under Electron (`scripts/golden.mjs`). Hashes live in `test/golden/frames.json`; previews land in `.golden-preview/` (ignored). Run it after touching anything that draws. |
| `npm run build` / `npm start` | Production build; build and launch. |

Other scripts in `scripts/`: `ui-shot.mjs` screenshots the editor over
Electron's debug port; `catalog-probe.mjs` exercises the asset catalog headless;
`clock-probe.mjs` and `font-probe.mjs` are measurement probes from earlier
phases.

## Layout

```
src/
  core/         scene model, clock, phase, registry, surfaces, roles, groups
  render/       compositor, host, mask — the drawing path
  providers/    content providers: procedural/, bundled/ (image, video, Lottie)
  editor/       React control panel + preview canvas (SVG overlays are held
                out of the output by an import-graph test)
  output/       the projector window's entry
  golden/       golden-frame harness entry
  debug/        HUD
  test/         the Vitest suite
electron/       main process: windows, IPC, calibration/scenes/config I/O,
                the asset catalog (Internet Archive search + download)
assets/bundled/ CC0 packs and test media, each with its license file
scenes/         scene state — what plays
calibration/    where it plays: surfaces.json (the traced faces), warp.json
config/         app prefs: display pin, HUD state, window bounds
measurements/   run logs and the gate record
test/golden/    committed golden hashes
```

`scenes/`, `calibration/` and `config/` are three subjects and never mix
(invariants I-5, I-15). No `localStorage`.

## What is in git, and what is deliberately not

**Tracked:** source, tests, scripts, `assets/bundled/`, `scenes/reel.json`,
`calibration/surfaces.json`, `test/golden/frames.json`, the gate record.

**Ignored, machine-local by design** (see `.gitignore` for the reasoning):

- `config/settings.json` — this machine's display and window prefs.
- `calibration/warp.json` — the projector-to-room warp for one physical wall.
  A warp from another room is worse than none.
- `calibration/surfaces.history/` — rotating undo snapshots of the room.
- `assets/library/` — clips downloaded through the editor's Library drawer,
  plus their `index.json` license records (~190 MB at handoff).
- `measurements/*.log`, `.golden-preview/`, `dist/`, `dist-electron/`.

Every data directory is created on demand, so a fresh clone runs.

**Two consequences for whoever takes this over:**

1. `scenes/reel.json` binds five layers to clips by library id
   (`archive.<item>.<file>`, all from the Internet Archive). On a fresh clone
   those layers show the I-13 placeholder until the same items are downloaded
   again through the Library drawer. The scene also binds layers to this room's
   face tokens (`surface-1` … `surface-5`); in another room the faces re-fill
   white.
2. `calibration/surfaces.json` is the builder's room as traced on 2026-09-07:
   five faces, traced against one physical set. Re-trace for any other wall.
   The app rewrites this file on every point drag; commit it after a wall
   session, that is the undo.

## State at handoff — 2026-09-07

- `npm test` 1221 / 1221 in 50 files. `npm run typecheck` clean.
  `npm run test:render` last recorded at 52 / 52.
- Sprint blocks B1–B5, S1–S3, F1 and the operator additions are closed.
  The wall sessions W1 and W2 are marked `[!]`: reported done by the builder
  but without the numbers the checklist asks for. Every line marked *(wall)*
  since the W1 fixes is open, because nothing since then has been seen on the
  projector. The suite proves what was written, never what the wall showed.
- `SPRINT.md` §8 (close the sprint, move the sprint files to `sprint/`,
  note what P6-A, P6-B and P7-A now start with) has not been run.
- Two `SPEC-CHANGE-PROPOSED` entries wait in `BUILD_LOG.md` for a human to
  ratify or reject: the asset catalog (SPEC §12 cuts catalog APIs) and the
  room-history snapshots (S3).
- Before any measurement run or any take, apply the preconditions in
  `CLAUDE.md` ("Before any measurement run"): the Adobe helper stack and
  OneDrive updater quit, Do Not Disturb on, projector on AC at 1280×720.
- The live demo date is 2026-10-05.

## Working on it

Read `CLAUDE.md` before changing anything. In short: one block per session,
tests before UI, no pixel values in stored state, one clock, seeded RNG only
in `src/core/` and `src/providers/`, no pixel buffers over IPC, every new
parameter in the registry and every new layer type with a placeholder path.
Commit messages are `P<phase>-<block>: <what>` or `sprint <block>: <what>`.
