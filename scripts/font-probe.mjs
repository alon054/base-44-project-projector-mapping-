/**
 * A pixel diff between two renders of the whole golden suite.
 *
 * Written for one question the golden suite structurally cannot answer. It
 * stores 43 hashes and no reference images, so when three cases changed after a
 * macOS update it could say *that* they differed and never *where* — and the
 * pre-update previews had already been overwritten by the run that found it.
 * A hash reports a verdict where it could report a value (A14).
 *
 * This renders the suite twice and reports, per case, the count and bounding
 * box of differing pixels. Text rasterization is perturbed with Chromium's own
 * switches (`--disable-lcd-text`, `--disable-font-subpixel-positioning`), which
 * change how glyphs are rasterized and nothing else — the same class of change
 * an OS update makes — so the perturbation is applied WITHOUT touching a line
 * of engine source.
 *
 * Usage (each dump is its own process, because the switches are per-process):
 *   npx electron scripts/font-probe.mjs --dump .probe/a
 *   PROBE_ALT_TEXT=1 npx electron scripts/font-probe.mjs --dump .probe/b
 *   npx electron scripts/font-probe.mjs --diff .probe/a .probe/b
 */
import { app, BrowserWindow, nativeImage } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'dist', 'golden', 'index.html');

// Must be appended before `ready`. These two change glyph rasterization only.
if (process.env.PROBE_ALT_TEXT === '1') {
  app.commandLine.appendSwitch('disable-lcd-text');
  app.commandLine.appendSwitch('disable-font-subpixel-positioning');
}

const argv = process.argv.slice(2);
const mode = argv[0];

async function dump(outDir) {
  if (!existsSync(PAGE)) {
    process.stderr.write(`not built: ${PAGE}\nrun \`npm run build:web\` first\n`);
    app.exit(1);
    return;
  }
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: false,
      ...(process.env.PROBE_MODE
        ? { preload: join(ROOT, 'scripts', 'font-probe-preload.js'), contextIsolation: false, sandbox: false }
        : {}),
    },
  });
  await win.loadFile(PAGE);
  const results = await win.webContents.executeJavaScript('window.__golden');
  mkdirSync(outDir, { recursive: true });
  for (const r of results) {
    writeFileSync(
      join(outDir, `${r.name.replace(/[^\w.@-]/g, '_')}.png`),
      Buffer.from(r.png.split(',')[1], 'base64'),
    );
  }
  process.stdout.write(
    `dumped ${results.length} cases -> ${outDir}` +
      `${process.env.PROBE_ALT_TEXT === '1' ? '  [alt text rasterization]' : ''}` +
      `${process.env.PROBE_MODE ? `  [text perturbation: ${process.env.PROBE_MODE}]` : ''}\n`,
  );
  app.exit(0);
}

/** Decode a PNG to raw RGBA via Electron's own decoder — no new dependency. */
function decode(file) {
  const img = nativeImage.createFromBuffer(readFileSync(file));
  const { width, height } = img.getSize();
  return { buf: img.getBitmap(), width, height };
}

