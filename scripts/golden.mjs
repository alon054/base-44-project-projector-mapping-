/**
 * §8.1's headless render smoke test, run under Electron.
 *
 * Electron rather than headless-gl or a Playwright browser, deliberately: it is
 * already a dependency, and — more to the point — it is the renderer that
 * ships. A golden produced by a different GL implementation can pass here and
 * differ on the wall, which is a regression net that catches the wrong thing.
 *
 * Usage:
 *   npm run test:render            compare against test/golden/frames.json
 *   npm run test:render -- --bless rewrite the goldens (do this in a commit
 *                                  that says why — SPEC.md §8.1)
 */
import { app, BrowserWindow } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'dist', 'golden', 'index.html');
const GOLDENS = join(ROOT, 'test', 'golden', 'frames.json');
const PREVIEW_DIR = join(ROOT, '.golden-preview');
const PREV_DIR = join(PREVIEW_DIR, 'prev');
const MANIFEST = 'manifest.json';

const BLESS = process.argv.includes('--bless');

/**
 * A hash alone cannot tell a correct frame from a black one, so every case
 * carries a floor on the share of lit pixels. This is the cheap version of the
 * A9 principle: an instrument that reports a plausible pass on a blank frame is
 * worse than one that fails.
 */
const MIN_COVERAGE = 0.005;

/**
 * I-1, Gate 1: "the same scene renders correctly at two output resolutions with
 * no repositioning". Hashes cannot check this — different pixel counts hash
 * differently by construction — so the harness reports a coarse luminance
 * signature delta instead, and this is the ceiling on it.
 *
 * Set from the measured value with room for rasterization, not from taste. A
 * repositioned layer moves a whole cell's worth of light and lands far above
 * this; a stroke that rasterizes differently at half resolution does not.
 */
const MAX_LAYOUT_DELTA = 0.08;

/**
 * B2. The cases that existed before role fills did.
 *
 * Every one of them must be byte-identical to its committed golden, asserted
 * BY NAME rather than left to the general hash loop below. The general loop
 * compares whatever is committed; this list is a statement about a specific set
 * — "adding a second draw path to the compositor changed nothing for a layer
 * that does not use it" — and it fails loudly if the set ever shrinks, which a
 * loop over the file cannot notice.
 */
const PRE_FILL_CASES = 43;

/**
 * B2 / SPRINT.md R3. How far a clipped frame may sit from the polygon area it
 * was clipped to.
 *
 * **Set from the measurement, not from taste**, and the first value written
 * here was wrong in the way that matters. 0.12 was chosen as "generous enough
 * for antialiasing" before the cases had ever run — and an unclipped
 * `fill-one-surface` would light 0.2304 of the frame against a polygon area of
 * 0.1656, a gap of 0.065, so a 0.12 tolerance would have passed the exact
 * failure the check exists to catch. A threshold wide enough to admit the bug
 * is a green line over nothing.
 *
 * Measured: both cases agree with their shoelace area to within 5e-5 of the
 * frame. 0.01 is 200x that headroom and still 6x tighter than the gap it has to
 * separate.
 */
const CLIP_TOLERANCE = 0.01;

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  app.exit(1);
}

/**
 * Keep the previous run's previews beside the current ones.
 *
 * `.golden-preview` is overwritten by every run, so the run that *finds* a
 * drift destroys the evidence of it on its way past: 2026-09-05's font
 * investigation could establish only that three frames differed, never how,
 * because the pre-update pixels no longer existed anywhere. Rotating one
 * generation costs a directory rename and turns the next drift from an
 * inference into a diff:
 *
 *   npx electron scripts/font-probe.mjs --diff .golden-preview/prev .golden-preview
 *
 * The manifest records which run produced the baseline — case count, OS build,
 * and whether the run that wrote it finished. A partial baseline is announced
 * rather than passed off as a good one (A9/A14: the instrument reports on
 * itself), and an interrupted run never overwrites a complete generation with
 * its fragments.
 */
