# Gate 0 measurement runs — Phase 0

**Date:** 2026-09-02 · **Commit:** see `git log` for `P0: A-series amendments…` and
following · **Verdict: GATE 0 PASSED, 2026-09-03.**

This report is self-contained. It assumes no prior context.

---

## 1. What is being measured, and why

This project is a live projection-mapping engine — performance equipment, driven
in front of an audience. Phase 0 is the platform scaffold: an editor window plus
a frameless fullscreen output window on a projector, drawing one animated test
pattern, with a performance HUD.

The performance contract (`SPEC.md` §4) defines **N**, the nominal frame
interval, read from the platform's actual display mode and never assumed. Here
**N = 16.6667 ms** (60.000003814697266 Hz). Two gate metrics:

- **M1, presentation (smoothness).** No more than 5% of presentation intervals
  exceed 1.5 × N, and zero runs of 3+ consecutive late presentations.
  - **M1 clause 3, magnitude.** Any interval over **3 × N** must be attributed
    as *engine*, *OS*, or *unknown*. **More than one "unknown" per run is a gate
    failure.** This clause exists because clauses 1 and 2 are binary above
    1.5 × N — a 4-frame stall counts the same as a 1.6× one — so rate alone
    discards exactly the magnitude that matters.
- **M2, headroom.** PixiJS CPU render duration **p99 ≤ 60% of N**. p99 rather
  than p95, because M1 tolerates a 5% late tail and nearest-rank p95 over that
  tail reports the *cheap* value — between the two metrics, nothing examined
  that tail at all.

**Protocol:** 60 continuous seconds after a discarded 10-second warmup, on the
output window only, HUD enabled, projector on AC, at **DEV_RESOLUTION
(1280×720)** — the projector's native mode, so no scaler sits between the
framebuffer and the panel.

**Hardware.** MacBook Air 13″ M4 (2025), 10 CPU / 8 GPU cores, 16 GB unified,
macOS 26.2, **fanless**. Anker Nebula Mars II Pro DLP, native 1280×720, 500 ANSI,
over USB-C→HDMI. Display mode in use 1280×720 @ 60.000003814697266 Hz,
scaleFactor 1, verified 1:1 to the panel in every run below.

**Scene under test:** the Phase 0 test pattern only — a dark green 8×8 grid, a
cyan sweep, a rotating white cross. There is no layer load to speak of. Every
number here is optimistic relative to any real scene, and 720p is 44% of
1080p's pixels.

---

## 2. Why these runs happened

A previous run under the correct protocol passed M1 rate and M2, but M1 clause 3
caught two intervals over 3 × N:

```
n=7846  t=131.0s  233.3 ms
n=7851  t=131.3s  283.4 ms
```

Five frames apart — one event, not two — and 233 ms and 283 ms are 14 and 17
frames, roughly half a second of near-frozen output. Both unattributed, so under
clause 3 the gate fails. A rate-only metric would have called that run clean:
two late frames in 3572 is 0.06%, comfortably inside the 5% allowance.

Two hypotheses were on the table. **H1, stdout pipe:** the app had been launched
through `| grep`, and a writer blocking on a full pipe would explain hundreds of
milliseconds. **H2, focus change or window occlusion:** the operator believes
they switched to another terminal at about t=131 s.

These runs test both.

---

## 3. Runs

All runs are unattended. The app takes `PROJENGINE_MEASURE=<label>` and drives
one full protocol window by itself: reset, wait out warmup plus window, emit a
structured summary, probe, quit. This exists because a run driven by a human
pressing keys cannot be repeated identically, and because a disturbed run must
be **discarded, not reported with a caveat** — which requires the app to notice
disturbance itself. It logs `focus`, `blur` and `visibilitychange` against the
same post-warmup clock the stall timestamps use, and flags the run `disturbed`
if any occurs inside the window.

| Run | Configuration | Result |
|---|---|---|
| run1-sync | stdout → file (synchronous writes) | **valid** |
| run2-sync | stdout → file (synchronous writes) | **valid** |
| run3-sync | stdout → file | **discarded twice**, see §3.2 |
| run4-pipe | stdout → `\| grep` (asynchronous writes) | **valid** |

### 3.1 Deviation from the requested configuration, and why

