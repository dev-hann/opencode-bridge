/**
 * OpenCode HTTP API client — dispatch only.
 *
 * Ported from Hermes hermes-opencode-bridge/api.py
 * Creates a session, injects rules, sends task, returns immediately.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ServerConfig } from "./server.js";
import { isRunning, waitUntilReady } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_FALLBACK_PATH = join(__dirname, "..", "rules", "opencode-bridge.md");

export interface DispatchParams {
  directory: string;
  task: string;
  title?: string;
}

export interface DispatchResult {
  status: "dispatched" | "error";
  session_id?: string;
  session_name?: string;
  web_ui?: string;
  directory?: string;
  message: string;
}

export async function dispatch(
  params: DispatchParams,
  config: ServerConfig,
  rulesPath?: string,
): Promise<DispatchResult> {
  const { directory, task, title } = params;

  // Check server is running
  if (!await isRunning(config)) {
    // Try to wait for boot (maybe lifecycle hook just started it)
    const ready = await waitUntilReady(config, 5);
    if (!ready) {
      return {
        status: "error",
        message: "OpenCode server is not running. Start it with: opencode serve",
      };
    }
  }

  const baseUrl = `http://localhost:${config.port}`;

  // Create session — directory goes in X-OpenCode-Directory header
  let sessionId = "";
  let sessionTitle = title ?? "";

  try {
    const sessionBody: Record<string, string> = {};
    if (title) sessionBody.title = title;

    const resp = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenCode-Directory": directory,
      },
      body: JSON.stringify(sessionBody),
    });

    const data = await resp.json() as Record<string, unknown>;
    sessionId = (data.id as string) ?? "";
    sessionTitle = (data.title as string) ?? sessionTitle;
  } catch (e) {
    return {
      status: "error",
      message: `Failed to create session: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!sessionId) {
    return {
      status: "error",
      message: "Server returned no session id.",
    };
  }

  // Load rules
  const rules = await loadRules(rulesPath);

  // Compose message: rules + task
  const messageText = rules
    ? `<system_rules>\n${rules}\n</system_rules>\n\n<task>\n${task}\n</task>`
    : task;

  // Send task via prompt_async (fire and forget)
  try {
    await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: messageText }],
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    return {
      status: "error",
      session_id: sessionId,
      message: `Session created but failed to send task: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return {
    status: "dispatched",
    session_id: sessionId,
    session_name: sessionTitle,
    web_ui: `http://localhost:${config.port}/session/${sessionId}`,
    directory,
    message: (
      `OpenCode session '${sessionTitle}' started.\n` +
      `Monitor: http://localhost:${config.port}/session/${sessionId}\n` +
      `Attach: opencode attach http://localhost:${config.port} --dir ${directory} --session ${sessionId}`
    ),
  };
}

/** Load collaboration rules from configured path or bundled fallback. */
async function loadRules(rulesPath?: string): Promise<string> {
  const path = rulesPath ?? RULES_FALLBACK_PATH;
  if (existsSync(path)) {
    try {
      return (await readFile(path, "utf-8")).trim();
    } catch {
      return "";
    }
  }
  return "";
}
