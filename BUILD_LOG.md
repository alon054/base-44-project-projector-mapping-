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

---

## 2026-09-02 — Phase 0 (session 3)
- DID: repo re-oriented after the move to `~/dev/projection-engine`. Wrote the
  A-series into the docs as a proper record (§0's new three-artefact rule, §1
  v3.2, and the propagation), implemented A1/A2/A3/A8/A9/A10/A12/A13, measured
  A11's hop breakdown, analysed A12's stall, recorded the conformant run and
  superseded the non-conformant one. 69 unit tests, both typechecks clean.
- MEASURED: bare 4-hop IPC relay floor **median 0.10 ms**; conformant §4 run
  recorded below; A11 breakdown below.
- BLOCKER: Gate 0 boxes 4 (relaunch) and 7 (keystone/auto-focus) are the
  human's. A11's amendment is awaiting a ruling on the breakdown. A12's 67.70 ms
  stall is unattributed pending re-runs.
- NEXT: the human runs A13's pin-then-relaunch sequence and the A12 re-runs;
  then A11's wording is settled and Gate 0 closes.

`SPEC-CHANGE-PROPOSED` — **approved by the human in the two messages that
requested it.** Recorded here for the audit trail, not pending. This is the
table that §0's new rule now requires, and whose absence for A4/A5/A6 is the
defect that prompted the rule.

| # | Change | Reason | Alternative rejected |
|---|---|---|---|
| A1 | §4 gained a thermal-derate clause: k measured at minute 1 and minute 20 of a continuous run, the delta recorded at every gate; Phase 9's soak 5 min → **20 min**, its gate judged on **minute-20** k. §9's thermal row completed to match | The machine is fanless and an installation runs for hours while the protocol runs for 60 seconds. Every gate would pass cold and fail in the room — a failure mode that only appears in front of an audience | Leaving the 5-minute soak and treating thermals as a Phase 9 surprise |
| A2 | §5 records that "the preview does not decode video" is load-bearing on **16 GB of unified CPU/GPU memory**, not tidiness, and must not be relaxed for preview fidelity. Symmetrically: the M4's hardware media engine may make one video layer cheaper than §5 assumes — **measure in Phase 3, assume nothing either way** | A future session reading §5 would have seen a preference, not a constraint, and "improve preview fidelity" is exactly the kind of reasonable-sounding change that spends the memory budget twice | Stating only the pessimistic half; it would have licensed over-conservative video caps at Phase 3 |
| A3 | `scaleFactor` is a first-class concern from Phase 0: explicit in `render/host.ts`, reported by the HUD (backing store / CSS box / dpr), visible warning when the path is not 1:1 to the panel | Internal display 2×, projector 1×. "The canvas is 1280×720" says nothing about what reaches the panel. **A3 arriving late is precisely why the two-scaler problem surfaced as a surprise rather than as a designed-for case** | Handling DPR ad hoc at each draw site, which is how it stayed invisible the first time |
| A7 | §4's projector block filled: Mars **II Pro**, 500 ANSI, mode in use 1280×720 @ 60.000003814697266 Hz scaleFactor 1, keystone and auto-focus both disableable. §10 row 1 **CLOSED** | The human fixed the macOS display mode outside the session, which removed the second scaler and made a conformant run possible | — |
| A8 | §4 defines **k**, **k_dev** and **k_target** (the latter against an offscreen 1920×1080 `RenderTexture`), both recorded at every gate, ratio = measured fill-rate coefficient. Informational until Phase 9. Also: §8.1 fixes the golden-hash resolution in the test itself; "particle counts from pixel area" promoted out of `IDEAS` into a §11 Phase 4 note as a latent I-12 violation | Metric 2 times CPU; fill-rate work scales ~2.25× from 720p to 1080p and per-layer CPU work barely scales. **Metric 2 is structurally blind to the one change it was designated to guard.** A 1080p framebuffer costs nothing and needs no 1080p projector | Waiting for 1080p hardware to measure 1080p fill rate — it defers the number past every gate that would have used it |
| A9 | §4: every metric validates its inputs; N unset / 0 / out-of-range → **INVALID**, never a derived percentage | Session 2's bug 2 produced a confident, precise, completely wrong gate number rather than an error. An instrument that emits a plausible wrong number is worse than one that fails loudly | Fixing only the specific N-propagation bug, which leaves the *class* of failure live for every future metric |
| A10 | §4 gate metric 2 gates on **p99**; p95 retained, informational | Session 2's bug 4: M1 permits a 5% late tail and nearest-rank p95 over exactly that tail reports the **cheap** value, so between the two metrics nothing examined that tail at all | Tightening p95's threshold — it does not make p95 able to see the tail |
| A12 | §4 gate metric 1 gained **clause 3, magnitude**: any interval over 3 × N attributed as engine / OS / unknown; more than one "unknown" per run is a gate failure | D2 folded the old 50 ms hard floor into a late *rate*, and "late" is binary above 1.5 × N, so a four-frame stall counted identically to a 1.6× one. The metric discarded exactly the magnitude that matters | Failing a gate on a single event in 3600 — too strict; requiring that it be *explained* is not |
| A13 | §7 states the output-display pin policy: pin always wins, heuristic is a first-run fallback only, a stale pin degrades to a **framed, warned, non-fullscreen** window. Implemented and unit-tested | It was **not** what was built: `pickOutputDisplay` fell through a failed pin to `largest-external` and would have gone cursorless-fullscreen on whatever external happened to be attached. Discovered by the human asking, not by the code failing | Silently retargeting under I-13's "must not end the session" — it satisfies the invariant's letter and loses the show |
| A11 | **NOT APPLIED.** Recorded in §1 v3.2 as an open item | The corrected threshold depends on where the ~28 ms actually goes, which was measured this session and is reported below for a ruling. Amending first and measuring second is how the wrong number gets frozen twice | Applying the proposed 66 ms immediately — it would have been right by luck, not by evidence |

`DECISION` — **A6's orphaned material, re-attributed.** Session 2's log named
A4/A5/A6 and recorded none of their content. With A1–A13 now in hand:

- The §9 thermal row's "two effectively fanless devices / minute-1 vs minute-20"
  text was built from **a forward reference inside A6 to A1**, as the human
  confirmed. It was A1-by-proxy and was incomplete: it compared "both §4
  metrics" and never mentioned k, the derate, or the 20-minute soak. Now
  completed.
- §4's **AC-power clause**, the **"wherever a gate says 'meets §4' it means both
  metrics"** sentence, and Gate 0's **informational phone-video panel-latency**
  box remain the best candidates for A6 proper — a measurement-conditions
  amendment. **This is inference from content, not record**, and is marked as
  such rather than asserted.
- One item I previously listed as an A6 candidate is **not**: Gate 0's
  primary-display fullscreen guard is **C6**, from session 1's `DECISION` block.
  Corrected here so the attribution table is not wrong in the other direction.

`MEASURED` — **the conformant Gate 0 run.** SPEC.md §4 protocol: 60 s continuous
after a discarded 10 s warmup, output window only, HUD enabled, projector on AC,
**at DEV_RESOLUTION on the projector at its native mode, scaleFactor 1, 1:1 to
the panel — no scaler in the path.**

```
[output] mode: 1280x720, displayFrequency=60.00000366Hz, N=16.6667ms,
         scaleFactor=1, uncapped=false
[output] display "T749-fHD720" id=2 1280x720 @60.000003814697266Hz
         scale=1 via largest-external fullscreen=true
```

| Metric | Result | Threshold |
|---|---|---|
| M1 presentation | **PASS** — late 0.00%, worst run 0, n=3601 | ≤5% late, zero runs of 3+ |
| M1 worst interval | 17.8 ms (warm) | late threshold 25.0 ms |
| M1 clause 3 (A12) | **no interval over 3 × N (50 ms) in this run** | ≤1 "unknown" |
| M2 headroom | **PASS** — render p95 **0.40 ms = 2.4% of N** | ≤60% of N |
| Round-trip | median 27.5 / p95 28.9 ms (n=297); median 28.2 / p95 29.2 ms (n=62) | p95 ≤ 33 ms |

Physical checks confirmed by the human: fullscreen edge to edge, **all four
magenta edges visible so no panel cropping**, no chrome, no cursor; test pattern
correct on the wall; preview at 480×270 tracking; relaunch returned the output
fullscreen on the projector with no manual step.

