# Build Log

Append-only. Newest entries at the **bottom**. Never rewrite or delete an entry
— a wrong decision that was later reversed is more useful than a clean history.

## Format

```
## YYYY-MM-DD — Phase N
- DID: what actually changed, terse
- MEASURED: any number worth keeping (p95 frame time, texture MB, headroom)
- BLOCKER: what stopped, or `-`
- NEXT: the single next action
```

## Tags

Use these as a line prefix when the entry is not routine work:

| Tag | Meaning |
|---|---|
| `GATE-PASSED` | every test in a gate passed. Record the numbers. |
| `GATE-FAILED` | a gate test failed. Say which, and why. |
| `BLOCKER` | work stopped. Say what would unblock it. |
| `INVARIANT-TENSION` | a task appears to require breaking an invariant. **Stop and ask the human.** Do not work around it. |
| `SPEC-CHANGE-PROPOSED` | a change to `SPEC.md` is being proposed. Write the change, the reason, and the alternative rejected. Wait for the human. |
| `DECISION` | an open decision from `SPEC.md` §10 was resolved. Record the answer and the evidence. |
| `RISK-TRIGGERED` | a risk from `SPEC.md` §9 fired. Say which fallback is being taken. |
| `IDEAS` | out-of-scope idea, parked for v2. Not built now. |
| `GOLDEN-REBLESSED` | a golden frame hash was replaced. Say why the old one was wrong. |
| `MEASURED` | a performance number worth keeping, outside a gate. |

## Rules

1. One entry per working session, minimum. Terse beats complete.
2. Every gate pass records its **measured numbers**, not just "passed". A gate
   that passed with 56 fps and one that passed with 140 fps are different facts.
3. `INVARIANT-TENSION` and `SPEC-CHANGE-PROPOSED` end the session's autonomous
   work. They are questions for the human, not notes to self.
4. When an estimate in `CHECKLIST.md` is exceeded by 2×, log it. Drift that is
   never written down is drift that is never addressed.

---

## 2026-__-__ — Phase 0
- DID: repo scaffolded from SPEC v3; four docs committed
- MEASURED: -
- BLOCKER: `SPEC.md` §4 still has `{{TARGET_MACHINE}}` and
  `{{TARGET_PROJECTOR}}` unfilled. Gate 0 cannot pass until they are real.
- NEXT: fill §4, then Electron dual-window scaffold

---

## 2026-09-02 — Phase 0
- DID: Stage 1 only — document amendments. No code written. Read `CLAUDE.md`,
  `SPEC.md` §0/§3/§4/§5/§7/§8/§9/§10/§11-P0 (+ P1/P3/P5/P9 gates, D5/D10/D11/D12),
  `CHECKLIST.md` P0 + rolling checks. Verified dependency versions against npm
  and read the installed `electron@44.1.1` `electron.d.ts` rather than recalling it.
- MEASURED: none yet. `SPEC.md` §4 still unfilled, so no gate number can exist.
- BLOCKER: `{{TARGET_MACHINE}}`, `{{TARGET_PROJECTOR}}` and C12 (is a second
  display attached?) were left as `<fill in>` placeholders in the human's reply.
  Phase 0 can be *built* without them; Gate 0 cannot *pass* without them.
- NEXT: human fills §4 and answers C12; then Stage 2 (build Phase 0 deliverables
  in `CHECKLIST.md` order).

`SPEC-CHANGE-PROPOSED` — **approved in advance by the human in the same message
that requested it.** Recorded here for the audit trail, not pending. Scoped,
one-time permission was granted to edit `SPEC.md`, `CHECKLIST.md` and
`CLAUDE.md` for these amendments only. All eight items originated as agent
findings in the Phase 0 pre-build review and were accepted verbatim except where
noted.

