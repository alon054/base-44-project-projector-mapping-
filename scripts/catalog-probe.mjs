/**
 * Exercise the catalog end to end without the editor: main searches
 * archive.org, brings the first addable hit home, and a renderer loads the
 * result back through the `library:` protocol under the SHIPPING CSP.
 *
 * Usage:  npm run build:electron && npx electron scripts/catalog-probe.mjs [query]
 *
 * Needs the network. A refusal or a timeout is reported in words and exits
 * non-zero; nothing here is a gate number.
 */
import { app, BrowserWindow, net, protocol } from 'electron';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = require(join(ROOT, 'dist-electron', 'catalog.js'));

const QUERY = process.argv[2] ?? 'vj loops';

// `electron scripts/x.mjs` makes the script's directory the app path, and the
// library root hangs off it. Point it at the repo so the probe writes exactly
// where the app reads — `assets/library/` — and the app sees what it added.
app.setAppPath(ROOT);

protocol.registerSchemesAsPrivileged([
  { scheme: 'library', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

function fail(msg) {
  process.stderr.write(`PROBE FAILED: ${msg}\n`);
  app.exit(1);
}

app.whenReady().then(async () => {
  protocol.handle('library', async (request) => {
    const path = await catalog.resolveLibraryRequest(request.url);
    if (!path) return new Response('not in the library', { status: 404 });
    return net.fetch(`file://${encodeURI(path)}`);
  });

  const t0 = Date.now();
  const hits = await catalog.searchCatalog(QUERY);
  process.stdout.write(`search "${QUERY}": ${hits.length} hit(s) in ${Date.now() - t0} ms\n`);
  if (hits.length === 0) return fail('no hits — offline, or archive.org is not answering');
  const addable = hits.filter((h) => h.license !== null);
  const refused = hits.length - addable.length;
  process.stdout.write(`  ${addable.length} addable (CC0/CC-BY), ${refused} without a usable license (I-10)\n`);
  for (const h of hits.slice(0, 5)) {
    process.stdout.write(`  - ${h.identifier} [${h.kind}] ${h.license ?? 'NO LICENSE'} "${h.title}"\n`);
  }
  if (addable.length === 0) return fail('nothing addable in the first page');

  // Prefer an item that is a PACK with playable clips, and add a named clip of it.
  let pick = null;
  let clipName;
  for (const h of addable) {
    const files = await catalog.listCatalogFiles(h);
    if (!files.ok) {
      process.stdout.write(`  ${h.identifier}: ${files.reason}\n`);
      continue;
    }
    process.stdout.write(`  ${h.identifier}: ${files.clips.length} clip(s); first "${files.clips[0].label}" ${(files.clips[0].bytes / 1048576).toFixed(1)} MB thumb ${files.clips[0].thumbUrl}\n`);
    if (!pick || files.clips.length > 1) {
      pick = h;
      clipName = files.clips[Math.min(1, files.clips.length - 1)].name;
      if (files.clips.length > 1) break;
    }
  }
  if (!pick) return fail('no addable item had a playable clip');
  process.stdout.write(`adding ${pick.identifier} / ${clipName}…\n`);
  let last = 0;
  const t1 = Date.now();
  const result = await catalog.addFromCatalog(pick, (received, total) => {
    const pct = total > 0 ? Math.round((received / total) * 100) : 0;
    if (pct - last >= 20) {
      last = pct;
      process.stdout.write(`  ${pct}% (${(received / 1048576).toFixed(1)} MB)\n`);
    }
  }, clipName);
  if (!result.ok) return fail(`add refused: ${result.reason}`);
  const e = result.entry;
  process.stdout.write(
    `added ${e.id} in ${Date.now() - t1} ms: ${e.kind}, ${(e.bytes / 1048576).toFixed(1)} MB, ` +
      `${e.license.license}${e.license.attributionRequired ? ` (credit: ${e.license.attribution})` : ''}, ` +
      `loop ${e.loopSeconds ?? '-'} s\n  url ${e.url}\n  poster ${e.posterUrl ?? '-'}\n`,
  );

  // Now the renderer's side: a window under the shipping CSP fetches both URLs.
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadFile(join(ROOT, 'dist', 'output', 'index.html'));
  const probe = `
    (async () => {
      const out = {};
      for (const [k, u] of [['asset', ${JSON.stringify(e.url)}], ['poster', ${JSON.stringify(e.posterUrl ?? e.url)}]]) {
        try {
          const r = await fetch(u);
          const b = await r.arrayBuffer();
          out[k] = { status: r.status, bytes: b.byteLength, type: r.headers.get('content-type') };
        } catch (err) { out[k] = { error: String(err) }; }
      }
      try {
        const r = await fetch('library://assets/../../package.json');
        out.escape = { status: r.status };
      } catch (err) { out.escape = { error: String(err) }; }
      if (${JSON.stringify(e.kind)} === 'video') {
        out.decode = await new Promise((res) => {
          const v = document.createElement('video');
          v.muted = true; v.preload = 'metadata';
          const t = setTimeout(() => res({ error: 'timeout' }), 15000);
          v.onloadedmetadata = () => { clearTimeout(t); res({ width: v.videoWidth, height: v.videoHeight, duration: v.duration }); };
          v.onerror = () => { clearTimeout(t); res({ error: v.error ? v.error.code + ' ' + v.error.message : 'error' }); };
          v.src = ${JSON.stringify(e.url)};
        });
      }
      return out;
    })()`;
  const got = await win.webContents.executeJavaScript(probe);
  process.stdout.write(`renderer fetch via library:// → ${JSON.stringify(got)}\n`);
  if (got.asset?.status !== 200 || got.asset?.bytes !== e.bytes) return fail('the renderer could not load the asset through library://');
  if (got.poster?.status !== 200) return fail('the renderer could not load the poster through library://');
  if (got.escape?.status === 200) return fail('a path outside the library root was served');
  if (e.kind === 'video' && !(got.decode?.width > 0)) return fail(`the renderer could not decode the clip: ${JSON.stringify(got.decode)}`);
  process.stdout.write('PROBE OK\n');
  app.exit(0);
});