**Superseding, not deleting — session 2's numbers are NON-CONFORMANT.** The
table in the 2026-09-02 session-2 entry (the "Gate-shape, no CSP" and "Final
config" rows, render p95 0.300 / 0.200 ms) was measured while macOS was
negotiating **1920×1080** to the projector. The real chain was `1280×720 canvas
→ CSS upscale to 1920×1080 → projector scaler → 720p panel`: **two scalers**,
the exact condition A4 exists to eliminate. Those rows describe a scaled path
and **must not be cited as Gate 0 numbers**. They are retained because the ADD-2
uncapped finding in that same table (823 fps) is unaffected by the output
scaling and still stands. The conformant p95 is **0.40 ms**, not 0.200 ms — the
scaled run was, mildly, optimistic.

`MEASURED` — **A11: where the ~28 ms goes.** Reported for a ruling; §4 not yet
amended.

Bare IPC floor, measured this session with a standalone Electron 44 harness
reproducing the **same 4-hop topology** as the real path (renderer A → main →
renderer B → main → renderer A), no rAF and no rendering, 1800 samples after 200
discarded:

```
median 0.10 ms   p95 0.20 ms   p99 0.20 ms   max 0.50 ms
```

So transport is **0.4% of the round-trip**. The budget:

| Hop | Cost | Evidence |
|---|---|---|
| 4-hop IPC transport | **0.10 ms** | harness above |
| Pixi CPU render | **0.40 ms** | M2, conformant run |
| Wait for the output's next rAF after the IPC lands | ~8.3 ms (0–16.7) | 1 × N quantization |
| **Deliberate extra frame before the ack is sent** | **16.67 ms** | `render/host.ts` — see below |
| Residual (rAF callback → presentation, editor-side input alignment) | ~2 ms | remainder |
| **Total** | **~27.5 ms** | observed median |

Answering the three questions directly:

1. **Yes, the echo is sent from inside a rAF callback — and worse than
   suspected.** `render/host.ts` calls `onPresented` at the *top of the
   following* rAF iteration, not at the end of the one that rendered. That is a
   full frame, by design, so that the number describes something *presented*
   rather than merely submitted. It is 16.67 ms of the 28.
2. **No, the React path is not throttled or coalesced by us.** `push()` captures
   `t0` synchronously inside `onChange` and sends before React re-renders.
   Chromium does coalesce the input events themselves to the frame cadence,
   which is what explains the ~1.4 ms spread: `t0` is itself vsync-aligned, so
   the phase offset between send and the output's next rAF is near-constant
   within a drag. The human's read was right — a systematic floor, not jitter.
3. **0.10 ms.** Everything above that is ours, and ~25 ms of it is two
   deliberate frame waits.

**The consequence that matters for the ruling.** The wall showed the change one
full frame *before* the ack was sent. So implied one-way time-to-photons is
**≈ 27.5 − 16.7 = 10.8 ms ≈ 0.65 × N** — comfortably inside one frame, never
mind two. The instrument is conservative by roughly a frame, exactly as A11
suspects, and the proposed 66 ms round-trip gate is generous but not wrong.

**Recommendation, not applied:** do not simply "echo on receipt" — that would
measure transport and stop measuring presentation, discarding the property that
makes the number trustworthy. Instrument **both**: a transport ack on receipt
and the existing presented ack, report both, gate on the presented one, and
state the implied one-way figure beside it. This matters more at Gate 5, where
region drags carry real scene state rather than one scalar, and the transport
number is the one that will move.

`MEASURED` — **A12: attributing the 67.70 ms stall.** Static analysis done;
re-runs still needed.

**First, a discrepancy the human should know about: the 67.70 ms event is not
from the conformant run.** That run reports `worstInterval` 17.8 ms at n=3601,
and `worstInterval` is a monotonic maximum within a measurement window — it
cannot fall from 67.70 to 17.8. The `n=3057 / 67.70 ms` line and the clean
3601-sample summary are therefore **two different windows**. The gate run is
clean; a *different* run carries the stall. Both facts stand, and the stall
still needs attributing.

Hypotheses, tested against the code:

- **Synchronous metrics log flush — RULED OUT.** `logMetricsPeriodically` runs
  in the **main** process, not the output renderer, and is throttled to 10 s. It
  cannot block the renderer's rAF loop. The human was right to ask; it is not
  this.
- **A fixed sample-count boundary — RULED OUT.** The sample window is trimmed by
  **time** (`windowMs`, 60 s), not by count. There is no count boundary at 3057
  for a hitch to sit on.
- **The instrument's own allocation churn — the leading candidate, and it is
  ours.** `report()` runs 4×/s. As written it did `samples.map(s => s.render)`
  — a fresh ~3600-element array — and then `percentile()` did `[...values].sort()`,
  another full copy. That is **~29,000 array elements per second of garbage on
  the same thread as the render loop**, on top of 3600 `Sample` objects per
  minute. n=3057 is ≈51 s past warmup, near the point where the 60 s sliding
  window begins re-slicing every frame. A major GC there is entirely plausible,
  and a 67.7 ms pause is the right order of magnitude for one.
  **Fixed this session**: one reusable scratch array, one sort, both percentiles
  read from it. Roughly two-thirds of the churn is gone.

**Prediction to test in the re-runs:** if the stall was the instrument's own GC,
it should vanish or move. If it recurs at ~the same n with the fix in place, it
is ours but not this; if it wanders or disappears, it is the OS and is recorded
as such. Under A12's new clause a single such event attributed "unknown" is
permitted — two are not.

`DECISION` — `CLAUDE.md`'s Working style measurement bullet is brought in line
with §4 (60 s after a discarded 10 s warmup, DEV_RESOLUTION through Phase 8,
both metrics plus k_dev and k_target). This was raised as a
`SPEC-CHANGE-PROPOSED` in session 1 and left unmade for want of scoped
permission; approved in this session's message. The stale text had survived
three sessions and would have had a future session measuring at 1920×1080
against the wrong protocol.

`DECISION` — **checklist-vs-reality disagreement, logged per `CLAUDE.md`.** The
Phase 0 deliverable read "`.gitignore` written; git repo not yet initialised —
awaiting go-ahead", but the repo was initialised and commit `6f9c724` exists
with a clean tree. `CHECKLIST.md` was wrong, not `SPEC.md`; the box is now `[x]`.

`GATE-FAILED` — not a gate attempt; a statement of what is still open at Gate 0.
Four boxes of eight remain, none of them silently downgraded:

1. **Box 4, relaunch** — held deliberately (A13). The relaunch that was run
   resolved via `largest-external`, so it exercised the auto-picker, not
   persistence. Sequence below.
2. **Box 7, keystone / auto-focus** — §4 now records YES for both, but the box
   is the human's physical check and a spec entry is not a verification.
3. **Box 8, projector-panel latency** — informational, human's, non-blocking.
4. **A12's stall** — attribution outstanding.

`DECISION` — **A13: the exact pin-then-relaunch sequence, and what the log now
prints.** The human's assumed sequence was right; the missing piece was that the
old log said `via largest-external` / `via exact-id` — reason slugs that do
distinguish the paths but do not *say* which is a pin. It now labels them
explicitly. Steps:

1. Launch. Note the `[output] display ... via ...` line. Expect
   **`via HEURISTIC, no pin stored (first-run-largest-external)`**, since
   `config/settings.json` currently has `"outputDisplay": null`.
2. In the editor's **Output display** panel, click **`T749-fHD720`**. The output
   window reopens immediately; the line should now read
   **`via PINNED (pinned-exact-id)`**.
3. Confirm on disk: `config/settings.json` → `outputDisplay` is a fingerprint
   object (`id`, `label`, `width`, `height`, `scaleFactor`, `internal`), no
   longer `null`.
4. Quit fully (⌘Q, not just closing a window — macOS keeps the app alive).
5. Relaunch. **The line that closes box 4 is `via PINNED (pinned-exact-id)`**,
   or `via PINNED (pinned-fingerprint)` if macOS reassigned the display id
   across the restart — both are pins and both count. **`via HEURISTIC` in any
   form does not close the box**, even if the projector is correct, because that
   is the auto-picker agreeing by coincidence.
6. Optional, and the case A13 was actually written for: with a pin stored,
   unplug the projector and relaunch with a different external attached. Expect
   `via HEURISTIC after STALE PIN (stale-pin-fallback)`, a **framed** window, and
   the warning "PINNED DISPLAY NOT FOUND". It must not go fullscreen.

`IDEAS` — parked, not built. `MAX_MAGNITUDE_EVENTS` caps A12's event list at 32
per window; a run pathological enough to exceed that is already failing, but if
Phase 9's 20-minute soak needs the full distribution rather than the first 32,
the cap becomes a histogram. Phase 9 decision, not now.

---

## 2026-09-02 — Phase 0 (session 3, part 2)
- DID: applied the A11 and A12 rulings, added A14 and implemented it, and
  audited the whole Phase 0 measurement path against the new clause. The audit
  found four violations, one of them introduced earlier in this same session.
  79 unit tests, typechecks and build clean.
- MEASURED: bare 4-hop IPC transport floor **0.10 ms median** — recorded here as
  the baseline every later phase regresses against (below).
- BLOCKER: Gate 0 box 2 has **reopened** as a consequence of the A11 ruling, see
  below. Boxes 4 and 7 remain the human's.
- NEXT: human runs A13's sequence, one slider drag for transport, and three
  conformant 60 s runs for A12 confirmation plus k_dev/k_target.

`SPEC-CHANGE-PROPOSED` — approved in the message that requested them.

| # | Change | Reason | Alternative rejected |
|---|---|---|---|
| A11 | §4 records **two** latency figures, never conflated: transport (editor event → output receipt, no frame wait, **p95 ≤ 5 ms**) and presented (acked from the frame after the one that rendered, **round-trip p95 ≤ 66 ms**), with the implied one-way stated beside them. Propagated to Gate 0 and Gate 5 | D4 specified a round-trip and judged it against a one-way budget. The measured split shows **~89% of the 28 ms is frame cadence, not work** — the criterion was measuring cadence and calling it latency | Moving the ack out of rAF, as originally instructed. It would have removed the extra frame and **broken the metric**: that frame is what makes the number describe something *presented* rather than merely submitted |
| A14 | §4 gains a standing clause: metrics code allocates nothing per-frame on the render thread, does no synchronous I/O, and reports its own cost as a HUD row; every future metric is reviewed against it before judging a gate | The instrument has now been the bug three times — N=0, the warmup-boundary leak, `report()`'s allocation churn. Three fixes address three instances; a clause addresses the class | Fixing the churn and moving on, which is what the first two occasions did |

`MEASURED` — **the transport floor, for regression against.** Standalone
Electron 44 harness, same 4-hop topology as the real path (renderer A → main →
renderer B → main → renderer A), no rAF, no rendering, 1800 samples after 200
discarded:

```
median 0.10 ms   p95 0.20 ms   p99 0.20 ms   max 0.50 ms
```

**This is the number every later phase regresses against.** It is the floor for
an empty payload; Gate 5's payload is a region transform, Phase 6's is scene
state, and the gap between this floor and the live transport figure is the cost
of what we put on the wire.

`MEASURED` — **A12, recorded as ruled, not closed.**

> **Origin:** instrument allocation churn in `report()`, leading candidate,
> fixed. **Not observed in the conformant Gate 0 run.** **Unconfirmed** — the
> confirming re-runs were not performed. If a >3 × N interval recurs at Phase 1
> or later, this is the first place to look and the fix is already in.

M1 clause 3 stands as written and now has its first real use: the next
unexplained interval over 3 × N is attributed against a **fixed** instrument, so
a recurrence kills the churn hypothesis and teaches us something instead of
re-litigating this one.

`MEASURED` — **A14 audit of the Phase 0 measurement path.** Four violations
found, all fixed. Listed with what each one actually cost, because "the
instrument is clean now" is not a finding.

1. **A per-frame array allocation in the sample window — the worst one, and I
   introduced it earlier in this same session's fix.** `notePresentation` ended
   with `this.samples = this.samples.slice(drop)`. At steady state the oldest
   sample is always past the cutoff, so **that ran every frame**, allocating a
   fresh ~3600-element array 60 times a second — an order of magnitude more
   churn than the `report()` path I had just "fixed", sitting three lines away
   from it. Replaced with a preallocated ring buffer (three `Float64Array`s,
   head + count, in-place time eviction). **This is the A14 pattern exactly: I
   fixed the instance in front of me and left a larger instance of the same
   thing in the same function.**
2. **A per-frame object allocation.** Each sample was a `{t, interval, render}`
   object — 3600 objects a minute of GC pressure on the render thread. Gone with
   the ring; samples are now three numbers in typed arrays.
3. **A synchronous layout read on the metrics tick, also mine, also this
   session.** `readScale()` calls `getBoundingClientRect()`, which forces a
   layout flush; the 250 ms tick called it 4×/s on the render thread for a value
   that only changes on resize. Now cached and invalidated on `resize` and on
   an explicit `resize()` call.
4. **`magnitude.filter()` on eviction** allocated a new array per frame once any
   event existed. Replaced with in-place compaction.

**The instrument now reports itself**, per A14: `noteInstrumentCost` times the
metrics call every frame (one extra `performance.now()`), `noteInstrumentTick`
times the whole report + format + DOM-write tick, and the HUD carries an
`instrument` row with per-frame max, per-frame mean, tick cost, and max as a
share of N.

`DECISION` — **what remains on the render thread, and why.** Honest inventory
after the fixes; none of these are per-frame allocations, but they are not free
and A14 says the overhead must be visible rather than inferred:

- **The HUD's own draw is on the render thread.** It is DOM, not Pixi, so it is
  *outside* the timed `renderer.render()` call — that was a deliberate Phase 0
  choice so the instrument does not inflate metric 2 — but `el.textContent = …`
  4×/s still invalidates style and layout for that element on the same thread.
  Off-main-thread compositing does not change this. It is now inside the
  `instrumentTick` measurement, so it is reported rather than hidden.
- **`assertJsonOnly` on the presented ack** walks a two-key object and allocates
  a `Set`, inside the rAF callback, once per acked frame — so only during a
  drag, but every frame during one. Kept: I-7's guard is mechanised on purpose
  and a drag is not a gate run. Now visible in `instrumentTick`'s sibling
  per-frame figure.
- **`assertJsonOnly` on the metrics payload** recursively walks the whole
  `MetricsReport`, `magnitudeEvents` included, 4×/s. Bounded and inside the tick
  measurement.
- **`report()`'s percentile sort** is one in-place sort of up to 3600 doubles,
  4×/s, over a preallocated scratch. Measured by the tick.
- **`magnitude.map()` in `report()`** allocates, bounded at 32 entries, 4×/s.
  Not per-frame; left alone.
- **The main-process metrics log** (`console.log`, 10 s cadence) is in the main
  process and cannot block the output renderer's rAF loop. Confirmed, not
  assumed — this was one of the A12 hypotheses.

`GATE-FAILED` — **Gate 0 box 2 has reopened**, as a direct consequence of the
A11 ruling, and is being recorded rather than quietly carried:

- **Presented latency: PASS.** p95 28.9 ms and 29.2 ms against the new ≤66 ms.
- **Transport latency: NOT MEASURED.** The gate condition is new, the
  instrumentation landed in this session, and no live drag has exercised it. The
  0.10 ms bare-IPC harness figure **bounds** it but is not the same measurement:
  it excludes the editor's event dispatch, the real payload, and the output
  renderer's receipt handler.

Closing box 2 needs **one slider drag** on the next run. Marking it `[x]` on the
strength of the old criterion would be exactly the "silently downgrade a gate"
failure `CLAUDE.md` forbids — the criterion got *stricter* and more informative,
and the box has to be re-earned.

`IDEAS` — parked. The A14 clause implies a test that no per-frame allocation
occurs, not merely that the numbers come out right. Node exposes enough
(`process.memoryUsage()` deltas over a fixed frame count) to assert it crudely,
but it is flaky under GC timing. Worth revisiting at Phase 9 when the soak
harness exists and can watch heap slope over 20 minutes — that is the honest
place to catch a regression of this class.

---

## 2026-09-02 — Phase 0 (session 3, part 3)
- DID: recorded the human's first conformant-protocol run. Gate 0 **not**
  closed — M1 clause 3 caught two unattributed stalls on its first real use.
  Added focus/blur/occlusion logging on the measurement clock and a frame-wait
  decomposition, so the next run answers the open questions with numbers
  instead of arguments.
- MEASURED: transport p95 **2.1 ms**; instrument per-frame max **0.200 ms =
  1.2% of N**; two stalls of 233.3 ms and 283.4 ms at n=7846/7851.
- BLOCKER: Gate 0 box 2 and box 3 both open. **`A15` is referenced but does not
  exist in any of the three documents** — see below.
- NEXT: the human drives four runs (three clean, one piped) per the sequence in
  this entry.

`MEASURED` — **regression baselines, recorded as instructed.**

| Baseline | Value | Note |
|---|---|---|
| **Transport latency p95** | **2.1 ms** | **This is the number every later phase regresses against**, not the 0.10 ms harness figure. The harness measured an empty payload through an idle relay; 2.1 ms is the live path with a real event dispatch and receipt handler. Gate ≤5 ms |
| Bare 4-hop IPC floor | 0.10 ms median | Retained as the *floor*, not the baseline. The 2.0 ms gap between it and the live figure is the cost of everything that is not the wire |
| Instrument per-frame max | 0.200 ms = **1.2% of N** | A14: the apparatus is no longer moving what it measures |
| Instrument per-frame mean | 0.005 ms | |
| Instrument tick | 0.40 ms | report + format + DOM write, 4×/s |

`GATE-FAILED` — **Gate 0 box 3, M1 clause 3: two unattributed events.**

```
n=7846  t=131.0s  233.3 ms
n=7851  t=131.3s  283.4 ms
```

Both unattributed, and A12 permits at most one "unknown" per run. **The box
stays open and clause 3 is not being adjusted to accommodate the events** —
233 ms and 283 ms are 14 and 17 frames, roughly half a second of near-frozen
output, and an unmissable glitch in a live installation. The clause is doing
exactly what it was written to do, on its first real use, and the old
rate-only metric would have reported this run as clean: two late frames in
3572 is 0.06%, comfortably inside the 5% allowance.

**They are one event, not two.** Five frames apart, and the accounting confirms
it: 233.3 + 283.4 = 516.7 ms ≈ 31 frames, against a sample shortfall of 29
(3572 observed vs ~3601 expected). The instrument is accounting for the lost
time correctly, which is a modest vote of confidence in the apparatus after
this session.

`DECISION` — **hypotheses, assessed against the code before the re-runs.**

**H1, the pipe — architecturally implausible, twice over, but test it anyway.**

1. **The writes are in the wrong process.** `logMetricsPeriodically` and
   `forwardConsole` both run in the **main** process. A main process blocked on
   stdout cannot stall the output renderer's rAF loop — they are separate
   processes with separate threads, and rAF does not depend on main. This is
   the same structural argument that ruled out the synchronous-log-flush
   hypothesis for the earlier 67.7 ms stall, and it applies unchanged here.
2. **The mechanism runs the other way.** On POSIX, Node's `process.stdout` is
   **synchronous for TTYs and files, and asynchronous for pipes**. If any of
   the three targets can block a writer, it is the tty or the file — *not* the
   pipe. So the hypothesis as stated is inverted: piping is the least blocking
   of the three configurations.

Run the piped comparison regardless. Two arguments from architecture are worth
less than one measurement, and if the stall does follow the pipe then something
is wrong with my model of the process boundary and I want to know that more
than I want to be right.

**H2, focus change or occlusion — the leading candidate, and the human's own.**
At t=131 s they very likely switched to a second terminal. `backgroundThrottling:
false` is set on the output window, but that stops **timer** throttling; it does
**not** make Chromium run rAF for a surface it considers not visible. A macOS
Space or app switch over a `simpleFullscreen` window is exactly the kind of event
that suspends and then resumes a surface — and **two large stalls five frames
apart is the shape of a suspend followed by a resume**, not of a GC pause or a
scheduling hiccup.

**This was previously untestable: the app logged no focus, blur, or visibility
events at all.** Added this session, on both sides:

- Renderer: `visibilitychange`, `focus`, `blur`, each logged as
  `[event] t=<seconds>s …` against **the same post-warmup clock A12's
  `atSeconds` uses**, so a stall line and an event line can be compared
  directly instead of correlated by eye.
- Main: the output `BrowserWindow`'s `focus` / `blur` / `show` / `hide` /
  `minimize` / `restore`, ISO-timestamped.

Both are event-driven, not per-frame, so they cost nothing against A14.

`DECISION` — **presented latency 27.5 → 32.3 ms: structural, not a regression.
Answered from the code, with the caveat stated.**

Presented latency is, by construction, one deliberate ack frame (**1.0 × N**)
plus a wait of **0 to 1.0 × N** for the output's next rAF. The whole quantity
therefore lives in a band of **1.0–2.0 × N = 16.7–33.3 ms**, and its position in
that band is set by the phase offset between the editor's input dispatch and the
output window's vsync.

- Earlier: 27.5 ms − 0.1 = **1.64 × N**.
- Now: 32.3 ms − 2.1 = **1.81 × N**.

**Both sit inside the structural band**, and the two windows are on *different
displays* — editor on the internal panel at 2×, output on the projector at 1× —
which are independent vsync domains that drift relative to each other. The beat
between them sets the wait, and it can differ between runs with nothing having
changed.

Ruling out a regression from this session's four apparatus fixes: none of them
touched the ack path. `markPending`, `pending`, `renderedPending` and the
`onPresented` call site are byte-for-byte unchanged; the loop gained one
`performance.now()`. The transport ack added one IPC send ahead of
`markPending`, but **transport itself measured 2.1 ms** — if the added send
were costing ~5 ms, transport would have shown it first, and it did not.

**The honest limit:** two drags of different lengths at different vsync phases
cannot distinguish "phase" from "small real shift" on their own. Rather than
assert it, the decomposition is now instrumented — the editor pairs transport
and presented **by token** and reports `presented − transport` as the frame-wait
component, flagging it when it leaves the 1–2 × N band. Next run reads the
answer off the panel. If it lands in band, this entry stands and the question
closes; if it lands out of band, there is a real regression and we have the
number that says so.

`BLOCKER` — **`A15` does not exist in the record.** This session's message
assessed the instrument row "against A15's threshold" and a "2% review trigger".
Neither `A15` nor a 2% figure appears anywhere in `SPEC.md`, `CHECKLIST.md`, or
`BUILD_LOG.md`; A14 as ratified requires the instrument's cost to be *reported*
and sets **no threshold**. The measured numbers are recorded above as
observations. **The 2% review trigger is deliberately NOT written into §4** —
under §0's three-artefact rule an amendment needs its text before it lands, and
writing a threshold into the spec from a passing reference is precisely the
defect that rule was added to stop. Send A15 and it goes in properly. Flagging
it rather than quietly adopting it, one session after adding the rule that says
so.

---

## 2026-09-02 — Phase 0 (session 3, part 4)
- DID: ratified A15 (three artefacts). Built an unattended measurement harness
  and drove runs 1, 2 and 4 plus a probe bench and a latency bench. Full report
  in `measurements/GATE0-RUNS.md`, written for a reader with no context.
- MEASURED: three valid runs, **zero intervals over 3 × N in 10,802 samples**.
  Transport p95 1.80 ms, presented p95 33.30 ms, frame wait **1.434 × N, in
  band**. A8's k probe found **defective**.
- BLOCKER: Gate 0 open. Clause-3 event unattributed; run 3 outstanding; k probe
  defective; run 5 is the operator's.
- NEXT: operator runs run 5 (script in the report) and redoes run 3 on an idle
  machine. Ruling wanted on the k-probe fix and on A15's statistic.

`SPEC-CHANGE-PROPOSED` — approved verbatim in the message that requested it.

| # | Change | Reason | Alternative rejected |
|---|---|---|---|
| A15 | §4: the HUD's DOM write is an **accepted apparatus cost with an expiry** — accepted through Phase 2, reviewed at Phase 3's gate against the measured instrument row, with a 2%-of-N trigger **at Phase 3's layer load**. Added to the Gate 3 checklist as a due item | "An accepted cost with a review date is engineering; an accepted cost without one is a defect with good manners." The A14 audit surfaced the HUD draw as on-thread-but-outside-the-timed-call, which is a real cost that had no owner and no expiry | Moving the HUD draw off the render thread now — rejected: Phase 0's instrument cost is a 0.034% mean and the work has no payoff until the budget tightens |

Phase 0's 1.2% reading is explicitly **not** backfilled as a pass against A15.
It was taken on a trivial scene with no layer load; A15's trigger is a Phase 3
measurement.

`DECISION` — **standing correction to the human's reasoning, recorded as
requested and not scoped to one hypothesis.**

> **The human repeatedly proposes main-process causes for render-thread stalls;
> check the process boundary before accepting one.**

Twice in two sessions: the synchronous-log-flush hypothesis for the 67.7 ms
stall, and the stdout-pipe hypothesis for the 233/283 ms stall. Both located the
cause in the Electron **main** process; both were refuted by the same structural
fact — main and the output renderer are separate processes, and rAF in the
renderer does not depend on main. Recorded here as a standing check to apply
before accepting such a hypothesis, not as a note about two particular ones.

The pipe hypothesis was additionally inverted on mechanism: on POSIX, Node's
`process.stdout` is synchronous for TTYs and files and **asynchronous for
pipes**, so a pipe is the least blocking of the three targets. Both facts were
recorded before the run, and the run then confirmed them — which is the right
order.

`MEASURED` — **three valid unattended runs. Full detail in
`measurements/GATE0-RUNS.md`.**

| | run1-sync | run2-sync | run4-pipe |
|---|---|---|---|
| samples | 3600 | 3601 | 3601 |
| M1 rate | PASS 0.0000% late, worst run 0 | PASS 0.0000%, 0 | PASS 0.0000%, 0 |
| worst interval | 17.70 ms | 17.80 ms | 17.70 ms |
| **M1 clause 3** | **none** | **none** | **none** |
| M2 p99 | 0.800 ms = 4.80% of N | 0.800 ms = 4.80% | 0.500 ms = 3.00% |
| M2 p95 (info) | 0.500 ms | 0.500 ms | 0.400 ms |
| instrument max / mean | 0.700 / 0.0056 ms | 0.500 / 0.0057 ms | 0.300 / 0.0044 ms |
| scale | 1:1 to panel | 1:1 | 1:1 |

`DECISION` — **H1, the stdout pipe: ELIMINATED.** The piped run was the cleanest
of the three. Eliminated empirically, and on the two architectural grounds
recorded above.

`DECISION` — **plain keyboard focus loss: RULED OUT as sufficient.** The two
discarded runs contain several genuine `focus LOST` events and four full window
teardowns, and **none coincided with an interval over 3 × N** — worst interval
stayed 17.70 ms throughout. So H2 survives only in its stronger form: surface
suspend/resume (Mission Control, Spaces, occlusion). Run 5 provokes cmd-tab,
Mission Control and a drag at three cued times to separate them.

`DECISION` — **A11's frame-wait question is CLOSED.** Presented latency had
moved 27.5 → 32.3 ms with no explanation. Presented is structurally one
deliberate ack frame plus a 0–1 frame wait, so it must live in 1–2 × N. Measured
`presented − transport`, paired by token: **23.90 ms = 1.434 × N, IN BAND**.
Three independent readings now sit at 1.64, 1.81 and 1.434 × N. The variation is
vsync phase between two windows on two displays with independent vsync domains.
Not a regression.

`GATE-FAILED` — **A8's k probe is defective; no k value in this session is
usable.** Every run reported `k_target` **cheaper per render** than `k_dev` —
ratio 0.38–0.56, where fill-bound work must give ≈2.25 and CPU-bound ≈1.0. A
1080p framebuffer cannot be cheaper to fill than a 720p one.

An order-alternating bench, four probes back to back on one unchanged scene:
ratios **2.800, 0.696, 1.273, 1.500**. Two compounding faults:

1. **Order bias** — the first resolution measured absorbs framebuffer and
   pipeline creation for its size; one discarded warm-up render is not enough.
   The cold dev-first probe gives 2.800, near theory; the target-first probe
   immediately after gives 0.696, the same bias reversed.
2. **Signal below noise** — on a trivial scene, per-render cost at either
   resolution (~0.05–0.14 ms) is the same order as the GPU-sync readback the
   two-burst subtraction exists to cancel. What survives is mostly noise.

Proposed, not applied, pending a ruling: more warm-up renders per resolution; a
wider iteration spread (8 vs 128); repeat with alternating order and take the
median; and **report a spread/confidence figure alongside k so an unstable probe
declares itself rather than emitting a plausible number** — the same principle
already ratified for N in A9. Note A8 first *matters* at Phase 3's layer load;
the probe may be measurable there and genuinely unmeasurable on a Phase 0 scene.

`DECISION` — **A15's statistic is probably wrong, raised not changed.** A15 as
ratified triggers on per-frame instrument **max**. That is a single-sample
extreme over 3600 frames and it read 0.300 / 0.500 / 0.700 ms across three
identical runs — **1.8% to 4.2% of N, straddling A15's own 2% threshold on noise
alone**. The **mean** was 0.0044–0.0057 ms (**0.034% of N**), stable to two
significant figures across all three. A trigger that fires or not depending on
which of three identical runs you look at cannot govern a Phase 3 decision.
Recommend A15 read against mean or p99. **Not changed** — A15 is ratified as
written and this is a proposal, one session after adding the rule that says so.

`MEASURED` — **environment, reported rather than assumed.** The machine was
**not quiet** during this session. Both attempts at run 3 logged
`openOutputWindow(displaysSelect)` about 2 s after launch, and `displaysSelect`
has exactly one caller: the editor's display-picker button. The operator was
working at the machine concurrently. Runs 1, 2 and 4 each opened exactly one
window and recorded no events; run 3 is **outstanding** and needs an idle
machine.

`IDEAS` — parked. `displaysSelect` destroys and recreates a live output window
even when the requested display is the one already in use. Harmless in the
editor, a hazard in a show — the same class as the self-triggering reopen fixed
in session 2. A guard making the select idempotent is a small fix, deliberately
**not** applied mid-measurement-series so that runs 1, 2 and 4 share one binary.

---

## 2026-09-02 — Phase 0 (session 3, part 5)
- DID: drove run 5 three times. Attempt 1 exposed a real defect and was aborted;
  the fix landed; attempt 3 completed clean. Report updated.
- MEASURED: **four valid runs now, zero intervals over 3 × N in 14,402 samples.**
  Keyboard focus loss / app switching **ruled out** as the stall mechanism.
- BLOCKER: Gate 0 open. The Mission Control provocation is the last untested
  candidate and was never actually performed in any attempt.
- NEXT: one 90-second run with cue 2 only — the operator presses F3, waits two
  seconds, presses Esc.

`DECISION` — **a real bug, found by run 5 rather than by a test.** Re-selecting
a display in the editor's picker destroyed and recreated the output window
**even when the requested display was the one already in use**. During run 5
attempt 1 this restarted the measurement six times: cue 1 fired, focus was lost
as scripted, and then a picker select tore the window down and the 70-second
window began again. It never reached cue 2.

It had been parked as an `IDEAS` note after runs 1–4 on the grounds that it was
"harmless in the editor, a hazard in a show". That judgement was wrong in one
respect — it was actively preventing the measurement — and the parking was
correct only in that it should not have been changed mid-series. Fixed now that
the series is complete: the pin is still persisted on every select, but a
re-select of the display already in use leaves the live window alone. Seven
such no-op selects were logged in the following attempt, each a teardown
avoided. Same class as the self-triggering reopen fixed in session 2: **an
output window that restarts whenever a control is touched is not show
equipment.**

`MEASURED` — **H2's focus-loss arm is RULED OUT, with deliberate provocation.**

- Attempt 1: the cmd-tab at cue 1 was performed in **six separate cycles**,
  each producing a logged `focus LOST` at t≈16–18 s. **No clause-3 event in
  any.**
- Attempt 2: a genuine focus-loss/focus-gain pair at **t = 37.63 / 37.98 s**
  inside a live window, with an application `activate`, running on to n=3044.
  **`worstInterval` stayed 17.70 ms. Zero late frames.**

Keyboard focus loss and application switching do not produce the stall. This was
the cheap half of H2 and it is now closed by measurement rather than by argument.

`MEASURED` — **run 5 attempt 3: completed, clean, unprovoked.** n=3600, M1
0.0000% late, worst run 0, worst interval 17.80 ms, **zero clause-3**, M2 p99
0.400 ms = 2.40% of N, instrument max 0.200 ms = 1.20%, mean 0.0052 ms.

All three cues fired on schedule and **no focus, blur or visibility event was
recorded — so none of the provocations was performed.** Reported as a fourth
clean control run, not as a disturbance test. It does replace the outstanding
run 3: same synchronous-stdout configuration, single window, undisturbed. Caveat
recorded: the cue overlay was drawing a countdown inside the window. It cost
nothing measurable — this run had the lowest p99 and the lowest instrument max
of the set.

`GATE-FAILED` — Gate 0 still open, and the reason has narrowed to one thing.
Four clean runs eliminate the pipe and rule out focus loss, but **four clean runs
are not an attribution**. The surviving candidate — surface suspend/resume via
Mission Control or a Spaces switch — has never actually been executed, in any
attempt. Everything else in the run set is now answered.

`DECISION` — **the parameter-drag candidate is ELIMINATED, on the operator's
own account.** They confirm the speed slider was not touched in run 5, nor in
the original run that produced the 233/283 ms event — consistent with run 5's
empty event list. The drag was one of the two possibilities originally offered
for t=131 s; the other was the terminal switch, which deliberate provocation has
now ruled out.

That leaves **Mission Control / Spaces surface suspend-resume as the only named
candidate still standing**, and it has never actually been executed. If it also
comes back clean, the named list is exhausted and the honest outcome is that the
original event is recorded as **unknown** — which clause 3 permits for a single
event, and which would let Gate 0 close on that basis rather than on a weakened
clause.

---

## 2026-09-02 — Phase 0 (session 4)
- DID: replaced the operator-driven provocation script with an unattended
  provocation harness and a run-conditions capture. Drove runs 6 and 7. Closed
  Gate 0's measurement box; reverted and re-proposed a checklist edit.
- MEASURED: **surface suspend/resume eliminated by four positive measurements.**
  A forced suspend costs **one 32.8 ms frame** on resume; the event under
  investigation was 233.3 / 283.4 ms. Run 6: n=3601, M1 PASS 0.0000% late, M2
  p99 0.400 ms = 2.40% of N, zero clause-3, worst interval 18.8 ms.
- BLOCKER: none of ours. Gate 0's three remaining boxes are the operator's
  physical checks.
- NEXT: operator's pin-then-relaunch sequence for A13, and the projector
  keystone / auto-focus passthrough check before Phase 2.

`DECISION` — **the experiment was the problem, not the answer.** Run 5's three
attempts and run5-mc all failed for the same two reasons: their timing depended
on a human pressing a key at a cued moment, and their result depended on a human
reporting what the wall did. run5-mc then produced a null that **could not be
interpreted at all**, because whether macOS `Displays have separate Spaces` was
on decided whether the run had tested its mechanism — and the run did not record
it. Recovering that with `defaults read` after the fact is not measurement.

Fixed before any further run: **every run now captures its own conditions** —
`spans-displays`, `hiddenInMissionControl` read from the window itself, display
count, output display, fullscreen state, and the A13 pin — read once in main at
window open and carried into the summary. This is the same clause as A9 and A14
in a third guise: *an instrument that cannot see the conditions it measured
under cannot say what it measured.*

`MEASURED` — **run 6: four provocations in the shipping configuration, all
null.** `hide`, `apphide`, `mc`, `mcvisible`. Zero visibility changes, worst
interval 18.7 ms in every provocation window, zero clause-3. The main process
logged `output window hide`, so the window really was hidden — and the renderer
presented straight through at ~16.7 ms.

**A null proves nothing on its own**, which is why run 7 exists.

`MEASURED` — **run 7: the control that isolates the variable.**
`backgroundThrottling: false` is set on the output window and has been since the
first scaffold commit `6f9c724`. Electron 44's installed typings: *"Controls
whether or not this WebContents will throttle animations and timers when the
page becomes backgrounded. **This also affects the Page Visibility API.**"*

| Provocation | Suspended? | max interval | after resume |
|---|---|---|---|
| `hidethrottled` (throttling re-enabled) | **YES** | **2016.1 ms** | 16.9 16.6 **32.8** 17.6 16.1 |
| `mcthrottled` (throttling re-enabled **and** flag cleared) | no | 17.8 ms | 16.6 |
| `hide` (shipping config) | no | 17.7 ms | 16.7 16.6 |

Four things follow, and the fourth is the one that matters:

1. **The instrument is not blind.** A real suspend fires `visibilitychange`,
   opens a 2016.1 ms gap, and trips clause 3. Run 6's nulls are real nulls.
2. **The shipping surface cannot be suspended** by hiding the window, hiding the
   app, or Mission Control — with or without `hiddenInMissionControl`.
3. **Mission Control cannot suspend it even stripped of both immunities.**
   `mcthrottled` was the maximally suspendable configuration and still null.
4. **A forced suspend costs one 32.8 ms frame on resume — 2.0 × N, below clause
   3's own threshold.** The event was 233.3 and 283.4 ms, 14 and 17 frames.
   **The mechanism is the wrong size, not merely absent.** That is a stronger
   result than any non-reproduction, and it is what closes the question.

Both immunity flags date from `6f9c724`, so they were in the binary that
produced the original event. The configuration under which it occurred is the
configuration now shown to be immune.

`GATE-PASSED` — **Gate 0 box 3 closes, with the event recorded `unknown`.**
Five runs pass both §4 metrics at DEV_RESOLUTION (1280×720) on the projector:
M1 0.0000% late with worst run 0, M2 p99 between 2.40% and 4.80% of N, worst
interval 18.8 ms across the set, **zero unexplained intervals over 3 × N in
18,003 gate samples**. The only clause-3 event anywhere in the set is run 7's
deliberate 2016.1 ms suspend, which the harness caused on purpose.

The 233.3 / 283.4 ms event is **one event, attributed `unknown`**, which A12
permits at one per run. It is recorded unknown because the named-candidate list
is exhausted — pipe eliminated, focus loss ruled out, drag eliminated on the
operator's account, suspend/resume eliminated above — not because it stopped
reproducing.

**Clause 3 was not weakened, and this is the outcome it was written for.** A
rate-only metric would have called the original run clean. Clause 3 held the box
open for four sessions, forced the instrument to grow the ability to answer the
question, and then permitted exactly the one `unknown` it always allowed.

**What this costs, stated plainly:** the allowance is now spent. A second
unexplained stall in any future run is a gate failure with nothing left to
absorb it. The honest reading of this box is "not reproduced in 18,003 samples,
mechanism eliminated, cause unidentified" — not "explained".

`DECISION` — **the checklist edit was reverted and re-made.** An earlier
auto-mode write in this session corrected a stale checklist line
(`A15` recorded as having "no text in any document", which `SPEC.md` §1 item 12
and §4 contradict). The correction was legitimate and `BUILD_LOG.md` was never
touched, but it landed as an unreviewed write. Reverted to HEAD on request and
re-made as a normal in-session checklist edit, logged here. The trail matters
more than the line did.

`MEASURED` — **A8's k probe: two more samples, still defective.** Ratio
**5.000** (run 6) and **0.923** (run 7), against **1.037** reported from
run5-mc, on a theoretical 2.25 fill-bound / 1.0 CPU-bound. `src/debug/probe.ts`
is **unchanged** across all of these and across the original defective runs, so
**1.037 was not evidence of a fix** — 5.000 is the same instrument saying so.
Nine samples now span 0.379 to 5.000 on an unchanged scene. Stays `[!]`,
non-blocking, awaiting a ruling on the proposed fix. A8 first *matters* at Phase
3's layer load.

`MEASURED` — **side finding: `hide`/`show` preserves `simpleFullScreen`.**
Checked on every hide provocation and reported in the note; the window returned
fullscreen on the projector every time. Had it not, that would have been a
live-show hazard of the same family as the picker teardown, and the harness now
checks it for free on any future run.

`IDEAS` — parked. The one corner never exercised: a Spaces switch driven on the
projector's **own** display with `Displays have separate Spaces` **OFF**. Every
run in the set ran with it ON, its untouched default, now recorded in each run's
conditions. Not load-bearing — the shipping immunity is a WebContents property
and display-independent, and `mcthrottled` failed to suspend with that immunity
removed — but it is the honest edge of the claim and is written down rather than
smoothed over.

---

## 2026-09-03 — Phase 0 (session 5)
- DID: marked Gate 0's projector-passthrough box verified on the operator's
  confirmation at the projector. No code change.
- MEASURED: -
- BLOCKER: Gate 0 has one blocking box left, and it is the operator's: the
  A13 pin-then-relaunch sequence.
- NEXT: pin the projector in the picker, relaunch, and confirm the log reads
  `PINNED`, not `HEURISTIC`.

`DECISION` — **projector auto-keystone and auto-focus confirmed fully
disableable to geometric passthrough**, by the operator, at the device. This was
always the human's physical check rather than a spec entry: `SPEC.md` §4 has
recorded YES for both since A7, but §4 is a statement and this box is its
verification, and the two were deliberately not allowed to satisfy each other.

Consequences, all already written into `SPEC.md` and now actually earned:

- §9's **projector-side geometric correction** risk row is discharged for this
  device. That row's fallback was "no software fix exists; Phase 7 requires a
  projector with full geometric passthrough" — it does not fire.
- §10's installation prerequisite is satisfied for the Nebula Mars II Pro, so
  **I-5 holds in practice**: Phase 2 and Phase 7 calibrate one transform rather
  than two stacked ones, only one of which we would control.
- The requirement stands for every future device. It is not discharged by this
  one passing (§10).

## 2026-09-03 — Phase 0 (session 5, part 2)
- DID: verified the A13 pin across a physical cable reconnect. Marked Gate 0's
  relaunch box and corrected a stale deliverable line.
- MEASURED: relaunch after unplug/replug resolved `via PINNED
  (pinned-exact-id)`, fullscreen on `T749-fHD720`. 15 launches on record, every
  one `PINNED`, none `HEURISTIC`.
- BLOCKER: one Gate 0 box left — the informational projector-panel latency.
- NEXT: measure panel latency by phone video, or log a decision to defer it.
  A gate is not crossed with a box left hanging (CLAUDE.md rule 3).

`DECISION` — **the relaunch box was held against evidence that had expired.**
It was opened because one early relaunch resolved via the `largest-external`
heuristic, which tests the auto-picker rather than persistence (`SPEC.md` §7
rule 5). Every launch since — 15 of them across the whole run set — resolved
`PINNED (pinned-exact-id)`, and the operator has clicked the picker 15 times in
both directions, which also retires the "human click not yet exercised" note on
the picker deliverable. Both lines were stale rather than wrong when written;
recorded here because a tracker that lags its own evidence is the same defect as
one that runs ahead of it.

The reconnect was performed physically: cable out, cable in, relaunch. **macOS
reused `Display.id` across it**, so the match was `pinned-exact-id` and the
`pinned-fingerprint` fallback — the one A13 exists for when the id does *not*
survive — has still never fired in the field. It is unit-tested
(`config.test.ts:65`, `:170`). Stated rather than claimed as covered: the field
has now exercised the easy half of A13, and the hard half remains simulated.

## 2026-09-03 — Phase 0 (session 5, part 3)
- DID: closed Gate 0. Deferred the panel-latency box to Phase 5 with its failure
  modes recorded, logged the cursor finding, corrected a stale Gate 5 line.
- MEASURED: full Gate 0 number set below.
- BLOCKER: none. Phase 0 is closed.
- NEXT: Phase 1 — `Scene` and `Layer` models, parameter registry (I-8), seeded
  RNG (I-12). `/compact` before starting.

`GATE-PASSED` — **Gate 0, 2026-09-03. DEV_RESOLUTION 1280×720 on the projector,
under §4's measurement protocol.**

**Display mode.** `displayFrequency` **60.000003814697266 Hz** read from
`Display.displayFrequency`, never assumed. **N = 16.6667 ms**, A9-validated in
every run. Scale 1280×720 buffer / 1280×720 css / dpr 1 — **1:1 to the panel**
in all five runs, no scaler in the path (A3).

**Gate metric 1 — presentation.** Five conformant runs:

| | run1-sync | run2-sync | run4-pipe | run5 att3 | run6-attrib |
|---|---|---|---|---|---|
| samples | 3600 | 3601 | 3601 | 3600 | 3601 |
| fps | 59.999 | 60.001 | 60.000 | 59.999 | 60.000 |
| late % (≤5%) | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| worst late run (≤2) | 0 | 0 | 0 | 0 | 0 |
| worst interval | 17.70 ms | 17.80 ms | 17.70 ms | 17.80 ms | 18.80 ms |
| clause 3 | none | none | none | none | none |

**18,003 samples, not one late frame anywhere** — worst interval in the set is
18.80 ms against a late threshold of 25.0 ms.

**Gate metric 2 — headroom (the recorded number).** Render p99 as a share of N:
**4.80%, 4.80%, 3.00%, 2.40%, 2.40%** against a 60% limit. p95 informational:
0.500 / 0.500 / 0.400 / — / — ms.

**Metric 1 clause 3 (A12).** One event in the whole project, from the original
pre-harness run: 233.3 ms at n=7846 and 283.4 ms at n=7851, five frames apart —
**one event, attributed `unknown`**, which A12 permits at one per run. Every
named candidate eliminated: stdout pipe (empirically and architecturally), plain
focus loss (repeated deliberate provocation), parameter drag (operator's own
account), surface suspend/resume (the run 6 / run 7 provocation matrix — a
forced suspend costs one 32.8 ms frame on resume against an event of 233/283 ms;
the mechanism is the wrong size, not merely absent). **Clause 3 was never
weakened.** The allowance is now spent: a second unexplained stall in any future
run is a gate failure with nothing left to absorb it.

**Latency (A11), two figures, never conflated.** Dedicated bench, deliberately
outside a gate window: **transport median 0.40 / p95 1.80 ms** — PASS against
≤5 ms. **Presented median 24.60 / p95 33.30 ms** — PASS against ≤66 ms; implied
one-way presented **≈7.93 ms = 0.48 × N**. Frame wait, paired by token,
**23.90 ms = 1.434 × N — in the structural 1–2 × N band.** Live-path transport
p95 **2.1 ms** stands as the regression baseline for every later phase, not the
0.10 ms bare-wire floor.

**Instrument self-cost (A14).** Per-frame mean **0.0044–0.0062 ms = 0.026–0.037%
of N**, stable to two significant figures across five runs. Per-frame max
0.200–0.700 ms (1.2–4.2% of N) — a single-sample extreme, and the reason A15's
statistic is questioned. Tick 0.20–0.50 ms.

**Measurement mode (ADD-2).** `--disable-frame-rate-limit` + `--disable-gpu-vsync`
still work in Electron 44: sustained **823 fps** vs 60.00 capped.

**Conditions, captured by the app.** `separateSpaces=true (spans-displays=absent)`,
`hiddenInMissionControl=true`, `displays=2`, output `T749-fHD720` fullscreen,
`pin=PINNED (pinned-exact-id)`.

**Not recorded, and why:** `k_dev` / `k_target` and the thermal derate. The A8
probe is defective (nine samples spanning 0.379–5.000 on an unchanged scene) and
A8 makes k informational through Phase 8; §4 names Phase 3 and Phase 9 as the
gates that must carry it. **A1's "recorded at every gate" and §4's "Phase 3 and
Phase 9" need reconciling before Phase 3**, where k stops being informational.
Flagged, not resolved — that is a `SPEC.md` question.

`DECISION` — **projector-panel latency deferred to Phase 5.** Attempted with a
phone video; the clip was **30 fps** (33.3 ms/frame, twice N, ±67 ms of
ambiguity on a 30–80 ms quantity), a **DLP panel filmed at 30 fps beats
light/dark on nearly every frame** (3,748 luminance transitions in 6,883
frames), and the **editor preview cannot be the time reference** — the sweep bar
sat ~12% across on the wall and ~35% in the preview, about **0.9 s apart on a
4 s loop**, because Phase 0's ticker is per-window.

**No number was recorded, deliberately.** A9 is ratified for the HUD — *an
instrument that emits a plausible wrong number is worse than one that fails
loudly* — and it binds the analysis as much as the apparatus. "≈33 ms" from that
clip would be precisely the defect A9 exists to stop. Needs 240 fps. Carried to
Phase 5 as a deliverable, which is where the number is first used. Box marked
`[-]`, not dropped, so the gate is not crossed with anything hanging.

`MEASURED` — **finding, found by hand and not by any log: the output window's
controls need a pointer on the projector.** `h` / `r` / `k` are bound with
`window.addEventListener('keydown')` in the output renderer, so that window must
hold keyboard focus, so the operator must click the projector display — where
`cursor: none` makes the pointer invisible. **Nothing traps the cursor**: no
pointer lock, no kiosk mode, no confinement anywhere in the codebase. But an
invisible pointer on a 1280×720 panel is indistinguishable from a trapped one,
and the operator had to quit the app to recover.

`cursor: none` is **required** by Gate 0 box 1 ("no chrome, no cursor"), so this
is not a bug to fix by deleting it. The fix is to forward the keys from the
editor over IPC so the pointer never needs to go to the wall — carried to Phase 5
as a deliverable. `SPEC.md` C6 already covers the one-monitor lockup; this is
the two-monitor case, and it surfaced only because someone used the thing with
their hands.

`DECISION` — **a second stale checklist line corrected.** Gate 5's latency
criterion still read "p95 ≤ 33 ms", which predates A11 and conflates the two
figures it exists to separate. `SPEC.md` §11 Gate 5 is authoritative —
**transport p95 ≤ 5 ms and presented round-trip p95 ≤ 66 ms** — and the
checklist was wrong. Second such correction this session; both were lines that
went stale under an amendment rather than being wrong when written, which is the
failure mode a tracker has and a spec does not.

`MEASURED` — **observation, free and worth keeping: preview and output are
~0.9 s out of phase.** Each `createRenderHost` accumulates its own `phase` from
its own first frame (`render/host.ts`), so two windows drift arbitrarily. This
is sanctioned — §0.2, the Phase 0 ticker is throwaway and is deleted in Phase 3
when I-2's single clock lands — and it is **not** an I-2 violation. Recorded
because it is the reason the preview can never be a timing reference, and
because Phase 3's gate should be able to point at a before-and-after.

## 2026-09-03 — Phase 1 (session 1)

- DID: Phase 1's whole buildable surface in four commits — scene/layer models,
  I-8 registry, seeded RNG, compositor, blend, outputs, `ContentProvider`,
  `ProceduralProvider`, `resilience.ts`, the §8.1 golden-frame harness, and the
  editor layer list. Deleted `render/testPattern.ts`.
- MEASURED: I-6 additive gain **1.1441×** (mean frame luminance 0.011315 →
  0.012945). I-1 cross-resolution layout delta **0.0109** max per cell against a
  **0.1204** negative control and an 0.08 limit. Occlusion centre pixel exactly
  the top layer's tint both ways (`[208,32,32]` / `[32,64,208]`). 174 unit tests
  green, up from 87. 11 golden frames, exit 0.
- BLOCKER: none in code. Two boxes are the operator's and one needs a
  measurement run — see NEXT.
- NEXT: (1) click the layer list on a real launch — add / remove / reorder /
  opacity / blend, and add a `fault` layer to see the placeholder. (2) Gate 1's
  informal wall check. (3) §4's two gate metrics at Phase 1's layer load, which
  is a **rolling check and therefore a Gate 1 blocker**, plus the 5-minute
  texture-memory soak. Neither can be run today — see the display-mode note
  below. Two rulings from Gate 0 are still open and were not decided here.

`DECISION` — **the golden-frame resolution is 1280×720, and the harness runs
under Electron.** Both were the operator's calls this session.

Electron rather than headless-gl or a Playwright browser: it is already a
dependency, and it is **the renderer that ships**. A golden produced by a
different GL implementation can pass in CI and differ on the wall, which is a
regression net that catches the wrong thing.

1280×720 currently **equals `DEV_RESOLUTION`**, and that coincidence is the
whole hazard A8 names. The two numbers look identical, so tidying the literal
into an import would look like a cleanup and would silently delete the net —
the first 1080p run would re-bless every golden at once, in a commit that looks
routine. So it is guarded mechanically rather than by comment: tests assert the
harness declares it as an object literal, imports neither resolution constant
nor `@shared/ipc` at all, and never reads a resolution from a display, window,
`devicePixelRatio` or env. A sixth test asserts every committed golden was
rendered at a resolution the harness states.

`DECISION` — **rotation is stored in turns, not radians.** Not a style choice.
It puts every field of a stored transform inside [0,1], which turns
`isNormalizedTransform` into a *total* I-1 check instead of a per-field special
case: if a pixel value ever leaks into stored state, some field lands outside
the unit interval and a test says so. Radians would put a legal `3.14` in stored
state with no way to tell it from a pixel value by inspection.

`DECISION` — **`ContentProvider.create` is synchronous.** The tempting shape is
`Promise<LayerView>`, since a catalog or AI provider cannot have its texture
ready at create time. It is the wrong one for a live instrument: awaiting a
provider means a scene switch mid-show stalls on a network fetch. Instead a view
exists from the first frame and populates itself — which is exactly the
placeholder → poster → content chain I-13 already requires of video in Phase 3.
Recorded because I-3 is the one interface SPEC.md sanctions building before its
consumers exist, and Gate 10 tests that swapping a catalog entity for an AI one
needs no compositor change.

`DECISION` — **the I-8 registry holds accessors, not values.** A definition
carries `get`/`set` onto wherever the value actually lives: scene state for
`entity.<id>.*`, a local cell for a debug knob. If the registry stored a copy of
`entity.<id>.opacity`, the scene JSON and the registry would be two sources of
truth for one number, and I-12 says there is exactly one. The editor's layer
controls write **through** the registry rather than mutating layers, so I-8 is
load-bearing from Phase 1 instead of a table nothing reads until Phase 11 asks
it to carry MIDI. `debug.testPattern.speed` is registered in Phase 1's first
commit (rule 9).

`MEASURED` — **three real defects, each found by writing the check rather than
by reading the code.** Recorded together because they share a moral.

1. **`moveLayer` was a silent no-op.** It swapped array positions and then
   called `reindexZOrder`, which re-indexes by *current draw order* — sorting by
   the very `zOrder` values the swap was meant to exchange, and putting the
   layers straight back. Correct for add and remove; a no-op for a move.
   **Invisible to the golden harness**, which builds its scenes directly rather
   than through the editor's operations, and invisible to typecheck. It was
   caught by the first unit test written against it, which is the argument for
   having pulled those three operations out of the click handlers into
   `core/sceneEdit.ts` in the first place.

2. **`canonicalizeScene` converted a typed array instead of refusing it.** A
   `Uint8ClampedArray` is an object with numeric keys, so `Object.entries` would
   turn a 4 MB pixel buffer into a four-million-key plain object and call it
   valid scene state — an I-7 violation that arrives through the scene rather
   than through IPC. Now refused at **both** boundaries, because layer content
   reaches a scene from a provider as well as from a channel.

3. **Two Phase 0 `invoke` sites carried unguarded payloads** (`displaysSelect`,
   `measurementMode`), while `CHECKLIST.md`'s Gate 0 line claimed
   `assertJsonOnly` was "on every send site". Neither can carry pixels — one
   sends a number, the other a boolean — so this was an **overstated claim, not
   a live defect**, and it is recorded as such rather than as a Gate 0 failure.
   The claim is now true and is checked mechanically: a test greps every
   `ipcRenderer.send`/`invoke` in `preload.ts` and fails on any that passes a
   payload without the guard.

`MEASURED` — **Gate 1's pixel conditions, as numbers.**

| Condition | Measure | Value |
|---|---|---|
| I-6 additive brightening | mean frame luminance, `add` ÷ `normal` | **1.1441×** (0.011315 → 0.012945) |
| Occlusion, red over blue | centre pixel | `[208, 32, 32]` = `0xd02020` exactly |
| Occlusion, blue over red | centre pixel | `[32, 64, 208]` = `0x2040d0` exactly |
| I-1 across resolutions | max per-cell luminance delta, 32×18 | **0.0109** |
| I-1 negative control | same, one layer moved 0.05 of frame width | **0.1204** |
| I-13 | `resilience` case | 2 placeholders + working layer, 13.4% lit |

The I-6 pair are identical scenes differing **only** in the glow's blend mode,
so the gap between them is the additive contribution and nothing else.

Both the I-6 and the occlusion assertions live in the **runner**, not only in
the committed goldens. A golden pins what was observed; an assertion says what
must be true. Without the second, a careless `--bless` would quietly record
`add` and `normal` producing the same frame, or the two z-orders producing one,
and every later run would agree with it.

The I-1 threshold of 0.08 is **not taste**. It sits between a measured pass
(0.0109) and a measured failure (0.1204), and the negative control is committed
beside the case so it stays there. If the control ever stops tripping, the
runner reports it **louder** than a mismatch — a blind check makes every pass
beside it worthless, which is a worse failure than a red one.

`MEASURED` — **the projector reported 1920×1080 at this session's launch**, not
the 1280×720 native mode every Gate 0 number was taken at. A3's warning fired
correctly: `buffer 1280x720 / css 1920x1080 / dpr 1 — NOT 1:1, a scaler is in
the path`. The instrument caught it, which is A3 doing its job.

Consequence, stated so it is not discovered later: **no §4 number taken in this
mode is comparable to Gate 0's.** Gate 1's rolling check — both §4 metrics at
Phase 1's layer load — is therefore not runnable until the display is back in
its native mode, and it is a **Gate 1 blocker**, not an optional extra. The
5-minute texture-memory soak is in the same position.

`DECISION` — **Gate 1 is NOT crossed.** Three boxes are open and none of them
was weakened to close it:

- The editor layer list is `[~]`: built, wired, and its logic unit-tested, but
  **nobody has clicked the buttons**. The app launches clean with no console
  errors, which is not the same claim.
- Gate 1's informal wall check is the operator's.
- The §4 rolling check and the texture soak need the projector in its native
  mode.

Everything else in Phase 1 is `[x]` with a number behind it.

`SPEC-CHANGE-PROPOSED` is **not** raised this session. The A1 / §4 reconciliation
over "k recorded at every gate" is due before Phase 3 and is deliberately left
where the last session put it.

`BLOCKER` — **two rulings from Gate 0 are still open, and were not decided
here.** Both were put to the operator this session and both came back
unanswered, so neither was decided unilaterally:

- **A8's k probe** — the fix proposed in `measurements/GATE0-RUNS.md` §4.4 is
  still unapplied. It first *matters* at Phase 3's layer load, where real fill
  work exists, so nothing in Phase 1 or 2 is blocked by it. Raise again at
  Phase 3.
- **A15's statistic** — its trigger reads per-frame instrument max, which
  straddles its own 2% threshold on noise. A15 is ratified as written and was
  not touched. Due at Gate 3.

`IDEAS` — parked, not built:
- The compositor rebuilds the whole layer stack on `setScene`. Honest for
  Phase 1 (static content, operator-paced edits) and it is what keeps texture
  memory flat across a reorder. If Phase 6's live scene switching or a per-frame
  parameter path makes it hurt, that is the phase that will know it.
- The `rect` procedural kind was added for the occlusion check — the only object
  here that is fully opaque, which is what makes "is this layer on top" a fact
  rather than a judgement about alpha. It may be worth keeping as a plain
  colour-field layer regardless.

## 2026-09-04 — Phase 1 (session 2)

- DID: closed Gate 1. §4 measurement at Phase 1 layer load, the §8.2 soak and
  the GPU census that makes it possible, drag-and-drop reordering, and four
  defects found by the operator using the thing rather than by any test.
- MEASURED: full set below.
- BLOCKER: none. Gate 1 is closed.
- NEXT: Phase 2 — Warp v0. `/compact` first.

`GATE-PASSED` — **Gate 1, 2026-09-04. DEV_RESOLUTION 1280×720 on the
projector, `1:1 to panel`, under §4's measurement protocol.**

**§4, run `p1-load`** — `disturbed=false`, valid, 3601 samples, 59.999 fps,
N=16.6667 ms read from `Display.displayFrequency` and A9-validated.

| | |
|---|---|
| M1 | **PASS** — late **0.0000%**, worst late run 0, worst interval 17.70 ms, clause 3 empty |
| M2 | **PASS** — render p99 **0.200 ms = 1.20% of N** against the 60% limit (p95 0.200 ms, informational) |
| A3 | buffer 1280×720 / css 1280×720 / dpr 1 — **1:1 to panel** |
| A14 | per-frame mean 0.0009 ms, max 0.100 ms = **0.60% of N** |

Load: the Phase 1 default scene — `water` (16 bands × 24 segments redrawn every
frame, the only per-frame work) + `tree` + `glow` on `add`, `testPattern`
hidden.

**§8.2 soak, run `p1-soak`** — 8 minutes, `disturbed=false`, 244 scene
rebuilds driven at 2 s intervals.

| t (s) | textures | buffers | geometries |
|---|---|---|---|
| 0.0 | 2 | 38 | 19 |
| 50.0 | 2 | 182 | 91 |
| 110.0 | 2 | 272 | 136 |
| 479.8 | 2 | 272 | 136 |

**§8.2's condition as written passes outright: texture count 2 → 2, +0.00%
across the whole window.** The stricter buffer/geometry census settles at
t=110 s and is then **exactly flat for 6.2 minutes while absorbing ~190
further rebuilds**. A per-rebuild leak cannot stop, so that is pool warm-up,
not leakage.

**Gate 1's own conditions, as numbers rather than impressions:**

| Condition | Measure | Value |
|---|---|---|
| I-6 additive brightening | mean frame luminance, `add` ÷ `normal` | **1.1441×** |
| Occlusion, both directions | centre pixel | `0xd02020` / `0x2040d0` exactly |
| I-1 across resolutions | max per-cell delta, 32×18 signature | **0.0109** |
| I-1 negative control | one layer moved 0.05 of frame width | **0.1204** (limit 0.08) |
| I-12 | round-trip | deep-equal, byte-identical on a second pass |
| §8.1 | golden frames | 15 cases, exit 0; a tampered hash exits 1 |

`DECISION` — **the golden-frame resolution is 1280×720, and the harness runs
under Electron.** Electron because it is already a dependency and is *the
renderer that ships*: a golden produced by a different GL implementation can
pass in CI and differ on the wall. 1280×720 currently **equals
`DEV_RESOLUTION`**, which is the whole hazard A8 names — tidying the literal
into an import would look like a cleanup and would silently delete the net.
Guarded mechanically: tests assert the harness declares it as an object
literal, imports neither resolution constant nor `@shared/ipc` at all, and
never reads a resolution from a display, window, `devicePixelRatio` or env.

`DECISION` — **rotation is stored in turns, not radians.** It puts every field
of a stored transform inside [0,1], making `isNormalizedTransform` a *total*
I-1 check rather than a per-field special case. Radians would put a legal
`3.14` in stored state with no way to tell it from a pixel value by inspection.

`DECISION` — **`ContentProvider.create` is synchronous.** `Promise<LayerView>`
is the tempting shape and the wrong one for a live instrument: awaiting a
provider means a scene switch mid-show stalls on a network fetch. A view exists
from the first frame and populates itself — the same placeholder → poster →
content chain I-13 already requires of video in Phase 3.

`DECISION` — **the I-8 registry holds accessors, not values.** `entity.<id>.*`
reads and writes through to scene state, so there is no second copy of a number
the scene already determines (I-12). The editor's controls write *through* the
registry, so I-8 is load-bearing from Phase 1 rather than a table nothing reads
until Phase 11.

`DECISION` — **drag-and-drop reordering is in phase.** Phase 1's deliverable is
"editor can add / remove / reorder layers" and does not specify the affordance.
`reorderLayer` clamps out-of-range destinations where `moveLayer` returns the
scene unchanged: a button press past the end is a mistake, a drag past the end
is a request.

`MEASURED` — **seven defects. Two were found by tests; five were found by the
operator using the thing, and that ratio is the lesson of this session.**

Found by writing the check:

1. **`moveLayer` was a silent no-op.** It swapped array positions then called
   `reindexZOrder`, which re-indexes by *current draw order* — sorting by the
   very `zOrder` values the swap was meant to exchange. Invisible to the golden
   harness, which builds scenes directly, and to typecheck. Caught by the first
   unit test written against it, which is the argument for having pulled those
   operations out of the click handlers into `core/sceneEdit.ts`.
2. **`canonicalizeScene` converted a typed array instead of refusing it.** A
   `Uint8ClampedArray` is an object with numeric keys, so `Object.entries`
   would turn a 4 MB pixel buffer into a four-million-key plain object and call
   it valid scene state — an I-7 violation arriving through the scene rather
   than through IPC. Now refused at both boundaries.

Found by using it:

3. **Two Phase 0 `invoke` sites carried unguarded payloads** while Gate 0's
   checklist claimed `assertJsonOnly` was on every send site. Neither can carry
   pixels, so an **overstated claim rather than a live defect** — recorded as
   such. Now true, and checked by a grep over `preload.ts`.
4. **The focus badge painted a yellow bar across the projection on every editor
   click.** Harmless while the editor had one slider nobody clicked; wrong the
   moment there was an editor worth using, because clicking the control panel
   takes focus off the output window *by definition*. Restricted to measurement
   runs; the A12 logging stays unconditional.
5. **The first fix for (4) killed the output window before it drew a frame** —
   `applyConfig` calls the badge sync, and main pushes the config while the
   module is still evaluating, during `await createRenderHost`.
6. **Added layers were pixel-identical.** Every new layer got the same
   transform and no tint, so two added `rect`s were two identical white squares
   in the same place and reordering them was a genuine visual no-op. My own
   instructions told the operator to do exactly that.
7. **The water layer could not demonstrate occlusion.** Ripple lines, thin,
   translucent, on black: moving it through the entire draw order changed the
   frame by **0.5%** of mean luminance. The operator reported "everything
   reorders except the water" twice, and both times the ordering was provably
   correct. Water is a surface, not a set of lines; with a body it is **8.1%**.

**(6) and (7) are the same defect twice: the suite kept proving the engine
while the scene kept being unable to show it.** A placeholder object that
cannot demonstrate the invariant it sits under is the wrong placeholder, and
"the tests are green" is not the same claim as "a person can see it work."

`MEASURED` — **a rule-9 miss, found by auditing before closing the gate rather
than by any test.** `tint`, `bands`, `rings`, `cells` and `bodyAlpha` were
introduced across Phase 1 as provider content and **none reached the
registry** — five keys over four commits, against a rule that says *same
commit, from Phase 1 onward*.

Why it slipped is the part worth keeping: "content" felt like a different
category from "parameter", because `layer.content` is opaque to the compositor
by design (I-3). But **opaque to the compositor is not the same as outside the
instrument.** Phase 11's MIDI mapping would have gone looking for
`entity.tree.tint` and found half the instrument unaddressable.

Providers now declare their own parameter keys, bound to `layer.content`
through accessors. `kind` and `when` are excluded with a stated reason rather
than by omission — `kind` does not modulate a layer, it replaces it.
**Rule 9 is now a grep, not a habit:** a test extracts every `content['x']` the
provider reads, subtracts declared structural keys, and fails on any that is
not registered, naming the key and both ways to fix it. Verified in both
directions. **That guard is the deliverable; the five keys were a symptom of
nothing checking.**

`MEASURED` — **coverage lesson, recorded because it cost three rounds at the
wall with every test green.** The suite proved the transform, the round-trip,
the draw order, the compositor and the live teardown-rebuild, and **not one of
them proved a person could see the result.** The golden harness also only ever
called `setScene` *once* per Application, so the editor's actual path — hand a
new scene to a live compositor — had no coverage at all. Both gaps are now
committed cases: `occlusion-reordered-live`, and an `editor-two-rects` pair
that renders the operator's exact click sequence and fails if the layer list
ever stops being able to demonstrate z-order.

`MEASURED` — **two runs discarded to focus loss, both kept.** The first §4 run
reported `disturbed=true` from a `focus LOST` at t=2.52 s and **its numbers
were fine** — which is exactly why the rule exists: a disturbed run that
happens to look good is the easiest one to talk yourself into keeping. The
soak run lost focus at t=35.8 s having *gained* it 2.3 s earlier, so something
activated the app. External disturbance, not a harness defect. **If a third run
is lost the same way, the harness should hold focus for the window rather than
merely notice losing it.**

`MEASURED` — **the display mode had drifted, and the instrument caught it.**
The projector reported **1920×1080** at this session's first launch, not the
1280×720 native mode every Gate 0 number was taken at, and A3 fired:
`buffer 1280x720 / css 1920x1080 — NOT 1:1, a scaler is in the path`. The
operator restored the mode and every number in this entry was taken at
`1:1 to panel`. **A stale caveat about this was left sitting inside a Gate 1
box for several hours and has been removed** — a gate box carrying an expired
warning is the same defect Gate 0 hit twice with its own stale lines.

`DECISION` — **the blur is attributed to the projector, and the attribution is
unconfirmed.** A 500 ANSI 720p DLP with auto-focus deliberately disabled at
Gate 0 is a wholly sufficient explanation, and the operator's own read. The
discriminator was never run: make the `testPattern` layer visible and see
whether its 1–2 px grid and magenta frame are crisp. **Recorded as an
attribution rather than a finding** — A9's principle binds prose as much as
numbers, and "probably the projector" is not a measurement.

`BLOCKER` — **two rulings from Gate 0 remain open and were not decided here.**
Both were put to the operator and neither came back; neither was decided
unilaterally.

- **A8's k probe.** Phase 1 produced **1.3269** (clean run) and **1.4158**
  (discarded run) on the same scene — two samples 6.7% apart, against Gate 0's
  0.379–5.000 across nine samples on a trivial scene. `GATE0-RUNS.md` §4.4
  predicted exactly this. **The probe source is unchanged, so this is evidence
  for the Phase 3 ruling, not a fix.**
- **A15's statistic.** Per-frame instrument max measured **0.60% of N** at a
  real layer load, comfortably under the 2% trigger; Gate 0's 1.8–4.2% was on a
  trivial scene. One data point toward Gate 3, not a discharge of it.

The **A1 ↔ §4 reconciliation** over "k recorded at every gate" is still due
before Phase 3 and is still a `SPEC-CHANGE-PROPOSED`, not a checklist fix.

`IDEAS` — parked, not built:
- The compositor rebuilds the whole layer stack on `setScene`. Honest for
  Phase 1 and measured not to leak. If Phase 6's live scene switching makes it
  hurt, that is the phase that will know.
- The default scene demonstrates I-6 well and occlusion poorly. Two opaque
  overlapping objects in it would make the wall check work on launch instead of
  after two clicks.
- `readGpuResources` reaches into two Pixi internals. It reports INVALID rather
  than zero if they move, but a version bump should expect to touch it.

## 2026-09-04 — Phase 2 (session 1)

- DID: Phase 2's whole buildable surface in six commits — calibration model,
  warp stage, persistence, editor panel, and two defects a run log exposed.
  Rolling checks reset for the phase.
- MEASURED: the tessellation table, the identity-resample result, and one
  discarded §4 run. All below.
- BLOCKER: Gate 2 needs two §4 runs and a wall check, and the first run
  attempt was discarded. Three deliverable boxes are `[~]`, not `[x]`.
- NEXT: (1) the two §4 runs on a quiet machine, warp off and warp on.
  (2) the wall check — the only thing that closes Gate 2's first condition.
  (3) the blur discriminator, which is now time-critical: see below.

`DECISION` — **warp corners are NOT in the I-8 parameter registry.** The
operator's ruling, and the reasoning is worth keeping. I-8's subject is forces,
per-entity parameters and grade settings — the things an operator modulates
during a show. Calibration is a description of a physical surface, and I-5
isolates it from scene logic in both directions. Registering the corners would
make them MIDI-mappable in Phase 11, where one knock of a knob destroys a
calibration that took someone on a ladder to make, with no undo on a wall.

The absence is now **a grep, not an intention**: a test scans `src/` outside
the tests for any `warp.*` key literal. Verified in both directions — planting
`'warp.enabled'` in `render/outputs.ts` fails the test by name and path.
Reversing the decision is fine, but it costs editing that test and saying why
here, which is the right amount of friction.

`DECISION` — **the warp stage runs in the output window only; the editor
preview stays unwarped.** D11 says placement happens in scene (pre-warp) space
and that Phase 5 must present the preview *as* the placement space — "a
scene-space grid overlay, not a photo of the wall". A warped preview would put
the operator's objects on a distorted canvas and teach exactly the mental model
D11 exists to prevent. The warp editor is therefore a wireframe of the
*correction*, not a picture of the result; the result is judged where Gate 2
says to judge it, on the surface.

`DECISION` — **off means absent, not identity.** With the warp disabled the
composite is a direct stage child and no render texture is in the path at all.
Gate 2's "disabling warp changes nothing in the scene" is therefore structural
rather than a claim about floating point.

The evidence is stronger than the claim needed: **all 15 Phase 1 goldens are
byte-identical across the whole phase** — 60 insertions and 0 deletions in
`frames.json`. This contradicts the going-in expectation that rendering through
a RenderTexture would change every golden hash, and the bypass is why. There
was no re-bless of existing frames to judge; the four new cases were blessed
after looking at the previews.

`MEASURED` — **a 2×2 quad cannot do this job, and no hash would ever say so.**

Two triangles interpolate linearly, so a bare quad is off by **91.58 px** from
the exact projective map on the very keystone Gate 2 uses.

| verticesX | Gate 2's keystone | harsher off-axis quad |
|---|---|---|
| 2 | **91.58 px** | **166.08 px** |
| 10 (PixiJS default) | 1.63 px | 4.48 px |
| 20 | 0.37 px | 1.07 px |
| **40 (chosen)** | **0.09 px** | **0.26 px** |

PixiJS 8.20 ships `PerspectiveMesh`, which pushes vertex *positions* through
the true homography on a subdivided plane, so every vertex is exact and the
only residual is affine interpolation inside a cell. 40 rather than 20 because
the cost is close to zero and paid in the wrong place to matter: the geometry
is rebuilt in `setCorners`, which runs on a corner drag, not per frame.

The table is recomputed by a unit test against an **independently solved**
homography. Grading Pixi's output with Pixi's own maths would check nothing.
The 2×2 row is asserted too — it is the negative control, and without one the
choice of 40 would be taste.

`MEASURED` — **the identity round trip does not resample.** The claim worth
distrusting was not "warp off is unchanged" but its opposite number: warp **on**
at identity corners is a full round trip through a render texture and a 40×40
mesh, and a half-pixel misalignment there would put a blur on the wall.

It is **pixel-identical**: `default`, `warp-disabled` and `warp-identity` all
hash `ba2e7858`; `warp-keystone` differs (`fc055613`). All three relations are
asserted in `scripts/golden.mjs`, not merely stored as goldens, so a careless
re-bless cannot quietly record a warp stage that resamples every frame or one
that does nothing at all.

**This matters beyond the hash.** The blur on the wall is still attributed to
the projector and that attribution is still unconfirmed. Had the warp stage
resampled, the existing attribution would have absorbed the new blur silently
and the discriminator would have become uninterpretable. It did not, so the
attribution is undamaged — but the discriminator is now **time-critical**: a
`testPattern` reading taken *after* a warp stage is in the path is a reading of
two suspects at once.

`MEASURED` — **two defects, neither found by a test, both sitting in a run log.**

1. **The GPU census threw on a destroyed texture, and had since Phase 1.**
   `managedTextures` can hold a null slot — PixiJS nulls the entry when a
   texture source is destroyed rather than compacting the array — and the
   census read `t.pixelWidth` straight off it. It appears as an uncaught
   "Cannot read properties of null (reading 'pixelWidth')" **in the p1-soak log
   as well as the p2 run**. It was on record at Gate 1, in plain sight, and
   nothing was watching for it. Phase 1 had no textures so it only ever fired
   at teardown; from Phase 2 there is a composite render texture, which puts it
   on the path of the §8.2 soak check itself — the check whose whole job is to
   watch textures appear and disappear.

2. **A corner drag emitted ~300 `[warp]` lines and buried the rest of the log**
   — including, in that same run, a projector hot-plug and a display-mode
   change. Phase 1's lesson is that these lines are what make a bug findable
   from a wall. A line nobody can find is not instrumentation. Corner moves now
   coalesce at ~4 Hz with a **trailing** emit, so a drag cannot end on a stale
   position; toggling and degrading are never coalesced.

`MEASURED` — **the first §4 attempt is DISCARDED, and it is the dangerous kind.**
Kept as `measurements/p2-warp-off-DISCARDED-interaction.log`.

It reports `disturbed=false`, `valid=true`, 3600 samples, 59.98 fps, **M1 and
M2 both passing** — M2 render p99 0.200 ms = 1.20% of N, identical to Phase 1's
baseline. That is precisely the run that is easiest to talk yourself into
keeping. The log says otherwise:

- the **projector was removed and re-added mid-session** (`display-removed` at
  09:02:07, `display-added` at 09:02:18). The output window reopened twice and
  `[run] START` appears three times; one of those windows reported
  `NOT 1:1 — a scaler is in the path` on the built-in Retina display.
- `[trace] activate windows=2` lands **inside** the measured window, and the
  single late interval of the whole run (**33.40 ms**, worstLateRun 1) sits
  immediately after it. Phase 1 measured 0.0000% late, worst interval 17.70 ms.
- the operator was **dragging warp corners during the window**, and the drag is
  in the log.

`disturbed=false` caught none of it, which is a finding rather than an excuse:
**the flag watches for focus being LOST, and this run was disturbed by focus
being GAINED.** Phase 1 already noted that the harness should hold focus rather
than merely notice losing it. This is the same gap approached from the other
side, and it is now two runs old.

Two things the run did establish, neither of them a gate number:

- **the calibration write path works end to end.** The operator's drags
  produced `calibration/warp.json` through editor → main → disk. The read-back
  on relaunch is implemented but has not been exercised.
- **A8's k probe produced 1.2773** on this scene, against Phase 1's 1.3269 and
  1.4158 and Gate 0's 0.379–5.000 on a trivial scene. Three samples now sit in
  1.28–1.42. Still informational, still unchanged source, still a Phase 3
  ruling — but the spread is narrowing on real fill work, exactly as
  `GATE0-RUNS.md` §4.4 predicted.
- **A15**: instrument per-frame max 0.100 ms = **0.60% of N**, the same figure
  as Phase 1 and well under the 2% trigger. A second data point toward Gate 3.

`DECISION` — **Gate 2 is NOT crossed, and three deliverable boxes are `[~]`.**
Nothing was weakened to make anything pass:

- the **warp toggle has never been switched on in a live session.** Every
  `[warp]` line on record reads `OFF`.
- the **corners have been dragged but nothing has been squared**, because they
  were dragged with the warp off.
- **calibration has never been read back on a relaunch**, which is also Gate 2's
  third condition.
- the wall check is the operator's and no test substitutes for it.

`BLOCKER` — **the two §4 runs need a machine nobody is using.** Both
disturbances in the discarded run were external: a projector hot-plug and live
editor interaction. Re-running while the machine is in use produces another
discarded log, not a number.

`BLOCKER` — **the three carried rulings are untouched, deliberately.** A8's k
probe and A15's statistic are due at Phase 3 / Gate 3 and gained a data point
each here, above. The **A1 ↔ §4 reconciliation** over "k recorded at every
gate" is still a `SPEC-CHANGE-PROPOSED` and still due before Phase 3.

`IDEAS` — parked, not built:
- The `disturbed` flag should assert focus for the measured window rather than
  observe it. Two runs have now been lost to focus events in opposite
  directions, and the second one did not even set the flag.
- `calibration/warp.json` is gitignored, which is right — it describes one
  surface in one room. But there is now no committed example of the format, so
  Phase 7's migration test will have to construct its own Phase 2 fixture.
- The warp editor shows the correction as a wireframe. Overlaying the live
  preview *behind* that wireframe, at low opacity, would make the shape easier
  to reason about without warping the placement space. Phase 5's call, not
  this one's.

## 2026-09-04 — Phase 2 (session 1, part 2)

- DID: the Gate 2 measurements on a free machine. Four clean §4 runs, a
  6-minute soak, and one instrument addition that the measurement forced.
- MEASURED: full set below. All eight rolling checks are now green.
- BLOCKER: Gate 2 is **not crossed**. Three conditions are the operator's and
  cannot be closed from here.
- NEXT: the wall. See the list at the end.

`MEASURED` — **the warp stage costs +10.65 µs = 0.064% of N, and M2 cannot see
it at all.**

Four runs at DEV_RESOLUTION 1280×720, all `disturbed=false`, all `1:1 to
panel`, one `[run] START` each, no events, no renderer errors.

| run | samples | fps | M1 late | worst interval | M2 p99 | render mean |
|---|---|---|---|---|---|---|
| `p2-warp-off` | 3601 | 60.000 | 0.0000% | 17.70 ms | 0.200 ms = 1.20% of N | **62.23 µs** |
| `p2-warp-off-2` | 3601 | 60.000 | 0.0000% | 17.70 ms | 0.200 ms = 1.20% of N | **68.20 µs** |
| `p2-warp-on` | 3601 | 60.000 | 0.0000% | 17.70 ms | 0.200 ms = 1.20% of N | **74.48 µs** |
| `p2-warp-on-2` | 3600 | 59.999 | 0.0000% | 18.80 ms | 0.200 ms = 1.20% of N | **77.25 µs** |

- paired deltas: **12.25 µs** and **9.05 µs**
- delta of run means: **10.65 µs = 0.064% of N**
- within-condition spread: 5.97 µs (off), 2.77 µs (on)
- **the two groups do not overlap**: max off 68.20 < min on 74.48, a gap of
  6.28 µs

Stated at the precision the data supports: the warp stage costs **about 10 µs**,
the effect is larger than the run-to-run noise and cleanly separated, and with
n=2 per condition it is not resolved to two significant figures.

`MEASURED` — **M2 is pinned at its own resolution floor, and that is a finding
about the instrument, not about the warp.**

`renderP99Ms` is **0.200 ms in all four runs** — identical to Phase 1's, and
identical between warp off and warp on. So is p95. Every render statistic in
every run is an exact multiple of 0.1 ms, because `performance.now()` is
coarsened to 100 µs in Electron. A percentile of quantized samples cannot
resolve a change smaller than one quantum, and the warp costs about **an eighth
of one quantum**.

That left Gate 2's "frame-time cost of the warp stage measured and recorded"
literally unanswerable with the statistics that existed — the honest reading of
the first pair was "identical, therefore below instrument resolution", which is
an upper bound, not a measurement.

So a **render mean over the full window** was added. Averaging 3601 quantized
samples resolves to roughly a thousandth of a quantum, and it is summed on the
copy pass `renderPercentiles` already made, so it stays a 4 Hz cost and never a
per-frame one (A14).

**A10 is untouched and M2 still gates on p99.** The mean is informational and
sits beside p95, which is already informational for the same kind of reason.
Its unit test is the point rather than a formality: two windows whose p99 and
p95 are *identical* (0.200 ms both) but whose means differ 2.1× (0.00351 vs
0.00752 ms). A statistic that could not do that would not have earned a place.

This matters past Phase 2. M2 reading 1.20% of N against a 60% limit has been
recorded at Gate 0, Gate 1 and now Gate 2, and it is **not a measurement of
headroom — it is a floor reading**. The real render cost at Phase 2's load is
62–77 µs, which is 0.37–0.46% of N. Phase 3 brings video, sprite sheets and
Lottie, and M2 will start reporting real numbers then; until it does, the
apparent constancy of 1.20% across three gates says nothing.

`MEASURED` — **§8.2's soak, with a subject at last.** `p2-soak`, 6 minutes,
**warp ON**, `disturbed=false`, 1:1 to panel, **184 scene rebuilds**.

| t (s) | textures | texture bytes | buffers | geometries |
|---|---|---|---|---|
| 0.1 | 3 | 3,686,408 | 47 | 23 |
| 50.0 | 3 | 3,686,408 | 191 | 95 |
| 110.0 | 3 | 3,686,408 | 281 | 140 |
| 359.8 | 3 | 3,686,408 | 281 | 140 |

**§8.2's condition as written passes outright: texture count 3 → 3 and texture
bytes +0.00% across the whole window.**

The number that matters is 3,686,408. **1280 × 720 × 4 = 3,686,400**, so the
composite render texture is the overwhelming majority of it — this check finally
has the subject Gate 1's annotation admitted it lacked, and what it is watching
is the warp's own allocation. It does not churn across a single one of 184 full
layer-stack rebuilds, which is the design working: the texture is allocated on
first enable and kept, never freed and reallocated on a toggle.

Buffers and geometries warm up 47→281 and 23→140 by t=110 s, then are **exactly
flat for 249.8 s across 128 further rebuilds** — the same shape Phase 1 found,
settling 9 buffers and 4 geometries higher, which is the warp mesh. `judgeSoak`
still returns `flat=false` for the full window because of that ramp, and the
steady-state figures are reported **beside** it, never instead of it.

The `pixelWidth` crash is gone: no `output:error` line in this run, where both
p1-soak and the discarded p2 run had one.

`MEASURED` — **A8 and A15 gained data points; neither ruling is discharged.**

- **k probe**: 0.9655, 0.9815 (this pair), against 1.2773 in the discarded run
  and Phase 1's 1.3269 / 1.4158. Six samples now span **0.97–1.42** on real
  scenes, against Gate 0's 0.379–5.000 on a trivial one. The probe source is
  still unchanged, so this remains evidence for the Phase 3 ruling and not a
  fix. Worth noting the two warp-ON probes are not comparable to the warp-OFF
  ones: with the warp active the probe re-renders the *mesh*, not the
  compositor, so it is timing a different subject.
- **A15**: instrument per-frame max **0.100 ms = 0.600% of N** in all four
  runs, identical to Phase 1, comfortably under the 2% trigger. A15 stays
  ratified as written and due at Gate 3.

`DECISION` — **Gate 2 is NOT crossed.** Nothing was weakened. Two boxes are
`[x]` on evidence, three are open and all three need a person at a wall:

- **the keystone has never been judged by eye.** The engine has run ON with a
  real keystone five times; nobody has looked at the surface and said it is
  square. That is Gate 2's first condition and no test substitutes for it.
- **the toggle has never been clicked.** The warp was enabled from the
  calibration file each time, not from the checkbox.
- **the calibration round trip has never been done as one gesture.** Each half
  is proven separately — the editor's drags wrote `calibration/warp.json`, and
  five launches read a keystone back off disk and applied it before the first
  frame — but the file that was read back was hand-written for the measurement
  runs. Drag, relaunch, confirm the corners came back is a 30-second check.
- **Scene A / Scene B has never been clicked** with a calibration in place.

`calibration/warp.json` is deliberately left holding the enabled keystone, so
the next launch comes up warped and the wall check needs no setup.

`BLOCKER` — **the A1 ↔ §4 reconciliation is still a `SPEC-CHANGE-PROPOSED` and
is now overdue-adjacent**: it is due before Phase 3, and Phase 3 is next.

`IDEAS` — parked, not built:
- M2's floor reading. Now that a render mean exists, the honest presentation of
  §4 might be "p99 for the gate, mean for the trend". Phase 9's grade and
  performance pass is where that belongs, not here.
- The soak drives rebuilds every 2 s, which makes its render mean (80.45 µs)
  incomparable to the clean pair. If the soak is ever wanted as a frame-time
  source too, it needs a quiet variant.

## 2026-09-04 — Phase 2 (session 1, part 3)

- DID: first wall session. Two Gate 2 conditions closed on a real projection,
  one defect found by the operator using the thing, and **one recorded
  attribution overturned by the discriminator that was never run.**
- MEASURED: below.
- BLOCKER: Gate 2 still open. Three checks remain, all the operator's.
- NEXT: the keystone by eye, the calibration round trip as one gesture, and
  I-6 by eye.

`MEASURED` — **the blur is NOT the projector. The attribution recorded at
Gate 1 is falsified.**

The discriminator was finally run: `testPattern` visible, **warp OFF** so the
path is the Phase 1 pipeline byte for byte. The operator reports the 1–2 px
grid and the magenta frame as **sharp — crisp thin lines**.

Gate 1 recorded this, deliberately, as an attribution rather than a finding:

> `DECISION` — the blur is attributed to the projector, and the attribution is
> unconfirmed. A 500 ANSI 720p DLP with auto-focus deliberately disabled at
> Gate 0 is a wholly sufficient explanation, and the operator's own read.

A wholly sufficient explanation that turns out to be the wrong one. **This is
exactly why A9 binds prose as well as numbers**, and why that entry was written
as an attribution: it cost one observation to overturn, and nothing was built on
it in the meantime.

What the result proves: the path from framebuffer to panel resolves 1–2 px
features crisply at 1:1, so there is no scaler and no defocus **at the scale of
the grid**.

What it does not prove: that nothing is soft. It **relocates the cause into the
content**, which is where every candidate now sits — Phase 1's layers are a
tree of thin strokes, water drawn as translucent ripple lines, and a glow that
is a soft radial gradient by construction. All three would read as soft beside a
hard-edged grid on the same panel in the same frame.

Recorded now because it changes what Phase 3 should worry about: sharpness is a
content-authoring property here, not a hardware one, and no projector change
would have improved it. Had the attribution stood, the obvious next move would
have been to re-focus or replace a projector that is doing its job.

`MEASURED` — **the identity round trip is visually lossless on real hardware.**
With corners reset to identity, toggling the warp ON and OFF produces **no
change the operator can see** — at a full round trip through a render texture
and a 1600-vertex mesh.

This is the hardware confirmation of the golden assertion that `default`,
`warp-disabled` and `warp-identity` all hash `ba2e7858`. It is worth having
separately from the hash: a headless harness and the shipping renderer agreeing
is a claim, and this is the check that would have caught them disagreeing.

Taken with the finding above, the warp stage is cleared twice over — it does not
resample, and it is not the blur, because there is no blur in the path.

`MEASURED` — **Gate 2's scene-isolation condition, closed on a real
projection.** The session switched `phase1-default` ⇄ `phase2-alt` repeatedly
with a keystone in place. The log shows consecutive `[scene] applied` lines with
**no `[warp]` line between them**, and the corners byte-identical either side.

The stop condition written for this check did not fire, which is the point of
having written one: nothing on the scene path touches calibration, and that was
observed rather than argued.

`MEASURED` — **the warp toggle, clicked.** A dozen `OFF ⇄ ON` transitions at
both a keystone and identity, interleaved with scene switches and layer edits.
No error, no dropped frame, M1 0.00% late across the whole session, worst
interval 17.80 ms.

`MEASURED` — **three of the four corner handles could not be caught, and the
log is what found it.** TL never left `(0.1200, 0.0000)` and BR/BL never left
their corners across two full drag attempts. Only TR ever moved by hand, and its
path wanders out to `(0.74, 0.63)` and back — which is what fighting a control
looks like in a log.

Three causes, all in the same twenty lines:

1. **The handles were clipped.** Corners are normalized `[0,1]` drawn onto an
   SVG whose viewport is exactly that box, so a handle at 0 or 1 sits ON the
   boundary — and an `<svg>` clips to its viewport. About a quarter of a 6 px
   circle was hittable. **Identity puts all four corners on the boundary at
   once**, so this was the state every new calibration starts in.
2. **The corner teleported to the pointer**, with no grab offset. The log shows
   it happening: TR's y jumps `0.0000 → 0.0209` on the very first move, a
   ~5.6 px displacement from nothing but an off-centre grab.
3. **A 6 px circle was the whole hit target**, on a control operated while
   looking at a wall rather than at the screen.

**The model underneath was never wrong.** 28 unit tests, clamping correct,
degenerate quads refused correctly, the `[warp]` line accurate throughout.
Nothing tested whether a person could reach a handle. That is Phase 1's lesson
arriving one phase later, in its exact original form: *the suite proved the
engine while the thing on top of it could not be operated.*

The guard added is arithmetic and asserts the property that was violated —
every handle **and its whole hit target** lies inside the viewport at every
legal corner position, all four extremes included. A corner can now also be
selected from a button row without being grabbed, which is what makes the arrow
keys usable for the last few pixels rather than a nicety beside a drag nobody
can start.

`DECISION` — **the first keystone attempt is VOID, not failed.** It was made
with one usable handle out of four, so it is not evidence about whether a
keystone can square a projection. Re-run on the fixed control.

`BLOCKER` — three checks remain, all requiring a person at the wall:
- the keystone by eye, on a deliberately angled projection (Gate 2, first
  condition)
- the calibration round trip as one gesture: drag, quit, relaunch, compare
- I-6 by eye — whether `add` reads as light rather than as paint

`IDEAS` — parked, not built:
- The sharpness finding suggests a content question Phase 3 will meet head on:
  thin strokes and soft gradients are what read as blurry on a 500 ANSI
  projector, and stroke width is a scene-authoring parameter nobody has thought
  about. Not a Phase 2 concern, but the first bundled sprite assets will be.

## 2026-09-04 — Phase 2 (session 1, part 4)

- DID: Gate 2's first condition met on a real surface. One observation from the
  previous entry withdrawn.
- MEASURED: below.
- BLOCKER: Gate 2 still open — three checks left.
- NEXT: re-check the identity case, the calibration round trip, I-6 by eye.

`CORRECTION` — **the identity-round-trip observation recorded in part 3 is
WITHDRAWN.** That entry recorded:

> `MEASURED` — the identity round trip is visually lossless on real hardware.
> With corners reset to identity, toggling the warp ON and OFF produces no
> change the operator can see.

The operator has since said they need to check it, so it was not an observation
of the identity case. It is withdrawn rather than softened: the difference
between "confirmed" and "not yet checked" is the whole content of the claim.

This entry is appended rather than the previous one edited — `BUILD_LOG.md` is
append-only, and a log that can be rewritten is not evidence.

**What is unaffected:** the golden assertion that `default`, `warp-disabled` and
`warp-identity` all hash `ba2e7858` while a keystone differs. That is mechanical,
it is asserted in `scripts/golden.mjs` rather than merely stored, and it never
depended on anybody's eyes. `CHECKLIST.md`'s box for "disabling warp changes
nothing" rests on that plus the import graph, and it stood on those before the
withdrawn observation was added.

**What is affected:** the *hardware* confirmation of it. The value of that check
is that it is the one thing that would catch the headless harness and the
shipping renderer disagreeing — a hash cannot report that, by construction. It
is back to unchecked.

`GATE-CONDITION MET` — **the keystone squares a deliberately angled projection
on a real surface, 2026-09-04.** Gate 2's first condition, and the one nothing
in the repo could substitute for.

The operator tilted the projector until the image was visibly not square, then
pulled it back with the four corners: *"i tilted the projector and played with
the warp and managed to make it square and normal again."*

Recorded with the hedge the operator actually used — *"as much as i can"* —
rather than smoothed into a clean pass. That hedge is in scope for Phase 2 and
out of scope to fix here: SPEC.md §11 calls this warp "deliberately early and
deliberately rough", and Phase 7 is the phase that owns precision, an N×M
control grid, and a curved surface. How much residual is left at the limits is a
Phase 7 input, and it is worth asking again then rather than resolving now.

**This is the product premise.** A projector sitting crooked and a square image
on the wall is what the whole instrument is for, and until today it had only
ever been true in a hash. The 40×40 projective mesh was chosen from a
measurement that said a 2×2 quad would be off by 91.58 px on this exact
keystone; the wall is where that stops being arithmetic.

The attempt made before the handle fix is **void, not failed** — one usable
handle out of four is not a test of whether a keystone can be set — and is not
counted toward this condition.

`MEASURED` — **the handle fix works.** The corner control was rebuilt between
the two attempts (clipped handles, no grab offset, 6 px hit target), and the
difference between the two sessions is the difference between a log full of one
corner wandering and an operator reporting the job done.

## 2026-09-04 — Phase 2 (session 1, part 5) — GATE 2 PASSED

- DID: closed Gate 2. The last three wall checks came back clean.
- MEASURED: the full set below.
- BLOCKER: none for Phase 2. One `SPEC-CHANGE-PROPOSED` is due before Phase 3.
- NEXT: Phase 3 — global clock, animated layers, bundled assets. `/compact`
  first.

`GATE-PASSED` — **Gate 2, 2026-09-04. DEV_RESOLUTION 1280×720 on the projector,
`1:1 to panel`, under §4's measurement protocol.** No condition was weakened and
no box was crossed unchecked.

**Gate 2's five conditions, as evidence rather than impressions:**

| Condition | How it was answered | Result |
|---|---|---|
| Keystone squares an angled projection on a real surface | operator, projector deliberately tilted | **met** — squared by hand, operator's hedge "as much as i can" recorded |
| Disabling warp changes nothing; no scene code reads warp state | goldens + import graph + operator | **met** — `ba2e7858` three ways; no `core/` or `providers/` import; no visible change at identity on the wall |
| Calibration survives relaunch | operator, one continuous gesture | **met** — set, quit, relaunch, corners returned, projection still square |
| Loading a different scene keeps the same calibration | wall session log | **met** — consecutive `[scene] applied` with **no `[warp]` line between** |
| Frame-time cost of the warp stage recorded | four §4 runs | **met** — **+10.65 µs = 0.064% of N** |

**§4, four runs** — all `disturbed=false`, `1:1 to panel`, one `[run] START`
each, no events, no renderer errors.

| run | samples | fps | M1 late | worst interval | M2 p99 | render mean |
|---|---|---|---|---|---|---|
| `p2-warp-off` | 3601 | 60.000 | 0.0000% | 17.70 ms | 0.200 ms = 1.20% of N | 62.23 µs |
| `p2-warp-off-2` | 3601 | 60.000 | 0.0000% | 17.70 ms | 0.200 ms = 1.20% of N | 68.20 µs |
| `p2-warp-on` | 3601 | 60.000 | 0.0000% | 17.70 ms | 0.200 ms = 1.20% of N | 74.48 µs |
| `p2-warp-on-2` | 3600 | 59.999 | 0.0000% | 18.80 ms | 0.200 ms = 1.20% of N | 77.25 µs |

Warp cost: paired deltas **12.25** and **9.05 µs**; delta of run means
**10.65 µs = 0.064% of N**; groups do not overlap (max off 68.20 < min on
74.48). A15: instrument per-frame max **0.100 ms = 0.600% of N** in all four.

**§8.2 soak** — `p2-soak`, 6 minutes, **warp ON**, `disturbed=false`, **184
scene rebuilds**: texture count 3 → 3, **texture bytes 3,686,408 → 3,686,408,
+0.00%**. 1280 × 720 × 4 = 3,686,400, so the composite render texture is what is
being watched. Buffers/geometries settle 47→281 / 23→140 at t=110 s then
**exactly flat for 249.8 s across 128 further rebuilds**.

**§8.1** — 19 golden frames, exit 0. **All 15 Phase 1 frames byte-identical**
across the whole phase: 60 insertions, 0 deletions in `frames.json`. 262 unit
tests, both typechecks clean.

**Geometry** — a 2×2 quad is off **91.58 px** from the exact projective map on
Gate 2's own keystone (166.08 px on a harsher one). At 40×40: **0.09 px** and
**0.26 px**.

**A8** — k probe 0.9655 and 0.9815 this pair. Six samples on real scenes now
span **0.97–1.42** against Gate 0's 0.379–5.000 on a trivial one. Source
unchanged; still a Phase 3 ruling.

`MEASURED` — **the phase's four defects, and where each was found.** The ratio
is the same one Phase 1 recorded, and it did not improve.

| # | Defect | Found by |
|---|---|---|
| 1 | Render texture destroyed while still bound to a shader | the golden harness treating renderer output as failure |
| 2 | GPU census threw on a destroyed texture — **present since Phase 1**, in the p1-soak log, unnoticed | reading a run log |
| 3 | A corner drag emitted ~300 `[warp]` lines and buried a projector hot-plug in the same log | reading a run log |
| 4 | **Three of four corner handles could not be caught** | the operator failing to use it |

Not one was found by a unit test. Two were found by *reading logs the project
already produced*, which is an argument for the `[scene] applied` / `[warp]`
convention rather than for more tests.

`MEASURED` — **the handle defect is Phase 1's lesson arriving unchanged.** The
warp model had 28 unit tests, correct clamping, correct refusal of degenerate
quads, and an accurate `[warp]` line. The control on top of it was close to
unusable: handles drawn at normalized `[0,1]` onto an SVG whose viewport is
exactly that box sit **on** the boundary and get clipped to about a quarter of a
6 px circle — and identity puts all four there at once, which is the state every
new calibration starts in. The log proves it: TL never left `(0.1200,0.0000)`
and BR/BL never moved, across two full attempts.

Phase 1 wrote: *"the suite proved the engine while the SCENE could not
demonstrate the invariant."* Phase 2's version is *the suite proved the geometry
while the CONTROL could not be operated.* The countermeasure that worked both
times is the same one: put the thing in front of a person.

`MEASURED` — **an attribution was overturned, at the cost of one observation.**
The blur on the wall was attributed at Gate 1 to the projector — "a wholly
sufficient explanation". It is **sharp**: the discriminator, run with the warp
off, resolves the 1–2 px grid and the magenta frame crisply. The cause is in the
**content** — thin strokes, translucent ripple lines, a soft radial glow. Had
the attribution stood, the next move would have been to re-focus or replace a
projector that is doing its job. **A9 binds prose as much as numbers**, and this
is the return on having written it as an attribution instead of a finding.

`MEASURED` — **one claim was recorded and withdrawn inside this phase.** The
identity-round-trip observation was reported, entered as `MEASURED`, then
withdrawn when the operator said they needed to check it, then re-checked
properly and confirmed. Kept visible in the log rather than tidied away, because
the withdrawal is the part worth keeping: *"working"* and *"no visible change"*
are not the same report, and the second is the only one that answers the
question. Two ambiguous reports this session resolved the opposite way from the
first reading.

`MEASURED` — **M2 is a floor reading, not headroom.** `renderP99` has now
recorded 1.20% of N against a 60% limit at Gate 0, Gate 1 and Gate 2, identical
warp off and warp on, because `performance.now()` is coarsened to 100 µs and
every render statistic is a multiple of 0.1 ms. Real cost at this load is
62–77 µs = 0.37–0.46% of N. The apparent constancy across three gates says
nothing, and **Phase 3 is the first phase where M2 will report a real number.**

`DECISION` — **warp corners are not in the I-8 registry** (operator's ruling;
enforced by a grep verified in both directions). **The warp stage runs in the
output window only**, never the editor preview (D11). **Off means absent, not
identity** — no render texture in the path when disabled, which is why Phase 1's
goldens are untouched. Full reasoning in parts 1–4 of this phase.

`BLOCKER` — **the A1 ↔ §4 reconciliation over "k recorded at every gate" is
still an open `SPEC-CHANGE-PROPOSED` and is now due.** Phase 3 is next. A8's k
probe and A15's statistic are both due at Gate 3 and each gained data points
here.

`IDEAS` — parked, not built:
- Sharpness is a **content-authoring** property, not a hardware one. Stroke
  width and gradient softness are what read as blurry on a 500 ANSI projector,
  and Phase 3's first bundled sprite assets are where that starts to matter.
- The `disturbed` flag watches for focus being LOST; one run this phase was
  disturbed by focus being GAINED and the flag stayed false. It should assert
  focus for the measured window rather than observe it.
- `calibration/warp.json` is gitignored, so there is no committed example of the
  format for Phase 7's migration test to load. It will need its own fixture.

## 2026-09-04 — Phase 2 (session 1, part 6) — the A1 reconciliation

- DID: worked the A1 ↔ §4 contradiction to a decision-ready proposal, and
  found a probe defect while gathering the evidence for it.
- MEASURED: eight k samples pulled from the run logs rather than from memory.
- BLOCKER: **`SPEC.md` is not edited here.** CLAUDE.md's document contract says
  propose and stop; the operator ratifies.
- NEXT: the ruling. Then Phase 3.

`SPEC-CHANGE-PROPOSED` — **"k and the thermal derate are recorded at every
gate" contradicts §4's own operative sentence, and it is a four-way
inconsistency, not the two-way one previously logged.**

**The four texts, quoted.**

1. **§1, A1** — "k is measured at minute 1 and minute 20 of a continuous run
   and the delta recorded **at every gate**; Phase 9's soak becomes 20 minutes
   and its gate is judged on minute-20 k."
2. **§4, "Thermal derate (A1)"** — "**k is measured at minute 1 and again at
   minute 20 of a continuous run, and the delta is the thermal derate, recorded
   at every gate.**"
3. **§4, "The render-multiplier probe, k (A8)"** — "**Both are recorded at
   every gate**" (k_dev and k_target).
4. **§4, closing sentence** — "**The Phase 3 and Phase 9 gates must record both
   numbers, plus k_dev, k_target and the thermal derate.**"

And a fourth party that says nothing at all: **§11's Gate 3 text does not
mention k or the derate**, asking only for "**Both** §4 gate metrics recorded in
`BUILD_LOG.md`, with the measured headroom". §11's Gate 9 text *does* name the
derate explicitly. So §11 agrees with (4) at Gate 9, is silent at Gate 3, and
nowhere asks for either at any other gate.

**Why it has to be settled before Phase 3, not at it.** Under reading (1)/(2),
**Gates 0, 1 and 2 were each crossed with a required number unrecorded** — none
of them ran a 20-minute continuous run, and none recorded a minute-1 →
minute-20 delta. That is three retroactive `GATE-FAILED` entries under
CLAUDE.md rule 3. Under reading (4) they are clean and Phase 3 owes the first
derate. The readings are not close together in consequence, which is why this
cannot be left to be discovered later.

**New evidence, and it is not favourable to the derate as specified.**

Every k sample this project has taken on a real scene, pulled from the run logs:

| run | k_ratio | k_dev | k_target |
|---|---|---|---|
| `p1-load` | 1.3269 | 49.68 | 37.44 |
| `p1-soak` | 0.9262 | 42.35 | 45.72 |
| `p2-warp-off-DISCARDED` | 1.2773 | 43.42 | 33.99 |
| `p2-warp-off` | 0.9655 | 44.54 | 46.13 |
| `p2-warp-off-2` | 1.0000 | 48.29 | 48.29 |
| `p2-warp-on` | 0.9815 | 95.68 | 97.48 |
| `p2-warp-on-2` | 0.9649 | 90.64 | 93.94 |
| `p2-soak` | 1.0370 | 95.68 | 97.48 |

Eight samples, all `disturbed=false`, **spanning 0.9262–1.3269** against a
theoretical 2.25 fill-bound / 1.0 CPU-bound. **The thermal derate is defined as
a delta in k.** A delta between two draws from a quantity with that spread is
not a measurement of anything, and no plausible thermal effect at Phase 2's
measured load — **0.37–0.46% of N** — would exceed it. There is, at this load,
no sustained GPU work to throttle.

**Three options.**

- **(A) Narrow A1 to match §4's closing sentence — recommended.** k_dev,
  k_target and the thermal derate are recorded at the gates that make a
  performance claim at a real layer load: **Phase 3 and Phase 9**. Edit §1's A1
  and §4's thermal-derate paragraph to say so, and add k and the derate to
  §11's Gate 3 text, which currently omits both. A1's *intent* — "a fanless
  machine passes every 60-second gate cold and fails in the room" — is fully
  served, because a gate with nothing to throttle cannot fail in the room for
  thermal reasons.
- **(B) Take "every gate" literally.** Log `GATE-FAILED` against Gates 0, 1 and
  2, and run a 20-minute continuous k comparison at all nine remaining gates.
  Honest to the words. It buys ~3 hours of runs producing deltas smaller than
  the probe's own noise, and it reopens three passed gates on a technicality
  rather than on a defect.
- **(C) Keep "every gate", define the record.** The derate is *recorded* at
  every gate, where the record may legitimately read
  `N/A — peak render cost 0.46% of N, no sustained GPU load to derate`.
  Gates 0–2 are then annotated rather than failed. This preserves A1's words
  exactly and makes the requirement honest, at the cost of a clause that says
  when "N/A" is a valid record.

**Recommendation: (A), with (C)'s annotation applied to Gates 0–2** so nothing
is retroactively failed on a technicality. (A) is what §4's own operative
sentence and §11's gate texts already describe; (1) and (2) read as the
amendment's summary having outrun the body it was summarising.

**Not decided here.** CLAUDE.md: `SPEC.md` is authoritative, read-only to the
agent, and changed only by the operator. This entry is the proposal.

`MEASURED` — **the k probe measures the wrong subject when the warp is on, and
it was found while gathering the evidence above.**

`k_dev` roughly **doubles** with the warp enabled — 42–50 across every warp-off
run, 90–96 across every warp-on run — and it is not a speedup. The probe renders
`app.stage`, and with the warp active the stage holds **the mesh**, not the
compositor. It is timing a single textured quad rather than the scene, so the
warp-on figures describe a different subject from the warp-off ones and the two
sets must never be compared.

This is not a Gate 2 problem: k is informational through Phase 8 (§4) and no
gate condition rests on it. It is recorded because **A8's ruling is due at Phase
3 and this changes the ruling's subject**: the probe's problem was thought to be
noise, and it now also has a correctness bug that only appears once a
post-composite stage exists. Any fix must render the composite, not the stage.

Two smaller observations from the same table, neither concluded:
- `p2-warp-off-2` reports k_dev and k_target **identical to 4 s.f.** (48.29 /
  48.29, ratio exactly 1.0000). Possibly coincidence at this timer resolution,
  possibly the probe returning one measurement twice.
- `p2-warp-on` and `p2-soak` report **identical** k_dev and k_target to 2 d.p.
  across two separate launches. Same caution.

`BLOCKER` — **A8 and A15 remain due at Gate 3 and are not pre-empted here.**
A8 now carries a second, separate problem (above) beyond the noise. A15's
statistic measured **0.600% of N** in all four Phase 2 runs, against its own 2%
trigger, and stays ratified as written.

## 2026-09-04 — Phase 2 (session 1, part 7) — A1 reconciliation ratified

- DID: the A1 ↔ §4 contradiction is closed. `SPEC.md` now says the same thing
  in all six places, and `CHECKLIST.md` carries the new Gate 3 condition.
- BLOCKER: none. Phase 3 is unblocked.
- NEXT: Phase 3 — global clock, animated layers, bundled assets.

`SPEC-CHANGE-RATIFIED` — **option (A) of the proposal in part 6, decided by the
operator.** k_dev, k_target and the minute-1 → minute-20 thermal derate are
recorded at **the Phase 3 and Phase 9 gates**, not at every gate.

Six sites, now consistent: §1's A1 and A8 amendment summaries, §4's
thermal-derate paragraph, §4's k-probe list, §9's thermal-throttling risk row,
and **§11's Gate 3, which previously named neither** and was the reason the
inconsistency was four-way rather than two. §4's closing sentence and Gate 9
already said this and were not touched. The five other "every gate" mentions —
§4's metric-2 line, the headroom lines in §4 and §6, and §8.2's heading — are
about different subjects and were deliberately left alone.

The reasoning is in part 6 and is not repeated. The short version: the derate is
defined as a delta in k, eight real-scene k samples span **0.9262–1.3269**, and
Phase 2's measured render cost is **0.37–0.46% of N** — there is nothing to
throttle at an early gate, and no derate would be visible beneath the probe's
own spread if there were.

**Consequence for the passed gates:** Gates 0, 1 and 2 are unaffected and are
not reopened. Under the previous wording each had been crossed with a required
number unrecorded; under the ratified wording they never owed it.

**Consequence for Gate 3:** it now owes k_dev, k_target and the derate, and
`CHECKLIST.md` carries that as its own box rather than as prose inside another
condition — a gate condition buried in a neighbouring bullet is one that gets
skipped when the gate is actually run.

**Recorded because the log's last word would otherwise be wrong.** Part 6 ends
"Not decided here… this entry is the proposal". Leaving that as the final state
would send the next session to re-litigate a settled decision against a spec
that already disagrees with it. The decision is the operator's; this entry is
the record that it was made and applied.

`BLOCKER` — **A8 goes into Gate 3 with two known problems, not one.** The
spread above is the first. The second, found in part 6: the probe renders
`app.stage`, so with the warp enabled it times **the mesh rather than the
composite** — `k_dev` 42–50 warp-off against 90–96 warp-on, which is not a
speedup. Any fix must render the composite. A15 also remains due at Gate 3 and
measured 0.600% of N against its 2% trigger across all four Phase 2 runs.

## 2026-09-04 — Phase 2 (session 1, part 8) — the Gate 2 calibration, recorded

Appended to correct a claim made in the Phase 3 handoff, which said these values
were "preserved in `BUILD_LOG.md`". They were not. `calibration/warp.json` is
gitignored, so the file was the only copy and resetting it would have destroyed
them.

`MEASURED` — **the keystone the operator set by hand at Gate 2**, on a
deliberately tilted projector, at DEV_RESOLUTION 1280×720:

| corner | normalized | pixels @1280×720 |
|---|---|---|
| TL | 0.0622, 0.1375 | 80, 99 |
| TR | 0.9840, 0.4271 | 1260, 308 |
| BR | 0.9120, 1.0000 | 1167, 720 |
| BL | 0.0130, 0.7480 | 17, 539 |

Quad area **0.5966** of the output rect, and strongly off-axis — the right edge
drops 0.4271 → 1.0000 while the left drops 0.1375 → 0.7480, which is a projector
rotated as well as tilted. Not a textbook symmetric keystone, and worth keeping
for that reason.

Two uses beyond the record:

1. **A real Phase-2-format fixture for Phase 7.** Gate 7 requires that "a
   Phase-2 calibration file either loads or is migrated — never silently
   misinterpreted", and an earlier `IDEAS` note observed there was no committed
   example of the format to test that against. This is one, and it is a quad a
   person actually produced rather than one invented for a test.
2. **A non-trivial input for the tessellation check.** `src/test/warp.test.ts`
   grades the 40×40 mesh against a symmetric keystone and a synthetic harsh
   quad. This is a measured third case.

The projector has since been straightened, so this calibration no longer matches
the physical setup and applying it now would bend a straight projection. It is
recorded as data, not as a calibration to restore.

`ADDENDUM` — **the Gate 2 keystone at full stored precision**, appended
immediately before `calibration/warp.json` was reset to identity. The table in
part 8 rounds to 4 d.p., which is ample for the two uses named there but is not
the file's contents. These are:

```json
{ "x": 0.06220942568841951, "y": 0.13745612212276218 }
{ "x": 0.984,               "y": 0.4270596926950128  }
{ "x": 0.9119999999999999,  "y": 1                   }
{ "x": 0.013000000000000005,"y": 0.7480112841671995  }
```

TL, TR, BR, BL. Recorded at full precision because a Phase 7 migration fixture
should round-trip exactly rather than approximately, and because the file was
the only copy — it no longer exists.

The float dust (`0.9119999999999999` for what the operator dragged to 0.912,
`0.013000000000000005` for 0.013) is the arithmetic in `withCorner`, not noise
in the input. Worth keeping visible: I-1 stores normalized values and I-12
judges round-trips by deep equality, so a Phase 7 migration that "cleans up"
these values would fail its own round-trip test for a tidy-looking reason.

## 2026-09-04 — Phase 3 (session 1) — the clock, and the ticker's funeral

- DID: rolling checks reset for Phase 3 (I-10 activated, `[-]` → `[ ]`); three
  rulings taken from the operator; `core/clock.ts` (I-2) built and Phase 0's
  throwaway ticker deleted; `[clock]` log line and the transport/loop-ruler
  built alongside it; a protocol defect found by that log line on the first
  launch and fixed.
- MEASURED: unit suite **262 → 313**, 51 of them the clock's. **19 golden
  frames byte-identical, none re-blessed.** Smoke launch `[scale] buffer
  1280×720 css 1280×720 dpr 1 displayScaleFactor 1 **1:1 to panel**`, `[warp]
  main: OFF identity mesh=bypassed`.
- BLOCKER: none.
- NEXT: sprite-sheet layer, then video, then Lottie — each with its placeholder
  path (I-13) and its registry keys (I-8) in the same commit. Then the two-probe
  measure run and the A8 probe fix, which gate Gate 3.

### Three rulings taken, so they are not re-litigated later

**A8's probe — "fix subject + attack spread".** Render the compositor container
explicitly instead of `app.stage`, so `k` means the same thing warp-on and
warp-off; then attack the 0.9262–1.3269 spread with median-of-N bursts and
alternating dev/target order per repeat, and report the dispersion beside the
value rather than a bare point number. This is the only option under which the
thermal derate is a measurement rather than a subtraction of two noisy draws.
Not yet built — it is Gate 3 harness work, scheduled after the layer types.

**The two-probe measure run — probe, §4 window, probe.** Probe at ~t=60 s after
warmup and before the §4 window opens; the §4 window runs clean between the
probes; probe again at t=1200 s. The run is continuous, which is what A1 asks;
the measurement window simply restarts after the first probe, which §4 already
sanctions. §4's number stays a cold-ish number and so stays comparable to the
four Gate 0–2 runs. The alternative shapes (§4 window after both probes; two §4
windows) were offered and not taken.

**`lottie-web` — add it.** §5 names it; CLAUDE.md required the ask. Not yet
installed; it lands with the Lottie layer.

### `MEASURED` — the clock, and why its shape is what it is

`Clock.advance(dtMs)` is driven from outside. The clock never reads
`performance.now()`, so it is a pure function of the deltas it was fed and its
51 tests need no renderer, no timers and no tolerance window. A clock that
consulted a wall clock internally could only ever be tested approximately, and
"approximately correct time" is the thing Gate 3 exists to rule out.

**Phase is derived, never accumulated.** `phaseAt(timeMs, periodSeconds)`
computes `(t / p) mod 1` from the authoritative time every time it is asked.
Phase 0's ticker did the opposite (`phase += dt / LOOP_SECONDS`). That
difference is the whole of Gate 3's phase-consistency condition: an accumulated
phase cannot survive a scrub, because each loop would have integrated its own
history and would land wherever that history put it. Derived, there is **no
per-layer state a scrub could fail to update, because there is no per-layer
state** — which also makes "pausing freezes every clock-driven layer
simultaneously" structural rather than a thing to verify per layer.

Rate scales the advance, not the read. Scaling at read would re-scale the whole
of history the instant the operator moved the control, jumping every derived
phase.

**Phase 0's ticker is deleted, not preserved.** `SPEC.md` §0.2's sanctioned
forward-reach came due and was taken out, per the handoff. `LayerFrame` gains
`timeSeconds` beside the existing `phase`; `phase` keeps its meaning
(`GLOBAL_LOOP_SECONDS = 4`, inherited from `LOOP_SECONDS`) specifically so the
19 blessed goldens stay byte-identical. They did — `npm run test:render`
reports all 19 matching with nothing re-blessed.

`clock.playing`, `clock.rate` and `clock.time` are registered in the same commit
(I-8, CLAUDE.md rule 9). Registered where the warp corners were a **ruled
exclusion**, and the distinction is not "global vs per-layer": calibration
describes a physical surface and a MIDI knob mapped to a keystone corner would
bend the projection mid-show with no undo on a wall, whereas a play/pause
footswitch and a rate knob are among the most obvious things Phase 11 will map.
`clock.time` is in **seconds**, not milliseconds — a 0–3,600,000 range on a
128-step control has no resolution anywhere.

### `MEASURED` — the log line found a defect on its first launch

This is the fourth consecutive instance of the project's own run logs finding
what the unit suite did not, and it happened within minutes of the line being
written.

The handoff's item 10 asked for a `[clock]` line before debugging anything.
Written, 4 Hz coalesced with a trailing emit like `[warp]`, with play/pause/rate
never coalesced. The first smoke launch produced:

```
[clock] t=0.000s PLAYING rate=1.00x (none)
[warp]  main: OFF identity ... mesh=bypassed
[scale] buffer 1280x720  css 1280x720  dpr 1  displayScaleFactor 1  1:1 to panel
[scene] applied "phase1-default" ... water(z0) -> tree(z1) -> glow(z2) -> testPattern(z3,hidden)
[clock] t=0.000s PLAYING rate=1.00x (scrub)
```

That last line should not exist. Nothing scrubbed. **The editor's first
`clock:set` was pulling the output window's already-running clock back to zero.**

The cause: the editor holds *operator intent*, not a clock — there is no ticker
in `useClock.ts` and there must not be, or I-2 has three time sources. Its
`timeMs` is therefore stale by construction, and sending whole state on every
change meant a **pause or a rate nudge carried that stale time along with it**.
Live, that is a projection that jumps back to its start when the operator
touches the rate. On a wall, in front of an audience.

**Fix: `ClockTransport.scrubSeq`.** `timeMs` is authoritative only when the
operator actually moved time; `playing` and `rate` always apply. The message
stays **whole state** rather than becoming a command stream — re-applying one
changes nothing, a dropped one is corrected by the next, and an output window
reopened on a display re-select (I-13) comes up at the last time the operator
asserted rather than at zero.

One thing was got wrong on the way and is recorded because the wrong version is
the tempting one: `lastScrubSeq` was first initialised to "has seen none", so a
receiver's **first** message was authoritative. That is wrong in both
directions — it rewinds an output window that started before the editor's first
message (exactly the observed defect), and it would restart a reopened window at
0 rather than at the show's position, because `timeMs` is 0 in a message from a
sender that holds intent and not a clock. It starts at **0** instead, and the
rule that falls out is the honest one: **the editor never knows the show's time,
so it never asserts one it did not get from an operator.** Two tests hold each
direction.

Nothing in the unit suite would have caught this. Every test in `clock.test.ts`
drives one clock in isolation; the defect lives in the seam between two
processes. Nine of the eleven defects across Phases 1–3 so far have been found
by an operator or a run log.

### `MEASURED` — the thing built so the pause can be felt

Phase 1's failure was a scene that could not demonstrate the invariant; Phase
2's was a control that could not be operated. The handoff named the Phase 3
analogue: a clock provably correct in tests whose pause and scrub cannot be
felt. `clock.test.ts` proves phase-consistency across a scrub. **Nobody can see
a proof.**

So `TransportPanel.tsx` carries a **loop ruler**: three loops of 3 s, 4 s and 5 s
drawn as markers, each positioned by `phaseAt` from the same clock time.
Deliberately mutually non-dividing — 2 s and 4 s would agree at every seam and
an accumulator bug could hide there. Pause, and all three stop in one frame.
Scrub, and all three land where their own arithmetic puts them. That is Gate 3's
first two conditions made watchable.

The ruler reads the **preview host's running clock**, not the transport's intent
state, and that is the point: a ruler driven by intent would animate smoothly
even if the render host had stopped sampling the clock entirely, which is
exactly the defect it exists to catch. Same reasoning puts the time readout and
the scrub slider on the live clock — a scrubber that sat still while the show
ran would report the last drag rather than the position, and dragging it would
then jump the show backwards.

The transport is `[~]`, not `[x]`. It cannot be judged until there is an
animated layer whose freeze an operator can see, and that is the next
deliverable.

### `NOTE` — the I-5 registry grep has a prose false-positive mode

`parameters.test.ts`'s "no source file registers a `warp.*` key" grep matches
`/['"`]warp\.[A-Za-z]/`, which fires on a **backtick immediately before**
`warp.ts` in a code comment. Writing "see `warp.ts`" in `clockLog.ts` failed the
test. Not relaxed — the test is right and the prose changed to
`src/render/warp.ts`. Recorded so the next person to trip it does not read it as
a real I-5 violation and weaken the check. The false-positive rate is one
occurrence in three phases, against a check that guards a decision nothing else
enforces; the trade is worth keeping.

### `IDEAS` — parked, not built

- `clockLog.ts` duplicates the 4 Hz coalescer in `src/render/warp.ts` rather
  than extracting it. `warp.ts` is a passed-gate surface (CLAUDE.md: "a passed
  gate is a frozen surface") and refactoring Phase 2's code for Phase 3's
  convenience is not sanctioned. This is the second instance; **a third would
  justify the extraction.**
- The preview clock and the output clock advance independently between operator
  actions and will disagree by scheduling jitter. I-7 already states the preview
  is an approximation, not a mirror, and Gate 3 is judged on the output window.
  If a later phase wants them tighter, the shape is a periodic resync on the
  existing `clock:set` channel — not a new one.

## 2026-09-04 — Phase 3 (session 2) — GATE 3, all conditions but one

- DID: built the rest of Phase 3 — bundled library, three layer types, seam
  handling, the transport — took the Gate 3 measurements, and fixed six
  instrument defects found along the way.
- MEASURED: everything below. **Gate 3's ten technical conditions pass.**
- BLOCKER: **one condition cannot be closed by this agent.** §10 row 2's
  video/Lottie caps are a `SPEC.md` change, and CLAUDE.md makes that the
  operator's. The proposal is at the end of this entry. Under rule 3 the gate
  is not crossed until it is ratified.
- NEXT: ratify the caps, then Phase 4 — forces and parallax, the first demoable
  milestone.

### `MEASURED` — Gate 3's §4 run, at the stated layer load

`p3-gate`, 1 video + 2 sprite + 1 Lottie (`phase3-load`), DEV_RESOLUTION
1280×720, **1:1 to panel**, warp OFF, HUD on, `PINNED (pinned-exact-id)`,
fullscreen on `T749-fHD720` @ 60.000004 Hz, **N = 16.6667 ms**.
`disturbed=false`, `throttled=false`, no focus change, 3601 samples covering
60.0 s, **fps 60.0004 against a nominal 60.0000**.

| | |
|---|---|
| **M1 presentation** | **0.0000% late**, worst run **0**, worst interval **17.80 ms** (1.07 × N) |
| **M1 clause 3 (A12)** | **zero** events over 3 × N, in the window and lifetime |
| **M2 headroom** | **p99 0.1000 ms = 0.600% of N**, against the 60% limit |
| p95 (information) | 0.1000 ms |
| mean (information) | 0.0212 ms = **0.127% of N** |
| **Measured headroom** | **59.4 percentage points**. Render cost is **1/100th** of the budget |

Warp deliberately off: A8's probe measured the mesh rather than the composite
whenever it was on, and although that is now fixed, keeping the §4 runs
warp-off makes them comparable to the four Gate 0–2 runs.

**M2 finally moved — and not for a good reason.** It read 0.200 ms = 1.200% of
N at Gate 0, Gate 1, Gate 2, and at every Phase 3 run until this one. Here it
reads 0.600%. That is not the metric waking up; it is the same 100 µs quantum
with a cheaper frame under it, so p99 landed on ONE tick instead of two. See
the clock section below.

### `MEASURED` — A15's review, due at this gate

**Per-frame instrument max 0.1000 ms = 0.600% of N**, against A15's **2%**
trigger, at Phase 3's stated layer load. Mean per-frame 0.00125 ms; tick
0.300 ms. Consistent across every Phase 3 run: 0.600% at x1–x4 and at the
resilience and soak runs, 1.200% at x5–x6.

**A15 does not trigger. The HUD draw stays on the render path.** Phase 0's
1.2% on a trivial scene did not discharge this; a measurement at the phase's
own layer load does, which is what the clause asked for.

### `MEASURED` — the memory soak (§8.2, and the rolling check)

`p3-soak`, 20 minutes continuous, `phase3-load`, scene re-applied every 2 s.
**604 rebuilds.**

| | first sample | last sample |
|---|---|---|
| live texture count | **11** | **11** |
| texture bytes (estimate) | **17,596,424** | **17,596,424** |
| buffers | 4 | 4 |
| geometries | 2 | 2 |
| `managedTextures` array slots | 23 | 1221 |

`driftTextureCount = 0.0000`, **`flat: true`**. The rolling check passes, and
for the first time on a subject that genuinely churns — Phase 2's soak watched
a single composite render texture that was never destroyed.

The last column is the census defect, recorded below.

### `MEASURED` — k and the thermal derate (A1, A8), the first time they are owed

Two probes in one continuous run: settle → **cold probe** → §4 window → **warm
probe**. Subject `composite` in both, median of 5 repeats with the dev/target
order alternating, min–max reported.

**Gate run, 71 s apart:**

| | k_dev | k_target | ratio |
|---|---|---|---|
| cold | **90.48** (81.62–95.38, spread 15.2%) | **90.48** (82.90–106.98) | 1.0000 |
| warm | **104.17** (85.59–106.98, spread 20.5%) | **94.25** (87.48–103.49) | 1.1053 |

Derate **+15.13%** over 71 s, against a probe spread of **20.5%** →
**`meaningful: false`**.

**Soak run, 1211 s apart — the actual minute-1 → minute-20 comparison A1 asks
for:**

| | k_dev | k_target |
|---|---|---|
| cold | **89.96** (spread 23.2%) | 96.54 |
| warm | **82.04** (spread 14.4%) | 84.22 |

Derate **−8.81%** over **1211 s**, against a spread of **23.2%** →
**`meaningful: false`**.

**Recorded, and recorded as not measurable.** Three independent runs put the
delta inside the instrument's own dispersion, and the sign is not even
consistent — +15.13%, −8.81%, and −15.38% on an earlier soak. There is no
thermal derate to find at this load, which is exactly what §4's own reasoning
predicted when A1 was narrowed to Phases 3 and 9: "an earlier gate has no
sustained GPU work to throttle."

A8's probe went into this gate with two known defects and both are fixed. The
subject one mattered most: it rendered `app.stage`, so with the warp on it
timed the **mesh** — k_dev 42–50 warp-off against 90–96 warp-on, which is not a
speedup but a different subject. It renders `compositor.view` now, a grep
enforces it, and `KReport.subject` records which was measured so two k values
can never again be compared across a change of subject. On the spread: median
of 5, alternating order, render targets allocated once per run instead of per
repeat, a 1-pixel GPU sync instead of an 8 MB readback, a full discarded warm-up
burst, iterations 32 → 96, and A9 rejection of bursts that measured nothing.
Dispersion went from **108%** to **14–23%**. Still not enough to resolve a
derate, and saying so is the point.

### `MEASURED` — I-13, the corrupt video (Gate 3 condition)

`p3-resilience`, `disturbed=false`. A deliberately corrupted MP4 beside a
missing asset and a working sprite.

- **M1 0.0000% late, worst interval 17.80 ms** — against the **50 ms** hard
  floor the condition names. The session did not notice.
- The chain resolved as the run log shows, and the ORDER is the interesting
  part: `[video] broken: placeholder — decode failed` then
  `[video] broken: poster — poster ready`. The decoder failed **before** the
  poster arrived, and the layer still ended on the poster.

That ordering is why the chain is now a table (`videoStage.ts`, 12 tests)
rather than a sequence of assignments: the poster is a small JPEG and the video
a megabyte of H.264, so which settles first is a race, and the end state must
not depend on it.

### `MEASURED` — the headroom ladder, and the cap it found

§4: "the Phase-3 load is a **floor** to validate the pipeline, not the ceiling.
Raise it deliberately, measuring at each step." `phase3-x{n}` is n videos, 2n
sprites and n Lotties. All six runs valid: no focus changes, none throttled.

| load | videos | fps | M1 | late | worst run | worst interval | clause 3 | M2 p99 | mean |
|---|---|---|---|---|---|---|---|---|---|
| x1 | 1 | 59.999 | pass | 0.0000% | 0 | 17.70 ms | 0 | 1.200% | 0.281% |
| x2 | 2 | 60.000 | pass | 0.0000% | 0 | 17.70 ms | 0 | 1.200% | 0.287% |
| x3 | 3 | 59.999 | pass | 0.0000% | 0 | 17.80 ms | 0 | 1.200% | 0.247% |
| x4 | 4 | 60.001 | pass | 0.0000% | 0 | 17.70 ms | 0 | 1.200% | 0.303% |
| x5 | 5 | 60.000 | pass | 0.0000% | 0 | 17.70 ms | 0 | 1.200% | 0.409% |
| **x6** | **6** | **59.234** | **FAIL** | **0.4219%** | **14** | **150.00 ms** | **9** | 2.400% | 0.697% |

**A clean cliff between five and six videos.** x6 fails M1 on two clauses at
once: a run of **14 consecutive late frames** against a limit of 2, and **nine**
intervals over 3 × N against A12's allowance of one unattributed event.

**Read the failure's shape, not just its size.** M2 is comfortable at x6 —
2.400% of a 60% budget — while presentation collapses. And the nine clause-3
events are a **burst**, all inside t = 1.667–2.367 s, intervals of 150.0, 133.3,
100.0, 83.6, 83.3, 83.3, 66.7, 66.5 and 50.0 ms. That is not a load ceiling
being reached; that is a **simultaneous seek**.

The mechanism is D5 doing exactly what it was told. Video realigns at loop
boundaries, and `phase3-x6` alternates a 4-second clip with a 3-second one, so
three decoders reach a boundary in the same frame and every twelve seconds all
six do. Nothing staggers them. §5 predicted "video count and live-Lottie count
will be the first things that blow the budget" and it was right about which
knob, but the cost is not per-decoder steady state — it is decoders seeking
together.

**Retraction, on the record.** Mid-session this agent reported the cliff, then
retracted it as its own interference, then found it again on a clean run. The
retraction was wrong. The runs it rested on were disturbed by the agent
polling the machine during them, which is the same mistake that cost four runs
this session.

### `MEASURED` — six instrument defects, and how each was found

Not one by a unit test. That is now eleven of thirteen defects across three
phases found by an operator or a run log.

**1. The false texture leak.** The first 20-minute soak reported textures
rising **23 → 1221** across 604 rebuilds: 5209% drift, rolling check failed.
Nothing leaked — bytes were pinned at 12,861,448 the entire time, buffers 4→4,
geometries 2→2. PixiJS nulls an entry in `managedTextures` when a source is
destroyed and never compacts the array, and the census counted `length`.
Phase 1 had no textures; Phase 2 had one composite render texture that was
never destroyed; Phase 3 is the first phase to destroy a texture per video and
per Lottie on every rebuild. `textureCount` is now the live count and
`textureSlots` reports the array length as information. An existing test had
asserted the wrong behaviour and is corrected with a note. **A9 names this
exactly, and a FALSE leak is the worse kind — it sends someone hunting what is
not there and makes the next real one easier to disbelieve.**

**2. The window that only covered its last minute.** The soak reported
`late 0.0000%` beside `worst interval 33.40 ms`. Both correct, describing
different spans: samples evict on a rolling 60-second window while
`worstIntervalMs` is a lifetime max. So a 20-minute soak's M1, percentiles and
clause-3 **list** all described its final minute — and §4 requires every
interval over 3 × N to be attributed, which cannot happen for an evicted one.
The report now carries `coveredSeconds` and `magnitudeEventsLifetime`. Latent
since Phase 0; only reachable once a phase ran a window longer than the
eviction window.

**3. The clock had never been paused.** Found by re-reading a stale checklist
note. Every log in `measurements/` held exactly one `[clock]` line — `PLAYING`,
at startup. `VideoView`'s `el.pause()` had never executed in a live process:
the unit suite covers the clock, the goldens render `playing: false`, but the
goldens run with `decodeVideo: false` and skip the branch. **Nothing had ever
checked that a decoder obeys the clock.** `PROJENGINE_TRANSPORT=1` now exercises
pause → scrub → resume → rate 0 → rate 1 → scrub during the settle.

**4. The decoder thrash, found by (3) on its first run.** At rate 0 the decoder
was started and stopped **sixty times a second** — two independent `if`s in the
per-frame update, one resuming a paused element, the other pausing a running
one. Nothing in the unit suite could have caught it: each branch was correct
alone and the defect lived only in their interaction across a frame boundary.
Gate 3 asks that "video pauses too, at frame granularity", and a decoder
thrashing at 60 Hz might well have read as a frozen frame to someone watching a
wall. Now one function, one answer, applied once (`decoderAction`), with a
120-frame idempotence test. The exercise now reads:

```
[clock] t=1.583s PAUSED       [video] decoder HELD at 1.571s
[clock] t=7.300s PAUSED       (scrub — no seek, resync at next boundary)
[clock] t=7.300s PLAYING      [video] decoder resumed
[clock] t=9.300s rate=0.00x   [video] decoder HELD at 1.314s
[clock] t=9.300s rate=1.00x   [video] decoder resumed
```

**5. The clock the instrument measures with.** `performance.now()` is coarsened
to 100 µs in a renderer — **measured, not assumed: `resolution=0.100000ms`** —
and Phase 3's render cost is 0.021–0.047 ms. The ruler's smallest mark is wider
than everything on it, which is why M2 read an identical 1.200% of N at four
consecutive gates and across five load steps. `debug/clock-source.ts` now
calibrates both candidate clocks at startup — cost per call and real resolution
— and prints which it took and why, with an explicit warning when the chosen
clock cannot resolve its subject. **The finer clock is unavailable on this
build**: the preload is sandboxed and a sandboxed preload gets a stripped
`process` with no `hrtime`. Learning that cost a crash — the first version
called it unguarded and killed the output window before it drew a frame, losing
a whole measurement run. Every call into a candidate is now guarded.

**6. The disturbance flag, twice.** Gate 2 carried forward that `disturbed`
watched only for focus being LOST, so a run that started backgrounded and
GAINED focus reported clean. The fix — require focus HELD for the whole window
— over-corrected: this app has two windows, only one can hold DOM focus, and it
is normally the editor. Two runs came back "disturbed" with **zero focus
events** and **60.0005 / 59.9995 fps across 3601 samples**; Chromium throttles a
genuinely backgrounded window to about 1 Hz. The verdict is now stability and
throughput rather than possession: any focus CHANGE in the window, visibility
going hidden, or the presentation rate departing from the display's nominal by
more than 5%. That last test is new and is strictly stronger than what it
replaced — a throttled run now fails on physics rather than on a proxy.

### `MEASURED` — four defects in the CONTENT, all found by looking at goldens

The seven new golden cases were inspected by eye rather than blessed on trust,
and four of them were wrong the first time.

- **lottie-web's default entry uses a direct `eval`** for expressions, and this
  app runs a hardened CSP with no `unsafe-eval`. It would have loaded fine and
  failed on a downloaded LottieFile in Phase 8. Now on the light canvas build,
  which contains zero `eval(` — checked against the file.
- **Passing `container` to lottie makes it build its own canvas and ignore the
  supplied context** (`CanvasRendererBase.configAnimation` branches on it), so
  the texture stayed blank with no error and no placeholder. The golden was an
  empty rectangle.
- **The first sprite sheets were 100% opaque.** An ffmpeg chain negotiated a
  non-alpha pixel format; they rendered as black boxes. The sources are also
  palette PNGs trimmed to per-frame bounding boxes, so frames are converted
  individually before tiling.
- **ffmpeg's `geq` wraps a negative result modulo 256** rather than clamping, so
  a channel value of −4 came out as 252 and the test clip grew hard-edged red
  and green blobs at its zero crossings.

The clips are also dark rather than a rainbow test card: I-6 and D1 build the
engine around additive light on black, and an `add` layer over a bright
background is not a test of anything.

### `MEASURED` — the operator's wall session, 2026-09-04

Four conditions no instrument can judge. Each was asked with its pass condition
stated explicitly, because two operator reports last session resolved the
OPPOSITE way from their first reading.

- **Pause freezes every clock-driven layer simultaneously — PASS.**
- **Two loops of different lengths stay phase-consistent after a scrub — PASS.**
  The same scrub position gives the same picture every time, across three
  mutually non-dividing periods (2.5 s / 1.8 s / 3 s).
- **Video re-syncs at its next loop boundary — PASS, confirmed in the right
  direction.** It drifted out of step and caught up within a few seconds.
  Snapping into step instantly would have been the FAILURE, because it would
  mean per-frame seeking, which D5 rules out as visibly stuttering. The
  operator was asked against that specific alternative, not against "looked
  fine".
- **A known non-seamless loop shows no visible pop with seam handling on —
  PASS. The pass condition here is INVERTED and was confirmed that way:** with
  `crossfade` the operator saw *nothing happen* over three or four loops.
  **And the control was run:** switching that layer's seam to `none` made the
  pop appear. Without that control the first answer would only have shown the
  asset might be seamless anyway — Phase 1's "a scene that could not
  demonstrate the invariant".

### `SPEC-CHANGE-PROPOSED` — §10 row 2, the concurrent video and Lottie caps

Due this phase ("Phase 3 decides, Phase 9 confirms"). **This is the one Gate 3
condition this agent cannot close**: `SPEC.md` is the operator's.

**The evidence** is the ladder above. Five videos + ten sprites + five Lotties
passes both §4 metrics with zero late frames. Six of each fails M1 on two
clauses. The failure is a burst of simultaneous loop-boundary seeks, not a
steady-state ceiling — M2 sits at 2.400% of a 60% budget while presentation
collapses.

**Option A — cap concurrent video at 4, live Lottie at 4.** One step below the
measured failure, which is the ordinary engineering margin. Matches §5's "use
sparingly, cap hard". Costs a ceiling that is probably artificially low, since
the failure is a collision rather than a load.

**Option B — cap at 5, the highest measured pass.** No margin. Defensible only
because the failure at 6 was not marginal (14 consecutive late frames, not
three), so the boundary is sharp rather than noisy.

**Option C — stagger the loop-boundary realignments, then re-measure.**
Treats the actual cause. D5 realigns each video at its own loop boundary and
nothing offsets them, so N videos sharing a period stall together. Giving each
layer a deterministic per-layer offset would spread the seeks. This may raise
the ceiling a long way — the per-decoder cost is nearly flat from one to five —
but it **changes D5's behaviour** and so is not something this agent will build
without a ruling.

**Recommendation: A now, C before Phase 9.** Cap at 4 and record why, so v1 has
a number it can defend; then treat the collision in Phase 9, where §4 already
plans a 20-minute soak and where the cap is confirmed rather than set.

**The Lottie cap is proposed by analogy, not by measurement, and that should be
recorded as a weakness.** No run isolated Lottie count from video count — the
ladder raised all three kinds together. §5 names Lottie as a main-thread
re-render and an active CPU cost, and the mean render duration does climb with
the ladder (0.281% → 0.409% of N from x1 to x5), but nothing here separates
that from the sprites. **If the Lottie cap matters, it needs its own ladder.**

### `BLOCKER` — two rulings, neither blocking the gate, both wanted before Phase 9

**A8 / A1 — should Gate 9 keep asking for a thermal derate?** The probe now
disperses 14–23% after six separate fixes. Three runs put the derate inside
that dispersion with inconsistent sign. Either the probe needs to get better by
an order of magnitude, or the derate needs to be defined against something the
instrument can resolve. Phase 9 judges its gate on minute-20 k, so this is
decided before then, not at it.

**§4 metric 2 — is p99 a measurement or a ceiling?** It is currently a ceiling:
a 100 µs quantum over a 21–47 µs subject. Three ways out, all of them the
operator's: drop the preload sandbox so `process.hrtime` is reachable; serve the
app from a custom protocol with COOP/COEP so the renderer is cross-origin
isolated and `performance.now()` falls to 5 µs; or accept p99 as a ceiling and
judge headroom on the informational mean. **Until one is chosen, every M2
number this project records is an upper bound and should be read as one.**

### `IDEAS` — parked

- `clockLog.ts` duplicates the 4 Hz coalescer in `src/render/warp.ts`. Second
  instance; a third justifies extracting it.
- The preview clock and the output clock advance independently between operator
  actions. I-7 already states the preview is an approximation. If a later phase
  wants them tighter, the shape is a periodic resync on the existing
  `clock:set` channel, not a new one.
- `PROJENGINE_TRANSPORT=1` currently runs a fixed script. A phase that wants to
  fuzz the transport would want it to take a sequence.
- The Kenney source frames are trimmed to per-frame bounding boxes with no
  offset metadata, so the sheets are centre-registered. Good enough for a puff
  expanding from its centre; a walk cycle would need real registration.

## 2026-09-04 — Phase 3 (session 2, part 2) — the caps, ratified

- DID: the operator ruled on §10 row 2. Recorded here, wired into the code as a
  named constant with a `[caps]` log line, and `CHECKLIST.md` updated.
- BLOCKER: **one mechanical step is outstanding and it is not the agent's.**
  `SPEC.md` §10 row 2 still reads "Phase 3, confirmed Phase 9" as its due date
  and carries no number. CLAUDE.md makes `SPEC.md` read-only to the agent, so
  the row is edited by the operator.
- NEXT: Phase 4 — forces and parallax, the first demoable milestone (§2.4).

`SPEC-CHANGE-RATIFIED` — **§10 row 2, decided by the operator, 2026-09-04.**

> **Concurrent video cap: 4. Concurrent live-Lottie cap: 4.**
> **Behaviour: WARN, do not refuse.**

**The video number is measured.** The `phase3-x{n}` ladder (n videos, 2n
sprites, n Lotties), all six runs valid — no focus changes, none throttled:

| load | fps | M1 | late | worst run | worst interval | clause 3 |
|---|---|---|---|---|---|---|
| x1–x5 | 59.999–60.001 | pass | 0.0000% | 0 | 17.70–17.80 ms | 0 |
| **x6** | **59.234** | **FAIL** | **0.4219%** | **14** | **150.00 ms** | **9** |

Five passes cleanly; six fails M1 on two clauses at once. **4 is one step below
the measured failure** — the ordinary engineering margin, and §5's "use
sparingly, cap hard".

**The Lottie number is NOT measured, and that is recorded rather than glossed.**
It is 4 by analogy with the video cap. No run isolated Lottie count from video
count — the ladder raised all three kinds together, so nothing here separates a
Lottie's main-thread re-render from a decoder or a sprite. §5 names Lottie as an
active CPU cost and the mean render duration does climb across the ladder
(0.281% → 0.409% of N from x1 to x5), but that is the whole scene climbing.
**If the Lottie cap ever matters, it needs its own ladder.** Phase 9 confirms
both, and that is where this should be done properly.

**Why WARN and not REFUSE.** §5's wording is "cap hard", and the literal reading
is to refuse the sixth layer. The operator ruled the other way, and the
measurement supports it: exceeding the cap costs **15 late frames out of 3555**
and one 150 ms hitch — a visible stumble, not a failure. Nothing crashed at x6:
zero errors, zero placeholders, all six decoders reached `playing`, memory flat,
M2 comfortable at 2.400% of a 60% budget. This is performance equipment (I-13's
premise), and an instrument that refuses its operator mid-show for a stumble it
could merely have flagged is the wrong trade.

**What the cap actually limits, which is not what it counts.** The x6 failure is
a **burst** — all nine clause-3 events inside t = 1.667–2.367 s, intervals of
150.0, 133.3, 100.0, 83.6, 83.3, 83.3, 66.7, 66.5 and 50.0 ms. Per-decoder cost
is nearly flat from one to five. What breaks is **simultaneous seeking**: D5
realigns each video at its own loop boundary, `phase3-x6` alternates a 4-second
clip with a 3-second one, so three decoders reach a boundary in the same frame
and every twelve seconds all six do. Nothing staggers them.

So **4 is a symptom-level cap**, and it is being recorded as one. The cause fix
— a deterministic per-layer offset on the boundary realignment — is **option C
of the proposal, parked for Phase 9** because it changes D5's behaviour and
Phase 9 is where §4 already plans the soak that would confirm a new ceiling. It
may lift the cap a long way.

`NOTE` — **what is implemented here, and what deliberately is not.**

Implemented: `MAX_CONCURRENT_VIDEO` and `MAX_CONCURRENT_LOTTIE` as named
constants carrying the measurement in their comment, and a `[caps]` line on the
output window whenever an applied scene exceeds either. That follows this
project's own evidence — `[scene]`, `[warp]`, `[clock]` and `[video]` between
them found eleven of thirteen defects across three phases, and a cap nobody can
see breached is a cap nobody will notice breaching.

**Not implemented: the operator-facing warning in the layer panel.** That is
editor interaction and belongs to **Phase 5**, not here (CLAUDE.md rule 1: one
phase at a time). Gate 3's condition is "caps **decided and recorded**", which
this discharges; enforcement lands where the layer-adding UI does.

---

## 2026-09-04 — Phase 4 (session 1) — forces, parallax, and a fifth force

- DID: built the whole of Phase 4 — the force bus (I-4, I-14), four v1 forces
  plus a fifth, per-entity susceptibility, parallax by depth (D3), the rain
  provider, the `[force]` log line, the editor's force panel, 13 golden cases
  and 92 new unit tests. Reset the rolling checks for the phase first.
- MEASURED: §4's window at the Phase 4 load, a regression at Phase 3's load,
  and three memory soaks. Numbers below.
- NEXT: the wall session. Four of Gate 4's six conditions need it, and one
  rolling check and two spec rows need the operator.

### `MEASURED` — Gate 4's §4 run, and the regression beside it

`p4-gate`, scene `phase4-forces` (11 layers, all procedural), warp off,
`disturbed=false`, `throttled=false`, `[scale] 1:1 to panel`,
`pin=PINNED (pinned-exact-id)`, fps 60.000067 vs nominal 60.000004,
3601 samples over 60.0 s.

| metric | value | verdict |
|---|---|---|
| M1 late | **0.0000%** | PASS |
| M1 worst run | 0 | PASS |
| M1 worst interval | 18.80 ms (floor 25.0 ms) | PASS |
| M1 clause 3 | empty | PASS |
| M2 p99 | **0.2000 ms = 1.200% of N** | PASS |
| M2 mean (informational) | 0.0649 ms = 0.390% of N | — |
| `k_dev` / `k_target` | 90.996 / 88.951, ratio 1.0230 | — |

**M2 is an upper bound and is recorded as one.** `performance.now()` resolves
0.100000 ms — printed as `[timer]` on every launch — so 1.200% is exactly two
quanta of a clock coarser than its subject. Gate 3 read 0.600% (one quantum) on
a cheaper frame. The ruling is still open and still the operator's: drop the
preload sandbox, serve from a custom protocol with COOP/COEP, or accept p99 as
a ceiling and judge on `renderMeanMs`. Until then every M2 number in this
project is an upper bound.

**The regression is the more informative number.** `p4-regression`, at Phase 3's
*own* scene with the force bus now in the render path:
**M1 0.0000% late, clause 3 empty, M2 p99 0.1000 ms = 0.600% of N — identical
to Gate 3's figure**, `renderMeanMs` 0.0239 ms inside Phase 3's measured
0.021–0.047 band. The force bus is free at Phase 3's load. That is what makes
Phase 4's own 1.200% attributable to eleven `Graphics` layers rather than to the
mechanism this phase added.

**A8's derate is still unresolvable, exactly as the open ruling says.**
`derate.meaningful: false` — devDelta 5.17% inside a probe spread of 38.4%.
Gate 9 judges on minute-20 k. This still needs deciding before then, not at it.

**§11 Phase 4 states no layer load, and this is a judgement call, recorded as
one.** §4 says runs happen "at the phase's stated layer load"; Phase 3's is
spelled out and Phase 4's is not. `phase4-forces` was taken as the load because
it is the scene the gate is judged on, and `p4-regression` was added so the
number stays comparable to Gate 3 instead of becoming a new baseline nobody can
read. No spec statement was invented.

### `BLOCKER` — the memory soak returns `flat: false`, and it is not Phase 4

Three soaks, one question: is the buffer growth a leak?

| run | scene | textures | bytes | buffers | geometries | `flat` |
|---|---|---|---|---|---|---|
| `p4-soak` | `phase4-forces` | 2 → 2 | 8 → 8 | 74 → **454** | 37 → 227 | **false** |
| `p4-soak-p1` | `phase1-default` | 2 → 2 | 8 → 8 | 46 → **274** | 23 → 137 | **false** |
| `p4-soak-p3load` | `phase3-load` | 11 → 11 | 17,596,424 → same | **4 → 4** | 2 → 2 | true *(DISTURBED)* |

**Texture memory is flat.** `driftTextureCount 0` on all three, over 20 minutes
and 604 rebuilds. That is the subject the rolling check names.

**The buffer/geometry growth is real, bounded, and predates Phase 4.**
`phase1-default` — four layers, wind at its zero default, no rain, no Phase 4
content whatsoever — shows the identical signature: growth to a plateau at
**110 s**, then `steadyDriftBufferCount: 0` across 188 rebuilds. `phase4-forces`
does the same at the same 110 s and then holds **bit-exact for 1090 s across 548
rebuilds**. The texture-heavy Phase 3 scene never leaves 4 buffers, which is why
nobody has seen this before: it is PixiJS `Graphics` pooling reaching a
high-water mark, and Phases 1–2 never soaked a Graphics-heavy scene.

A leak that stops is not a leak. But **the box is marked `[~]`, not `[x]`**,
because the instrument says `flat: false` and Phase 3's lesson was a soak that
reported a *false* 5209% leak — overruling one's own instrument by argument is
how that happens in the other direction. **The operator rules.** Three options,
in the order I would take them:

1. **Accept and narrow the check.** Its stated subject is texture memory, which
   is flat. The harness's `flat` folds in buffers/geometries; split the verdict.
2. **Explain the 110 s.** It is suspiciously identical across two unrelated
   scenes. Worth one measurement in Phase 9, not one at this gate.
3. **Nothing.** Bounded 5-6x growth that holds bit-exact for 18 minutes is not a
   live-session risk. Phase 9 owns performance.

Whichever is chosen should be written down, because the next Graphics-heavy
scene will report it again.

### `MEASURED` — a run I disturbed myself, and it is not being kept

`p4-soak-p3load` came back **`disturbed=true`**. The cause was mine: I ran
`ls`, `cat` and `date` at 16:15 UTC to check on the batch, inside the window,
having said in the same session that I would not. Its numbers happen to match
Gate 3's exactly (buffers 4 → 4, texture bytes byte-identical) and its worst
interval is the only one of the five runs to sit at 33.40 ms rather than 18.80.
A disturbed run is not a run; it is re-taken rather than kept because it agrees
with what I expected. That is the whole point of the flag.

### `MEASURED` — two defects found before they shipped, neither by design

**1. Every Phase 1-3 scene would have started swaying.** `wind.strength`
defaulted to 0.25, and `createScene` fills `scene.forces` from the definitions'
defaults — so adding the force bus would have silently changed the look of every
scene in the project. Caught by a test written for a different reason ("every
force is inert at its own defaults"). **A force's defaults must be the identity**
is now a stated rule on any force added later, and it is what made the fifth
force provably free: all 41 goldens matched after adding it.

**2. Parallax exposed a black band down one edge of the frame.** Found by
*looking at a golden preview*, which is now the fourth time in this project that
a picture caught what a passing test could not. The sky was authored at
`depth 0.02`, so a full parallax sweep slid it 23 px and revealed the black
behind it. **There is no way to author around it: I-1 caps a layer's `width` at
1**, so a full-frame layer cannot be over-sized to give itself bleed the way a
conventional parallax backdrop would be. The invariant is not the thing to
change. `DEPTH_GAIN_FAR` is now 0 — the far plane does not move, which is also
what "far plane" means — and the authoring rule is recorded in two places:
**a layer that spans the frame is authored at `depth 0`.**

### `MEASURED` — the fifth force, timed (Gate 4, I-14)

**1 minute 34 seconds**, start to green, including two failing runs and their
fixes, against a 30-minute budget.

- **Production diff: one file, `core/forceDefs.ts`, +53 lines** — the definition
  and its comment. Nothing in `core/forces.ts`, `render/compositor.ts`,
  `core/parameters.ts`, `core/scene.ts`, `editor/ForcePanel.tsx` or
  `debug/forceLog.ts`.
- `force.fog.density` appeared in the registry, a slider and a per-entity
  susceptibility column appeared in the editor, and `[force] fog density=0.000
  -> 11/11 entities` appeared in `p4-gate.log`, without any of them being told
  fog exists.
- **All 41 golden frames still matched afterwards.** A new force changed no
  rendered pixel, because every force is inert at its own defaults.

**The honest cost: three TEST files changed.** They used `fog` as their own
synthetic fifth force and collided with the real id; renamed to `current`, which
is I-14's own second example. Not one changed because the mechanism changed. The
one substantive change was "ships exactly the four SPEC.md names", now five —
the deliberate friction of shipping a force.

### `BLOCKER` — the operator's colour-shift report, and the instrument built for it

> "every time I change the scale of something, opacity, strength of a force,
> rain or anything, the projector changes lights a bit, like the colours change"
> — and, asked to discriminate: **it affects the whole wall, and it probably
> happened in Phase 3 too.**

**Part of this is correct behaviour.** `rain`, `timeOfDay`, `temperature` and
`fog` are tint forces reaching 11/11 entities; the whole scene changing colour
when they move is Gate 4's second condition working. If it did *not*, that would
be the defect.

**The rest is not, and points away from the engine on two independent grounds.**
The engine has no path that changes the whole wall when one layer's opacity
moves — modulation is per-entity. And `holder.tint` is new *today*: a symptom
that existed in Phase 3 cannot be caused by a mechanism that did not exist then.
The leading candidate is **the projector's adaptive brightness / dynamic
contrast**, re-grading the frame when the average light level moves. §10 row 1
established that auto-keystone and auto-focus are fully disableable on the Mars
II Pro; this is the third auto-feature and nobody has checked it.

**Not closed on that reasoning.** Gate 2 overturned "the blur is the projector"
into "the blur is content", and the reverse mistake is just as available: a
whole-wall shift is also what a global engine bug looks like, and "I think it
happened in Phase 3" is a recollection, not a run. So the engine's half is now
closed by construction and the projector's half has a test.

**`scenes: phase4-reference` — the instrument.** A mid-grey patch stating
`susceptibility: 0` for *every* shipped force **explicitly** — not by omission,
because an omitted force takes its definition's default and `timeOfDay` defaults
to 1 — at `depth 0` so parallax cannot move it either. `forces.test.ts` asserts
its modulation is the identity under every force at full travel, at 81 clock
times, with parallax swept to the corner. Two witnesses stand beside it, one
that moves only on wind and one that changes only on tint, so that "nothing
happened" can be told apart from "nothing is running".

It is deliberately **not** part of `phase4-forces`: a twelfth layer would change
the load §4's window was measured at and re-bless thirteen goldens, to answer a
question unrelated to either.

**The pass condition inverts, and is stated that way on purpose** — Phase 3 lost
three rounds of questions to an "all good" covering a check of exactly this
shape. Drag any control and watch **only the patch**:

- **The patch does not change → PASS**, and the whole-wall shift is downstream,
  in the projector. This check passes by *nothing happening*.
- The patch changes while its witnesses move → the engine is implicated.

Order of work for the operator: **turn off adaptive/dynamic brightness in the
projector's menu first**, then re-test. This wants doing *before* the wall
session, because "`timeOfDay` sweeps the whole scene's light smoothly" is a
judgement about light on a wall, and a projector re-grading underneath the sweep
can make a smooth ramp look like it steps.

### `SPEC-CHANGE-PROPOSED` — §10, two rows

**Row 2 is still outstanding from Phase 3 and is not the agent's to edit.** The
caps were ratified 2026-09-04 — **concurrent video 4, concurrent live Lottie 4,
behaviour WARN not refuse** — and are wired as `MAX_CONCURRENT_VIDEO` /
`MAX_CONCURRENT_LOTTIE` with a `[caps]` log line. The row itself still reads
"Phase 3, confirmed Phase 9" and carries no number. The Lottie figure should be
recorded as **by analogy and unmeasured**; no run ever isolated Lottie count
from video count.

**A NEW row is proposed: the projector's adaptive picture features are
disabled.** A7 closed auto-keystone and auto-focus in row 1. Adaptive
brightness / dynamic contrast is the same class of thing — a projector feature
that silently re-grades the image — and it is a **measurement precondition**,
not a preference: every colour judgement from Gate 4 onward, D15's colour
coherence and Phase 9's grade pass all depend on the panel not moving underneath
them. It belongs in the spec rather than in somebody's memory.

Note this does **not** contaminate today's §4 numbers. M1 and M2 are frame
timing, not photometry.

### `NOTE` — the coalescer's third instance, and why it is a new file

`debug/coalesce.ts` is the third implementation of the 4 Hz trailing-emit
coalescer (`render/warp.ts`, `debug/clockLog.ts`, now `[force]`), which is the
threshold the Phase 3 `IDEAS` note named. It is a **new module used only by the
new logger**, not a refactor of the two existing ones: both sit behind passed
gates and CLAUDE.md is explicit that a passed gate is a frozen surface. The
extraction is available to either the next time its surface is legitimately
open. Until then there are three implementations of one idea, recorded rather
than hidden.

It is keyed per force, which the other two are not: the clock has one subject
and the bus has five, and a global window would let a wind-slider drag suppress
the one `[force] rain …` line explaining what the operator was looking at.

A defect in it was caught by its own tests before it ever ran: the first line
for each key was being *held* for a quarter second rather than emitted, because
`lastAt` started at 0 and a coalescer constructed near its clock's epoch has
`now() - 0 < interval`. A run log whose opening state arrives late is the Phase 3
instrument defect wearing new clothes.

### `IDEAS` — parked, not built

- **Extract the coalescer** across `warp.ts` and `clockLog.ts` when either
  surface is next open. Three copies is one too many.
- **A per-region golden assertion.** The reference patch's invariance is proved
  by unit test; proving it *in pixels* would need the harness to hash a
  sub-rectangle, which it cannot. Worth it if the same question recurs.
- **`timeOfDay` cannot brighten.** The tint axes are multiply-only because
  PixiJS `Container.tint` is; noon is `(1,1,1)` and the day ramp runs downward
  from full output. A *lifted* look is `grade.*` and belongs to Phase 9, where
  D15 already lives. Golden-hour consequently reads as a desaturated warm rather
  than an orange sky, which is honest and worth a look on the wall.
- **Wind does not depth-scale its `rotate` axis**, only its offsets. A distant
  tree bends by the same angle and merely looks smaller, which is physically
  right; if it reads wrong on the wall, that is a content note, not a bus one.

### `MEASURED` — the clean re-take, and a hole it found in Gate 3's records

`p4-soak-p3load-2`, `disturbed=false`, `focusChangedInWindow=false`,
`throttled=false`, `1:1 to panel`. Phase 3's scene, 20 minutes, 604 rebuilds,
**`flat: true`** — textures 11 → 11, bytes 17,596,424 → 17,596,424, buffers
4 → 4, geometries 2 → 2, `driftTextureCount`/`Buffer`/`Geometry` all 0.
M1 0.0000% late, worst interval 18.80 ms, clause 3 empty.

**Gate 3's result is unchanged by the force bus**, which completes the
attribution: the `flat: false` on `phase4-forces` is PixiJS `Graphics` pooling,
reproduced on `phase1-default` with no forces active at all.

Two numbers in this run needed checking rather than assuming, and both are
recorded because the next person will see them too.

**`textureSlots` grows 23 → 1221 over 20 minutes.** It does exactly the same in
Gate 3's own soak, so it is pre-existing and not Phase 4's. It is also not a
leak in any sense that matters: `textureCount` holds at 11 and
`textureBytesEstimate` is byte-identical end to end. It is a slot counter, not
memory.

**Mean render duration at minute 20 is 0.1662 ms, against 0.0349 ms in Gate 3's
soak of the same scene.** M2 passes either way — p99 1.800% of N against a 60%
budget, and the mean is 1.0% of N — so this blocks nothing. It is also not the
force bus arriving: the 60-second `p4-regression` at the same scene reads
0.0239 ms, *lower* than Gate 3's soak. Something rises across 20 minutes on a
video + Lottie scene, and this session cannot say what.

**And the reason it cannot is worth recording as a defect in our own records:
`p3-soak` — the run Gate 3's texture rolling check cites — is itself
`disturbed=true`.** For a memory census that matters little, which is presumably
why it was accepted. For a *timing* comparison it means there has never been a
clean 20-minute M2 baseline at Phase 3's load, so there is nothing to say
whether 0.1662 ms is a regression, thermal drift, or ordinary variance.
Phase 9 owns the performance pass and the soak that would settle it; it is
parked there rather than guessed at here. Nothing was weakened to accommodate
it — M2 passes on its own terms.

## 2026-09-05 — Phase 4 (session 1, part 2) — the wall, and the patch in pixels

### `MEASURED` — the operator's wall session, 2026-09-05

Warp on, `phase4-forces`, after disabling the projector's adaptive brightness.
Three of Gate 4's four visual conditions, each answered against a stated pass
condition rather than in general:

| condition | observed | verdict |
|---|---|---|
| wind, scaled by susceptibility | "grey still, amber leans about half as far as cyan" | PASS |
| `timeOfDay`, no per-layer seams | "whole scene together, no seams" | PASS |
| parallax, near vs far | "trees slid across each other, backdrop still, no black band" | PASS |

**The grey bar not moving is the load-bearing half of the wind observation.**
Three bars identical in size, position and depth, differing only in
`susceptibility.wind`; if susceptibility were not reaching the compositor all
three would move together and the scene would look busy and pass nothing.

**The absence of a black band confirms on a wall the defect a golden preview
caught before it shipped.** I-1 caps layer width at 1, so a full-frame layer has
no bleed to parallax into; `DEPTH_GAIN_FAR` is 0 and the backdrop is nailed
down. A picture found it and a wall confirmed the fix.

**And the projector's adaptive brightness was a real cause, not a hypothesis.**
Turning it off stopped the whole-wall colour shifts the operator reported. It
was disabled BEFORE the `timeOfDay` sweep was judged, which was a precondition
and not a detail — a panel re-grading underneath the sweep can make a smooth
ramp look like it steps. This is why it wants a §10 row rather than a memory.

### `MEASURED` — the reference patch, and why it needed pixels

The operator's answers contained a genuine contradiction, and it was not
resolved by choosing the convenient one:

> patch: **"the grey patch changed too"** — while dragging wind
> projector: **"the whole scene together, no seams — and the projector fix
> worked"**

Those cannot both be true of a layer that is subscribed to no force, sits at
`depth 0`, and is unit-tested as the identity under every force at full travel
across 81 clock times with parallax swept to the corner. Three readings survive
and the eye cannot separate them: the patch test happened before the projector
menu fix; a real modulation leak in the compositor; or **simultaneous contrast**
— a mid-grey patch beside a bar that is genuinely moving and changing brightness
will *appear* to shift, which is an optical effect and not a figure of speech.

So the engine's half was settled in **pixels**. `IDEAS` in the previous entry
parked a per-region golden assertion as "worth it if the same question recurs".
It recurred within the session.

`GoldenCase.region` hashes one normalized rectangle of the frame alongside the
whole one. Two new cases — `phase4-reference-wind-none` and
`phase4-reference-wind-max` — differ in exactly one value:

- their **frame** hashes MUST differ (`7874f3b5` vs `0204c000`); a match would
  mean the witness was not moving and the assertion proved nothing, so that is
  its own `problems.push`
- their **region** hashes over the grey patch MUST be identical: **`1a00d8e5`**

**Verified by negative control.** Giving the patch `wind: 1` and `depth 0.5`
makes the assertion fail (`1a00d8e5` vs `a16c4f65`) with the message it should.
An assertion that cannot fail is worth nothing, and this project has shipped one
before.

**Conclusion: the compositor cannot be what shifts the patch.** What the
operator saw was the projector — consistent with the fix having worked — or
contrast against a moving neighbour. No engine change is warranted, and none was
made to accommodate the report.

### `NOTE` — the region assertion printed a false PASS on its first run

`regionHash` was absent from the runner's projection of the results, so both
sides read `undefined`, and the guard tested `=== null`. `undefined ===
undefined` is true, so the harness printed **"the reference patch is
pixel-identical (undefined)"** — a green line over a measurement that never
happened.

Caught within a minute because the hash printed as `undefined` in the message,
which is the only reason it was visible at all. This is the sixth instrument
defect of the same family in this project and the argument for putting the
VALUE in the log line rather than only the verdict. The guard is now falsy-based
and says explicitly that a missing hash "is not a pass".

---

## 2026-09-05 — Phase 4 (session 2) — the S-series ratified, and a consistency sweep

- DID: no code. Two document batches. **v3.3** — the S-series (S1–S10), from a
  design consultation with the operator on four gaps they named, worked into one
  amendment and ratified in the same session. **v3.3.1** — the B-series (B1–B9),
  a consistency sweep with no new decisions in it, run immediately afterwards
  because propagating S8's renumbering exposed how much of the two mutable
  documents still spoke in v3.2 numbers.
- MEASURED: nothing new. **No §4 number in this project is affected by either
  batch** — they change plans and wording, not measurements, and no gate run was
  taken.
- BLOCKER: none, and deliberately so — see the order note below. **Gate 4 is
  still open on one condition and nothing in Phases 6+ is built until it closes.**
- NEXT: show it to one other human, on a wall, warped, and log their reaction
  verbatim. That is the whole of Gate 4's remainder.

### The operator's four gaps, as stated

Recorded in their own framing before being reorganised, because the
reorganisation is an interpretation and the next reader should be able to check
it:

1. **Hierarchy** — folders inside folders, holding layers and entities, so they
   can be grouped and filed.
2. **Serial and parallel motion** — "something that happens after something, or
   something that happens at the same time as something". Named as absent.
3. **Per-animation warp** — an element marked or added, then shaped against the
   projector, needs its own warp.
4. **A boundary and a path inside it** — mark a window in the projector's
   throw, project only its outline, run an animation along that outline; four
   windows in a queue folder, one after another, while a second folder fills all
   four at the same time. "Then there is a flow."

Plus, in the same session: cubes standing in the projection space, and an AI
prompt filling a marked shape or walking a marked route.

### `DECISION` — the four gaps are one feature, and naming it that way is what made the amendment small

Presented as four, they read as four phases. They are one model:

- a **Surface** — a marked piece of real geometry with a shape, a mask, a path
  and its own mapping (gaps 3 and 4),
- a **content tree** organised into groups that run together or in turn
  (gaps 1 and 2),
- and a **binding** between them.

Gap 4's four-window example is not a fifth feature; it is what the other three
produce when composed. That is why this lands as **two phases and three
invariants** rather than four independent workstreams, and it is the reason the
amendment could be ratified in one session.

### `DECISION` — the surface question, which is the one that cost the most

Asked directly: is the target a flat wall with shapes marked on it, or real
geometry at different angles? Answer: **both.**

That answer is what forces I-5's restatement. **A single transform can square
exactly one plane.** Faces of a cube sit at different angles to the projector,
so no one transform aligns them — geometry, not implementation. And "both" is
better than either alone, because it collapses to one model: **a flat wall is
not a special case, it is one surface filling the frame.**

### The S-series amendment table

| # | Change | Reason | Alternative rejected |
|---|---|---|---|
| **S1** | §2.1 gains a third usage mode: object & architectural mapping | v3 named two modes; the operator's actual target is a third, and the spec did not say so. A scope this size discovered later is a scope crept into rather than chosen | Treat it as a variant of worldbuilding. Rejected: worldbuilding is about depth and weather in a frame, not about aligning to facets of real objects. Calling them the same thing is how the second one never gets designed for |
| **S2** | I-5 restated as **two** mapping levels — per-surface, and the final output mapping — both calibration, both isolated from scene logic | One transform squares one plane; cubes need more. Stating two levels keeps the isolation I-5 exists for and makes the second one legal instead of leaving it to appear as a per-layer hack | A per-layer warp stored in the scene file. **Rejected as the thing I-5 exists to refuse**: it puts physical geometry inside content, and there is then no statement of where the room ends and the show begins. Also rejected: a scene-space corner-pin that is *not* calibration — the same problem in politer clothes |
| **S3** | I-15 added: surface tree (where) and content tree (what), bound by **role** | Keeps I-5 stateable, and buys portability for free — a scene authored in one room loads in another once that room is calibrated and tagged | One tree holding both, the obvious shape. Rejected: it makes every scene file room-specific and makes the calibration/scene split — Gate 2's own proof — unstateable. Also rejected: binding by surface **id**, which works and quietly destroys the portability that is the best thing here |
| **S4** | I-16 added: hierarchy, and `parallel` \| `sequence` with per-child durations summing to the group's, position **derived** from the one clock | It answers "this, then that" with no new time source and no per-child state, so pause and scrub keep working exactly as Phase 3 built them | "When A finishes, start B" — the natural reading of the request. **Rejected on Phase 3's own evidence:** derived phase is what makes a scrub land and a pause freeze in one frame, and a completion trigger reintroduces per-child accumulated state through the back door. Also rejected: an absolute timeline with a playhead, which §2.2 forbids and which S4 exists to give an alternative to |
| **S5** | I-17 added: one path primitive with `closed` and `interpolation`; three uses — boundary, outline, route | A surface outline and a movement path are the same object; building them separately creates two pointer paths and two stored types for one idea | Curves now (Catmull-Rom or Bézier). **Rejected as four decisions, not one** — curve family, handle UI, corner behaviour, and arc-length reparametrisation for constant speed — in a batch already doubling scope. Mitigated rather than deferred blindly: `interpolation` ships serialized with one legal value, so a curve is a later **value**, never a migration of every stored path. Also rejected: separate straight and freehand tools, which is a mode switch users pay for forever |
| **S6** | §10 row 2 CLOSED with the ratified caps: video 4, live Lottie 4, WARN not refuse | It was ratified 2026-09-04 and wired into the code while §10 still read "Phase 3, confirmed Phase 9" and carried no number. Named as outstanding in two prior entries; the operator is the only one who can edit it and is here | Leaving it for the Phase 11 confirmation. Rejected: a decision that is live in code and absent from the spec is exactly the drift §0's three-artefact rule exists to prevent |
| **S7** | §10 gains a row: the projector's adaptive picture features are disabled, **before Gate 4** | Proposed 2026-09-04 against the colour-shift report. Same class as A7's auto-keystone and auto-focus, and a **measurement precondition** for every colour judgement from Gate 4 on | Leaving it in the build log as a note. Rejected on A7's precedent: an installation prerequisite that lives in somebody's memory is discovered on site. **Discharged the same day it was written**, which is the argument for the row rather than against it |
| **S8** | Two phases inserted; §11 renumbered P6→P8 … P11→P13; Phases 0–5 unchanged | Surfaces and sequencing each carry a gate's worth of conditions and cannot be bullet points inside Phase 5 | Appending them after Phase 11 to avoid renumbering. Rejected: Phase 8's serialization, Phase 9's calibration format and Phase 11's caps all depend on these models, so appending would mean designing three formats twice. Renumbering was made cheap by leaving 0–5 alone, so **no passed gate moves** |
| **S9** | An inactive sequence block is dismounted; the next is prewarmed, with the lead **measured** | Sequencing is a performance fact, not a UI detail: it puts decoders in series where §4 measured six colliding in parallel | Keeping every block resident. Rejected: it discards the main performance benefit and multiplies the x6 burst. Also rejected: a guessed prewarm lead — A9's principle, an instrument (or a constant) that emits a plausible wrong number is worse than one that fails loudly |
| **S10** | D20: the AI provider supplies **pixels**, never motion or geometry | The engine already owns paths, pace, size and boundaries. Asking a model for them breaks I-3 and does not work reliably today | Prompting for the full behaviour — "a zombie walking along this path inside this shape". Rejected twice over: it makes the compositor care where pixels came from, and current models cannot hold a seamless alpha walk cycle at consistent scale and heading |

### `SPEC-CHANGE-RATIFIED` — v3.3, all ten, by the operator, 2026-09-05

Propagated in the same session, so the three-artefact rule (§0) is satisfied by
this entry plus the §1 v3.3 block plus the body edits:

- §2.1 third mode · §2.4 unchanged
- **I-5 restated**; **I-15, I-16, I-17 added** — invariants now I-1 … I-17
- **D17** (two trees + calibration/performance modes), **D18** (duration blocks,
  loop default on, hard cuts, longest-child rule), **D19** (one path tool,
  shift-constrain, simplify on release), **D20** (AI supplies pixels)
- §7 gains `core/paths.ts`, `core/surfaces.ts`, `core/roles.ts`,
  `core/groups.ts`, `render/mask.ts`, `render/surfaceMap.ts`,
  `render/lifecycle.ts`; `calibration/` splits into `output.json` and
  `surfaces.json`; a "which tree owns which file" note added beside A13's policy
- §8.1 gains four test groups; §8.2 gains three rolling checks
- §9 gains five risk rows; the scope-creep row now names I-16 as the line
- §10: row 2 **closed**, rows 6–10 added
- §11: Phase 5 extended, **Phases 6 and 7 new**, 8–13 renumbered, Gates 8, 9,
  11 and 12 extended
- §12 gains eleven terms

### The B-series table — a sweep, not a batch of decisions

Every row makes one document say what the project had already decided somewhere
else. **Nothing here is a decision**, and each is labelled so a later reader can
tell a correction from an amendment.

| # | Fix | What it was inconsistent with |
|---|---|---|
| **B1** | `SPEC.md`'s header said `v3` while §1's top block said v3.2 | Itself. A spec whose header disagrees with its own revision history is §0's auditability defect in its smallest form. The header now carries version *and* build status, so the two cannot drift apart silently again |
| **B2** | Six pre-S8 phase numbers in `CHECKLIST.md` prose: "Phase 2 and Phase 7 calibrate one transform" (→9), "residual at the limits is Phase 7's subject" (→9), "parked for Phase 9" (→11), "grade wired in Phase 9" (→11), and Gate 0's carried-forward k note naming Phase 9 and Phase 8 (→11 and 10) | S8's own claim that no phase label goes stale. That was true of headings and false of forward references inside prose. **A renumbering that sweeps headings and not prose is a renumbering half done** |
| **B3** | `CHECKLIST.md` still said §10 row 2 "needs the operator's edit" | S6, which closed it. A checkbox describing an action already discharged is the stale-note defect Gate 0 hit twice |
| **B4** | `BUILD_LOG.md`'s pre-v3.3 entries left **unedited** | §0's append-only rule. They were correct when written. The reconciliation is stated once, here, rather than by rewriting history: **a phase number in an entry dated before 2026-09-05 is a v3.2 number** |
| **B5** | §9's projector-side geometric row read as still pending; there was no photometric row at all | The 2026-09-03 verification at the projector, and the 2026-09-05 adaptive-brightness fix. Both rows now record that they fired and were discharged, and the requirement still stands for future devices |
| **B6** | §4's A14 clause said the instrument "has now been the bug three times" | The log. It is six. The sixth is the region-hash guard printing `pixel-identical (undefined)` on 2026-09-05 — a green line over a measurement that never happened, caught only because the missing value was visible in the message. **The clause is unchanged; the count is corrected, and one sentence is added: a gate line prints the VALUE, not only the verdict** |
| **B7** | §10 rows 1 and 2 did not say they were closed *in code* | The code. `MAX_CONCURRENT_VIDEO` / `MAX_CONCURRENT_LOTTIE` were wired with a `[caps]` log line before the row said anything |
| **B8** | Gate 4's status was stated differently in three places | The wall session. Header, §11 and `CHECKLIST.md` now agree: five passed 2026-09-05, one open, and the open one is not a measurement |
| **B9** | Three live rulings had no §10 row and no due phase: M2's `performance.now()` quantization, A8's `k` probe, the memory-soak verdict | §10 itself, which is the register of what is undecided. Each was named at every gate since Phase 2, each waits on the operator, and each lived **only in build-log prose**. They are now rows 11, 12 and 13, due at Phase 6, Phase 11 and Phase 6. **A decision that is open, load-bearing and absent from §10 is open with no due date, which is how an open decision becomes a permanent one** |

### `DECISION` — the order, which is the part most likely to be ignored

**Nothing in the S-series is built until Gate 4 is crossed.** Written into §11's
preamble rather than left to discipline, because this is the exact moment §9's
scope-creep row fires: a ratified amendment is the most legitimate-looking
reason there has ever been to leave a gate condition open.

Gate 4 is §2.4's first demoable milestone — "treat reaching it as a deadline,
not a byproduct" — and after 2026-09-05 it has **one** condition left, which
needs a person and not a phase. The order that follows: **show it to somebody →
log their reaction → Gate 4 closed → §10 rows 11 and 13 ruled → Phase 5.**

The formulation worth keeping: an amendment that is ratified and then queued is
scope **chosen**; one that is ratified and then started is scope **crept**.

### `DECISION` — what this costs, stated in days rather than implied

`CHECKLIST.md`'s totals are restated. **v1 shippable moves from 45–67 days to
63–94 — roughly +40%.** Phase 5 grew (path tool), Phases 6 and 7 are new, and
Phase 9 grew because I-5 now has two levels to calibrate.

Recorded as a headline rather than buried in a table because the estimates exist
to detect drift, and a 40% increase absorbed silently into a table is drift that
was never written down — rule 4, applied to a plan instead of to a phase.

### `NOTE` — three predictions this batch makes, so they can be checked later

Written down now because a prediction recorded before the run is evidence and
one recalled afterwards is not. This project has already lost a cliff to a
retraction for want of exactly this.

1. **Sequencing raises the video ceiling.** §10 row 2's cap of 4 is
   symptom-level; the x6 failure was a 0.7 s burst of simultaneous
   loop-boundary seeks. Six videos **in sequence** should hold both §4 metrics
   where six concurrent ones did not. Gate 7 asks for it directly and asks that
   a negative result be stated.
2. **Most surfaces will not need a render target.** On a flat wall the surface
   mapping is identity and a clip should suffice. If that is wrong, §9's
   per-surface render-target row does real work and Phase 6's stated surface
   count will be low.
3. **The AI fill case works well before the character case.** D20 already
   bounds the consequence — the failure is an ugly asset, not a broken feature.

### `IDEAS` — parked, not built

- **Per-surface content in the preview at reduced fidelity.** I-7 already makes
  the preview an approximation, and A2 forbids a second video decoder. Any
  surface preview must respect both.
- **Nested sequences as a "scene bank" of one scene.** Phase 8's bank and a
  top-level sequence are structurally similar and should not be merged without
  a reason; noted so the similarity is not mistaken for a refactor opportunity.
- **The coalescer's fourth instance.** Still three (`warp.ts`, `clockLog.ts`,
  `debug/coalesce.ts`). Phase 6's surface log would be a fourth and should use
  the existing module rather than adding one.
- **A per-region golden assertion — now built, and its scope is worth noting.**
  `GoldenCase.region` landed on 2026-09-05 for the reference patch. Surfaces
  make it more valuable still: hashing a sub-rectangle is exactly how a
  boundary's containment gets proved in pixels rather than by unit test.


---

## 2026-09-05 — Phase 4 (session 3) — GATE 4 PASSED, and row 11 put to the operator

- DID: closed Gate 4's sixth and last condition on the operator's report, marked
  it `[x]`, and crossed the gate. No engine code changed. Restored the three
  mutable documents, which had arrived in the working directory as
  `SPEC (1).md` / `CHECKLIST (1).md` / `BUILD_LOG (1).md` with the tracked
  originals deleted. Read `src/debug/clock-source.ts` and `electron/main.ts` to
  cost `SPEC.md` §10 row 11 properly, and put it to the operator as a
  `SPEC-CHANGE-PROPOSED` with a recommendation.
- MEASURED: **507 tests / 24 files green** and **43 golden frames match**, both
  re-run today before the gate box was ticked rather than quoted from the gate
  run. The golden run printed the region assertion with its **value** —
  `the reference patch is pixel-identical at wind 0 and wind 1 (1a00d8e5) while
  the frames differ (7874f3b5 vs 0204c000)` — which is B6 working as intended:
  the line that once printed `(undefined)` now cannot hide a missing hash.
  No new §4 number; no gate run was taken and none was needed.
- BLOCKER: none. Gate 4 is closed; the queue is `SPEC.md` §10 row 11, then row
  13, then Phase 5.
- NEXT: the operator rules on row 11. Then row 13, then Phase 5 — **not**
  Phase 6, which stays queued behind Phase 5 exactly as S8 ratified it.
  Crossing Gate 4 releases the S-series from its hold; it does not reorder the
  phases.

### `GATE-PASSED` — Gate 4, all six conditions, 2026-09-05

§2.4's **first demoable milestone**, reached. Five conditions were judged on the
wall by the operator earlier the same day and are recorded in the Phase 4
session 1 part 2 entry; the sixth was discharged that evening. The numbers, so
this entry is complete on its own and not a pointer to another one:

**Run `p4-gate`, scene `phase4-forces`, 11 layers.** `disturbed=false`,
`throttled=false`, 1:1 to panel, `pin=PINNED`, 3601 samples over 60.0 s after
the discarded 10 s warmup, fps 60.000067 against a nominal 60.000004.

| metric | value | reading |
|---|---|---|
| **M1** — frames late | **0.0000%**, worst run 0, worst interval 18.80 ms, clause 3 empty | a measurement |
| **M2** — p99 render | **0.2000 ms = 1.200% of N** | an **UPPER BOUND**, exactly two quanta of a 0.100 ms clock |
| `renderMeanMs` (informational) | 0.0649 ms = 0.390% of N | a measurement |
| regression `p4-regression`, Phase 3's load | M2 p99 **0.600% of N**, identical to Gate 3 | the force bus costs nothing measurable |

Suites: **507 tests**, **43 golden frames**. Fifth force added as data in
**1 min 34 s**, one production file, `core/forceDefs.ts`, +53 lines, zero lines
in the bus, compositor, registry, editor panel, log or scene model.

**M2 is stated as a ceiling in the gate's own record, not in a footnote.** Every
M2 p99 this project has recorded is an upper bound in whole quanta, and Gate 4
is no exception. That is §10 row 11 and it is the next thing on the queue,
which is the correct relationship between the two: the gate passed on a metric
that cannot yet see its own subject, and it says so.

### The sixth condition, and what kind of evidence it is

- **date:** 2026-09-05 · **scene:** `phase4-forces` · **warp:** on
- **projector:** adaptive brightness and dynamic contrast **OFF** (§10 row 6),
  so the colour half of what they saw was seen under the ratified precondition
- **they saw the `timeOfDay` sweep:** yes
- **who, by role:** a friend / family member — a non-technical viewer with no
  professional stake in the tool, which is arguably the strongest form of this
  test, since §2.4 asks whether the thing reads as a product rather than as an
  exercise
- **contradictions with a passed condition:** none reported

**The reaction is a SUMMARY, not a quote, and this entry labels it as the
weaker evidence it is.** The operator reports the reaction as strongly
positive — *"they loved it"* — and states plainly that the words themselves
were not written down in the room and are **not being reconstructed after the
fact**.

The gate line asked for a verbatim reaction and said, in its own text, that *"a
remembered 'they liked it' is not"* data. That warning was left standing in
`CHECKLIST.md` rather than softened to fit what was returned. The operator ruled
that the condition is satisfied — the thing was shown to another human, on a
wall, warped, and the reaction is on the record — and that the shortfall is
recorded as a shortfall.

**A9 applies to prose as much as to numbers.** A reconstructed quote is a
plausible wrong value in a field that would look like a fact, and this project
has already lost a cliff to a retraction for want of a record made before rather
than after. Refusing to invent one is why this reads as a summary. Three fields
in the operator's report arrived as unfilled placeholders — date, sweep, role —
and were asked for rather than inferred, for the same reason: an append-only
file cannot be corrected in place, only appended to.

**For the next showing: write the words down in the room.**

### `SPEC-CHANGE-PROPOSED` — §10 row 11, M2's resolution floor

The row is due before Phase 6 records its first gate number, it has been open
since Phase 2, and it is the operator's ruling to make. Presented with a
recommendation; not taken.

**What the code already does, because it changes the cost of every option.**
`src/debug/clock-source.ts` is finished, not a stub. `selectClockSource()`
accepts any candidate fine clock and **measures it before committing** —
monotonicity, resolution, and per-call cost against `CLOCK_CALL_BUDGET_MS` —
refusing a candidate that does not advance, that is not monotonic, that costs
more than it resolves, or that is no finer than `performance.now()`, each with a
printed reason and a loud fallback. `ClockSourceReport.coarserThanSubject`
already makes the ceiling condition self-reporting.

**The fine clock is not being refused for a hard reason. It is being handed
nothing.** `electron/main.ts` sets `sandbox: true` on both windows; a sandboxed
preload gets a stripped `process` with no `hrtime`; `preload.ts:nowMs()`
therefore returns `null`, and the fine branch is never taken. The consumer is
built, guarded and tested, and the producer is one line away.

| option | resolution vs the ~47 µs subject | cost | risk |
|---|---|---|---|
| **1. drop the preload sandbox** | `hrtime.bigint()`, sub-µs, ~50× finer | one line + a re-run | a security-posture change bought for an instrument |
| **2. custom protocol + COOP/COEP** | `performance.now()` → 5 µs, ~9 quanta — **documented, not measured here** | days: `registerSchemesAsPrivileged`, `protocol.handle`, rewritten asset URLs, CORP on every subresource, dev-server headers | **it changes the asset load path**, which is the path §4's video numbers are taken on. Production loads `file://`, which cannot carry the headers at all |
| **3. accept p99 as a ceiling, judge on `renderMeanMs`** | none | free | M2 stays decorative at low load, entering the phase that adds render targets |

**RECOMMENDED: option 1, narrowed — drop `sandbox` on the OUTPUT window only,
keep it on the editor.**

| | |
|---|---|
| **Reason** | `CLAUDE.md` measures on the output window, so that is the only window that needs the fine clock and the only one that should pay for it. **The risk is bounded by code that already shipped:** if `hrtime` proves unaffordable, `selectClockSource` rejects it on the measured `callCostMs` and falls back with a printed reason, so this change cannot silently produce a better-looking wrong number — the failure mode A9 exists for and the one this project has hit six times. The editor keeps the stricter posture, and the editor is where posture matters: file dialogs, UI, and Phase 12's AI provider, the first thing here that touches a network. `contextIsolation` and `nodeIntegration` are untouched in both windows. And it clears the row **before** Phase 6 records a number, as the row's due date requires, without disturbing the substrate Gate 6's video regression is measured on |
| **Alternative rejected** | **Option 2**, the technically cleaner fix, which keeps the sandbox and is what a remote-content app would be forced into. Rejected **for now and not on principle**: it fixes the clock by changing the asset load path immediately before a gate whose numbers depend on that path, and it is days of work against one line. Option 1 does not foreclose it — if this app ever loads remote content, option 2 stops being optional. Also rejected: **option 3**, which is honest and free and leaves M2 unable to judge its own gate condition at low load, three phases after that was discovered |
| **Honest weakness, stated rather than buried** | Electron's own guidance is that `sandbox` stays on. This is a real posture change, made for a measurement. Confining it to one window makes it small; it does not make it nothing |

**A prediction, recorded before the run so it counts as evidence later.** Phase 6
draws surfaces with `Graphics` and adds render targets, so the subject may grow
past the 100 µs quantum on its own and make M2 self-resolving. That would be
luck rather than a plan, and it would not retroactively measure Gates 0–4.

### `SPEC-CHANGE-PROPOSED` — propagate Gate 4's status into `SPEC.md`

Not a decision and not an amendment — a status propagation, listed because
`SPEC.md` is the operator's file and it now states something that stopped being
true today. Four places:

| line | says today | should say |
|---|---|---|
| 11–13 (header **Status**) | "Gate 4 is one condition from closed — five of its six passed" | Gate 4 **passed** 2026-09-05, all six; building Phase 5 next |
| 1285 (§11 "Where that stands today") | "Five of Gate 4's six conditions passed… Until it is met, the sanctioned work is Gate 4's closure and the §10 rulings" | Gate 4 crossed 2026-09-05; the sanctioned work is §10 rows 11 and 13, then Phase 5 |
| 1381 (§11 Gate 4 heading) | "*five of six passed 2026-09-05; the sixth is the only thing between this project and Phase 5*" | all six passed 2026-09-05 |
| 1394–1395 (§11 Gate 4, sixth bullet) | "**OPEN.**" | **PASSED 2026-09-05**, with the note that the reaction is on the record as a summary rather than a quote, and is weaker for it |

B1's lesson is the argument for doing all four together: a header that disagrees
with the body is §0's auditability defect in its smallest form, and B8 had to
fix Gate 4's status being stated three different ways once already. A §1
revision block goes with them if the operator wants the propagation auditable as
a change rather than a correction.

### `NOTE` — the three documents were restored, not edited

They arrived as `SPEC (1).md`, `CHECKLIST (1).md` and `BUILD_LOG (1).md` with
the tracked originals deleted from the working tree. Each was diffed against
`HEAD` before anything else happened: all three are strict supersets of the
committed versions — the v3.3.1 header, the B-series block, the Phase 4 session
2 entry appended at line 3519 — so they are the newer copies and nothing
committed was lost. Renamed into place. `SPEC.md` was **read and not written**.

### `IDEAS` — parked, not built

- **A verbatim-capture habit, not a feature.** Gate 6 and Gate 7 both end in a
  human judgement on a wall, and both will hit this. The cheap fix is a phone
  voice memo in the room, transcribed into the log afterwards — a record made
  before rather than after, which is the whole of A9 applied to people.
- **`coarserThanSubject` belongs on the gate line.** It already exists in
  `ClockSourceReport`. Printing it beside every M2 figure would mean no future
  reader can mistake a ceiling for a measurement, whichever way row 11 is ruled
  — including option 3, where it becomes the only thing standing between the
  number and a misreading. Cheap, and squarely B6's principle: print the value,
  not only the verdict.

## 2026-09-05 — Phase 4 (session 4) — the goldens drifted, and the machine moved under them

- DID: no code, no engine change, no spec edit. Verified the previous session's
  uncommitted work before committing it rather than after, which is the only
  reason this entry exists. Re-ran both suites the session-3 entry cites. The
  unit suite reproduced exactly; **the golden suite did not**. Traced the
  difference to a macOS update installed between the blessing and the re-run,
  updated `CHECKLIST.md`'s golden rolling check to say what is true on this
  machine today, and put §4's TARGET_MACHINE to the operator as a
  `SPEC-CHANGE-PROPOSED`. Committed the v3.3.1 document replacement, the Gate 4
  entry and this one together.
- MEASURED: **507 tests / 24 files green** — matches session 3 exactly.
  **Golden frames: 40 of 43.** Three mismatches, hashes stable across two
  consecutive runs:

  | case | rendered | blessed |
  |---|---|---|
  | `resilience` | `071a69af` | `c8d0e8e7` |
  | `phase3-load-preview` | `5c548a84` | `af59b5a4` |
  | `bundled-missing-asset` | `f1546bfd` | `9510edbd` |

  The I-4 region assertion printed **identically** to session 3 — reference
  patch `1a00d8e5`, frames `7874f3b5` vs `0204c000` — as did I-5 (`ba2e7858` /
  `fc055613`) and I-6 (additive gain 1.1441×). The values are quoted, not the
  verdicts (B6).
- BLOCKER: **the golden rolling check is `[!]`, not `[x]`.** It is one ruling,
  not a defect in the engine. Gate 4 is **not** withdrawn and no Gate 4 box
  changed.
- NEXT: the operator rules on the goldens and on §4's TARGET_MACHINE. Then §10
  row 11, then row 13, then Phase 5 — the queue is unchanged and this does not
  reorder it.

### What actually happened, with the timestamps that make it a diagnosis

| when | what |
|---|---|
| 2026-09-04 18:42 / 18:43 | `p4-gate` and `p4-regression` written — **every §4 number in this project predates what follows** |
| 2026-09-05 00:05 | `test/golden/frames.json` blessed, **43 of 43 green** |
| **2026-09-05 00:53:25** | **macOS 26.6.2 (26.6.2) installed** — `/Library/Receipts/InstallHistory.plist` |
| 2026-09-05 14:18 | unit suite re-run: 507 green, unchanged |
| 2026-09-05 14:19 | golden suite re-run: **40 of 43** |

**The engine did not change.** The working tree is three documents; `git diff`
touches no file under `src/`, and the goldens were blessed against this exact
source. So the variable is the environment, and the timestamps bracket it to a
48-minute window that contains exactly one event.

**The three cases are precisely the three that draw text**, and that correlation
is the evidence, not an intuition about fonts:

- `render/placeholder.ts:42` and `providers/bundled/VideoView.ts:87` both set
  `fontFamily: 'monospace'` — a **generic family the OS resolves**, not a font
  the repository ships or pins.
- `resilience` draws two placeholder labels, `bundled-missing-asset` one, and
  `phase3-load-preview` the video badge `▶ live in output`. That is every text
  in the suite, and all three fail.
- The other **40 hash byte-identically** — every filter, blend mode, warp,
  video, Lottie, spritesheet and all five forces. A GPU or driver change would
  have moved those too, which is what rules that class of cause out.
- Both runs produced the same three hashes, so this is a **new deterministic
  baseline, not flake**.
- The rendered placeholder was inspected by eye and is **correct** under I-13:
  magenta outline, cross, and a legible label. Nothing is broken; the bytes
  moved.

**A hash-only golden can say "different" and never "how different."** There are
43 hashes in `frames.json` and no reference images, so the suite cannot show
that a difference is confined to glyph pixels — the eye had to do it from the
preview PNGs. That is B6's principle with one more instance: the instrument
reports a verdict where it could report the value. Parked under `IDEAS`.

### `SPEC-CHANGE-PROPOSED` — §4 TARGET_MACHINE's OS version

§4 records TARGET_MACHINE as **macOS 26.2 (25C56)**. This machine has run
**macOS 26.6.2 (25G83)** since 2026-09-05 00:53:25. §4's own sentence is *"If
the machine changes, the numbers get re-measured, not re-assumed"*, so this is
the clause firing, on the smallest possible subject, before a phase that will
record new numbers.

| | |
|---|---|
| **Proposed** | §4's TARGET_MACHINE line reads **macOS 26.6.2 (25G83)**, with a note that Gates 0–4 were measured on 26.2 (25C56) and that the boundary falls between `p4-regression` (2026-09-04 18:43) and Phase 5's first run |
| **Reason** | The numbers are not wrong and must not be restated as though they were taken here. They are correct **for the machine §4 described when they were taken**. Recording the boundary is what keeps a Phase 5 comparison against Gate 4 honest — without it, the next person to compare an M2 across that line will be comparing two machines and will not be able to tell |
| **Alternative rejected** | **Silently updating the version**, which is the tidier-looking option and destroys exactly the fact worth keeping: *where* the boundary is. A spec that says 26.6.2 with no note claims every gate was measured on 26.6.2, and four of them were not |
| **Also rejected** | **Re-measuring Gates 0–4 on 26.6.2.** Disproportionate, and it would reopen four passed gates to restate numbers that were honestly taken. §0.1 freezes a passed gate; A1's derate and the row-11 ruling are the sanctioned places for re-measurement, not a retrospective sweep |
| **Not proposed** | Any change to Gate 4's result. It passed on the machine of record, with the suites green at the time, and this entry does not touch it |

### The goldens: a ruling, with a recommendation

`CHECKLIST.md`'s line permits *"green, or re-blessed in a commit that says why"*,
so re-blessing is sanctioned and the reason would be a good one. It is put to
the operator anyway, because the cause is a spec fact and because re-blessing is
a decision about **evidence**, not about code.

| option | what it does | cost | weakness |
|---|---|---|---|
| **1. Re-bless the three, reason in the commit** | new baseline on 26.6.2 | minutes | the suite stays hostage to the next OS update, and the next one may land mid-phase |
| **2. Pin the font** — ship one and name it, instead of `monospace` | removes the OS from the render path for text | small, but it **edits Phase 4 code**, and §0.1 freezes a passed surface | changes all three hashes anyway, so option 1 happens too |
| **3. Drop text from golden scenes** | goldens stop covering the label | small | throws away I-13 coverage to protect a hash — the label **is** the deliverable |

**RECOMMENDED: option 1 now, option 2 proposed separately for Phase 5.**
Re-blessing records the truth of this machine and unblocks the line today.
Pinning the font is the actual fix and belongs where it can be done without
reaching into a frozen phase — Phase 5 already opens the editor and pointer
surface, and a pinned font is a one-field change reviewable on its own. Doing
option 2 first would mean editing passed-phase render code to fix a test, which
is the shape of change `CLAUDE.md` warns about even when the change is right.

**Not done unilaterally**, though the checklist would have permitted it: three
green boxes would have appeared with no operator in the loop, on the same day
the machine underneath them changed. That is the "silently downgrade a gate to
make it pass" failure wearing a permitted hat.

### `NOTE` — the session-3 entry's golden claim, reconciled not rewritten

The session-3 entry says *"43 golden frames match, re-run today."* That was
**true when written** — `frames.json` is timestamped 00:05 and the OS landed at
00:53. `BUILD_LOG.md` is append-only (§0, B4), so the line stands as written and
this entry is the reconciliation, exactly as B4 handled the phase renumbering: a
record is corrected by appending to it, never by editing it into agreement.

### `IDEAS` — parked, not built

- **Store reference PNGs, or a per-region hash, beside the 43 whole-frame
  hashes.** Today a mismatch costs a human eye on a preview to classify. A
  per-region hash would have said *"the difference is inside the label box"*
  mechanically. The I-4 region assertion already proves the mechanism exists in
  this suite — it is one call, used once.
- **Record the OS build in each run's conditions block.** The block already
  captures `spans-displays`, the pin, display count and fullscreen state,
  precisely so conditions are captured rather than reconstructed. The OS build
  belongs in it, and this session had to reconstruct it from an install receipt
  — the thing that block exists to prevent.

### `SPEC-CHANGE-PROPOSED` — the version header, B1 recurring

`SPEC.md:9` reads **`**Spec version:** v3.3`** while §1's top block is
**v3.3.1**. This is B1's defect exactly — *"this file's version header said `v3`
while §1's top block said v3.2"* — recurring in the same shape one version
later, and B1's own remedy was to make the header carry version *and* status
*"so the two cannot drift apart silently again."* They drifted again, silently,
which suggests the remedy was a correction rather than a mechanism.

Proposed: the header reads **v3.3.1**. Session 3's propagation table lists four
Gate 4 status lines and does **not** include this one, so it would have been
propagated around and left standing. Worth one line in whatever revision block
carries the Gate 4 propagation, and worth a thought about whether a header this
easy to forget should be asserted by a test rather than by care.

## 2026-09-05 — Phase 4 (session 5) — the goldens settled in pixels, and the OS boundary turned out to be real

- DID: the Part 1 verification block. Proved the golden drift is text-local by
  experiment rather than by inference, narrowed the three hashes to exclude the
  label instead of pinning a font, re-measured `p4-gate` and `p4-regression` on
  macOS 26.6.2, ran the §10 row 11 experiment, and turned B1 from an edit into a
  test. **`SPEC.md` was edited on one line — the version header — under the
  operator's explicit instruction (Part 1.5); nothing else in it was touched.**
- MEASURED: **519 tests / 26 files green** (507 before), **43 of 43 goldens**,
  typecheck clean. Full numbers below.
- BLOCKER: none blocking. Three items need the operator's ruling before Phase 5:
  §4's OS boundary, §10 row 11 (now with a measurement attached), and §10 row 13.
- NEXT: those three rulings, then Phase 5. Phases 6 and 7 stay queued behind
  Phase 5 exactly as S8 ratified them.

### 1.1 — the font hypothesis, settled in pixels

**The step as written could not be run, and that is itself the finding.** It
asked for a diff of the previous preview against the current one. The previous
previews no longer exist: `.golden-preview` is overwritten by every run, and the
run that *found* the drift destroyed the evidence of it on its way past.
`test/golden/frames.json` stores 43 hashes and no reference images. This is the
`IDEAS` note from session 4 — *"a hash-only golden can say 'different' and never
'how different'"* — biting one session after it was written. No Time Machine
snapshot exists either (`tmutil listlocalsnapshots /` is empty).

So the causal variable was changed instead, and what moved was measured.
`scripts/font-probe.mjs` renders the whole suite twice and reports the count and
bounding box of every differing pixel. Perturbations are applied at the canvas-2D
layer through a preload, so **no engine source is touched**.

| perturbation | cases moved (of 43) | `meanLuminance` |
|---|---|---|
| **none — the same run twice** | **0** | identical |
| Chromium `--disable-lcd-text`, `--disable-font-subpixel-positioning` | 0 | no effect |
| generic `monospace` remapped to Courier New | **3** | **differs, ~4.5%** |
| glyphs translated one whole pixel | **3** | **identical** |
| *(observed)* macOS 26.2 → 26.6.2 | **3** | **identical** |

**The instrument control comes first**: two renders with nothing changed are
identical in all 43 cases, across separate processes. Without that line the rest
is unreadable, and this project has shipped an assertion that could not fail.

Four things follow, and the third was a surprise:

1. **Only three cases contain text.** Suppressing glyphs entirely moves exactly
   `resilience`, `phase3-load-preview` and `bundled-missing-asset` — the same
   three the OS moved — and nothing else. The correlation is not a coincidence
   of names.
2. **Alpha is dead as an explanation.** The frame hash is FNV-1a over RGBA while
   `meanLuminance` and `centrePixel` read RGB only, so an alpha-only change would
   have produced precisely the observed signature. Measured: alpha is **255 at
   every pixel of all three frames**, so it cannot be what moved.
3. **The mechanism is a translation, not a re-rasterization.** A font
   substitution moves `meanLuminance` by ~4.5%; the OS change moved it by **zero
   at 6 dp**, and left `coverage` and `centrePixel` bit-identical too. Exact
   preservation of total light *and* lit-pixel count with a different hash is the
   signature of a **pure integer shift** of the glyph block, and a 1 px shift
   reproduces it exactly. Consistent with the font files: **nothing in
   `/System/Library/Fonts` changed** — every file is dated Aug 13.
4. **Therefore pinning a font would not have helped at all.** Not merely a
   partial fix, as Part 1.2 argued: in this instance a zero fix. No font file
   changed; the glyphs simply landed a pixel over.

**What is still not proven, stated rather than buried.** None of this shows that
the OS-induced change lay *inside* the label box, because that comparison needs
pixels that no longer exist. It shows the change correlates perfectly with the
presence of text across 43 cases, that its statistical signature matches a
text-local mechanism exactly, and that the one alternative with the same
signature is ruled out. The residual is that the non-text pixels of those three
frames are now blessed post-update, never checked against 26.2 — bounded by the
40 untouched cases, which exercise every renderer feature those three frames use
and are byte-identical.

### 1.2 — the fix: narrow the hash, do not pin the font

`GoldenCase.exclude` takes a **list** of normalized rects (I-1) — a list, not one
rect, because `resilience` carries two labels at opposite corners and a single
box around both covered **11.42% of the frame**, swallowing the placeholder
outlines that are the actual subject under test. The runner's own 5% ceiling
caught that on the first run, which is the ceiling working rather than a
formality. Split per label it is 2.500% + 1.822%.

Every rect is **measured, not guessed** — the glyph-suppression diff gives the
exact footprint, plus a 4 px margin so a rect is not fitted to today's glyphs:

| case | excluded | share of frame |
|---|---|---|
| `bundled-missing-asset` | 1 rect | 1.146% |
| `phase3-load-preview` | 1 rect | 0.337% |
| `resilience` | 2 rects | 4.487% |

Deliberate details, each with a reason:

- **The rect is outset by a pixel, the exact opposite of `hashRegion`'s inset.**
  `region` asks *"are these pixels identical"* so it steps inside the antialiased
  boundary; an exclusion says *"ignore this"* so it must step outside, or the
  glyph's own fringe — the part most likely to move — stays in the hash.
- **The exclusion applies to `meanLuminance` and `coverage`, not only the hash.**
  Excluding it from the hash alone would leave the other two statistics reading
  the glyphs, and the next rasteriser change would simply fail the case on a
  different line. That is a fix that buys one release.
- **The excluded area is printed every run** with its rects and pixel count
  (A14). A hash that quietly stopped covering part of the frame is worse than one
  that fails.
- **`excluded` is committed into `frames.json`**, so widening a rect later shows
  up as a diff rather than as nothing at all.

**The negative control, in two places.** Ten unit tests in
`src/test/goldenHash.test.ts` — a change inside the rect is ignored, a change one
pixel outside it on every edge is still caught, overlapping rects do not
double-count, an off-frame rect clamps rather than reading out of bounds. Plus a
**live control in the runner**: every excluded case flips a byte outside its
rects and requires the hash to move, reporting where it tripped. If the control
does not trip, that is reported louder than a mismatch, in the same shape
`expectLayoutMismatch` already uses.

**And the fix was verified to actually fix the thing.** With the exclusions in
place, the narrowed hashes of all three cases are **unchanged under both**
perturbations — the font substitution *and* the 1 px translation that matches the
observed signature — while remaining sensitive to a byte one pixel outside.
Durable against the next rasteriser, which pinning a family is not.

### 1.3 — the OS boundary is NOT cosmetic

Both runs on macOS **26.6.2 (25G83)**, projector `T749-fHD720` at 1280×720 @
60.000003814697266 Hz, scale 1, 1:1 to panel, `disturbed=false`,
`throttled=false`, 3601 samples over 60.0 s after the discarded 10 s warmup.

| run | OS | M1 late | M2 p99 | `renderMeanMs` |
|---|---|---|---|---|
| `p4-gate` | 26.2 | 0.0000% | 0.2000 ms = **1.200% of N** | 0.0649 ms = 0.390% of N |
| `p4-gate` | **26.6.2** | 0.0000% | 0.5000 ms = **3.000% of N** | **0.2561 ms = 1.537% of N** |
| `p4-regression` | 26.2 | 0.0000% | 0.1000 ms = **0.600% of N** | 0.0239 ms = 0.143% of N |
| `p4-regression` | **26.6.2** | 0.0000% | 0.3000 ms = **1.800% of N** | **0.1272 ms = 0.763% of N** |

**Both still pass both metrics, with a wide margin** — 3.000% of N against a 60%
limit — and M1 is untouched: 0.0000% late, worst run 0, clause 3 empty, worst
interval slightly *better* at 17.80 / 17.70 ms against 18.80 ms.

But CPU render cost is **3.9× and 5.3×** what it was, in the same direction and
the same magnitude on two different scenes. That is not noise, and "record the
boundary" would have missed it. §4's clause fired and was worth firing.

**Attribution is not claimed.** Two runs cannot separate the OS update from the
state of a fanless machine that had been rendering the golden suite repeatedly
for the previous hour. What is established is that Phase 5's numbers must be
compared against **these** figures, not against Gate 4's.

**A `p4-regression` run was discarded first** — `disturbed=true`, focus LOST at
t=7.0 s inside the window — and re-taken clean rather than reported. Kept as
`p4-regression-os2662-DISCARDED-focus.log`. Its numbers were within 0.4% of the
clean re-take, which is exactly why the rule is that a disturbed run is not a
run, especially when its numbers match.

**Two incidental findings.** The Gate 0 note that *"the `pinned-fingerprint`
fallback resolved in unit tests but has still never fired in the field"* is now
out of date: `p4-gate-os2662` resolved `PINNED (pinned-fingerprint)`, macOS
having changed the display id across the OS update. And **session 3's prediction
has half come true early** — it recorded, before the fact, that the M2 subject
might grow past the 100 µs quantum on its own and make the metric self-resolving,
expecting Phase 6 to do it. The OS did it first: `renderMeanMs` 0.2561 ms is now
**2.5 quanta** rather than 0.65, and p99 0.5 ms is 5. M2 is a coarse measurement
today rather than a pure ceiling. That is luck, not a plan, and it does not
retroactively measure Gates 0–4.

### 1.4 — §10 row 11, measured

The proposal is no longer a proposal with a guess attached. Measured directly, in
two windows differing only in `sandbox`:

| | `sandbox: true` (today) | `sandbox: false` |
|---|---|---|
| `process.hrtime.bigint` | **ABSENT** | **available** |
| clock resolution | `performance.now()` **100.0 µs** | hrtime **0.041 µs (41 ns)** |
| call cost | 0.000150–0.000200 ms | **0.000012 ms (12 ns)** |

The diagnosis in session 3's proposal is confirmed exactly, and the shipping log
line already says it: *"fine clock rejected: fine clock returned a non-number (no
hrtime in a sandboxed preload?) — COARSER THAN ITS SUBJECT (~0.047 ms)."*