Runs 1–3 were specified as "stdout to a tty". A tty cannot also be captured to a
file without either `script` (which allocates a pty) or `tee` (which introduces
a pipe — the very thing run 4 exists to isolate).

`script` was tried first and **actively corrupted the run**: the output window
was torn down and recreated four times in 50 seconds, with the metrics window
resetting each time. A plain redirect ran stable. `script` was therefore
abandoned.

This costs nothing that matters. On POSIX, Node's `process.stdout` is
**synchronous for TTYs and files, and asynchronous for pipes**. A file redirect
preserves the synchronous-write property a tty has; the pipe is the genuinely
different case, and run 4 covers it.

### 3.2 Two discarded runs, and what they show about the environment

- **`run1-tty` (via `script`)** — discarded. Four window teardowns, several
  `focus LOST [DISTURBING]` events.
- **`run3-sync`, both attempts** — discarded. Each showed
  `[trace] openOutputWindow(displaysSelect)` roughly 2 seconds after launch.
  `displaysSelect` has exactly one caller in the codebase: the display-picker
  button's click handler in the editor. **Somebody clicked the picker during the
  run.** The operator was working at the machine concurrently.

This is reported rather than smoothed over: **run 3 is outstanding and the
machine was not quiet.** It needs redoing on an idle machine.

---

## 4. Results

### 4.1 Gate metrics

| | run1-sync | run2-sync | run4-pipe |
|---|---|---|---|
| stdout | file (sync) | file (sync) | **pipe (async)** |
| disturbed | no | no | no |
| samples | 3600 | 3601 | 3601 |
| fps | 59.999 | 60.001 | 60.000 |
| N validated | yes | yes | yes |
| **M1 rate** | **PASS** | **PASS** | **PASS** |
| late % (limit 5%) | 0.0000% | 0.0000% | 0.0000% |
| worst late run (limit 2) | 0 | 0 | 0 |
| worst interval | 17.70 ms | 17.80 ms | 17.70 ms |
| **M1 clause 3 (>3×N = >50 ms)** | **none** | **none** | **none** |
| **M2 headroom** | **PASS** | **PASS** | **PASS** |
| render p99 (limit 60% of N) | 0.800 ms = **4.80%** | 0.800 ms = **4.80%** | 0.500 ms = **3.00%** |
| render p95 (informational) | 0.500 ms | 0.500 ms | 0.400 ms |
| scale | 1280×720 buffer / 1280×720 css / dpr 1 — **1:1** | same | same |
| `[event]` lines in window | none | none | none |

**Not one interval exceeded 3 × N in any of the three valid runs.** Worst
interval across all three was 17.80 ms, against a late threshold of 25.0 ms —
not a single late frame in 10,802 samples.

### 4.2 Instrument self-cost

The measurement apparatus is subject to the budget it measures, and reports its
own cost (`SPEC.md` §4, A14).

| | run1-sync | run2-sync | run4-pipe |
|---|---|---|---|
| per-frame **max** | 0.700 ms = 4.20% of N | 0.500 ms = 3.00% | 0.300 ms = 1.80% |
| per-frame **mean** | 0.0056 ms = 0.034% | 0.0057 ms = 0.034% | 0.0044 ms = 0.026% |
| report tick (4×/s) | 0.500 ms | 0.400 ms | 0.300 ms |

**Finding: per-frame *max* is the wrong statistic for A15's 2% review trigger.**
It is a single-sample extreme over 3600 frames and it varies 0.3–0.7 ms across
three identical runs — 1.8% to 4.2% of N, straddling the threshold on noise
alone. The **mean is 0.034% of N**, three orders of magnitude below the
apparatus's own budget concern, and is stable to two significant figures across
all three runs. A15's trigger should read against a stable statistic (mean, or
p99) before it is applied at Phase 3. **Raised, not unilaterally changed** — A15
is ratified as written and says "per-frame instrument max".

### 4.3 Latency (A11)

Two figures, never conflated. **Transport** is editor event → output receipt with
no frame wait — the figure that moves under load. **Presented** is acked from the
frame *after* the one that rendered, so it is conservative by one frame by
construction.

Measured in a dedicated short run, deliberately **not** inside a gate window: a
slider drag inside the measurement window would put its own IPC and React work
into the numbers being gated.