function diffPair(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    return { error: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  const { width, height } = a;
  let count = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const rows = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        a.buf[i] !== b.buf[i] ||
        a.buf[i + 1] !== b.buf[i + 1] ||
        a.buf[i + 2] !== b.buf[i + 2] ||
        a.buf[i + 3] !== b.buf[i + 3]
      ) {
        count++;
        const row = rows[y] ?? (rows[y] = { x0: x, x1: x });
        if (x < row.x0) row.x0 = x;
        if (x > row.x1) row.x1 = x;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return count === 0
    ? { count: 0, width, height, rows: [] }
    : { count, width, height, x0, y0, x1, y1, rows };
}

/**
 * Split a diff into clusters separated by blank horizontal bands, then bound
 * each one. One box around every difference in a frame with two labels at
 * opposite corners is mostly untouched frame — and an exclusion that wide stops
 * excluding text and starts excluding the thing under test.
 */
function cluster(d, gap = 8) {
  const bands = [];
  let cur = null;
  for (let y = 0; y < d.height; y++) {
    const r = d.rows[y];
    if (!r) {
      if (cur && y - cur.lastY > gap) { bands.push(cur); cur = null; }
      continue;
    }
    if (!cur) cur = { y0: y, lastY: y, x0: r.x0, x1: r.x1 };
    else { cur.lastY = y; cur.x0 = Math.min(cur.x0, r.x0); cur.x1 = Math.max(cur.x1, r.x1); }
  }
  if (cur) bands.push(cur);
  return bands.map((b) => ({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.lastY }));
}

function diff(dirA, dirB) {
  const names = readdirSync(dirA).filter((f) => f.endsWith('.png'));
  const moved = [];
  for (const f of names) {
    const bf = join(dirB, f);
    if (!existsSync(bf)) {
      process.stdout.write(`  ${f}: present in ${dirA} and absent from ${dirB}\n`);
      continue;
    }
    const d = diffPair(decode(join(dirA, f)), decode(bf));
    if (d.error) {
      process.stdout.write(`  ${f}: ERROR ${d.error}\n`);
      continue;
    }
    if (d.count > 0) moved.push([f.replace(/\.png$/, ''), d]);
  }
  process.stdout.write(`cases compared: ${names.length}, cases differing: ${moved.length}\n`);
  for (const [n, d] of moved) {
    const pct = ((d.count / (d.width * d.height)) * 100).toFixed(4);
    // normalized and centre-based: the exact shape `GoldenCase.region` uses
    const cx = (d.x0 + d.x1 + 1) / 2 / d.width;
    const cy = (d.y0 + d.y1 + 1) / 2 / d.height;
    const w = (d.x1 - d.x0 + 1) / d.width;
    const h = (d.y1 - d.y0 + 1) / d.height;
    process.stdout.write(
      `  ${n}: ${d.count} px (${pct}%) bbox x[${d.x0}..${d.x1}] y[${d.y0}..${d.y1}]\n` +
        `      normalized { x: ${cx.toFixed(6)}, y: ${cy.toFixed(6)}, ` +
        `width: ${w.toFixed(6)}, height: ${h.toFixed(6)} }\n`,
    );
    const M = 4; // margin, so a rect is not sized to today's exact glyphs
    for (const c of cluster(d)) {
      const bx0 = Math.max(0, c.x0 - M), bx1 = Math.min(d.width - 1, c.x1 + M);
      const by0 = Math.max(0, c.y0 - M), by1 = Math.min(d.height - 1, c.y1 + M);
      const ncx = (bx0 + bx1 + 1) / 2 / d.width, ncy = (by0 + by1 + 1) / 2 / d.height;
      const nw = (bx1 - bx0 + 1) / d.width, nh = (by1 - by0 + 1) / d.height;
      const share = (((bx1 - bx0 + 1) * (by1 - by0 + 1)) / (d.width * d.height) * 100).toFixed(3);
      process.stdout.write(
        `      cluster +${M}px x[${bx0}..${bx1}] y[${by0}..${by1}] = ${share}% -> ` +
          `{ x: ${ncx.toFixed(6)}, y: ${ncy.toFixed(6)}, width: ${nw.toFixed(6)}, height: ${nh.toFixed(6)} }\n`,
      );
    }
  }
  if (moved.length === 0) process.stdout.write('  (no case differs — every pixel identical)\n');
  app.exit(0);
}

app.whenReady().then(() => {
  if (mode === '--dump') return dump(resolve(ROOT, argv[1] ?? '.probe/out'));
  if (mode === '--diff') return diff(resolve(ROOT, argv[1]), resolve(ROOT, argv[2]));
  process.stderr.write('usage: --dump <dir> | --diff <dirA> <dirB>\n');
  app.exit(1);
  return undefined;
});