function rotatePreviews() {
  const pngs = existsSync(PREVIEW_DIR) ? readdirSync(PREVIEW_DIR).filter((f) => f.endsWith('.png')) : [];
  if (pngs.length === 0) {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    process.stdout.write('previews: nothing to rotate — this run writes the first baseline\n');
    return;
  }

  const priorFile = join(PREVIEW_DIR, MANIFEST);
  let prior = null;
  if (existsSync(priorFile)) {
    try {
      prior = JSON.parse(readFileSync(priorFile, 'utf8'));
    } catch {
      prior = null;
    }
  }

  // An interrupted run leaves a partial set with no manifest. Keeping the older
  // complete generation is strictly more useful than replacing it with
  // fragments, so that case declines to rotate and says so.
  if (!prior?.complete && existsSync(join(PREV_DIR, MANIFEST))) {
    process.stdout.write(
      `previews: NOT rotated — the ${pngs.length} png(s) in ${PREVIEW_DIR} carry no complete manifest ` +
        '(an interrupted run?), so the existing prev/ generation is kept rather than overwritten with fragments\n',
    );
    for (const f of pngs) rmSync(join(PREVIEW_DIR, f));
    rmSync(priorFile, { force: true });
    return;
  }

  rmSync(PREV_DIR, { recursive: true, force: true });
  mkdirSync(PREV_DIR, { recursive: true });
  for (const f of pngs) renameSync(join(PREVIEW_DIR, f), join(PREV_DIR, f));
  if (existsSync(priorFile)) renameSync(priorFile, join(PREV_DIR, MANIFEST));

  process.stdout.write(
    `previews rotated: ${pngs.length} png(s) -> ${PREV_DIR}` +
      (prior
        ? `  [from ${prior.at}, ${prior.platform} ${prior.osRelease}]`
        : '  [no manifest — the provenance of that baseline is unknown]') +
      '\n',
  );
}

/**
 * Written only after every preview has landed, so its presence is what marks a
 * generation complete. Records the OS build, which is the fact the 26.2 →
 * 26.6.2 boundary needed and did not have.
 */