| Figure | Median | p95 | Gate | Verdict |
|---|---|---|---|---|
| Transport | 0.40 ms | 1.80 ms | p95 ≤ 5 ms | **PASS** |
| Presented (round trip) | 24.60 ms | 33.30 ms | p95 ≤ 66 ms | **PASS** |
| Frame wait (`presented − transport`, paired by token) | 23.90 ms = **1.434 × N** | 32.40 ms | structurally 1–2 × N | **IN BAND** |

**This closes an open question.** Presented latency had been observed at 27.5 ms
and later 32.3 ms — a 45% jump that needed explaining. Presented is by
construction one deliberate ack frame (1.0 × N) plus a 0–1 frame wait for the
output's next rAF, so the whole quantity must live in **1.0–2.0 × N**. Three
independent measurements now read **1.64 × N**, **1.81 × N** and **1.434 × N** —
all inside the band. The variation is the phase offset between the editor's
input dispatch and the output window's vsync; the two windows are on different
displays (internal at 2×, projector at 1×), which are independent vsync domains
that drift against each other. **Not a regression.** The band flag makes this
readable directly rather than argued, which matters at Phase 5 where a genuine
transport regression would otherwise hide behind the cadence.

### 4.4 The k probe (A8) — **defective, numbers not usable**

`k` is intended to measure how many times the current scene fits into one frame
interval at a given resolution: `k_dev` at 1280×720, `k_target` against an
offscreen 1920×1080 render texture. The ratio `k_dev / k_target` is meant to be
the measured fill-rate coefficient — **≈2.25 for purely fill-bound work, ≈1.0 for
purely CPU-bound work** — because M2 times CPU only and is therefore structurally
blind to the resolution change it is supposed to guard.

| | run1-sync | run2-sync | run4-pipe |
|---|---|---|---|
| k_dev | 87.6× (0.1903 ms) | 178.2× (0.0935 ms) | 1033.3× (0.0161 ms) |
| k_target | 156.6× (0.1065 ms) | 469.7× (0.0355 ms) | 2583.3× (0.0065 ms) |
| ratio | 0.559 | 0.379 | 0.400 |

**A ratio below 1 means the 1920×1080 probe measured *cheaper per render* than
the 1280×720 probe. That is physically impossible for real fill work.** The
per-render cost also varies more than 10× across three identical runs.

A dedicated bench ran the probe four times back to back on the same scene,
alternating which resolution is measured first:

| Order | k_dev | k_target | ratio |
|---|---|---|---|
| dev-first | 344.4× (0.0484 ms) | 123.0× (0.1355 ms) | **2.800** |
| target-first | 224.6× (0.0742 ms) | 322.9× (0.0516 ms) | **0.696** |
| dev-first | 234.8× (0.0710 ms) | 184.5× (0.0903 ms) | **1.273** |
| target-first | 234.8× (0.0710 ms) | 156.6× (0.1065 ms) | **1.500** |

**Diagnosis, two faults compounding:**

1. **Order bias.** The first resolution measured absorbs framebuffer and
   pipeline creation for that size. The single discarded warm-up render per
   resolution is not enough. The very first probe of a session (dev-first, cold)
   gives 2.800 — near the theoretical 2.25 — and the immediately following
   target-first probe gives 0.696, the same bias reversed.
2. **Signal below noise.** On this trivial scene, per-render cost at either
   resolution is ~0.05–0.14 ms, the same order as the GPU-sync readback the
   two-burst subtraction is meant to cancel. What survives the subtraction is
   mostly noise.

**Consequence:** A8's fill-rate coefficient is **not measurable on a Phase 0
scene with this probe design**, and no k value in this report should be quoted.
Proposed fix, not applied pending a ruling: more warm-up renders per resolution;
a wider iteration spread (8 vs 128) to lift signal above the readback; several
repetitions per resolution with alternating order, reporting the median; and —
most importantly — **a spread/confidence figure reported alongside k, so an
unstable probe declares itself rather than emitting a plausible number**. That
last point is the same principle already ratified for N: an instrument that
emits a plausible wrong number is worse than one that fails loudly.

Note that A8 first *matters* at Phase 3's layer load, where real fill work
exists. The probe may well be measurable there and unmeasurable here.