| # | Change | Reason | Alternative rejected |
|---|---|---|---|
| D1 | `CHECKLIST.md` P0 item 1 → "confirm §4 is filled in"; `SPEC.md` §10 row 1 marked the human's responsibility | Filling §4 was simultaneously a prerequisite *to* Phase 0 (§10), a deliverable *of* Phase 0 (checklist), and assigned to an agent forbidden from editing `SPEC.md` (`CLAUDE.md`). Three docs, three positions. | Granting the agent standing edit rights to §4 — rejected, it erodes the read-only spec boundary for one field |
| D2 | `SPEC.md` §4 frame-rate budget and hard floor replaced with a measurement protocol (60 s after a discarded 10 s warmup, `N` from the active display mode) and **two** gate metrics: presentation smoothness (≤5% of intervals over 1.5×N, zero runs of 3+ late) and headroom (Pixi CPU render duration p95 ≤ 60% of N) | "≥55 fps at p95" is a p95 frame time of 18.18 ms; on a vsync-locked 60 Hz output frame times quantize to ~16.7/33.3/50 ms, so the threshold graded nothing. And presentation interval alone cannot see headroom — an app pinned at vsync with 0.5 ms to spare reports a perfect p95, so every gate 0–8 would have reported "budget holds" and Phase 9 would have discovered there was never any. | Keeping a single fps threshold and tightening it — rejected, it still cannot distinguish "fast" from "at the wall" |
| D3 | `[-]` marker added to `CHECKLIST.md`'s legend; rolling-check activation rule added; P0 rolling checks marked | `CLAUDE.md` rule 3 forbids crossing a gate with an unchecked box, and the rolling block contained boxes whose subjects (scene model, golden hash, catalog licenses) do not exist at Gate 0. Read literally, Phase 0 could never end. | Deleting the rolling block from early gates — rejected, it is the mechanism that stops late-phase drift |
| D4 | Gate 0 and Gate 5 latency criteria → instrumented timestamped round-trip, median + p95 in ms, gate on p95 ≤ 33 ms | "Within one or two frames" across two renderer processes joined by async IPC names no unit and no owner of "frame"; it gets passed by wiggling a slider, which is not a measurement and silently regresses. | Leaving it qualitative and trusting the operator's eye |
| D5 | `config/` added to `SPEC.md` §7 | Gate 0 requires relaunch without display reconfiguration, so the chosen display must persist; `CLAUDE.md` bans `localStorage`; §7 offered only `scenes/` and `calibration/`, and this is neither. | Storing display choice in `calibration/` — rejected, it muddies I-5's isolation boundary on day one |
| D6 | `SPEC.md` §0.2 gained "when an invariant starts applying"; `CLAUDE.md` rule 9 → "from Phase 1 onward" | Phase 0's own deliverables put it in nominal breach of I-2 (animate with no `clock.ts`) and I-8 (one named parameter with no registry). Invariant tension is a stop-and-ask event, so the agent was obliged to halt twice in the first hour of the project. | Building `clock.ts` and `parameters.ts` in Phase 0 — rejected as forward-reach that §0.2 explicitly forbids |
| D7 | Covered by D2's warmup clause | Startup, shader compilation and fullscreen-entry hitches all exceed the old 50 ms hard floor, so every gate would have failed for reasons unrelated to the engine. Those hitches are now reported separately, informational. | — |
| D8 | `SPEC.md` §9 row 1 trip-wire → "Day 2 with no fullscreen output window on the second display" | At "~3 days" it fired at the end of a 3–5 day phase. That is a schedule, not an early warning. | — |
| ADD-1 | `powerSaveBlocker` (`prevent-display-sleep`) held while the output window is open — human's addition, added to §11 P0 goal and the P0 deliverables | This is performance equipment; a screensaver mid-installation is a failure. | — |
| ADD-2 | Measurement mode attempting to disable the frame-rate cap — human's addition. To be verified empirically in Electron 44, **not assumed**, with the result recorded either way | Gives §4's metric 2 a direct uncapped-throughput reading if the platform still permits it. | — |

`DECISION` — open decisions and answers from the pre-build review:
- §10 row 1 (`{{TARGET_MACHINE}}` / `{{TARGET_PROJECTOR}}`): **still open.** Now
  explicitly the human's.
- Build integration: **hand-rolled** Vite + esbuild, no `electron-vite` and no
  `vite-plugin-electron`. Reason: no third-party build tool between the agent and
  the only thing Gate 0 actually tests. Evidence: `electron-vite@5.0.0` declares
  `vite: ^5 || ^6 || ^7` and so cannot take Vite 8 at all.
- HUD: off by default in the output window, key-toggled; editor text mirror
  always on. I-11 says "available", not "always on"; a HUD burned into a live
  show is a failure mode.
- Display fallback: never enter fullscreen on the primary display without
  explicit confirmation. On fallback, a **framed** window with a visible warning.
  A cursorless frameless fullscreen window on the only monitor locks the machine.
- React from Phase 0; Zustand deferred to Phase 6.
- `debug.testPattern.speed` carries its hierarchical key from Phase 0; registered
  in `parameters.ts` in the first Phase 1 commit (per D6).
- Throwaway ticker in `render/host.ts`, deleted in Phase 3 when `clock.ts` lands.
- npm, plus `.nvmrc` pinning Node 24 LTS. This machine currently runs Node
  v25.9.0, an odd-numbered line, on a project measured in months.