**Option 1 works, and it is ~2,400× finer than the quantum it replaces**, at a
call cost of 12 ns — 0.00007% of N, comfortably inside `CLOCK_CALL_BUDGET_MS`,
and `selectClockSource` measures it before committing in any case.

**One caveat the proposal did not know about, and it is load-bearing.** The mixed
configuration is **order-dependent**, reproducibly, three runs out of three:

- editor (sandboxed) created **first**, then output (unsandboxed) — **works**,
  and this is the shipping order.
- output (unsandboxed) first, then editor (sandboxed) — the output window
  **fails to load** with `ERR_FAILED (-2)`, and the process dies with `SIGTRAP`.

So option 1 is one line *plus an undocumented ordering dependency that crashes
the app if a later change reorders window creation*. It happens to be satisfied
today by accident of how `main.ts` is written, not by design. **Recommendation
unchanged — option 1, output window only — but it should ship with a comment at
the window-creation site and a guard, not as a bare flag.** The operator rules.

### 1.5 — B1, shipped as a mechanism

`SPEC.md:9` read `v3.3` against §1's `v3.3.1`. Header corrected to `v3.3.1` under
the operator's explicit instruction, and — the actual point — `src/test/specVersion.test.ts`
now asserts that the header equals the first version named in §1. It was run
**before** the fix and failed with both values in the message (`header says v3.3
and §1's first block says v3.3.1`), which is the only reason it is worth having;
then it passed. **A fix that shipped as an edit comes back; a fix that shipped as
a test does not.**