---

## 4.5 Run 5 — three attempts, one completed, provocations not performed

Run 5 was attempted three times. It exposed a defect before it produced data.

**Attempt 1 — aborted, and it found a bug.** The run restarted endlessly: cue 1
fired, focus was lost as expected at t≈16–18 s, and then
`openOutputWindow(displaysSelect)` tore the output window down and the whole
70-second window began again. Six cycles, never reaching cue 2. **Cause:**
re-selecting a display in the editor's picker destroyed and recreated the output
window *even when the requested display was the one already in use*. This had
been filed as a parked idea after runs 1–4; it was in fact blocking the
measurement, and it is a live-show hazard in its own right — an output window
that restarts whenever a control is touched drops the frame, the power-save
blocker and the calibration state. **Fixed:** the pin is still persisted, but a
re-select of the current display leaves the live window alone. Seven such
no-op selects were logged in the next attempt, each one a teardown avoided.

**Attempt 2 — partial, and informative.** Reached cue 1 and cue 2 with no
teardown. A genuine focus-loss / focus-gain pair occurred at **t = 37.63 s and
t = 37.98 s** inside the live window, together with an application `activate`.
The window ran to n=3044 (~51 s post-warmup). **`worstInterval` stayed at
17.70 ms throughout. Zero late frames, zero clause-3 events.** The attempt ended
when the picker was used to select the built-in display and then the projector
again, which legitimately reopened the window.

**Attempt 3 — completed, clean, but unprovoked.**

| | run5-disturb (attempt 3) |
|---|---|
| samples | 3600 · fps 59.999 |
| M1 rate | **PASS** — 0.0000% late, worst run 0 |
| worst interval | 17.80 ms |
| **M1 clause 3** | **none** |
| M2 p99 | 0.400 ms = **2.40% of N** |
| instrument max / mean | 0.200 ms (1.20%) / 0.0052 ms (0.031%) |
| `[event]` lines | **none** |

All three cues fired on schedule. **No focus, blur or visibility event was
recorded, so none of the three provocations was performed** — and the operator
confirms independently that the speed slider was not touched in this run or in
the earlier ones, which is consistent with the empty event list. This is therefore a
fourth clean control run, not a disturbance test. It does usefully **replace the
outstanding run 3** — same synchronous-stdout configuration, single window,
undisturbed — with the caveat that the cue overlay was drawing a countdown
inside the window. That overlay cost nothing measurable: this run had the
*lowest* p99 (2.40% of N) and the *lowest* instrument max (1.20%) of any run.

## 4.6 Runs 6 and 7 — the provocation matrix, driven by the machine

Run 5's three attempts all failed as experiments for the same two reasons: the
timing depended on a human pressing a key at a cued moment, and the result
depended on a human reporting what the wall did. run5-mc then produced a null
that **could not be interpreted at all** — whether macOS `Displays have separate
Spaces` was on decided whether the run had tested its mechanism, and the run did
not record it. That is the same defect class as A9 and A14, and it was fixed
before these runs: every run now captures its own conditions.

Runs 6 and 7 drive the OS events from the harness. `PROJENGINE_PROVOKE=kind@t`
fires each provocation off the same post-warmup clock every other timestamp uses.
**Ground truth is the renderer's `visibilitychange`** — the listener that
demonstrably fires on a real surface hide — so "did the surface actually
suspend?" is answered by the machine, not by an eye.

**Conditions, captured by the app, identical in both runs:**

```
separateSpaces=true (spans-displays=absent)   hiddenInMissionControl=true
displays=2   output="T749-fHD720"   fullscreen=true   pin=PINNED (pinned-exact-id)
```

### 4.6.1 Run 6 — four provocations in the shipping configuration

| Provocation | Surface suspended? | max interval | clause 3 | first intervals after |
|---|---|---|---|---|
| `hide` — window hidden 2 s | **no** | 18.7 ms | 0 | 15.4 16.5 18.1 16.6 … |
| `apphide` — whole app hidden 2 s | **no** | 18.7 ms | 0 | 15.0 16.7 16.4 16.6 … |
| `mc` — Mission Control, shipping flags | **no** | 18.7 ms | 0 | 16.7 16.7 16.6 16.7 … |
| `mcvisible` — Mission Control, `hiddenInMissionControl` cleared | **no** | 18.7 ms | 0 | 16.6 14.8 17.3 18.0 … |