`MEASURED` — verified against npm and the installed package, not recalled:
- Pins agreed: `pixi.js@8.20.1` (8.x is still `latest`; there is no v9),
  `electron@44.1.1`, `vite@8.2.2`, `vitest@4.1.11`, `react@19.2.8`,
  `react-dom@19.2.8`. Exact pins, no carets. `lottie-web` (5.13.0) and `zustand`
  (5.0.15) not installed in Phase 0.
- TypeScript: human overrode the agent's 5.9.3 proposal in favour of the 6.0
  transition release. A stable 6.0.x **does** exist — the line ran
  `6.0.0-beta` → `6.0.1-rc` → `6.0.2` → `6.0.3`, with no plain `6.0.0`. Pin is
  therefore **`typescript@6.0.3`**. Adopt 6.0's new defaults when writing
  tsconfig (strict on, `module esnext`, `rootDir ./`, `types []`). Revisit at
  Phase 9.
- `electron@44.1.1` → Chromium 152, Node ABI 149. Bundled Node line is close to
  the Node 24 LTS the toolchain is being pinned to, which is convenient.
- Read `electron.d.ts` (27,287 lines) for §9's top risk rather than recalling it.
  Findings that matter: **`Display.displayFrequency: number` exists**, so §4's
  `N` is directly readable and never has to be assumed — this is what makes D2
  implementable. `Display` also carries `id`, `label`, `size`, `scaleFactor`,
  `internal` and `detected`, which supports the C6 display-matching heuristic.
  `powerSaveBlocker.start('prevent-display-sleep')` confirmed for ADD-1.
  `simpleFullscreen` (darwin, pre-Lion fullscreen), `kiosk`, `setKiosk()`,
  `setSimpleFullScreen()`, `isSimpleFullScreen()` and `hiddenInMissionControl`
  all present. `screen` emits `display-added` / `display-removed` /
  `display-metrics-changed` as expected.
- **New in Electron 44, and a genuine interaction with D5:** `BrowserWindow` has
  a `windowStatePersistence?: WindowStatePersistence | boolean` option that
  persists window bounds *and* display mode (fullscreen/kiosk/maximized) across
  restarts on its own. It will be left **off**, so `config/` is the single source
  of truth for window state. Two competing persistence mechanisms is how a
  projector window comes back fullscreen on the wrong display.
- ADD-2 (`--disable-frame-rate-limit` / `--disable-gpu-vsync`) **not yet
  verified** — it needs a real Electron launch, which is Stage 2. Result will be
  recorded either way, as instructed.

`SPEC-CHANGE-PROPOSED` — **one further amendment, NOT made, pending approval.**
`CLAUDE.md` "Working style" still says: *"When measuring performance, measure on
the output window with the HUD on, for 60 continuous seconds, at 1920×1080.
Anything shorter is noise. Record p95, not mean."* After D2 that is incomplete in
two ways — it omits the discarded 10-second warmup, and "record p95" no longer
identifies which of the two metrics. Left untouched because the granted
permission was scoped to the listed amendments and this bullet was not among
them. It should be brought in line with §4 before a future session measures
against the old protocol.

---

## 2026-09-02 — Phase 0 (session 2)
- DID: Stage 1 amendments (A4/A5/A6 + C1/C2 paste, propagated). Stage 2: built
  the Phase 0 scaffold — hand-rolled Vite + tsc + Electron, typed JSON IPC with a
  mechanised I-7 guard, `config/` persistence with a display-fingerprint match,
  Pixi v8 output renderer at DEV_RESOLUTION, React editor with display picker and
  preview, §4's two-metric HUD, `powerSaveBlocker`, uncapped measurement mode.
  38 unit tests. Typecheck and build clean.
- MEASURED: see the `MEASURED` block below. Both §4 metrics pass at
  DEV_RESOLUTION with very large margin on a trivial scene.
- BLOCKER: Gate 0 cannot be signed off. Four reasons, in order of severity:
  1. **The projector is negotiating 1920×1080, not its native 1280×720.** A4's
     whole point was to keep the projector's scaler out of the path, and right
     now the chain is `1280×720 canvas → CSS upscale to 1920×1080 → projector
     scaler → 720p panel`. Two scalers. Electron cannot change display modes;
     this needs macOS Display settings set to 1280×720 for `T749-fHD720`.
  2. Five Gate 0 boxes need a human looking at a physical screen.
  3. §4 still has `{{PROJECTOR_LUMENS}}`,
     `{{PROJECTOR_KEYSTONE_DISABLEABLE}}`, `{{PROJECTOR_AUTOFOCUS_DISABLEABLE}}`.
  4. No git repo yet — `git init` not run without a go-ahead.