### `SPEC-CHANGE-PROPOSED` — §4 TARGET_MACHINE, now with numbers

Session 4 proposed recording the OS boundary. The re-measurement changes what the
proposal should say, so it is restated rather than left standing.

| | |
|---|---|
| **Proposed** | §4's TARGET_MACHINE reads **macOS 26.6.2 (25G83)**, with a note that Gates 0–4 were measured on **26.2 (25C56)**, that the boundary falls between `p4-regression` (2026-09-04 18:43) and the re-takes of 2026-09-05, and that **CPU render cost measured 3.9–5.3× higher across it on two scenes while both gate metrics continued to pass** |
| **Reason** | Session 4 argued the boundary should be recorded so a later comparison is not silently made across two machines. That argument was right and is now much stronger: the gap is real and large. A spec that records only the version number would still let someone read Gate 4's 0.390% of N and this phase's 1.537% as a regression in the engine |
| **Alternative rejected** | **Recording the version and not the numbers.** Tidier, and it loses the one fact that makes the boundary worth recording. The version is the label; the ratio is the content |
| **Also rejected** | **Re-measuring Gates 0–4 on 26.6.2.** Disproportionate, and §0.1 freezes a passed gate. Gate 4's numbers were honestly taken on the machine §4 described |
| **Not proposed** | Any change to a passed gate's result, and any claim that the OS *caused* the increase. Two runs cannot separate the update from the thermal state of a fanless machine under an hour of load |

