# Gate 0 measurement runs — Phase 0

**Date:** 2026-09-02 · **Commit:** see `git log` for `P0: A-series amendments…` and
following · **Verdict: Gate 0 does not close.**

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

## 5. Findings

**Did an interval over 3 × N recur?** **No.** Zero in three valid runs, 10,802
samples. Worst interval anywhere was 17.80 ms.

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
| plain keyboard focus loss | **ruled out** — observed repeatedly with no stall |
| surface suspend/resume: Mission Control, Spaces switch, occlusion | **open, leading** — requires the operator-driven run |
| parameter drag concurrent with a switch | **open, untested** |

---

## 6. Gate 0 status

**Does not close.**

| Box | Status |
|---|---|
| Output truly fullscreen on the projector, no chrome, no cursor | pass |
| Both latency figures (transport ≤5 ms, presented ≤66 ms) | pass — 1.80 ms / 33.30 ms p95 |
| **Both §4 gate metrics under protocol** | **open** — M1 rate and M2 pass in all three runs, but the original clause-3 event is still unattributed. Three clean runs cannot attribute a stall they did not reproduce |
| App relaunches without manual display reconfiguration | operator's — pin resolved as `PINNED (pinned-exact-id)` in every run here, which is evidence, not the operator's own verification |
| Never fullscreens the primary display without confirmation | pass |
| Both §4 metrics recorded, labelled DEV_RESOLUTION | pass |
| Projector keystone / auto-focus disable to passthrough | operator's physical check |
| Projector-panel latency by phone video | informational, operator's |

**Three clean runs are not an attribution.** They eliminate one hypothesis and
narrow a second. The clause-3 event needs a positive identification, which needs
a run that deliberately provokes it. That run is §7, and it needs a human.

**M1 clause 3 has not been adjusted.** It is doing exactly what it was written to
do: this run set would have been declared clean by any rate-only metric.

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

- **Run 3** — needs redoing on an idle machine; both attempts were interrupted by
  a display-picker click.
- **A8's k probe** — defective, awaiting a ruling on the proposed fix.
- **The 67.70 ms stall from the earlier session** — origin recorded as instrument
  allocation churn, fixed, never confirmed.