Run totals: n=3601, 60.000 fps, M1 **PASS** (0.0000% late, worst run 0), M2
**PASS** (p99 0.400 ms = 2.40% of N), **zero clause-3 events**, worst interval
**18.8 ms**. The main process logged `output window hide` for the first two, so
the window really was hidden — and the renderer presented straight through it at
~16.7 ms with no visibility change and no gap.

**On its own this is a null, and a null proves nothing.** It could equally mean
the instrument is blind. Run 7 is the control that settles which.

### 4.6.2 Run 7 — the control that isolates the variable

`backgroundThrottling: false` is set on the output window at creation and has
been there since the first scaffold commit `6f9c724`. The installed Electron 44
typings state what it does: *"Controls whether or not this WebContents will
throttle animations and timers when the page becomes backgrounded. **This also
affects the Page Visibility API.**"* That is a candidate explanation for all four
nulls, and it is testable at runtime via `webContents.setBackgroundThrottling`.

| Provocation | Surface suspended? | max interval | clause 3 | first intervals after resume |
|---|---|---|---|---|
| `hidethrottled` — throttling re-enabled, window hidden 2 s | **YES** | **2016.1 ms** | 1 | 16.9 16.6 **32.8** 17.6 16.1 17.2 … |
| `mcthrottled` — throttling re-enabled **and** `hiddenInMissionControl` cleared, Mission Control | **no** | 17.8 ms | 0 | 16.6 |
| `hide` — shipping configuration again | **no** | 17.7 ms | 0 | 16.7 16.6 |

`hidethrottled` logged `[event] t=15.00s visibility=hidden [DISTURBING]`,
produced a 2016.1 ms gap — the 2000 ms hold plus one frame — and a clause-3
event at n=901. Run 7 is therefore **an attribution run, not a gate run**: its
one clause-3 event was caused deliberately by the harness and its M1 numbers
describe the provocation.

### 4.6.3 What this establishes

1. **The instrument is not blind.** When the surface genuinely suspends, the
   `visibilitychange` fires, the gap appears, and clause 3 catches it. Run 6's
   four nulls are real nulls.
2. **In the shipping configuration the output surface cannot be suspended** by
   hiding the window, hiding the app, or Mission Control — with or without
   `hiddenInMissionControl`. Five provocations across two runs, zero visibility
   changes, worst interval 18.8 ms.
3. **Mission Control does not reach this surface even stripped of both
   immunities.** `mcthrottled` ran with throttling re-enabled *and* the window
   not excluded from Mission Control — the maximally suspendable configuration —
   and the surface still did not suspend. Worst interval 17.8 ms.
4. **A forced suspend costs one 32.8 ms frame on resume.** That is the only
   measured resume cost in the set: 2.0 × N, *below* clause 3's 3 × N threshold.
   The event under investigation is 233.3 ms and 283.4 ms — 14 and 17 frames.
   **Suspend/resume on this hardware is an order of magnitude too cheap to
   produce it**, which is a stronger result than the non-reproduction: it says
   the mechanism is the wrong size, not merely absent.

Both immunity flags — `backgroundThrottling: false` and
`hiddenInMissionControl: true` — have been present since `6f9c724`, so they were
in the binary that produced the 233/283 ms event. The configuration under which
that event occurred is the configuration these runs show to be immune.

**Surface suspend/resume is eliminated.** Not by failing to reproduce it, but by
four positive measurements.

### 4.6.4 Two side findings

- **`hide`/`show` preserves `simpleFullScreen`.** Checked on every hide
  provocation and reported in the note; the window came back fullscreen on the
  projector every time. Had it not, that would have been a live-show hazard of
  the same family as the picker teardown.
- **A8's k probe, two more samples: ratio 5.000 (run 6) and 0.923 (run 7).**
  With run5-mc's 1.037 that is three more points on an unchanged probe, against
  a theoretical 2.25 / 1.0. The probe source has not been touched since the
  defective runs, so **1.037 was not evidence of a fix** and 5.000 is the same
  instrument saying so. Still `[!]`, still non-blocking, still awaiting a ruling.

