/**
 * opencode-bridge — Delegate ALL code work to OpenCode.
 *
 * Ported from Hermes hermes-opencode-bridge (Python) to OpenClaw plugin (TypeScript).
 *
 * Three-layer design (same as Hermes):
 *   [A] Behavior rules    → before_prompt_build hook (inject directive on code keywords)
 *   [B] OpenCode work rules → prepend to message body on dispatch
 *   [C] Server lifecycle  → gateway_start hook (auto-start in background)
 */

import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { ensureServer, type ServerConfig } from "./server.js";
import { dispatch } from "./api.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPluginEntry = any;

// ---------------------------------------------------------------------------
// [A] Behavior rules — inject directive when code keywords are detected
// ---------------------------------------------------------------------------

const CODE_KEYWORDS = [
  // English: code nouns
  "code", "function", "bug", "fix", "implement", "refactor", "error",
  "test", "develop", "build", "component", "script", "debug",
  "deploy", "package", "class", "method", "variable", "type",
  "api", "css", "html", "sql", "json", "yaml", "lint",
  // English: action verbs
  "write", "edit", "modify", "create", "make", "add", "remove",
  "delete", "update", "change", "improve", "optimize", "generate",
  // Korean: code nouns
  "코드", "함수", "버그", "구현", "리팩토링", "리팩터링", "테스트",
  "개발", "스크립트", "디버그", "빌드", "배포", "컴포넌트", "클래스",
  "메서드", "메소드", "변수", "타입", "에러", "오류", "로직",
  "모듈", "패키지",
  // Korean: action verbs
  "만들어", "만들어줘", "만들어봐", "작성", "작성해", "작성해줘",
  "고쳐", "고쳐줘", "수정", "수정해", "수정해줘", "추가", "추가해",
  "삭제", "삭제해", "변경", "변경해", "개선", "개선해",
  "최적화", "최적화해", "생성", "생성해", "구현해", "구현해줘",
  "리팩토링해",
  // Explicit bridge triggers
  "opencode", "오픈코드",
] as const;

const DIRECTIVE = [
  "<opencode_bridge_directive>",
  "When a task requires writing, modifying, or implementing code, you MUST use the",
  "opencode_dispatch tool to delegate it to OpenCode. Do NOT edit code directly",
  "via write, edit, or terminal.",
  "Reading code (read), writing docs, and planning are fine to do directly.",
  "Break large tasks into 2-5 minute chunks and dispatch each one separately.",
  "After dispatching, report the session name, web UI URL, AND the TUI attach command",
  "to the user. The attach command must use the directory and session_id from the",
  "result, formatted exactly as:",
  "`opencode attach http://localhost:4096 --dir <directory> --session <session_id>`",
  "— the user copies this to join via terminal.",
  "Then STOP — do NOT poll, sleep, check status, or wait for completion.",
  "The user monitors progress directly in OpenCode. Continue only when the user asks.",
  "</opencode_bridge_directive>",
].join("\n");

function hasCodeKeyword(message: string): boolean {
  const lower = message.toLowerCase();
  return CODE_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry: AnyPluginEntry = definePluginEntry({
  id: "opencode-bridge",
  name: "OpenCode Bridge",
  description:
    "Delegate ALL code work to OpenCode. Manages server lifecycle, injects collaboration rules, and dispatches tasks via HTTP API.",

  register(api) {
    // -- Config ----------------------------------------------------------

    const getConfig = (): ServerConfig => {
      const raw = api.config as Record<string, unknown> | undefined;
      return {
        port: (raw?.port as number) ?? 4096,
        hostname: (raw?.hostname as string) ?? "0.0.0.0",
      };
    };

    const getRulesPath = (): string | undefined => {
      const raw = api.config as Record<string, unknown> | undefined;
      const val = raw?.rulesFile as string | undefined;
      return val || undefined;
    };

    // -- [C] Server lifecycle: start on Gateway startup ----------------

    api.on("gateway_start", async () => {
      const config = getConfig();
      const status = await ensureServer(config);
      api.logger?.info?.(`opencode server: ${status}`);
    });

    // -- [A] Behavior rules: inject directive on code keywords ----------
    // Use before_prompt_build to prepend context when code keywords detected

    api.on("before_prompt_build", (event) => {
      const userMessage = event.prompt ?? "";
      if (!hasCodeKeyword(userMessage)) return;

      return {
        prependContext: DIRECTIVE,
      };
    });

    // -- Tool: opencode_dispatch ----------------------------------------

    api.registerTool({
      name: "opencode_dispatch",
      label: "OpenCode Dispatch",
      description:
        "Dispatch a coding task to OpenCode (autonomous coding agent). " +
        "This is the ONLY sanctioned path for code changes — do NOT use " +
        "terminal/write/edit for code implementation. " +
        "Break large tasks into 2-5 minute chunks before dispatching. " +
        "Returns session info and web UI URL.",
      parameters: Type.Object({
        directory: Type.String({
          description: "Absolute path to the project directory",
        }),
        task: Type.String({
          description: "Detailed task description. A small, well-defined chunk (2-5 min of work).",
        }),
        title: Type.Optional(Type.String({
          description: "Optional session title for easy identification.",
        })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const config = getConfig();
        const rulesPath = getRulesPath();
        const result = await dispatch(
          {
            directory: params.directory as string,
            task: params.task as string,
            title: params.title as string | undefined,
          },
          config,
          rulesPath,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          details: result,
        };
      },
    });
  },
});

export default entry;
