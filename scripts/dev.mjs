/**
 * Dev runner. Hand-rolled on purpose (C7): no third-party build tool between us
 * and the only thing Gate 0 tests. Starts Vite, waits for it, compiles the
 * Electron side with tsc, then launches Electron pointed at the dev server.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PORT = 5173;
const URL_BASE = `http://localhost:${PORT}`;

const children = [];
function run(cmd, args, opts = {}) {
  const c = spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  children.push(c);
  return c;
}
function shutdown(code = 0) {
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${URL_BASE}/output/index.html`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

run('npx', ['vite', '--port', String(PORT), '--strictPort']);

if (!(await waitForServer())) {
  console.error('[dev] vite did not come up');
  shutdown(1);
}

const tsc = run('npx', ['tsc', '-p', 'tsconfig.node.json']);
await new Promise((resolve) => tsc.on('exit', resolve));

const electron = run(require('electron'), ['.'], {
  env: { ...process.env, VITE_DEV_SERVER_URL: URL_BASE },
});
electron.on('exit', (code) => shutdown(code ?? 0));