## 5. Findings

**Did an interval over 3 × N recur?** **No.** Zero in four valid runs, 14,402
samples. Worst interval anywhere was 17.80 ms — against a late threshold of
25.0 ms, so not one late frame anywhere in the set.

**Did the stall follow the pipe?** **No.** Run 4 was piped exactly as the
original failing run was, and was the *cleanest* of the three — lowest p99
(3.00% of N), lowest instrument cost. **H1 is eliminated**, on three independent
grounds:

1. **Empirically** — the piped run shows no stall.
2. **Wrong process** — the stdout writers (`logMetricsPeriodically`,
   `forwardConsole`) run in the Electron **main** process. A main process blocked
   on stdout cannot stall the output renderer's rAF loop; they are separate
   processes.
3. **Wrong direction** — Node's stdout is synchronous for TTYs and files and
   *asynchronous* for pipes, so a pipe is the least blocking of the three
   targets, not the most.

**What does that leave for H2?** Focus/occlusion remains the leading candidate
but is **not yet confirmed, and one form of it is already ruled out.** The two
discarded runs contain several genuine `focus LOST` events and four full window
teardowns, and **none of them coincided with an interval over 3 × N** — worst
interval stayed at 17.70 ms throughout. So **plain keyboard-focus loss is not
sufficient** to produce the stall.

That leaves stronger surface-level events: Mission Control, a Spaces switch on
the display holding the output window, or genuine occlusion — all of which can
suspend and resume a rendering surface, and any of which fits the observed shape
of two large stalls five frames apart. A slider drag concurrent with the switch
is a third untested candidate.

**Standing:**

| Hypothesis | Status |
|---|---|
| stdout pipe blocking the writer | **eliminated** — empirically and architecturally |
| instrument allocation churn (earlier 67.7 ms stall) | fixed; **unconfirmed**, never observed in a conformant run |
| plain keyboard focus loss / app switch | **ruled out** — performed deliberately at cue 1 in six separate cycles of run 5 attempt 1, and observed again at t≈37.6 s inside attempt 2's live window, with an app `activate`. Not one interval over 3 × N in any of them |
| surface suspend/resume: Mission Control, Spaces switch, occlusion | **eliminated** — §4.6. In the shipping configuration the surface cannot be suspended at all (5 provocations, 0 visibility changes); Mission Control cannot suspend it even with both immunity flags stripped; and a *forced* suspend costs one 32.8 ms frame on resume, against an event of 233/283 ms. Wrong size, not merely absent |
| the output window being suspendable at all | **answered** — `backgroundThrottling: false`, set since `6f9c724`, "also affects the Page Visibility API" (Electron 44 typings). It is why the surface stays live when hidden, and it was in the binary that produced the original event |
| parameter drag concurrent with a switch | **eliminated** — the operator confirms the speed slider was never touched, in run 5 or in the original run that produced the stall. It was one of the two possibilities originally offered for t=131 s; it is now out |
| output window teardown from a picker re-select | **found and fixed** — not the original stall (it postdates it), but a real live-show hazard uncovered by run 5 |

---

## 6. Gate 0 status

**Passed, 2026-09-03.**

| Box | Status |
|---|---|
| Output truly fullscreen on the projector, no chrome, no cursor | pass |
| Both latency figures (transport ≤5 ms, presented ≤66 ms) | pass — 1.80 ms / 33.30 ms p95 |
| **Both §4 gate metrics under protocol** | **closed** — five runs pass both metrics; the 233/283 ms event is recorded **`unknown`**, which A12 permits at one per run, after its last named candidate was eliminated by the §4.6 provocation matrix |
| App relaunches without manual display reconfiguration | **pass** — verified across a physical cable reconnect: unplug, replug, relaunch, resolved `via PINNED (pinned-exact-id)` fullscreen. 15 launches on record, every one `PINNED`, none `HEURISTIC`. macOS reused `Display.id`, so `pinned-fingerprint` has still never fired in the field (unit-tested, `config.test.ts:65`, `:170`) |
| Never fullscreens the primary display without confirmation | pass |
| Both §4 metrics recorded, labelled DEV_RESOLUTION | pass |
| Projector keystone / auto-focus disable to passthrough | **pass** — confirmed by the operator at the device, 2026-09-03. Discharges §9's projector-side geometric correction row and §10's installation prerequisite for the Nebula Mars II Pro: I-5 holds in practice and Phase 2 / Phase 7 calibrate one transform |
| Projector-panel latency by phone video | **deferred to Phase 5** — attempted and failed on capture, not on effort. See §8 |

