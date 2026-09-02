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