- NEXT: set the macOS display mode to 1280×720, then walk the five physical Gate
  0 checks.

`MEASURED` — SPEC.md §4 protocol: 60 s continuous after a discarded 10 s warmup,
output window only, HUD enabled, projector on AC. **DEV_RESOLUTION render target
(1280×720) — 44% of TARGET_RESOLUTION's pixels, so these are optimistic relative
to the §4 spec target and must not be read as 1080p headroom.**

`N = 16.6667 ms`, from `Display.displayFrequency = 60.000003814697266 Hz`, read
from the platform, not assumed (§4). Trivial scene: one Pixi grid + sweep +
cross, no video, no Lottie.

| Run | n | fps | M1 late % | M1 worst run | M2 render p95 | M2 % of N | worst interval |
|---|---|---|---|---|---|---|---|
| Gate-shape, no CSP | 3601 | 60.00 | 0.00% | 0 | 0.300 ms | 1.80% | 17.80 ms |
| **Final config (CSP + Pixi polyfill)** | **3601** | **60.00** | **0.00%** | **0** | **0.200 ms** | **1.20%** | **17.80 ms** |
| ADD-2 uncapped | 24894 | 822.95 | 0.04% | 1 | 0.400 ms | 2.40% | 34.40 ms |

- **Gate metric 1 — PASS.** 0.00% of intervals over 1.5 × N (limit 5%), zero runs
  of 3+ (limit 0 runs of 3+). Worst single interval 17.80 ms, under the 25.0 ms
  late threshold, so not even one late frame in 3601.
- **Gate metric 2 — PASS, with the headroom that matters:** render p95 0.200 ms =
  **1.20% of N**, against a 60% ceiling. ~50× margin at this layer load.
- **ADD-2 verified empirically, as instructed, not assumed.**
  `--disable-frame-rate-limit` + `--disable-gpu-vsync` **still work in Electron
  44 / Chromium 152**: 822.95 fps sustained over 24894 frames ≈ **1.22 ms per
  complete frame including present**, versus 16.67 ms vsync-locked. This is the
  direct uncapped-throughput reading §4's metric 2 wanted, and it corroborates
  the render timer independently. Note that **gate metric 1 is meaningless in
  uncapped mode** — with vsync off there is no cadence to be late against, which
  is why the 0.04%/run-1 figures in that row must not be read as a gate result.
- **Cold start / fullscreen entry (informational, not gated, §4):** the discarded
  warmup absorbed it; no hitch survived into the measurement window in any run.
- **CSP hardening is free at this layer load.** A CSP without `unsafe-eval`
  breaks Pixi v8 (it generates shader/uniform sync with `new Function`); the
  official `pixi.js/unsafe-eval` polyfill fixes it, and cost 0.000 ms of
  measurable render p95 here (0.300 → 0.200 ms, inside noise). **Re-measure at
  Phase 3** — the polyfill's cost scales with shader/uniform churn, which a
  trivial scene does not exercise.

`DECISION`
- Pins installed and building: `pixi.js@8.20.1`, `electron@44.1.1`,
  `typescript@6.0.3`, `vite@8.2.2`, `vitest@4.1.11`, `react@19.2.8`,
  `react-dom@19.2.8`. Two corrections to the agreed list, both verified against
  npm: there is **no stable `typescript@6.0.0`** (the line ran
  `6.0.0-beta` → `6.0.1-rc` → `6.0.2` → `6.0.3`), and `@types/react-dom` versions
  independently of React — latest is **19.2.5**, not 19.2.8.
- `@vitejs/plugin-react` had to go to **6.1.1**: version 5.1.0 declares
  `vite: ^4 || ^5 || ^6 || ^7` and cannot take Vite 8. Same failure shape as
  `electron-vite`. Its extra peers are all `optional: true`.
- TypeScript 6.0 immediately earned its keep: `moduleResolution: node10` is a
  **hard error** in 6.0 with a pointer to the 7.0 migration, exactly the
  "surface the 7.0 breakage now" argument. Node project uses `module: node18`.
- Preload is **bundled** (Vite, CJS) rather than emitted by `tsc`. With
  `sandbox: true` a preload cannot `require()` a relative file, so
  `require('./ipc')` failed silently and left `window.engine` undefined.