### `SPEC-CHANGE-PROPOSED` — §10 row 13, the memory soak, stated early

Due at Phase 6 and therefore behind Phase 5, but Part 2 asks for it now so it is
not discovered late. **No new measurement was taken this session**; this is the
existing evidence given a recommendation.

The harness reports `flat: false` on `Graphics`-heavy scenes while texture memory
is provably flat — count 2 → 2, bytes 8 → 8, `driftTextureCount 0` over 20
minutes and 604 rebuilds. The `false` comes from buffers 74 → 454 and geometries
37 → 227, and `phase1-default` shows the same signature with no Phase 4 content
at all, settling at the same 110 s, so it is PixiJS `Graphics` pooling and it
predates Phase 4. After settling, `steadyDriftBufferCount: 0` across 548 rebuilds
in 1090 s.

| | |
|---|---|
| **Recommended** | **Split the verdict.** Report `flatTextures`, `flatBuffers` and `flatGeometries` separately, and gate the rolling check on **textures plus post-settle drift in each**, with the 110 s settle stated as a documented plateau rather than explained away |
| **Reason** | One `flat` flag folding three subsystems answers a question nobody asked. The check exists to catch a leak; a pool that fills once and then holds steady is not one, and `steadyDriftBufferCount: 0` over 548 rebuilds is the measurement that says so. Splitting makes the instrument report what it actually observed — the A14 principle applied to a boolean |
| **Alternative rejected** | **Accept the plateau and mark the line `[x]`.** It reaches the same checkbox by argument instead of by measurement, and the instrument would still say `false`. Overruling an instrument in prose is how a green box stops meaning anything |
| **Also rejected** | **Explain the 110 s plateau first.** Worth knowing, not worth blocking on: the plateau is in PixiJS's pooling, and the check does not need its cause to stop conflating three subsystems |
| **Bites at** | Phase 6. Surfaces are drawn with `Graphics`, which is exactly the subject |