**Clean runs were never going to be an attribution**, which is why §4.6 stopped
running them and started provoking instead. The event is recorded `unknown` on
the strength of an exhausted candidate list, not on the strength of
non-reproduction — and the strongest single fact in that list is that a forced
suspend costs 32.8 ms where the event cost 233 and 283 ms.

**M1 clause 3 has not been adjusted, and this is the outcome it was written for.**
A rate-only metric would have called the original run clean; clause 3 held the
gate open for four sessions, forced the instrument to grow the ability to answer
the question, and then permitted exactly the one `unknown` it always allowed.
Nothing was weakened to close this box.

**What one `unknown` costs, stated plainly.** A12 permits one per run and this
uses it. A second unexplained stall in any future run is a gate failure with no
allowance left, and the honest reading of this box is "not reproduced in 18,003
samples, mechanism eliminated, cause unidentified" — not "explained".

---

## 7. Run 5 — operator-driven, the only run that can positively identify

Runs 1–4 can only fail to reproduce. This one can identify.

### 7.1 Two questions answered first

**Do `h`, `r` and `k` need the output window focused, and will a click into a
black rectangle register?**

They are bound with `window.addEventListener('keydown')` in the output
renderer, so **yes — the output window must hold keyboard focus. They are not
global shortcuts.** A click anywhere on the projector display will register: the
window covers that display edge to edge, and the cursor is hidden by CSS but
still present and still clicks.

Confirming focus with no visible cursor is now solved three ways:

- **On the wall:** a yellow bar appears across the bottom of the output window
  whenever focus is **lost**, reading `OUTPUT WINDOW NOT FOCUSED — click
  anywhere on this display`. A focused window draws nothing extra, so it cannot
  pollute a clean run.
- **In the terminal:** `[event] output window focus|blur @ <ISO timestamp>` from
  the main process, and `[event] t=<seconds>s focus gained|LOST` from the
  renderer, on the same post-warmup clock the stall timestamps use.
- **Not needed at all for runs 1–4**, which press no keys.

**Cmd-tab to which app, and is a Spaces switch the same test?**

**They are two different tests, and the evidence says the cheaper one is already
ruled out.**