- Electron 44's `windowStatePersistence` left **off** on both windows, as planned:
  `config/` is the single source of truth for window state.

`GATE-FAILED` — not a gate attempt, a statement that Gate 0 is not yet claimable.
Five boxes require a human at a physical screen and were **not** self-checked:
output truly fullscreen with no chrome and no cursor; the test pattern visible on
the wall; the editor preview; the round-trip latency numbers from a real slider
drag; relaunch finding the projector again. Plus the A5 keystone/auto-focus
verification, which is due before Phase 2.

`RISK-TRIGGERED` — §9 "Projector-side geometric correction", partially. Not the
keystone half yet, but the adjacent scaler half has fired: the projector is
accepting 1080p and scaling it internally to its 720p panel, which is the
condition A4 was written to eliminate. Fallback taken: none needed in software —
the macOS display mode needs changing. Recorded because if the Mars 2 turns out
not to *offer* a 1280×720 mode over this adapter, A4's premise fails and it
becomes the §10 installation-prerequisite question.

`MEASURED` — bugs found by running it, all fixed and re-verified:
1. **Self-triggering output reopen.** `display-metrics-changed` fires *because*
   the output window opened, so the I-13 reopen handler re-entered and destroyed
   a live output window twice on every launch, dropping the power blocker and
   restarting the measurement warmup each time. Fixed with a display signature
   plus a 250 ms debounce: reopen only when the picked display actually changes.
   A live-show hazard, found on the first launch.
2. **`N` never reached the metrics.** Main pushed `output:config` on
   `did-finish-load`, but the renderer registers its listener *after* an
   `await` on Pixi init, so the message was already gone. Every interval then
   compared against `N = 0` and reported **100% late**. Fixed by registering
   listeners before the await, buffering, and adding a pull handshake
   (`output:config:get`). Worth noting how this failed: it produced a confident,
   precise, completely wrong gate number rather than an error.
3. **Warmup boundary leak in `FrameMetrics`.** The warmup test looked at the
   interval's *end* only, so an interval that began during warmup and ended after
   it was admitted as a gate sample — a 250 ms startup hitch counted against the
   gate, which is exactly what D7/§4's warmup clause exists to prevent. Fixed to
   require both endpoints past warmup. Caught by a unit test.
4. **A wrong test expectation of my own**, kept as a documented test: with a tail
   of exactly 5% expensive frames, nearest-rank p95 reports the *cheap* value.
   So metric 2 is structurally blind to the same 5% tail metric 1 is allowed to
   permit. The two metrics meet at that seam by construction. Recorded now rather
   than discovered at Phase 9.

`IDEAS` — A4 dev/target split: places a 720p-developed scene could bake in an
assumption that breaks at 1080p. Parked, not built.
1. **Asset pixel density.** I-1 makes *positions* resolution-free but not source
   art resolution. A sprite chosen because it looks crisp at 720p is upsampled
   1.5× at 1080p. Suggest the library record source pixel dimensions (I-10's
   record is the natural home) and flag assets under-resolved for
   TARGET_RESOLUTION. Decision belongs at Phase 3/8 ingest, not later.
2. **Particle and procedural density.** If a provider derives counts from pixel
   area, 1080p yields 2.25× the particles from the same seed — same state,
   different look, which breaks I-12's "same state implies same intended look".
   Counts must come from scene state, never from resolution. Phase 1 decision.
3. **Golden frame hashes (§8.1).** They must be rendered at one fixed stated
   resolution written into the test, independent of DEV/TARGET. Otherwise the
   first 1080p run re-blesses every golden and the regression net is gone.
   Phase 1 decision.
4. **Draw-time pixel constants.** Stroke widths, placeholder outlines, HUD text,
   warp handle hit radii: any constant tuned at 720p is a third as thick,
   relative to the image, at 1080p. Convention adopted in Phase 0 already —
   `testPattern.ts` derives stroke width from render height — worth making it a
   rule before Phase 5 adds handles.
5. **The 44% warning does not apply evenly, and cuts against the metric we
   trust.** Fill-rate work (blend modes, the warp mesh, full-screen filters, the
   Phase 9 grade) scales with pixel count, ~2.25× from 720p to 1080p. Per-layer
   CPU work (Lottie main-thread re-render, video decode, scene-graph traversal)
   barely scales at all. Since metric 2 times CPU render duration, **metric 2 is
   the metric that will fail to warn us about the resolution change**, while
   metric 1 absorbs it. Phase 9 should not read a comfortable 720p metric 2 as
   1080p headroom.