### `IDEAS` — parked, not built

- **Keep reference PNGs, or per-case region hashes, beside the 43 hashes.** Said
  last session, and this session paid for it: the pre-update pixels were gone and
  the central question of 1.1 became permanently unanswerable. `scripts/font-probe.mjs`
  is now the tool that would have answered it, and it exists — what is missing is
  a *baseline* for it to diff against.
- **Record the OS build in each run's conditions block.** Said last session,
  unbuilt, and it would have made this session's boundary visible without an
  install receipt.
- **A pinned font is a Phase 5 product decision, not a test fix** — whether the
  HUD and placeholder labels should look identical on every machine. Parked
  there, which is where it belongs now that the goldens no longer depend on it.

## 2026-09-05 — Phase 5 (session 1) — previews retained, the window order made unreachable, row 11 shipped

**APPENDED LATE, 2026-09-05 18:30, by the following session.** This entry
records commit `6051526`, which shipped without one. `BUILD_LOG.md` is
append-only, so the entry goes at the end in the order it was *written*, not the
order it happened; its subject is the session before the one appending it. The
defect is stated rather than hidden: for a few hours the only account of 1.1,
1.2 and 1.4 was a commit message, and a commit message is not one of §0's three
artefacts. **The session-end rule in `CLAUDE.md` is "append one entry, always" —
it was not followed, and the cost was that the next session had to reconstruct
what happened from `git show` and two log files.** Content below is from the
commit message, `measurements/p5-smoke-hrtime-DISCARDED-focus.log`, and
`.golden-preview/prev/manifest.json`; nothing is reconstructed from memory.

