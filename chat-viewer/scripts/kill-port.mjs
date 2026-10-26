/**
 * Frees the API and Vite dev ports before `npm run dev` starts.
 *
 * Rationale: a previous run that was killed with SIGKILL (or a crashed tsx
 * child) leaves a process holding port 3001. The server then exits with
 * EADDRINUSE, `concurrently -k` tears down Vite, and `npm run dev` appears
 * to fail for no reason. This clears the stale listeners first.
 *
 * Only processes owned by the current user are touched.
 */
import { execFileSync } from 'node:child_process';

const PORTS = [Number(process.env.PORT) || 3001, Number(process.env.VITE_PORT) || 5173];

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** Return PIDs listening on `port`, using whichever tool is available. */
function listenersOn(port) {
  const pids = new Set();

  // lsof is the most portable option across Linux and macOS.
  for (const line of run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).split('\n')) {
    const pid = Number(line.trim());
    if (pid > 0) pids.add(pid);
  }

  if (pids.size === 0) {
    // Fallback for minimal systems that ship iproute2 but not lsof.
    const out = run('ss', ['-tlnpH', `sport = :${port}`]);
    for (const m of out.matchAll(/pid=(\d+)/g)) {
      const pid = Number(m[1]);
      if (pid > 0) pids.add(pid);
    }
  }

  return [...pids].filter((pid) => pid !== process.pid);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

for (const port of PORTS) {
  const pids = listenersOn(port);
  if (pids.length === 0) continue;

  for (const pid of pids) {
    console.log(`[kill-port] Freeing port ${port} (stale pid ${pid})`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone or not ours */
    }
  }

  // Give the process a moment to release the socket, then force it.
  await sleep(400);
  for (const pid of pids) {
    if (!alive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
      console.log(`[kill-port] pid ${pid} did not exit on SIGTERM; sent SIGKILL`);
    } catch {
      /* ignore */
    }
  }
}