function writePreviewManifest(names) {
  writeFileSync(
    join(PREVIEW_DIR, MANIFEST),
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        cases: names.length,
        complete: true,
        platform: process.platform,
        osRelease: release(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        names,
      },
      null,
      2,
    )}\n`,
  );
}

app.whenReady().then(async () => {
  if (!existsSync(PAGE)) {
    fail(`golden harness not built: ${PAGE}\nrun \`npm run build:web\` first`);
    return;
  }

  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { backgroundThrottling: false, offscreen: false },
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });

  let results;
  try {
    await win.loadFile(PAGE);
    results = await win.webContents.executeJavaScript('window.__golden');
  } catch (e) {
    fail(`golden harness threw: ${e?.message ?? e}`);
    return;
  }

  rotatePreviews();
  const observed = {};
  for (const r of results) {
    observed[r.name] = {
      width: r.width,
      height: r.height,
      hash: r.hash,
      coverage: Number(r.coverage.toFixed(6)),
      failures: r.failures,
      layoutDelta: r.layoutDelta,
      expectLayoutMismatch: r.expectLayoutMismatch,
      centrePixel: r.centrePixel,
      meanLuminance: r.meanLuminance,
      // Phase 4. Only present on cases that declare a region, so it is written
      // into the committed goldens too — a region hash that changed between
      // runs is as much a regression as a frame hash that did.
      ...(r.regionHash ? { regionHash: r.regionHash } : {}),
      // Committed, so a hash that silently stopped covering part of the frame
      // shows up as a diff in the goldens rather than as nothing at all.
      ...(r.excluded ? { excluded: r.excluded } : {}),
    };
    writeFileSync(
      join(PREVIEW_DIR, `${r.name.replace(/[^\w.@-]/g, '_')}.png`),
      Buffer.from(r.png.split(',')[1], 'base64'),
    );
  }
  writePreviewManifest(results.map((r) => r.name));

  const problems = [];
  for (const r of results) {
    if (r.layoutDelta) {
      const over = r.layoutDelta.maxCell > MAX_LAYOUT_DELTA;
      if (r.expectLayoutMismatch && !over) {
        // The control failed to fail. The measure is blind, so every I-1 pass
        // beside it is worthless — this is louder than a mismatch, not quieter.
        problems.push(
          `${r.name}: NEGATIVE CONTROL DID NOT TRIP. A deliberately mislaid layer measured ${r.layoutDelta.maxCell} against ${r.layoutDelta.against}, at or under the ${MAX_LAYOUT_DELTA} limit. The I-1 layout check cannot see a moved layer and every other layout pass in this run means nothing`,
        );
      } else if (!r.expectLayoutMismatch && over) {
        problems.push(
          `${r.name}: layout differs from ${r.layoutDelta.against} by ${r.layoutDelta.maxCell} per cell (limit ${MAX_LAYOUT_DELTA}) — a normalized transform is not surviving the resolution change (I-1)`,
        );
      }
    }
    // The narrowed hash must still be able to fail. If the control did not
    // trip, every excluded case's pass means nothing — louder than a mismatch.
    if (r.excludeControl && !r.excludeControl.tripped) {
      problems.push(
        `${r.name}: EXCLUSION NEGATIVE CONTROL DID NOT TRIP. A byte flipped at ` +
          `${r.excludeControl.at ? `(${r.excludeControl.at.join(', ')})` : 'no pixel'} — outside the excluded rect — ` +
          `left the hash at ${r.hash}. The narrowed assertion cannot see a change it is supposed to see` +
          `${r.excludeControl.note ? `: ${r.excludeControl.note}` : ''}`,
      );
    }
    if (r.excluded) {
      const pct = ((r.excluded.pixels / (r.width * r.height)) * 100).toFixed(3);
      if (r.excluded.pixels > r.width * r.height * 0.05) {
        problems.push(
          `${r.name}: the exclusion covers ${pct}% of the frame, over the 5% ceiling — an exclusion that wide stops being "as small as the text"`,
        );
      }
      process.stdout.write(
        `exclusion: ${r.name} skips ${r.excluded.pixels} px (${pct}% of frame) ` +
          `in ${r.excluded.rects.length} rect(s) ${JSON.stringify(r.excluded.rects)} — control tripped at ` +
          `${r.excludeControl?.at ? `(${r.excludeControl.at.join(', ')})` : 'n/a'}\n`,
      );
    }
    if (r.coverage < MIN_COVERAGE) {
      problems.push(
        `${r.name}: only ${(r.coverage * 100).toFixed(3)}% of pixels are lit — a blank frame hashes just as well as a correct one`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // B2 — SPRINT.md R2 and R3, asserted in the runner rather than only stored.
  //
  // Three separate claims, and each is a thing a hash cannot say:
  //   1. the fill is CLIPPED (a hash of an unclipped frame is just as stable);
  //   2. clipping allocates NO render target (invisible in every pixel);
  //   3. the pre-B2 cases are untouched (a re-bless would hide it).
  // -------------------------------------------------------------------------
  const fillCases = results.filter((r) => r.clip);
  const baseline = results.find((r) => r.name === 'default');
  if (fillCases.length === 0) {
    problems.push('B2: the role-fill cases are missing from the harness');
  }
  for (const r of fillCases) {
    const { polygon, box } = r.clip;
    // The clip, in area. An unmasked fill lights its bounding box; a masked one
    // lights the polygon. These two differ by 39% on the L face, so the
    // measurement separates them with room to spare.
    if (Math.abs(r.coverage - polygon) > CLIP_TOLERANCE) {
      problems.push(
        `${r.name}: lit ${(r.coverage * 100).toFixed(2)}% of the frame, but the faces carrying ` +
          `"${r.clip.role}" enclose ${(polygon * 100).toFixed(2)}% (tolerance ${CLIP_TOLERANCE * 100}%). ` +
          `Unclipped, their bounding boxes would light ${(box * 100).toFixed(2)}% — ` +
          'if the lit share is near THAT number, the mask is not in the path.',
      );
    }
    // The discriminator, stated directly rather than left to the tolerance: a
    // frame closer to the UNCLIPPED area than to the clipped one is an
    // unclipped frame, whatever the threshold above happens to be set to.
    if (Math.abs(r.coverage - box) <= Math.abs(r.coverage - polygon)) {
      problems.push(
        `${r.name}: the lit share ${(r.coverage * 100).toFixed(2)}% is at least as close to the ` +
          `UNCLIPPED bounding-box area ${(box * 100).toFixed(2)}% as to the clipped polygon area ` +
          `${(polygon * 100).toFixed(2)}%. The mask is not cutting the fill.`,
      );
    }
    // The negative control for the check above. If the box and the polygon were
    // the same area, agreeing with one would mean agreeing with the other and
    // the assertion would prove nothing. This is the reason `fill-one-surface`
    // uses the L rather than a rectangle.
    if (!(box > polygon * 1.1)) {
      problems.push(
        `${r.name}: NO CLIPPING TO MEASURE. The faces' bounding boxes (${box.toFixed(4)}) are not ` +
          `meaningfully larger than their area (${polygon.toFixed(4)}), so a frame with no mask at ` +
          'all would pass the coverage check above. This case cannot demonstrate what it is for.',
      );
    }
  }

  // R3. The count must not rise when a fill is added — and an INVALID census is
  // not a pass. `undefined === undefined` reading as agreement is exactly how
  // this project once printed a green line over a measurement that never ran.
  if (baseline && fillCases.length > 0) {
    const censuses = [baseline, ...fillCases];
    const invalid = censuses.filter((r) => !r.renderTargets?.valid);
    if (invalid.length > 0) {
      problems.push(
        `R3: the render-target census is INVALID on ${invalid.map((r) => r.name).join(', ')} — ` +
          `${invalid[0].renderTargets?.invalidReason ?? 'no census at all'}. ` +
          'This is not a pass: nothing was measured.',
      );
    } else {
      const over = fillCases.filter((r) => r.renderTargets.count > baseline.renderTargets.count);
      if (over.length > 0) {
        problems.push(
          `R3: adding a fill ALLOCATED A RENDER TARGET. default ${baseline.renderTargets.count}, ` +
            over
              .map((r) => `${r.name} ${r.renderTargets.count}`)
              .join(', ') +
            '. A mask must be a stencil, never a render texture — check that render/mask.ts still ' +
            'returns a Graphics and that nothing wrapped the fill in a Sprite or a filter.',
        );
      } else {
        process.stdout.write(
          `R3: render targets ${baseline.renderTargets.count} with no fill, ` +
            fillCases.map((r) => `${r.renderTargets.count} on ${r.name}`).join(', ') +
            ` — clipping ${fillCases.length} face-fill case(s) allocated none\n`,
        );
      }
    }
  }

  if (BLESS || !existsSync(GOLDENS)) {
    if (problems.length > 0) {
      fail(`refusing to bless:\n  ${problems.join('\n  ')}`);
      return;
    }
    mkdirSync(dirname(GOLDENS), { recursive: true });
    writeFileSync(GOLDENS, `${JSON.stringify(observed, null, 2)}\n`);
    process.stdout.write(
      `${existsSync(GOLDENS) && !BLESS ? 'created' : 'blessed'} ${Object.keys(observed).length} goldens -> ${GOLDENS}\n`,
    );
    process.stdout.write(`previews in ${PREVIEW_DIR}\n`);
    app.exit(0);
    return;
  }

  const expected = JSON.parse(readFileSync(GOLDENS, 'utf8'));
  for (const [name, exp] of Object.entries(expected)) {
    const got = observed[name];
    if (!got) {
      problems.push(`${name}: golden exists but the harness produced no such case`);
      continue;
    }
    if (got.width !== exp.width || got.height !== exp.height) {
      problems.push(
        `${name}: rendered at ${got.width}x${got.height}, golden is ${exp.width}x${exp.height} — the golden resolution must be fixed in the harness, never read from a display (A8)`,
      );
    }
    if (got.hash !== exp.hash) {
      problems.push(
        `${name}: hash ${got.hash} != golden ${exp.hash} (preview: ${PREVIEW_DIR}/${name}.png)` +
          (existsSync(join(PREV_DIR, `${name.replace(/[^\w.@-]/g, '_')}.png`))
            ? `\n    the previous run's pixels are in ${PREV_DIR} — diff them with:\n` +
              '      npx electron scripts/font-probe.mjs --diff .golden-preview/prev .golden-preview'
            : `\n    no previous generation in ${PREV_DIR}, so this drift can be seen but not localised`),
      );
    }
    if (got.meanLuminance !== exp.meanLuminance) {
      problems.push(`${name}: mean luminance ${got.meanLuminance} != golden ${exp.meanLuminance}`);
    }
    if (JSON.stringify(got.centrePixel) !== JSON.stringify(exp.centrePixel)) {
      problems.push(
        `${name}: centre pixel ${JSON.stringify(got.centrePixel)} != golden ${JSON.stringify(exp.centrePixel)}`,
      );
    }
    if (JSON.stringify(got.layoutDelta) !== JSON.stringify(exp.layoutDelta)) {
      problems.push(
        `${name}: I-1 layout delta changed\n    got      ${JSON.stringify(got.layoutDelta)}\n    expected ${JSON.stringify(exp.layoutDelta)}`,
      );
    }
    if (JSON.stringify(got.excluded ?? null) !== JSON.stringify(exp.excluded ?? null)) {
      problems.push(
        `${name}: the excluded rect changed\n    got      ${JSON.stringify(got.excluded ?? null)}\n    expected ${JSON.stringify(exp.excluded ?? null)}`,
      );
    }
    if (JSON.stringify(got.failures) !== JSON.stringify(exp.failures)) {
      problems.push(
        `${name}: I-13 failures changed\n    got      ${JSON.stringify(got.failures)}\n    expected ${JSON.stringify(exp.failures)}`,
      );
    }
  }
  for (const name of Object.keys(observed)) {
    if (!(name in expected)) {
      problems.push(`${name}: new case with no golden — run with --bless in a commit that says why`);
    }
  }
  // Gate 1, condition 1 (I-6): a dark-background `add` glow visibly brightens
  // what is beneath it. The two cases differ ONLY in blend mode, so the gap
  // between their mean luminances is the additive contribution and nothing
  // else. Asserted in the runner, not only in the goldens, so a re-bless cannot
  // quietly record `add` and `normal` producing the same frame.
  const gNormal = observed['glow-normal'];
  const gAdd = observed['glow-add'];
  if (gNormal && gAdd) {
    const gain = gAdd.meanLuminance / gNormal.meanLuminance;
    if (!(gain > 1.05)) {
      problems.push(
        `I-6: \`add\` did not brighten. mean luminance normal=${gNormal.meanLuminance} add=${gAdd.meanLuminance} (gain ${gain.toFixed(4)}x, need > 1.05x)`,
      );
    } else {
      process.stdout.write(
        `I-6: additive gain ${gain.toFixed(4)}x (mean luminance ${gNormal.meanLuminance} -> ${gAdd.meanLuminance})\n`,
      );
    }
  } else {
    problems.push('I-6: the Gate 1 blend-mode cases are missing from the harness');
  }

  // Gate 1: reordering changes occlusion CORRECTLY. A hash difference only
  // says something changed; this says the right layer is on top. Asserted in
  // the runner rather than only in the goldens, so a re-bless cannot quietly
  // record the two orders producing the same pixel.
  const red = observed['occlusion-red-over-blue'];
  const blue = observed['occlusion-blue-over-red'];
  if (red && blue) {
    const dominant = (p) => (p[0] > p[2] ? 'red' : p[2] > p[0] ? 'blue' : 'neither');
    if (dominant(red.centrePixel) !== 'red' || dominant(blue.centrePixel) !== 'blue') {
      problems.push(
        `occlusion: swapping z-order did not swap what is on top — red-over-blue centre ${JSON.stringify(red.centrePixel)}, blue-over-red centre ${JSON.stringify(blue.centrePixel)}`,
      );
    }
  } else {
    problems.push('occlusion: the Gate 1 z-order cases are missing from the harness');
  }

  // Gate 2 (I-5): the warp is a pure post-composite stage. Asserted in the
  // runner, not only in the goldens, because all three of these claims are
  // about frames being IDENTICAL — and a re-bless would happily record a warp
  // stage that quietly resamples every frame, or one that does nothing at all.
  const plain = observed['default'];
  const wOff = observed['warp-disabled'];
  const wId = observed['warp-identity'];
  const wKey = observed['warp-keystone'];
  if (plain && wOff && wId && wKey) {
    if (wOff.hash !== plain.hash) {
      problems.push(
        `I-5: switching the warp OFF did not reproduce the unwarped frame — default ${plain.hash}, warp-disabled ${wOff.hash}`,
      );
    }
    if (wId.hash !== plain.hash) {
      problems.push(
        `I-5: the warp at IDENTITY corners is not pixel-identical to no warp — default ${plain.hash}, warp-identity ${wId.hash}. ` +
          'A round trip through the render texture is resampling the frame, which is a blur on the wall, not a hash detail.',
      );
    }
    if (wKey.hash === plain.hash) {
      problems.push(
        `I-5: a keystone changed nothing — warp-keystone hashes identical to default (${plain.hash}). The warp stage is not in the path.`,
      );
    }
    if (wOff.hash === plain.hash && wId.hash === plain.hash && wKey.hash !== plain.hash) {
      process.stdout.write(
        `I-5: warp off and warp-at-identity are both pixel-identical to no warp (${plain.hash}); a keystone differs (${wKey.hash})\n`,
      );
    }
  } else {
    problems.push('I-5: the Gate 2 warp cases are missing from the harness');
  }

  // I-4 — the reference patch, in pixels. Built because the operator reported a
  // whole-wall colour shift on every edit, and neither the eye nor a
  // whole-frame hash can say whether the engine caused it: the rest of the
  // frame is SUPPOSED to differ between these two cases.
  //
  // Two cases, one difference (wind 0 vs wind 1). The frames must differ; the
  // grey patch must not. If both hold, a patch that still appears to shift on
  // a wall is shifting downstream of this renderer.
  const rNone = observed['phase4-reference-wind-none'];
  const rMax = observed['phase4-reference-wind-max'];
  if (rNone && rMax) {
    // `!rNone.regionHash` and not `=== null`: an ABSENT field is `undefined`,
    // and `undefined === undefined` would have made two missing hashes read as
    // a pass. It did, on this assertion's first run — a green line printed over
    // a measurement that never happened, which is the exact instrument failure
    // Phase 3 spent a session removing from six other places.
    if (!rNone.regionHash || !rMax.regionHash) {
      problems.push(
        'I-4: the reference-patch cases produced no region hash. The assertion did not run — ' +
          'this is not a pass.',
      );
    } else if (rNone.hash === rMax.hash) {
      // The negative control. A dead scene would pass the region test trivially.
      problems.push(
        `I-4: the reference-patch frames are IDENTICAL at wind 0 and wind 1 (${rNone.hash}). ` +
          'The witness is not moving, so the region assertion proves nothing.',
      );
    } else if (rNone.regionHash !== rMax.regionHash) {
      problems.push(
        `I-4: the reference patch CHANGED between wind 0 and wind 1 — ` +
          `${rNone.regionHash} vs ${rMax.regionHash}. It is subscribed to no force and sits at ` +
          'depth 0, so this is a real modulation leak in the compositor. Do not close Gate 4.',
      );
    } else {
      process.stdout.write(
        `I-4: the reference patch is pixel-identical at wind 0 and wind 1 ` +
          `(${rNone.regionHash}) while the frames differ (${rNone.hash} vs ${rMax.hash}) — ` +
          'the engine cannot be what shifts it on the wall\n',
      );
    }
  } else {
    problems.push('I-4: the reference-patch cases are missing from the harness');
  }

  // -------------------------------------------------------------------------
  // B4 — I-16, SPRINT.md R4, asserted in the runner rather than only stored.
  //
  // A defaulted `parallel` group must be BYTE-IDENTICAL to no group at all,
  // and a `sequence` must show exactly its active block. Both are claims a
  // re-bless would happily record the failure of.
  // -------------------------------------------------------------------------
  const stackPlain = observed['stack'];
  const stackGrouped = observed['group-parallel-default'];
  if (stackPlain && stackGrouped) {
    if (stackGrouped.hash !== stackPlain.hash) {
      problems.push(
        `I-16: a defaulted parallel group is NOT byte-identical to no group — stack ${stackPlain.hash}, ` +
          `group-parallel-default ${stackGrouped.hash}. A group must be inert at its defaults.`,
      );
    } else {
      process.stdout.write(
        `I-16: a defaulted parallel group is byte-identical to no group at all (${stackPlain.hash})\n`,
      );
    }
  } else {
    problems.push('I-16: the parallel-group case is missing from the harness');
  }
  const seqExpect = { 'group-sequence-t6': 'green', 'group-sequence-t9.5': 'blue', 'group-sequence-t12': 'red' };
  const channel = (p) => {
    const [r, g, b] = p;
    if (r > g && r > b) return 'red';
    if (g > r && g > b) return 'green';
    if (b > r && b > g) return 'blue';
    return 'none';
  };
  const seqSeen = Object.entries(seqExpect).map(([name, want]) => {
    const r = observed[name];
    if (!r) {
      problems.push(`I-16: sequence case ${name} is missing from the harness`);
      return null;
    }
    const got = channel(r.centrePixel);
    if (got !== want) {
      problems.push(
        `I-16: ${name} shows ${got} at the centre ${JSON.stringify(r.centrePixel)}, expected ${want}. ` +
          'The sequence is not deriving its active block from the clock — or is drawing every block.',
      );
    }
    return `${name}=${got}`;
  });
  if (seqSeen.every((x) => x !== null)) {
    process.stdout.write(`I-16: 5 + 3 + 2 sequence shows one block per clock time (${seqSeen.join(', ')})\n`);
  }

  // The 43 cases that predate B2, by name and by hash. B4's `group-` cases are
  // excluded the same way B2's `fill-` cases are: the set is "what existed
  // before the compositor learned each new trick", and it must not grow.
  const preFill = Object.keys(expected).filter((n) => !n.startsWith('fill-') && !n.startsWith('group-'));
  if (preFill.length !== PRE_FILL_CASES) {
    problems.push(
      `B2: ${preFill.length} pre-fill goldens are committed, expected ${PRE_FILL_CASES}. ` +
        'The set a fill must not disturb changed size; if that was deliberate, update PRE_FILL_CASES ' +
        'in a commit that says why.',
    );
  }
  const drifted = preFill.filter((n) => observed[n] && observed[n].hash !== expected[n].hash);
  if (drifted.length === 0 && preFill.length === PRE_FILL_CASES) {
    process.stdout.write(
      `B2: all ${preFill.length} pre-fill goldens byte-identical — a layer with no fillRole renders ` +
        'exactly as it did before the compositor learned to draw one layer N times\n',
    );
  }

  if (errors.length > 0) problems.push(`renderer logged errors:\n    ${errors.join('\n    ')}`);

  if (problems.length > 0) {
    fail(`GOLDEN FRAME MISMATCH\n  ${problems.join('\n  ')}`);
    return;
  }

  process.stdout.write(
    `${Object.keys(expected).length} golden frames match. previews in ${PREVIEW_DIR}\n` +
      (existsSync(join(PREV_DIR, MANIFEST))
        ? '  previous run retained in .golden-preview/prev — diff with:\n' +
          '    npx electron scripts/font-probe.mjs --diff .golden-preview/prev .golden-preview\n'
        : ''),
  );
  app.exit(0);
});
