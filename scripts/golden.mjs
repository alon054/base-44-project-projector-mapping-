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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'dist', 'golden', 'index.html');
const GOLDENS = join(ROOT, 'test', 'golden', 'frames.json');
const PREVIEW_DIR = join(ROOT, '.golden-preview');

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

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  app.exit(1);
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

  mkdirSync(PREVIEW_DIR, { recursive: true });
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
    };
    writeFileSync(
      join(PREVIEW_DIR, `${r.name.replace(/[^\w.@-]/g, '_')}.png`),
      Buffer.from(r.png.split(',')[1], 'base64'),
    );
  }

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
    if (r.coverage < MIN_COVERAGE) {
      problems.push(
        `${r.name}: only ${(r.coverage * 100).toFixed(3)}% of pixels are lit — a blank frame hashes just as well as a correct one`,
      );
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
      problems.push(`${name}: hash ${got.hash} != golden ${exp.hash} (preview: ${PREVIEW_DIR}/${name}.png)`);
    }
    if (JSON.stringify(got.layoutDelta) !== JSON.stringify(exp.layoutDelta)) {
      problems.push(
        `${name}: I-1 layout delta changed\n    got      ${JSON.stringify(got.layoutDelta)}\n    expected ${JSON.stringify(exp.layoutDelta)}`,
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
  if (errors.length > 0) problems.push(`renderer logged errors:\n    ${errors.join('\n    ')}`);

  if (problems.length > 0) {
    fail(`GOLDEN FRAME MISMATCH\n  ${problems.join('\n  ')}`);
    return;
  }

  process.stdout.write(
    `${Object.keys(expected).length} golden frames match. previews in ${PREVIEW_DIR}\n`,
  );
  app.exit(0);
});