- The editor and output windows belong to the **same application**, so cmd-tab
  cannot move between them (that is cmd-` , which cycles windows within an app).
  Cmd-tab necessarily goes to another app — Terminal, Finder.
- **Cmd-tab tests keyboard-focus loss only.** A window on a second display
  normally stays *visible* when another app activates; Chromium keeps rAF running
  for a visible-but-unfocused window. §5 shows focus loss occurring repeatedly
  with no stall, so this alone is not expected to reproduce.
- **Mission Control and a Spaces switch test surface suspend/resume**, which is
  the mechanism that fits two large stalls five frames apart. Note that macOS's
  "Displays have separate Spaces" setting changes whether a Spaces switch on the
  internal display touches the projector at all — worth knowing which way it is
  set before interpreting a null result.

So run 5 provokes **three** distinct events at three cued times, in one run.

### 7.2 The script

The app cues you on the wall so you act on a signal rather than a stopwatch: a
5-4-3-2-1 countdown in large red type, then **`SWITCH NOW`**. Cue times are
post-warmup seconds.

```
npm run build
PROJENGINE_MEASURE=run5-disturb PROJENGINE_CUES=15,30,45 npx electron . > measurements/run5-disturb.log 2>&1
```

Then, **hands off except at the three cues**:

| Cue | At | Do exactly this |
|---|---|---|
| 1 | t = 15 s | **Cmd-Tab** to Terminal, count two seconds, **Cmd-Tab** back |
| 2 | t = 30 s | **Mission Control** (F3 or a four-finger swipe up), count two seconds, **Esc** |
| 3 | t = 45 s | Click the **editor** window and **drag the speed slider** for two seconds, then stop |

The run ends by itself at t = 60 s, probes, and quits. Total about 80 seconds
from launch.

### 7.3 Reading it

```
grep -E "M1-clause-3|\[event\]|\[run\] CUE|SUMMARY" measurements/run5-disturb.log
```

A `clause-3` stall within about 0.5 s of an `[event]` line **identifies the
cause**, and the cue it belongs to names the mechanism:

- near cue 1 → keyboard focus loss, contradicting §5's null result and worth
  re-examining;
- near cue 2 → **surface suspend/resume — the expected answer**, and it goes into
  `SPEC.md` §4's protocol as "measurement runs are made without window, Space, or
  Mission Control switching";
- near cue 3 → the parameter path under drag, which is an engine finding and the
  most serious of the three, because it would recur in a live show;
- **no stall at any cue** → none of the three is the mechanism, the original
  event stays `unknown`, and under clause 3 a single unknown is permitted. Gate 0
  could then close on one further clean run, with the event recorded as
  unexplained rather than explained away.

### 7.4 Still outstanding

§7's operator-driven script is **superseded** by the unattended provocation
harness in §4.6 and should not be run again. It is kept here as the record of
what was attempted and why it failed as an experiment: it depended on a human
for both its timing and its observation, and it could not record the one
condition needed to interpret its own null.

- **Run 3** — satisfied by run 5 attempt 3 (same configuration, clean,
  undisturbed), with the cue-overlay caveat noted in §4.5.
- **The Mission Control arm** — closed by §4.6, without a human at the keyboard.
- **The one untested corner, stated rather than hidden:** every run in this
  report was made with macOS `Displays have separate Spaces` **ON** — its
  untouched default, now recorded in each run's conditions block. A Spaces
  switch driven on the projector's *own* display with that setting OFF has never
  been exercised. It is not load-bearing for the conclusion: the shipping
  window's immunity comes from `backgroundThrottling: false`, which is a
  WebContents property and display-independent, and `mcthrottled` failed to
  suspend the surface even with that immunity removed.
- **A8's k probe** — defective, three further samples (1.037, 5.000, 0.923) on
  unchanged source, awaiting a ruling on the proposed fix.
- **The 67.70 ms stall from the earlier session** — origin recorded as instrument
  allocation churn, fixed, never confirmed.

---

## 8. The panel-latency attempt, and why no number was recorded

Attempted 2026-09-03 with a phone video of the wall and the laptop in one frame.
The framing was right and the clip contains a real discrete event — the HUD
toggling off on the wall. **No number was extracted, and none was invented.**

| Obstacle | Detail |
|---|---|
| **Frame rate** | 1920×1080 @ **30 fps** = 33.3 ms/frame, *twice* the projector's own frame interval. One frame of ambiguity at each end spans ±67 ms on a quantity expected to be 30–80 ms — consistent with anything from zero to 150 ms |
| **DLP flicker** | A per-frame luminance scan of the projected area found **3,748 brightness transitions in 6,883 frames**. The colour wheel and PWM mean the panel is not showing a stable image within a 30 fps exposure, so the wall beats light/dark almost every frame. Automatic event detection is impossible and a by-eye scrub is little better |
| **No valid reference** | The editor preview cannot serve as the time reference: measured from the same still, the sweep bar sat ~12% across on the wall and ~35% across in the preview — **about 0.9 s apart on a 4 s loop**. Phase 0's ticker (`render/host.ts`) is per-window and each accumulates phase from its own first frame. Sanctioned throwaway (§0.2), deleted in Phase 3 when I-2's single clock lands |

**Why nothing was recorded anyway.** A9 is ratified for the HUD — *an instrument
that emits a plausible wrong number is worse than one that fails loudly* — and
that clause binds the analysis as much as the apparatus. "≈33 ms" from a 30 fps
clip of a flickering DLP is exactly the kind of confident, precise, wrong figure
A9 exists to stop.

**What the measurement needs.** 240 fps slo-mo (4.17 ms/frame, which also
averages through the DLP flicker), the wall and the laptop keyboard in one
frame, and the HUD toggled several times. It is carried into Phase 5 as a
deliverable, which is where the number is first used — judging whether a drag
feels late, against a fresh transport figure. Reported separately from the
software round-trip and never as an engine number (§9's projector-observation
rule).
