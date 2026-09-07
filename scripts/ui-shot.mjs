/**
 * Screenshot the editor window without a driver dependency: launch the built
 * app with Chromium's remote-debugging port and talk CDP over Node's own
 * WebSocket. For looking at the UI, not for tests.
 *
 * Usage:  npm run build && node scripts/ui-shot.mjs <outDir> [step ...]
 *   step = "shot:<name>"            full-page PNG of the editor
 *        | "eval:<js>"              run JS in the editor page (e.g. click a button)
 *        | "wait:<ms>"
 *        | "size:<w>x<h>"           resize the editor window
 *        | "scroll:<y>"             scroll the page
 *        | "vshot:<name>"           viewport-only PNG at the current scroll
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9333;
const [outDir = '/tmp/ui-shots', ...steps] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

import { execSync } from 'node:child_process';
// A previous capture's instance still dying would answer /json and then hang
// up on us. Wait for it to be gone before launching ours.
for (let i = 0; i < 40; i++) {
  let alive = '';
  try {
    // Match the Electron binary, not this script's own argv (pgrep -f sees itself).
    alive = execSync(`pgrep -f "MacOS/Electron --remote-debugging-port=${PORT}" || true`).toString().trim();
  } catch {
    alive = '';
  }
  if (alive === '') break;
  await new Promise((r) => setTimeout(r, 250));
}

const bin = join(ROOT, 'node_modules', '.bin', 'electron');
const child = spawn(bin, [`--remote-debugging-port=${PORT}`, '.'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const log = [];
child.stdout.on('data', (d) => log.push(String(d)));
child.stderr.on('data', (d) => log.push(String(d)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return res.json();
}

let editor = null;
for (let i = 0; i < 60 && !editor; i++) {
  await sleep(500);
  try {
    editor = (await targets()).find((t) => t.type === 'page' && /\/editor\//.test(t.url));
  } catch {
    /* not up yet */
  }
}
if (!editor) {
  console.error('no editor page found\n' + log.join(''));
  child.kill('SIGTERM');
  process.exit(1);
}

const ws = new WebSocket(editor.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
ws.onclose = () => process.stderr.write('websocket closed by the app\n');
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((r, j) => {
    const id = ++seq;
    const t = setTimeout(() => {
      pending.delete(id);
      j(new Error(`${method} timed out`));
    }, 20_000);
    pending.set(id, (m) => {
      clearTimeout(t);
      r(m);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');
await sleep(2500); // let React settle and the first scene apply

async function shot(name) {
  const { result } = await send('Page.getLayoutMetrics');
  const height = Math.ceil(result.cssContentSize?.height ?? result.contentSize.height);
  const width = Math.ceil(result.cssContentSize?.width ?? result.contentSize.width);
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  const f = join(outDir, `${name}.png`);
  writeFileSync(f, Buffer.from(r.result.data, 'base64'));
  console.log(`shot ${f} (${width}x${height})`);
}

process.on('exit', (code) => process.stderr.write(`exit ${code}\n`));
process.on('unhandledRejection', (e) => process.stderr.write(`unhandled: ${e?.stack ?? e}\n`));
for (const step of steps) {
  const [kind, ...rest] = step.split(':');
  const arg = rest.join(':');
  process.stderr.write(`· ${kind} ${arg.slice(0, 60)}\n`);
  if (kind === 'shot') await shot(arg || `shot-${Date.now()}`);
  else if (kind === 'wait') await sleep(Number(arg) || 500);
  else if (kind === 'eval') {
    const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
    console.log(`eval → ${JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? null)}`);
    await sleep(400);
  } else if (kind === 'scroll') {
    await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${Number(arg) || 0})` });
    await sleep(300);
  } else if (kind === 'vshot') {
    // The viewport only, at the current scroll — for a page too tall to read
    // whole. `captureBeyondViewport` forces a paint even when the window is
    // behind another; a plain viewport capture waits for a frame that an
    // occluded window never produces.
    const { result } = await send('Page.getLayoutMetrics');
    const vv = result.cssVisualViewport ?? result.visualViewport;
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: vv.pageY, width: vv.clientWidth, height: vv.clientHeight, scale: 1 },
    });
    const f = join(outDir, `${arg || `v-${Date.now()}`}.png`);
    writeFileSync(f, Buffer.from(r.result.data, 'base64'));
    console.log(`vshot ${f}`);
  } else if (kind === 'size') {
    const [w, h] = arg.split('x').map(Number);
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
  }
}

ws.close();
child.kill('SIGTERM');
const errors = log.join('').split('\n').filter((l) => /error|uncaught/i.test(l) && !/instrument clock/.test(l));
if (errors.length) console.log('renderer/main errors:\n' + errors.join('\n'));
process.exit(0);