- DID: Part 1 blocks 1.1, 1.2 and 1.4 of the Phase 5 handoff. 1.3 was started and
  left idling; it produced no output file and is not reported here.
- MEASURED: **524 tests / 27 files green** (was 519 / 26), **43 of 43 goldens**,
  typecheck clean. Instrument clock on the output window: `hrtime`,
  resolution **0.000084 ms**, call cost **0.000188 ms** against a 0.0028 ms
  budget.
- BLOCKER: none. Three rulings still owed (§4's OS boundary, §10 row 11's
  shipped form, §10 row 13).
- NEXT: 1.3, the cold/warm runs. *(Written by the appending session from the
  handoff, not by the session this entry describes.)*

### 1.1 — previews retained, so the next drift is a diff and not an inference

Last session's central question was unanswerable because the run that *found* the
golden drift overwrote the only pixels that could have explained it, and
`frames.json` stores hashes with no reference images. That was filed under
`IDEAS`; this session built it.

`.golden-preview/prev/` is rotated on every run and carries a
`manifest.json` recording the case count, the platform and OS release, the
Electron and Chrome builds, whether the run that wrote it **completed**, and the
case names. The `complete` flag is the load-bearing field: a baseline written by
a run that died halfway is worse than no baseline, and a manifest that cannot say
so is the same defect as a verdict without its value (A9).

The diff uses the tool that already exists rather than a second one:

    npx electron scripts/font-probe.mjs --diff .golden-preview/prev .golden-preview

**Proven rather than wired.** Diffed against a shift-perturbed dump it localised
the simulated drift to the same three cases and their pixel bounding boxes — the
answer that was unavailable last session. A retention mechanism that has never
been diffed is a directory, not an instrument.

Recorded baseline at the time of writing: 43 cases, `complete: true`,
`osRelease` 25.6.0, Electron 44.1.1, Chrome 152.0.7977.65.

### 1.2 — §10 row 11 shipped as a mechanism, not a flag with a guard

The output window drops `sandbox`, so its preload gets a real `process.hrtime`
and the instrument finally has a clock finer than its subject. `contextIsolation`
stays on and `nodeIntegration` stays off; what changes is that the preload runs
with a real `process`. The editor keeps its sandbox and keeps
`performance.now()`.

**The ordering dependency was the actual problem, and it was fixed at the level
it lives at.** Last session measured that the mixed configuration is
order-dependent, three runs of three: editor-first works, output-first fails to
load with `ERR_FAILED (-2)` and dies `SIGTRAP`. The obvious response — a comment
and a guard at the window-creation site — leaves the wrong order *reachable* and
relies on a future reader obeying a comment. Instead `openOutputWindow`
establishes its own precondition by calling `ensureEditorWindow` first, and
`createWindows()` is the only path that brings up a fresh pair. **Swapping those
two lines now changes nothing**, which is the property worth having.

Asserted in `src/test/windowOrder.test.ts`, 5 tests, mutation-checked: removing
the precondition call fails the suite. *A fix that ships as an edit comes back; a
fix that ships as a mechanism does not.*

| | output window | editor window |
|---|---|---|
| `sandbox` | **false** | true |
| instrument clock | **`hrtime`** | `performance.now()` |
| resolution | **0.000084 ms (84 ns)** | 0.100000 ms |
| call cost | **0.000188 ms (188 ns)** | 0.000100 ms |
| COARSER-THAN-ITS-SUBJECT | **gone, first time in the project** | still reported |

**The editor still reporting the warning is correct and is kept in the record.**
It is a sandboxed renderer with a 100 µs clock and it says so. §4's metrics are
measured on the output window; the editor's line is not a failure to fix.

### 1.4 — B10: an expired note on a live line

Gate 0's note that the `pinned-fingerprint` fallback *"resolved in unit tests but
has still never fired in the field"* was true when written and stopped being true
on 2026-09-05, when it fired in `p4-gate-os2662` because the macOS update changed
the display id. Filed as **B10**, same family as B3: a note that describes the
world at the moment it was written, sitting on a line that is still live.

### The smoke run that confirmed the clock — DISCARDED

`p5-smoke-hrtime` came back `disturbed=true`, `focusHeld=false`, **focus LOST at
t = 58.8667 s of 60**. Renamed `p5-smoke-hrtime-DISCARDED-focus.log` and not
reported as a run. It is kept because the `[timer]` line it printed at startup is
what the table above is quoting, and that line is emitted before the measurement
window opens and is unaffected by focus.

**Two runs discarded for lost focus in two sessions is a pattern**, and this one
died 1.1 seconds from the end. Carried into the next session as block 1.8.


## 2026-09-05 — Phase 5 (session 2) — the OS boundary and the derate measured, hrtime reconciled, row 13's counter fixed

- DID: Part 1 finished — 1.3, 1.6, 1.7, 1.8, 1.9, 1.10. Appended the owed entry
  for commit `6051526`. Diagnosed three sessions of focus theft as
  environmental. Four proposals below.
- MEASURED: **537 tests / 27 files green** (was 524 / 27), **43 of 43 goldens**
  with all three exclusion controls tripping, typecheck clean. Four §4 runs,
  all `disturbed=false` / `throttled=false`. Full numbers below.
- BLOCKER: none blocking Part 3. Four rulings owed before Gate 5's latency
  numbers are recorded — §4's OS boundary, §10 rows 12 and 13, and A14's count.
- NEXT: **Part 3 Block A — `core/paths.ts`, the path primitive, headless.**

### 1.3 — the OS boundary AND the thermal derate, both real

macOS **26.6.2 (25G83)**, projector `T749-fHD720` 1280×720 @ 60.000003814697266 Hz,
scale 1, 1:1 to panel, 3601 samples over 60.0 s after a discarded 10 s warmup,
instrument clock `hrtime` on every run.

| run | scene | state | M1 late | worst interval | M2 mean | of N | M2 p99 | of N | instrument |
|---|---|---|---|---|---|---|---|---|---|
| `p5-cold-gate` | `phase4-forces` | COLD | 0.0000% | 17.80 ms | 0.28129 ms | 1.688% | 0.53033 ms | 3.182% | 0.2745% |
| `p5-warm-gate` | `phase4-forces` | WARM | 0.0000% | 17.80 ms | 0.51118 ms | 3.067% | 0.68863 ms | 4.132% | 0.4735% |
| `p5-regression` | `phase3-load` | COOL | 0.0000% | 17.80 ms | 0.12637 ms | 0.758% | 0.28963 ms | 1.738% | 0.6225% |
| `p5-warm-regression` | `phase3-load` | WARM | 0.0000% | 17.80 ms | 0.19546 ms | 1.173% | 0.28112 ms | 1.687% | 0.3820% |

Against the 26.2 (25C56) baselines — `p4-gate` 0.0649 ms, `p4-regression`
0.0239 ms — and clause 3 is empty on all four runs.

**Two findings, and neither displaces the other.**

1. **The OS moved the baseline.** Cold on 26.6.2 is **4.33×** and **5.29×** the
   26.2 figures. A thermal explanation predicts cold returns to near the 26.2
   numbers. It does not.
2. **The thermal derate is real and is now measured.** A matched within-session
   pair: **+81.7%** on the gate scene (0.28129 → 0.51118) and **+54.7%** on the
   regression scene (0.12637 → 0.19546). It is large, and it is nowhere near
   large enough to account for a 4–5× gap.

**A wrong reading was made in-session and is recorded rather than quietly
dropped.** Partway through, on the strength of the cold gate run against
*session 5's* warm run, this session stated that cold and warm were
indistinguishable. That comparison spanned two sessions, two clocks and two sets
of conditions — precisely the cross-machine comparison §4's boundary clause
exists to prevent, made by the session arguing for that clause. A matched pair
taken an hour later says the opposite. **The error was in the method, not the
arithmetic**, which is why it is worth an entry: the numbers were right and the
pairing was wrong.

**M2 is a measurement for the first time in this project.** p99 reads 0.53033,
0.68863, 0.28963, 0.28112 — none of them a multiple of 0.1. Every M2 at Gates
0–4 was quantised to whole 100 µs steps. Session 5 recorded this regression's
p99 as exactly **0.3000 ms**; the true value is **0.28963 ms**, so the coarse
clock was rounding *up* and the old ceilings were not merely conservative in
principle but inflated in fact.

**A1's derate finally has a number, from M2 rather than from `k`.** `k` reported
`meaningful: false` on both gate runs again today, as it has since Phase 3. The
cold/warm delta on M2 is the quantity A1 asks for, measured on two scenes in one
session. See the row 12 proposal below.

**Three sessions of focus theft, diagnosed.** `p5-cold-regression` was discarded
at focus LOST t=23.58 s with the operator's hands off the machine, so the cause
was not the operator. The Adobe Creative Cloud helper stack was running (Desktop
Service, Creative Cloud Helper, Core Sync, UI Helper, crash processor) along
with OneDrive's updater daemon. Quit the Adobe stack, operator enabled Do Not
Disturb, and **four consecutive runs since have come back clean**. The two
survivors (`com.adobe.acc.installer.v2`, `StandaloneUpdaterDaemon`) are launchd
daemons with no UI and were deliberately left alone.

### 1.6 — 12 ns or 188 ns: 188, and 12 is below the floor

Measured with `scripts/clock-probe.mjs`, every candidate path in **one process**
with **one shared calibration algorithm** (`scripts/clock-probe-calibrate.js`
holds it as source text, rebuilt with `new Function` on both sides of the
bridge) so that the clock is the only thing that differs.

| clock | crosses bridge | resolution | call cost |
|---|---|---|---|
| hardware quantum (mach timebase) | — | **41 ns** | — |
| raw counter read, no wrapper, no loop | — | — | **24.7 ns** |
| `bigint-bare`, preload scope | no | 41 ns | 32.0 ns |
| `nowMs-in-preload` (shipping wrapper body) | no | 41 ns | 28.6 ns |
| **`nowMs-over-bridge` — the in-app path** | **YES** | **83 ns** | **112.5 ns** |
| `performance.now()` in the renderer | no | 100 000 ns | 100.0 ns |

**188 ns is right. 12 ns is not a real number.** It is faster than a bare
`hrtime.bigint()` read measured with no wrapper and no calibration loop around
it at all (24.7 ns), and faster than the most favourable path it could have been
measuring (28.6–32 ns). It is below the floor, not a kinder measurement of the
same thing, and it is **retired rather than averaged in**.

**Why they differ:** they time different paths. The in-app instrument calls
`window.projection.nowMs()` from the renderer, so every read crosses the context
bridge — **80.5 ns per call, 3.5× the bare counter**.

**The resolution move 41 → 84 ns was never variance.** It is forced: a bridged
read costs ~112 ns, which exceeds one 41 ns quantum, so two consecutive bridged
reads land **two quanta apart — 2 × 41.5 = 83 ns**. Both figures are correct for
their own path and the relation between them is derived. Confirmed from the raw
dump: **129,663 of 199,999** consecutive *unbridged* reads return the identical
value, because a raw read (24.7 ns) is faster than the quantum.

**Recorded figure for the instrument: 181 ns median, 164–188 ns across the
day's runs, at 83 ns effective resolution — 6.5% of `CLOCK_CALL_BUDGET_MS` and
~553× finer than the 100 µs it replaced.** `selectClockSource` re-measures it
against the budget at every startup regardless (A14).

### 1.7 — row 13: the counter was reading the wrong set

**The mechanism filed last session was the wrong class.** The handoff recorded
the finding as PixiJS's `Pool` — `_count` only increments, `return()` pushes
back, no eviction, so the counters are a high-water mark. Applying that same
lesson one layer further down says otherwise: `readGpuResources` reads
`buffer._managedBuffers`, and in PixiJS 8.20.1 that is constructed as
`new GCManagedHash({...})` (`GlBufferSystem.mjs:19`), not a `Pool`. Its
`remove()` is

    remove(item) { ...; this.items[item.uid] = null; }

— **a tombstone, not a delete**. `countManaged` counted `Object.keys(...).length`,
graves included.

**This is the same fault the same function already fixed for its sibling.** The
texture path skips null slots and carries a long comment ending *"The instrument
was counting graves."* It has done so since Phase 3. The buffer and geometry
paths, twelve lines below it, never got the same treatment. **A fix to one
counter was not a fix to the counter beside it, and nobody checked.**

Shipped:

- `countManagedHash` returns **both** `live` and `slots`. `bufferCount` and
  `geometryCount` are live; `bufferSlots` and `geometrySlots` are reported and
  **never gated** — a slot count is monotone non-decreasing by construction, so
  gating it would be asking a flatness question of a quantity that cannot be
  flat.
- The verdict is **split**: `flatTextures`, `flatBuffers`, `flatGeometries`, with
  `flat` kept as their AND so nothing loosens by splitting it.
- `describeSoak` prints **both terms of every pair**, never a ratio, and states
  *why* a run did not settle rather than only that it did not.

**The 1.20 buffers-per-geometry anomaly does not exist.** Every soak on record
reads **exactly 2.0000** at both ends, on every scene:

| soak | scene | buffers first→last | geometries first→last | buf/geo first | buf/geo last |
|---|---|---|---|---|---|
| `p4-soak-p1` | `phase1-default` | 46 → 274 | 23 → 137 | 2.0000 | 2.0000 |
| `p4-soak` | `phase4-forces` | 74 → 454 | 37 → 227 | 2.0000 | 2.0000 |
| `p4-soak-p3load` | Phase 3 load | 4 → 4 | 2 → 2 | 2.0000 | 2.0000 |
| `p4-soak-p3load-2` | Phase 3 load | 4 → 4 | 2 → 2 | 2.0000 | 2.0000 |

**1.20 is 274 / 227** — `phase1-default`'s buffer count over `phase4-forces`'
geometry count. A numerator from one scene over a denominator from another. The
instruction *"a ratio hides its sample size, which is the one thing an
instrument must not do"* describes what happened in the filing of the anomaly
itself; printing both terms makes it unwriteable. The guessed explanation for
2.00 — each geometry allocating position + index — stands, and it is universal
rather than a coincidence on one scene.

**K = 64, justified before it was run.** Mechanism: `GCManagedHash.add()` is a
no-op for a uid already present, so live growth is bounded by peak concurrent
demand and a repeatedly-rebuilt scene reaches that peak and stops. Measurement,
from `p4-soak` and `p4-soak-p1`, both `disturbed=false`: increases land at 20.3,
50.3, 80.3 and 110.3 s and never again, on two scenes — a warm-up of **≈55
rebuilds with no quiet interval inside it**, then quiet tails of **548** and
**188** rebuilds. So 55 < K < 188, and 64 sits above the whole warm-up at about
a third of the shorter tail.

**Wrong K fails in both directions and passes in neither**, which is the
asymmetry A9 asks for: too small settles early, later growth lands inside the
post-settle window and post-settle drift is non-zero — FAIL; too large never
reaches the threshold — NOT SETTLED, FAIL. **Stated limit:** the soak samples
every 30 s against ~0.5 rebuilds/s, so K is expressed in rebuilds but evaluated
at ~15-rebuild resolution. That is the sampling rate's property, not K's, and it
is recorded rather than smoothed.

**The fix does not make it green.** 5-minute soak, `phase4-forces`,
`disturbed=false`:

    [soak] live  textures 2->2  buffers 74->312  geometries 37->156
    [soak] slots textures 4->4  buffers 74->454  geometries 37->227
    [soak] buffers per geometry, both terms: first 74/37  last 312/156
    [soak] flat textures=true buffers=false geometries=false (AND=false)
    [soak] settled=false K=64 lastIncrease=300.1s quietRebuilds=0
           — NOT SETTLED: only 0 rebuilds passed after the last increase at 300.1s

Tombstones are real — **142 buffer graves, 71 geometry graves** — and filtering
them **did not** make it flat: live buffers still grew 74 → 312. The hypothesis
that the tombstone fix would dissolve row 13 was stated in-session as *"a
measurement, not an argument"*, and the measurement came back against it. What
the fix bought is a sharper question: **does LIVE growth plateau?** The old logs
cannot answer it — they recorded slot counts under the name `bufferCount` — so
it needs a 20-minute soak with the corrected counter, which is Phase 6's, where
row 13 is due. **K refused a run this session wanted to pass**, which is the
instrument working.

### 1.8 — a focus-free path for the clock smoke run

Reserved label `clock-only`, following `probe-only`'s precedent rather than
adding a second mechanism for reserved labels. Prints the clock's values and a
verdict, opens no measurement window, exits:

    [clock] source=hrtime  resolution=0.000083ms  callCost=0.000188ms
            budget=0.0028ms (6.7% of it)  coarserThanSubject=false
    [clock] VERDICT PASS — focus-independent, no measurement window opened

**2.29 seconds**, against the 70 s run it replaces — a run that died at
t = 58.87 s of 60 having already printed, at startup, the only line it was taken
for. `[timer]` is emitted by `createRenderHost` before any window opens and is a
property of the preload, not of which window is frontmost.

**The real §4 runs are deliberately untouched.** Discarding on focus loss stays
correct there: session 5's discarded run landed within 0.4% of its clean
re-take and today's within 6.8%, which is the argument *for* the rule — a run
that agrees with expectation is the one that gets waved through.

**1.8 and Block E are NOT one mechanism, and building them as one would make
things worse.** Block E forwards `h`/`r`/`k` from the editor to the output over
IPC so the operator never clicks the projector display. But pressing a key in
the *editor* takes focus *away from the output window*, which is exactly what
discards a §4 run. Block E therefore increases focus-loss frequency during runs
unless the disturbance rule is considered alongside it. Checked before building,
as asked; they stay separate.

### 1.9 — A14's count is seven, and the seventh is NOT different in kind

The handoff proposed the seventh as a **category error** — an instrument asking
a flatness question of a quantity that cannot be flat — and asked for a clause
saying *before trusting a derived quantity, read what produces it*.

**Reading what produces it is what showed the premise was wrong.** The quantity
is produced by `GCManagedHash`, not `Pool`; it is not a high-water mark; and the
defect is an ordinary miscount with a one-line fix. So the seventh is **the same
kind as the first six — a fault, not a category error** — and it is more
uncomfortable for it: the identical fault had already been found, fixed and
commented at length for the sibling quantity **in the same function, twelve
lines away, two phases earlier**.

The lesson worth adding is therefore not only the handoff's. Both are true:

- **Read what produces a derived quantity before trusting it.** The pool's — the
  hash's — source answered in one sitting a question four gates of measurement
  could not.
- **A fix to one counter is not a fix to the counter beside it.** The texture
  tombstone fix landed in Phase 3 with a comment explaining the mechanism in
  full. The identical buffer fault survived to Phase 5 because fixing one
  instance was mistaken for fixing the class.

### `SPEC-CHANGE-PROPOSED` — §4 TARGET_MACHINE, the OS boundary with numbers

Restates session 5's proposal, which was made before the matched cold/warm pair
existed.

| | |
|---|---|
| **Proposed** | §4's TARGET_MACHINE reads **macOS 26.6.2 (25G83)**, noting that Gates 0–4 were measured on **26.2 (25C56)**, that the boundary falls between `p4-regression` (2026-09-04 18:43) and the re-takes of 2026-09-05, that **cold CPU render cost measured 4.33× and 5.29× higher across it on two scenes**, and that **the measured cold→warm derate on this machine is +82% / +55%, which does not account for that gap** |
| **Reason** | Session 5 proposed recording the boundary so a later comparison is not silently made across two machines. A matched pair now separates the two effects that were confounded in that proposal: an OS-level baseline shift and a thermal derate. Recording the version alone would let a reader take Gate 4's 0.390% of N and this phase's 1.688% for an engine regression, and recording a single ratio would let them attribute all of it to heat |
| **Alternative rejected** | **Recording the version and not the numbers.** Tidier, and it loses the content. The version is the label; the ratio is the finding |
| **Also rejected** | **Reporting one combined ratio.** It was what session 5 could offer and it is now known to fold two independent effects into one number — the same defect as a single `flat` flag over three subsystems (row 13). Two effects, two numbers |
| **Also rejected** | **Re-measuring Gates 0–4 on 26.6.2.** Disproportionate, and §0.1 freezes a passed gate. Gate 4's numbers were honestly taken on the machine §4 described |
| **Not proposed** | Any change to a passed gate's result, and any claim that the OS *caused* the shift. Attribution between the update and the machine's state is still not established, and is not claimed |

### `SPEC-CHANGE-PROPOSED` — §10 row 12, pulled forward, and `k` replaced not repaired

| | |
|---|---|
| **Proposed** | Move row 12 from **Phase 11** to **Phase 6**, alongside rows 11 and 13, and change its question from *"fix, replace, or formally retire k"* to a recommendation: **replace `k`'s role in A1 with the cold/warm delta on M2**, keeping `k_dev`/`k_target` only for A8's fill-rate coefficient, which is a different question |
| **Reason** | 1.3 needed A1's thermal derate and `k` could not supply it — `meaningful: false` on both gate runs today, as at every gate since Phase 3. M2 on the fine clock supplied it directly: **+82% and +55%, two scenes, one session, both runs clean**. A1's derate is defined as a delta between minute 1 and minute 20 of *both* §4 metrics *and* `k`; the §4-metric half now works and the `k` half still does not. Row 12 was due at Phase 11 on the reasoning that nothing before then depends on it — that stopped being true this session, when a §4 finding turned on a quantity `k` was supposed to provide |
| **Alternative rejected** | **Leave row 12 at Phase 11.** It was right while `k` was merely unfixed and unused. It is wrong now that a Phase 5 measurement had to route around it, and Phase 11 judges its gate on minute-20 `k` — arriving there with the instrument still broken is the situation the row exists to prevent |
| **Also rejected** | **Retire `k` outright.** `k_target` against an offscreen 1080p `RenderTexture` is the only thing in the project that sees fill-rate work at TARGET_RESOLUTION, and A8 is explicit that metric 2 is structurally blind to it. Retiring `k` would take the fill-rate probe down with the derate probe; only the derate role is being reassigned |
| **Also rejected** | **Repair `k` first, then decide.** Three runs at Gate 3 gave ratios 0.379…5.000 on an unchanged scene with the sign of the derate inconsistent between them. Repair is unbounded work with no evidence it converges, against a replacement that is already measured |
| **Depends on** | The §4 boundary proposal above. If the operator declines to record the OS boundary, the evidence for this one is weaker but not void — the derate figures stand on their own |

### `SPEC-CHANGE-PROPOSED` — §10 row 13, the criterion, with K justified and the ratio split

Supersedes session 5's row 13 proposal, which recommended splitting the verdict
on the belief that the counters were a legitimate high-water mark.

| | |
|---|---|
| **Proposed** | Row 13's verdict is **split** into `flatTextures`/`flatBuffers`/`flatGeometries` over **live** counts, with slot counts reported and never gated; the rolling check gates on **textures flat AND settled**, where `settled` = **K = 64 rebuilds with no increase, and zero post-settle drift**; and every soak line prints **numerator and denominator, never a ratio** |
| **Reason** | The `false` was an instrument fault, not a property of PixiJS: `_managedBuffers` is a `GCManagedHash` that tombstones on remove, and the census counted graves — the same fault already fixed for textures in the same function. Splitting is still right, but for a stronger reason than session 5 had: one flag over three subsystems answers a question nobody asked, *and* two of the three were reading the wrong set. K's threshold is derived from the pool's behaviour and from two clean soaks rather than chosen |
| **Alternative rejected** | **Accept the plateau and mark the line `[x]`.** It reaches the checkbox by argument rather than measurement, and — as this session proved — the argument would have been wrong. The 5-minute soak with the corrected counter still reports `flatBuffers: false` |
| **Also rejected** | **Gate on slot counts as well.** They are monotone non-decreasing by construction; a gate on them can only ever fail. Reported as information, never gated |
| **Also rejected** | **Declare row 13 closed on the strength of the fix.** The fix is shipped and mutation-checked, but the measurement it enables has not been taken: live buffers grew 74 → 312 in five minutes and the run did not settle. Closing it now would be a green box over a question still open |
| **Still owed** | A **20-minute soak on `phase4-forces` with the corrected counter**, at Phase 6 where row 13 is due. The existing 20-minute soaks cannot be reinterpreted — they recorded slot counts under the name `bufferCount` |

### `SPEC-CHANGE-PROPOSED` — §4's A14 clause, the seventh count

| | |
|---|---|
| **Proposed** | A14's count goes from **six** to **seven**, the seventh being *the GPU census counting tombstones for buffers and geometries, reporting a false leak that survived four gates*; and the clause gains **two** sentences rather than one: **"Before trusting a derived quantity, read what produces it"** and **"A fix to one counter is not a fix to the counter beside it."** |
| **Reason** | The seventh is not a new kind of failure, which is the uncomfortable part and the reason the second sentence is needed. The identical tombstone fault was found, fixed and commented at length for `managedTextures` in Phase 3; the buffer and geometry paths sat twelve lines below it, unfixed, for two more phases. Recording only the first lesson would file this as "we inferred instead of reading", which is true of last session and not of the fix |
| **Alternative rejected** | **The handoff's single sentence, and calling the seventh different in kind.** It was the right reading of the evidence available when it was written. Reading `GCManagedHash` showed the premise was wrong — the quantity is not a high-water mark and the defect is an ordinary miscount — so filing it as a category error would put a wrong mechanism into the spec |
| **Also rejected** | **Counting it as two** (buffers and geometries). One function, one fault, one commit |

### `IDEAS` — parked, not built

