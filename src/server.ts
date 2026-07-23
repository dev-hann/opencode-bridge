/**
 * OpenCode server lifecycle management.
 *
 * Ported from Hermes hermes-opencode-bridge/server.py
 * Handles: install check, health check, process discovery, auto-start.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

const execAsync = promisify(execCb);

export interface ServerConfig {
  port: number;
  hostname: string;
}

const DEFAULT_CONFIG: ServerConfig = {
  port: 4096,
  hostname: "0.0.0.0",
};

const HEALTH_TIMEOUT_MS = 3000;
const BOOT_WAIT_MAX = 15;

/** Check if the opencode binary is available on PATH. */
export async function isInstalled(): Promise<boolean> {
  try {
    await execAsync("which opencode");
    return true;
  } catch {
    return false;
  }
}

/** Health check — is the OpenCode server responding? */
export async function isRunning(config: ServerConfig = DEFAULT_CONFIG): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const resp = await fetch(`http://localhost:${config.port}/global/health`, {
      signal: controller.signal,
    });
    const data = await resp.json() as Record<string, unknown>;
    return Boolean(data.healthy);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

interface ProcessInfo {
  pid: number;
  correct: boolean;
}

/**
 * Find a running `opencode serve` process.
 * Returns (pid, correct) or null if none found.
 */
async function findServerProcess(config: ServerConfig): Promise<ProcessInfo | null> {
  const expectedPort = String(config.port);
  const expectedHost = config.hostname;

  let pidsRaw: string;
  try {
    const { stdout } = await execAsync("pgrep -f 'opencode serve'", { timeout: 5000 });
    pidsRaw = stdout.trim();
  } catch {
    return null;
  }

  if (!pidsRaw) return null;

  for (const pidStr of pidsRaw.split("\n")) {
    const pid = parseInt(pidStr.trim(), 10);
    if (isNaN(pid)) continue;

    let cmdline: string;
    try {
      const { stdout } = await execAsync(`ps -p ${pid} -o command=`, { timeout: 5000 });
      cmdline = stdout.trim();
    } catch {
      continue;
    }

    if (!cmdline) continue;

    const args = cmdline.split(/\s+/);
    if (args.length < 2) continue;

    // Match `opencode serve ...`
    const base = args[0]!.split("/").pop()!;
    if (base !== "opencode" || args[1] !== "serve") continue;

    let portOk = false;
    let hostOk = false;
    for (let i = 2; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--port" && i + 1 < args.length) {
        portOk = args[i + 1] === expectedPort;
      } else if (arg.startsWith("--port=")) {
        portOk = arg.split("=")[1] === expectedPort;
      } else if (arg === "--hostname" && i + 1 < args.length) {
        hostOk = args[i + 1] === expectedHost;
      } else if (arg.startsWith("--hostname=")) {
        hostOk = arg.split("=")[1] === expectedHost;
      }
    }

    return { pid, correct: portOk && hostOk };
  }

  return null;
}

/**
 * Ensure the OpenCode server is running in the background.
 * Kills misconfigured servers and starts a new one if needed.
 */
export async function ensureServer(config: ServerConfig = DEFAULT_CONFIG): Promise<string> {
  const installed = await isInstalled();
  if (!installed) {
    return "opencode not installed";
  }

  const found = await findServerProcess(config);

  if (found) {
    if (found.correct) {
      return `already running (pid=${found.pid})`;
    }
    // Kill misconfigured server
    try {
      process.kill(found.pid, "SIGTERM");
    } catch {
      // already dead
    }
    await sleep(1000);
  }

  // Start new server
  const cmd = [
    "opencode", "serve",
    "--port", String(config.port),
    "--hostname", config.hostname,
  ];
  const child = spawn(cmd[0]!, cmd.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return `starting (pid=${child.pid})`;
}

/** Wait until the server is ready, up to timeout seconds. */
export async function waitUntilReady(
  config: ServerConfig = DEFAULT_CONFIG,
  timeoutSec: number = BOOT_WAIT_MAX,
): Promise<boolean> {
  for (let i = 0; i < timeoutSec; i++) {
    if (await isRunning(config)) return true;
    await sleep(1000);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