- **Record the OS build in each run's conditions block.** Said in session 4,
  said again in session 5, still unbuilt, and this session again had to pair runs
  by hand from file timestamps and an install receipt. The `conditions` block
  already captures nine fields; this is a tenth.
- **A `[soak]`-style human-readable line for every structured verdict.** Adding
  `describeSoak` took ten minutes and immediately made a four-gate-old defect
  legible. The SUMMARY JSON has carried these numbers all along and nobody read
  them out of it. `k`'s report is the obvious next candidate — row 12's
  `meaningful: false` has been in every gate log since Phase 3 and has never
  once been quoted in an entry.
- **A focus-theft canary.** Three §4 runs lost in three sessions, diagnosed only
  when the operator's hands were provably off the keyboard. The run already
  records focus events with timestamps; what is missing is naming the process
  that took focus, which would have turned a session of guessing into one line.


## 2026-09-05 — Phase 5 (session 2, part 2) — Block A: the path primitive, headless

Appended to the same session as the entry above, which ended `NEXT: Block A`.
Recorded separately rather than by editing that entry, because the log is
append-only and a `NEXT` line that quietly became a `DID` is a rewritten record.

- DID: **Part 3 Block A complete.** `src/core/paths.ts` (I-17) and its test
  group, written before any UI.
- MEASURED: **581 tests / 28 files green** (537 / 27 before; +44). Typecheck
  clean. Two mutation checks below.
- BLOCKER: none. **Block B needs a plan confirmed before it starts** — it
  touches more than three files, which `CLAUDE.md`'s working-style rule puts
  behind a confirmation.
- NEXT: **Part 3 Block B — pointer interaction on the preview.** Plan stated to
  the operator, awaiting confirmation.

**What Block A settled, and the two decisions inside it.**

*Clamped versus refused.* Coordinates are clamped with `clamp01`, which is what
`layer.ts`'s transform and `scene.ts`'s parallax already do — a point half a
pixel outside the frame after float drift is not a corrupt scene, and refusing a
show over it would be I-13 failing at the worst moment. `interpolation` is
refused unless `linear` (S5), because an unknown value means the file came from
a build this one does not understand and rendering a curve silently as a
polyline is a plausible wrong answer (A9). A non-numeric coordinate is refused
as well: that is not a number out of range, and a point silently at the origin
is a shape wrong in a way nobody can see. Every refusal names the path, the
point index and the offending value.

*One flag apart, demonstrated.* Gate 5 asks for this to be shown rather than
asserted in prose, so the test diffs every field of an open and a closed path
built from the same points and requires the difference set to be exactly
`['closed']`, then requires the two JSON strings to be equal after substituting
the flag. `closed` changes only derived geometry and does so in exactly one
function, `pathSegments`, so there is one place for the claim to be true.

*No accumulated position anywhere.* `progressAlong` is `phaseAt` re-exported
rather than reimplemented (I-2, I-16) — two functions turning clock time into a
normalized position would be two things to keep in agreement. A test walks 90 s
forward and then asks for an earlier time again, requiring the exact earlier
answer.

**Mutation checks**, because a new test that cannot fail is not a test:

| mutation | tests failed |
|---|---|
| S5's refusal replaced by a silent fallback to `linear` | 2 |
| a second stored field made to vary with `closed` | 3 |
| *(both reverted)* | 0 of 44 |

**One test assertion was wrong and the test was fixed, not the code.** The
stroke fixture's corner sits at (0.5, 0.5005), not (0.5, 0.5): the last point of
the horizontal run carries the jitter like every other point in it. The
tolerance is now the jitter amplitude and the reason is written in the test.
Worth recording because the failure looked at first like a simplifier dropping a
corner, which is the defect that test exists to catch — the instrument was
right and the expectation was wrong, which is the opposite of this project's
usual finding and took a minute to believe.

**Not built, deliberately.** No parameter is introduced, so none is registered
(I-8) — a route's period arrives with the layer binding that owns it, not with
the shape. Nothing in `paths.ts` knows about surfaces (§11's order note, §0.2);
it is the shape primitive alone.


## 2026-09-05 — Phase 5 (session 3) — v4 ratified: scope cut to a ship date, three rows closed

- DID: No code. `SPEC.md` rewritten to **v4.0**, `CHECKLIST.md` rebuilt around
  blocks, `CLAUDE.md` trimmed. Five outstanding `SPEC-CHANGE-PROPOSED` entries
  from sessions 4, 5 and this session's part 1 are resolved below — none was
  declined, two were absorbed into larger changes and that is stated per item.
- MEASURED: nothing new. **581 tests / 28 files, 43 of 43 goldens** carried
  unchanged from part 2.
- BLOCKER: none.
- NEXT: **P5-B — region interaction on the preview.** Its plan is the block's
  task list in `CHECKLIST.md`; the confirmation round trip is removed.

### `DECISION` — the ship date is now a spec input

A live demo on **2026-10-05**, to evaluators assessing the operator's ability to
build with an AI coding agent. This is stated in `SPEC.md` §1.1 as a
three-minute run on a table, and every gate from here is judged against its part
of it.

**This is the first constraint in the project that is external.** Every previous
decision optimised for correctness with time as a soft variable. Time is now the
hard variable, and §12 exists to say what that cost.

### The v4 amendment table

| # | Change | Reason | Alternative rejected |
|---|---|---|---|
| V1 | Product statement rewritten around a table, a library and one month | The spec described an engine; the deliverable is a demo. §1.1 names the three minutes so a block can be judged against them | Leaving §2.1's three usage modes as the statement. They are still true and are now background, not scope |
| V2 | Phases 5–7 kept; **new 8 = library + scenes**, **new 9 = polish + demo**; old 8–13 cut or folded | Four weeks, five phases, one per week plus a buffer | A clean renumber from 1. It would produce exactly the drift the B-series existed to correct, and `BUILD_LOG.md`'s phase labels would go stale for a second time |
| V3 | §4 gates on **M1 alone**; M2 reported | Headroom is ~100×. **Explicitly not an instrument argument** — M2 works properly now | Retiring M2 outright. It costs nothing to read and it is the number that would move first if something regressed |
| V4 | §10 rows 11, 12, 13 closed | Each blocked Phase 6 and each now has evidence rather than an argument. Details below | Carrying them into Phase 6 as this session's part 1 proposed. Correct then; the scope cut changed row 12's premise |
| V5 | **I-18 added — route motion declared, progress derived** | The product's core verb had no data model. I-17 said how a route is *stored* and nothing said how content *travels* it: no speed, no heading, no end behaviour, no offset | Leaving it to be discovered in the block that needs it. That is how a per-layer playhead gets built by accident, which is the thing I-16 exists to refuse |
| V6 | Gate 4's status corrected to **PASSED** | Five conditions passed on the wall 2026-09-05 and the sixth was discharged the same day. §11 still read "one condition from closed". Absorbs the session-3 proposal | Applying §0's "spec wins" mechanically and un-checking the box. It would deny an event that happened |
| V7 | §4 records macOS **26.6.2 (25G83)**, the boundary and **both** effects with numbers | Absorbs session 4's and this session's part-1 proposals in full, including the two-numbers-not-one-ratio ruling | Recording the version without the numbers. The version is the label; the ratios are the finding |
| V8 | A14's count is **seven**, with **two** lessons | Absorbs part 1's proposal verbatim, including that the seventh is the same kind as the first six | The handoff's single sentence and calling it a category error. Reading `GCManagedHash` showed the premise was wrong |
| V9 | Phases subdivided into **blocks**, one per session, each with files, spec sections, a mechanical "Done when" and a ready prompt | The build is driven one prompt at a time and the tracker did not match how it is driven | Keeping flat deliverable lists. They give an agent no stopping point, and a session that does not know where to stop is a session that reaches into the next phase |

### `DECISION` — §10 row 11, closed by the mechanism that shipped in part 1

Closed, not ruled. The output window's preload carries `hrtime` at **84 ns**
against a subject that had been measured in 100 µs quanta for four gates. The
question "accept p99 as a ceiling or fix the clock" is answered by the clock
being fixed. **M2 is ungated for a different reason than the one the row was
about** — 1.7–4.1% of N against a 60% limit — and `SPEC.md` §4 states that
distinction explicitly so a later reader does not record it as "we gave up on
measuring M2".

### `DECISION` — §10 row 12, `k` retired, and the premise that changed

Part 1 proposed moving row 12 to Phase 6 and **explicitly rejected retiring `k`
outright**, on the grounds that `k_target` against an offscreen 1080p
`RenderTexture` is the only thing in the project that sees fill-rate work at
TARGET_RESOLUTION.

**v4 removes TARGET_RESOLUTION** (§4: there is no 1080p hardware, I-1 makes the
resolution free when it arrives). So the rejection's premise is gone, and the
two roles resolve separately:

- **A1's thermal derate** — supplied directly by M2's cold→warm delta, +82% and
  +55%, two scenes, one session, both runs clean. `k` reported
  `meaningful: false` at every gate since Phase 3 and could not supply it.
- **A8's fill-rate coefficient** — has no subject in v4.

**The probe, its call sites and its 14 arithmetic tests are deleted in P9-A.**
Recorded this way rather than as a quiet drop because the earlier rejection is on
the record and a later reader is entitled to see which premise moved.

### `DECISION` — §10 row 13, closed on the fix, with what is deferred named

The verdict split, the live/slots separation and `describeSoak` all shipped in
part 1. The rolling check gates on **textures flat AND settled (K = 64)**;
buffers and geometries are reported and never gated; slot counts are never gated
at all.

**What part 1 said was still owed — a 20-minute soak on `phase4-forces` with the
corrected counter — is deferred to v2, not answered.** Live buffers grew
74 → 312 over five minutes without settling and that observation stands
unexplained. It is deferred rather than closed because closing it would be the
"green box over a question still open" that part 1's own proposal rejected.
P6-B runs the 5-minute soak in the block that first draws surfaces with
`Graphics`, which is the scene row 13 was always about.

### `NOTE` — what v4 cuts, and the one thing that is not a cost

§12 lists twelve cuts. Eleven are capability the demo does not show. The twelfth
is different and is worth naming: **the measurement apparatus itself.** Between
Phase 0 and Phase 5 the instrument was the bug seven times, and every one of
those cost more than the number it was chasing. Cutting it is not a compromise
against quality; on this project's own evidence it is a quality decision.

What is kept is the part that repeatedly paid: M1, the golden harness with its
lit-pixel floors and measured text exclusions, the import-graph checks, and
mutation-checking anything load-bearing. Those found real defects. The k probe,
the p95/p99 dispute and the 20-minute soaks did not.

### `NOTE` — three predictions v4 makes, so they can be checked later

1. **The four-window case (P7-D) is where the schedule actually breaks**, not the
   surfaces. It is the first block that requires two subsystems built in
   different weeks to agree on the wall.
2. **The library (P8-D) is the thing left too late** if it is not started in week
   1. It needs no code, which is exactly why it will be deprioritised.
3. **P9-C's usability run will find something cheap and embarrassing** — a
   missing affordance, not an architecture fault. The prediction is that it is
   fixable inside its own block; if it is not, that is the signal that "easy to
   use" was never tested and is now being discovered at the deadline.

### `IDEAS` — parked, not built

- **Record the OS build in each run's conditions block.** Said in sessions 4 and
  5 and part 1, still unbuilt. `CLAUDE.md` now names it as a precondition so it
  is at least done by hand.
- **A focus-theft canary** naming the process that took focus. Three runs lost
  across three sessions; the diagnosis (Adobe Creative Cloud stack, OneDrive
  updater) is now written into `CLAUDE.md`'s pre-run preconditions instead.
- **A `[soak]`-style human-readable line for every structured verdict.**
  `describeSoak` took ten minutes and made a four-gate-old defect legible.
- **The 20-minute soak with the corrected counter** — row 13's deferred half.
  First item on v2's list.

## 2026-09-05 — Phase 5 (block B) — regions placed, moved, scaled and deleted, in normalized space

- DID: **P5-B code-complete, not verified on the table.** `src/editor/interaction.ts`
  (new — the pixel boundary, hit testing, the three gestures);
  `src/core/sceneEdit.ts` gains `setLayerRect`, `MIN_LAYER_EXTENT`,
  `SceneEditError` and an optional `rect` on `addLayer`; `PreviewCanvas.tsx`
  gains a pointer surface and an SVG selection overlay; `App.tsx` passes one
  prop. Selection is `useState` in the preview and exists nowhere else.
- MEASURED: **631 tests / 29 files** (581 / 28 before; **+50** — 32 in
  `interaction.test.ts`, 18 appended to `sceneEdit.test.ts`). **630 pass.**
  `npm run test:render` **43 / 43 goldens, none re-blessed.** Typecheck clean
  both projects. Six mutation checks below.
- BLOCKER: **`specVersion.test.ts` fails, and it predates this block.** Not
  fixable inside it — see below. Nothing in P5-B is blocked by it.
- NEXT: **the operator's table pass on P5-B** — the four hand checks in
  `CHECKLIST.md`. Not P5-C.

### `BLOCKER` — the suite is 630/631, and the one red test is session 3's

`specVersion.test.ts` slices `SPEC.md` from `## 1. Revision history` and reads
the first `**vX — ...**` block out of it. v4.0 renamed §1 to *What it is* and
carries no revision-history section at all, so the slice is empty and the match
is null. **The test is doing its job**: it exists because B1's version drift
shipped as an edit and came back, and it was rebuilt as a mechanism precisely to
catch a spec change that moved its subject. It caught one.

It is left red rather than fixed, for two reasons that both point the same way:
`SPEC.md` is read-only to this session, and `specVersion.test.ts` is outside
P5-B's stated files. The choice — restore a revision block to §1, or re-point
the test at wherever v4 keeps its version history — is the operator's, and it is
one line either way. Recorded here so that "630/631" is never read as P5-B
having shipped a red test.

*Verified pre-existing:* `git show HEAD:SPEC.md` has `## 1. Revision history` at
line 79; the working tree's v4 has `## 1. What it is` at line 45. Session 3
rewrote the spec and did not re-run the suite, which is why its entry records
581 green as carried forward rather than measured.

### `DECISION` — the scene is mutated once, on release, and the outline moves live

The obvious implementation mutates the scene on every `pointermove`. It is
wrong here, and structurally rather than aesthetically:

- `Compositor.setScene` **tears the whole layer stack down and rebuilds it** —
  every provider view destroyed, every texture recreated. Its own comment says
  scene edits are operator-paced and a diff would be optimising something that
  does not happen 60 times a second. A live-follow drag makes that comment false.
- `App`'s effect sends **the whole scene over IPC on every change**. A drag would
  put a scene JSON on the boundary once per frame.

So a 90-frame drag would be 90 full teardowns, 90 texture rebuilds and 90 scene
messages — visible as flicker, and as churn in exactly the counter the rolling
flatness check watches. Instead the overlay draws the live rect from
`gestureRect`, and pointer-up commits **one** mutation. The outline and the
committed transform are the same function, not two approximations of it, so what
the operator drags is where the region lands.

The cost is honest and worth stating: the *content* does not follow the pointer
until release, only its outline. Making it follow needs a diffing compositor,
which is a different block and is not on the ship list.

### `DECISION` — no parameter is registered, for Block A's reason

`entity.<id>.transform.*` is **not** added to the registry. Rule 5 binds every
*new* parameter, and this block introduces none: `x`, `y`, `width`, `height` have
been stored fields since Phase 1 and `addLayer` has written them since Phase 1.
Registering them would be a genuine improvement and it is a change to
`parameters.ts` and `useSceneRegistry.ts`, both outside this block's files —
which is the block's own rule for when to stop and ask. Filed as the question,
not answered: *should the transform be addressable, so a region can be nudged by
key as well as by mouse?*

### What the block settled

**The pixel boundary is one function wide, and that is testable.**
`toNormalizedPoint` is the only export in `interaction.ts` that takes a canvas
dimension; `aspectOf` returns a ratio, which is dimensionless. A test enumerates
the exports whose parameters mention a pixel and requires the set to be exactly
those two, so the boundary moving is a failing test rather than a review
question. Everything downstream — hit test, handle test, gesture geometry,
mutation — is `[0, 1]`.

**The handle radius is normalized, and that is the whole point.** A radius in
pixels is 0.025 of a 480 px frame and 0.00625 of a 1920 px one, so the same
*relative* click grabs a handle on the preview and misses it on a larger canvas.
That defect would arrive through the **input** path, where nothing was watching:
I-1 is asserted over stored state, and stored state would have been innocent.
There is a test that clicks the same near-miss at both resolutions.

**A region's own corner is one ulp outside it.** Centre 0.5 plus half-width 0.15
is `0.65`; `0.65 - 0.5` is `0.15000000000000002`. So the corner of a region —
the single most-clicked point on it, because that is where the handles are —
fails a naive `<=` test. Two fixes, both kept: `toLocal`/`fromLocal` return
early when `rotation === 0` so the unrotated case does no lossy aspect round
trip at all, and `containsPoint` carries an `EDGE_TOLERANCE` of 1e-9 — two
millionths of a pixel at 1920 wide, with a negative control asserting a click a
thousandth of a frame outside still misses. This is Block A's ruling applied to
the input path: the value drifted, so it is accepted rather than refused.

**Rotation is read and never written.** The gestures honour it — a rotated
region is hit where it is drawn, not where its axis-aligned box would be,
because the compositor rotates in *pixel* space and the hit test un-rotates in
the same space via the aspect ratio. No gesture writes the field, and a test
asserts it survives a move and a scale untouched, including when a caller passes
one through a cast. The block that adds the handle inherits correct maths
instead of writing them under time pressure.

**The selection outline cannot reach the output, by import graph.** It is an SVG
sibling of the canvas in `PreviewCanvas.tsx`, not a Pixi display object.
`output/main.ts` and `golden/main.ts` both build a `Compositor` directly and
neither can reach `editor/PreviewCanvas.tsx` or `editor/interaction.ts` — a test
walks the transitive import graph from both entry points and asserts it. That is
why 43 goldens matched with none re-blessed. Selection likewise has no field on
`Scene` to occupy, and a test asserts neither `scene.ts` nor `layer.ts` contains
the string `select` at all.

**Disposal shipped as the mechanism that was already there, not as a new call.**
Grepping the class rather than the instance — the Phase 3 lesson — there is
exactly **one** structural removal in the engine, `removeLayer`; the two other
`layers.filter` sites (`debug/forceLog.ts`, `editor/ForcePanel.tsx`) filter to
*count* and never produce a scene, and the test names all three rather than
excluding them by a loose pattern. Every scene reaches the renderer through
`RenderHost.setScene`, and `Compositor.setScene` opens with `teardownLayers()`.
So the delete path disposes because there is no other path, and there is nothing
for a caller to remember. Two tests hold it: `setScene` tears down *before* it
rebuilds, and teardown destroys the provider view **and** the holder — the
counter beside the counter, checked this time.

**Mutation checks**, because a new test that cannot fail is not a test. Baseline
is 1 pre-existing failure; the column is failures *added*:

| mutation | tests failed |
|---|---|
| `toNormalizedPoint` hard-codes the preview size instead of the canvas's | 3 |
| `hitTest` walks back-to-front, so the bottom-most region wins a click | 1 |
| `setLayerRect`'s refusal replaced by a silent `clamp01` | 2 |
| the `MIN_LAYER_EXTENT` clamp removed | 1 |
| `Compositor.setScene` tears down *after* rebuilding | 1 |
| `addLayer` ignores the drawn rect and staggers anyway | 3 |
| *(all reverted)* | 1 of 631, the pre-existing one |

**One test assertion was wrong and the test was fixed, not the code** — Block A's
finding, again. "A scale holds the opposite corner still" is false when the drag
crosses the anchor: the box turns inside out, and the anchor is still *a* corner
but no longer the *opposite* one. Split into two tests naming two different true
properties, rather than loosened into one that says less.

### `IDEAS` — parked, not built

- **Edge handles**, for scaling one axis. Four more cases, zero new mechanism.
- **Shift to constrain a placement to a square**, and the same modifier
  constraining a move to one axis. D19 already wants shift for right angles on
  paths, so there is one convention to settle rather than two to invent.
- **The transform in the registry** — the question above, filed not answered.
- **A live-follow drag**, which needs a diffing compositor. Named here so that if
  the demo rehearsal says the snap reads badly, the cost is already known.

## 2026-09-05 — Phase 5 (block B) — the operator's table pass on P5-B

- DID: No code. Operator ran the four hand checks on P5-B and reports all four
  pass. `CHECKLIST.md` updated: the three gesture/projector lines and the
  outline line are `[x]`, and the two task lines that were waiting on a mouse
  are closed.
- MEASURED: nothing new. **631 tests / 29 files, 630 pass; 43/43 goldens**,
  carried from the block entry above. **The texture count's two numbers were
  not captured** — see below.
- BLOCKER: **P5-B is still `[~]`, not `[x]`.** Its fourth Done-when line —
  "`npm test` green with the count recorded" — is not green. The failure is
  `specVersion.test.ts` and it predates the block, but the line is the line.
- NEXT: resolve `specVersion.test.ts`, which flips P5-B to `[x]`. Then P5-C.

### `MEASURED` — the texture count is a verdict, not a figure, and is labelled so

The condition reads "HUD texture count returns to its pre-add value after a
delete — **record both numbers**". What came back is that it returned. That is
the verdict the condition asks about and it is not the evidence the condition
asks for.

Recorded this way rather than as a clean pass because Gate 4 set the precedent
in this log three entries ago: the sixth condition's reaction was "recorded as a
**summary**, labelled weaker than the quote the condition asked for". Same
species, same treatment. The numbers are two readings of the `gpu tex N` line in
the editor's metrics mirror and cost nothing to take on the next launch; until
they are taken, this row says what it actually knows.

### `INVARIANT-TENSION` — a block cannot be `[x]` while one of its own gate lines is `[!]`

Three of P5-B's four Done-when lines are now checked on the table. The fourth is
`npm test` green, and the suite is 630/631 for a reason that has nothing to do
with pointer interaction: session 3's v4 rewrite renamed `## 1. Revision
history` to `## 1. What it is` and dropped the revision section, so
`specVersion.test.ts` slices an empty string and finds no version block.

The tempting move is to mark P5-B `[x]` on the grounds that the red test is not
the block's. It is refused here, because `CLAUDE.md`'s one tracker rule is
"never mark `[x]` before the check actually passed" and the check is `npm test`,
not `npm test excluding the parts another session broke`. A block that closes
over a red suite teaches the next block that the suite is advisory.

Two ways out, and they are not equivalent:

1. **Re-point `specVersion.test.ts`.** A code change, inside this session's
   reach. But v4 has *no* revision history anywhere, so the test's second
   assertion — header agrees with §1 — has no subject left. Re-pointing it means
   reducing it to "the header states a version", which is the drift check B1
   built as a mechanism, weakened back into the shape that let the drift happen.
2. **Restore a revision block to `SPEC.md`.** The spec is read-only to this
   session, so this route is a `SPEC-CHANGE-PROPOSED` entry and a stop. It keeps
   the check at full strength and it costs the operator an edit.

Route 2 preserves a mechanism that has already caught one real drift; route 1
spends it to turn a checkbox green. Stated rather than chosen, because the spec
is the operator's document.

## 2026-09-05 — Phase 5 (block B) — P5-B closed by operator decision, over a red suite

- DID: No code. P5-B marked `[x]`. The `npm test` Done-when line stays `[!]` and
  the failure is carried into **Rolling checks** as a standing red with a
  deadline of Gate 5, so closing the block does not bury it.
- MEASURED: unchanged — **631 tests / 29 files, 630 pass; 43/43 goldens**.
- BLOCKER: none for P5-C. `specVersion.test.ts` is red and now tracked at the
  phase gate rather than at the block.
- NEXT: **P5-C — route motion.** Fresh session, `/compact` first.

### `DECISION` — the block closed over a failing suite, and who decided

I put four options to the operator and recommended against this one. The
operator chose to close P5-B and carry the red test. That is their call and it
is recorded as theirs, with the reasoning on both sides above in the
`INVARIANT-TENSION` entry, so a later reader sees a decision rather than an
oversight.

Two things were done to keep the cost bounded rather than to soften the call:

- **The Done-when line is still `[!]`, not `[x]`.** The block is closed; the
  check did not pass. Marking the line green would have been the actual damage —
  a tracker that records a check as passed when it failed is worth nothing
  afterwards, and P5-B's own work is full of tests written on exactly that
  principle.
- **The failure moved up, not away.** It is now a standing item in Rolling
  checks with "Gate 5 cannot be judged on a red suite" attached. A block-level
  `[!]` is read once, by the next session; a rolling check is read at every
  phase gate.

The prediction, recorded so it can be checked: the cheap fix is route 1
(re-point the test), it will be taken under time pressure at the gate, and B1's
drift mechanism will end up weaker than it was on 2026-09-04. If instead §1
regains a revision block, this paragraph is wrong and that is the better outcome.

### `IDEAS` — still parked

- The two texture-count numbers, unrecorded from the table pass. Two readings of
  the editor's `gpu tex N` line on the next launch.

## 2026-09-05 — Phase 5 (post-block B) — the version check re-pointed at the pair that can drift

- DID: `src/test/specVersion.test.ts` rewritten. It compared `SPEC.md`'s header
  against §1's revision history; v4 deleted that section, so it compared against
  nothing. It now compares `SPEC.md`'s header against `CHECKLIST.md`'s
  *Tracking* line, asserts `SPEC.md` states its version exactly once, and fails
  loudly when either marker is missing. No spec edit; the read-only rule held.
- MEASURED: **633 tests / 29 files, all green** (631 / 29 with one failing
  before; the file went 2 tests → 4). Typecheck clean. Five mutation checks
  below. `SPEC.md` and `CHECKLIST.md` verified byte-identical after the
  mutation run.
- BLOCKER: none. The standing red carried out of P5-B is cleared.
- NEXT: **P5-C — route motion.** Fresh session.

### `DECISION` — the check moved rather than the spec, and the earlier advice was wrong

Four options were put to the operator when P5-B closed and I recommended
restoring §1's revision history, arguing that re-pointing the test would weaken
B1's mechanism. **That recommendation was aimed at the wrong pair**, and reading
where the version is actually stated is what showed it:

- `SPEC.md` states its version **once**, at line 7. A file cannot disagree with
  itself, so B1's original defect — header versus §1 — is structurally
  impossible in v4 and restoring §1 would have re-created the hazard in order
  to keep guarding it.
- The version is nonetheless stated **twice**, in two files: `SPEC.md:7` and
  `CHECKLIST.md:12`'s *Tracking* line. That is B1's defect with one document's
  distance added, and **nothing checked it** — `specVersion.test.ts` is the only
  test that reads `SPEC.md` as data and no test read `CHECKLIST.md` at all.

So the test was not guarding a ghost and was not guarding the live hazard
either. Re-pointing it is not a weakening; it is the same mechanism aimed at the
surface that exists. This is recorded as a correction rather than folded in
silently, because the earlier reasoning is on the record two entries above.

### The latent bug the rewrite removed

`text.slice(text.indexOf('## 1. Revision history'))` — `indexOf` returns -1 when
the heading is absent and `slice(-1)` quietly takes **the last character of the
file** rather than erroring. The test did fail, and it failed for the right
reason, but by accident: a one-character haystack happened to match nothing. Had
the file ended differently it could have passed while checking nothing.

Every lookup in the rewrite is asserted non-null with a message naming the file
and the line it expected. **A cross-check that vacuously passes when its subject
is deleted is worse than no cross-check**, because it reports green. Mutation M2
below exists precisely to prove that deleting the subject now fails.

**Mutation checks:**

| mutation | tests failed |
|---|---|
| `CHECKLIST.md` tracks v4.1 while `SPEC.md` says v4.0 — the live drift | 1 |
| `CHECKLIST.md`'s *Tracking* line deleted — the vacuous-pass case | 2 |
| `SPEC.md` bumped to v5.0, `CHECKLIST.md` left behind | 1 |
| a **second** `**Spec version:**` added to `SPEC.md` — B1's original defect | 1 |
| `SPEC.md`'s version header removed entirely | 3 |
| *(all reverted; both documents byte-identical to git afterwards)* | 0 of 4 |

### `NOTE` — `CHECKLIST.md` line 12 is now load-bearing

`**Tracking `SPEC.md` v4.0.**` is one half of the check. Rewording it fails the
suite by design, with a message that says so rather than a null complaint. Said
here and in `CHECKLIST.md` itself, because the next person to tidy that header
will not read this file first.

### The prediction from two entries ago, resolved

That entry predicted the cheap fix would be taken under time pressure at Gate 5
and B1's mechanism would end up weaker than on 2026-09-04. **Half right and the
better half wrong**: the cheap fix was taken, immediately rather than at the
gate, and the mechanism came out stronger — it now guards a real pair, catches
the single-file case B1 was originally about, and no longer passes vacuously.
The prediction assumed the only two options were the two first named, which is
the failure mode worth keeping: a decision framed as a choice between the
options already on the table, when reading the subject would have produced a
third.

---

## 2026-09-05 — Phase 5 (block C) — route motion: declared, derived, on the entity

- DID: `src/core/motion.ts` and `src/test/motion.test.ts` new; four
  `entity.<id>.motion.*` keys added to `src/core/parameters.ts`. `RouteMotion`
  as I-18 spells it, `progressAt`/`pointAtMotion`/`headingAtMotion` pure,
  `segmentAtProgress`/`headingAtProgress` for `orient`, canonicalizer +
  `assertRouteTraversable` + `canonicalizeRoute` as the validation boundary.
  No UI, no renderer, `paths.ts` untouched.
- MEASURED: tests 633 → 684 (30 files), all green. 51 new. Ten mutations run,
  nine killed, one killed nothing and produced a test — table below.
- BLOCKER: -
- NEXT: P5-D, the path tool.

### `phaseOffset` shifts the time, which is what made one line serve three

I-18 gives `hold` as `min(1, t / period + phaseOffset)`. That is
`min(1, (t + phaseOffset × period) / period)` — the same shift applied a step
earlier, to the time rather than to the answer. Doing it there means `loop`,
`pingpong` and `hold` share one line:

```
const shiftedSeconds = timeSeconds + wrapTurn(motion.phaseOffset) * period;
```

and each behaviour is then a single expression over it. The alternative —
shifting the *result* of `progressAlong` — needs a second `% 1` to bring the
sum back into range, which is the phase arithmetic I-2 says exists once and
lives in `clock.ts`. So this is not a tidiness choice: shifting the answer
would have put a wrap operator in this file, and shifting the time keeps the
count at zero. The suite now asserts that count directly, with comments
stripped, rather than trusting a one-off grep.

`pingpong`'s offset falls out of the same line meaning a traversal rather than
a cycle: an entity at `phaseOffset` 0.5 is half a traversal ahead under all
three behaviours. Had the offset been applied to the 2 × period cycle instead,
one field would mean two different things depending on a neighbouring field's
value.

### `DECISION` — clamp is the wrong verb for `phaseOffset`, and wrapping is why

The block asks for `phaseOffset` to "clamp into `[0,1)`". Wrapping is what
landed, and the reason is arithmetic rather than preference: **a clamp cannot
put 1.0 inside a half-open interval at all.** It would have to answer 0.999…,
which is a different position from the 0 that offset 1 actually means on a
loop. `wrapTurn` — already in `layer.ts`, already commented "a turn past 1 is a
turn, not an error" — gives `[0,1)` for every finite input and gives the right
position for 1, for 2, and for −0.25. The checkbox's intent (drift is absorbed,
not refused) is met; its verb is not the operation.

Mutation M6 exists to hold this: swapping `wrapTurn` for `clamp01` fails.

### `DECISION` — where a route refuses, and where it degrades

Two rules were in tension. The block says a path with fewer than two points is
refused; I-13 says nothing ends a live session. Both are satisfied by putting
them in different places, and the split is stated in the file header:

- **Refusal at the validation boundary** — `canonicalizeRouteMotion`,
  `deserializeRouteMotion`, `assertRouteTraversable`, `canonicalizeRoute`.
  This is where a scene file, an IPC payload or an editor field arrives.
- **Degradation on the per-frame path** — `progressAt` on a nonsense time
  returns 0, `headingAtProgress` with no segment returns 0 turns. An entity
  parked at the start of its route is a defect an operator can see and report;
  an exception 60 times a second disables the layer.

`canonicalizeRoute(path, rawMotion)` is the mechanism rather than the comment:
a caller that validates the record and forgets the path is the gap a note in
the header would have left reachable, so the two checks are one call.

The one deliberate exception is an unknown `endBehavior` reaching `progressAt`,
which **throws**. It cannot arrive from a scene file — the canonicalizer
refused it there — so it means a caller skipped the boundary. That is a
programming fault, and holding still would dress it up as a content problem.

`paths.ts` keeps its own degrade-gracefully behaviour, untouched: a one-point
path is a legal *shape* and only an illegal *route*. The same stored object,
judged by the use it is being put to, which is I-17's claim working as intended
rather than being worked around.

### The mutation that killed nothing, and the test it produced

**M10 removed the zero-length guard from `segmentAtProgress` and the suite
stayed at 50 green.** The guard is load-bearing — `headingAtProgress` carries
no zero-vector check because it relies on that guard — so a guard no test could
falsify was a comment pretending to be a mechanism.

Finding the input that reaches it took reading the walk rather than guessing.
`travelled + len >= target` with `len === 0` is true only when
`travelled === target` exactly, and any zero-length segment in the middle of a
path is preceded by a real one that already satisfied the inclusive `>=`. The
single reachable case is a zero-length segment **first**, at progress 0 — which
is exactly what a freehand stroke that starts with two samples at one
coordinate produces, so P5-D will generate it next block. Without the guard
`t` is 0/0.

The test is `skips a zero-length segment rather than landing on one`, on
`[0.5,0] [0.5,0] [0.5,1]`: `t` is not NaN, and the heading reads 0.25 turns
(down the run) rather than 0 (a tangent to a point). It fails on M10 and passes
on the file as shipped. 50 → 51.

### `MEASURED` — mutation checks

Each applied alone to a pristine copy and reverted before the next; counts are
`src/test/motion.test.ts` only. The first attempt at this table was thrown
away: `motion.ts` was still untracked, `git checkout --` could not restore it,
and four mutations stacked into one meaningless run of nines. Restoring from a
saved copy rather than from git is the fix, and it is written down because the
same trap sits in front of every new file's first mutation table.

| mutation | tests failed |
|---|---|
| M1 `loop`: the `phaseOffset` shift dropped | 5 |
| M2 `pingpong`: triangle replaced by the raw saw | 3 |
| M3 `hold`: the ceiling at 1 removed | 2 |
| M4 `pointAtProgress` walks by point index — equal time per segment, not per unit length | 4 |
| M5 an unknown `endBehavior` accepted instead of refused | 2 |
| M6 `phaseOffset` clamped instead of wrapped | 1 |
| M7 heading returned in radians rather than turns | 3 |
| M8 the four keys filed under `route.<id>.*` instead of `entity.<id>.motion.*` | 5 |
| M9 `progressAt` keeps a cursor and accumulates | 10 |
| M10 the zero-length guard removed from `segmentAtProgress` | **0**, then 1 |
| *(all reverted; 684 green afterwards, `paths.ts` byte-identical to git)* | 0 of 10 |

M4 and M8 were applied to files this block did not otherwise change —
`paths.ts` and the registry — because the claim being tested is about them:
that the constant-speed assertions read arc length rather than index, and that
the keys hang off the entity rather than the route.

### `IDEAS`

- `MOTION_PERIOD_MIN_SECONDS` (0.1) is a *control* range, not the legality
  boundary — the canonicalizer refuses only `<= 0`. The two are different
  questions and conflating them would either give a fader an illegal bottom
  stop or make a 0.05 s period unloadable. There is a test that a value the
  fader can reach is a value the canonicalizer accepts; if a third range ever
  appears, that test is the place to notice.
- `RouteMotion` is not yet a field on `Layer`, because the block's file list
  did not include `layer.ts` or `scene.ts` and nothing reads motion yet. P5-F's
  motion panel is where it has to land, and the round-trip test here is written
  against the record alone so it will not need rewriting when it does.
