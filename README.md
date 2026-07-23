# hermes-opencode-bridge

A [Hermes Agent](https://github.com/NousResearch/hermes-agent) plugin that delegates **ALL code work** to [OpenCode](https://opencode.ai).

Hermes acts as the planner/reviewer; OpenCode acts as the coder. This plugin automates the handoff — server lifecycle, task dispatch, and rule injection — so you never have to manually orchestrate the two agents.

## How It Works

```
You: "Implement login API"
      │
      ▼
┌─────────────────────────────┐
│ Hermes (Planner/Reviewer)    │
│ - Writes design docs         │
│ - Breaks work into chunks    │
│ - Calls opencode_dispatch    │
└──────────┬──────────────────┘
           │  rules + task
           ▼
┌──────────────────────────────────────────────────────┐
│ OpenCode (Coder)                                      │
│ - Implements, tests, commits                          │
│ - Runs in serve mode (HTTP API)                       │
└──────────────────────────────────────────────────────┘

You monitor progress at http://localhost:4096
```

**Fire and forget** — Hermes dispatches the task and reports the session name + URL. You watch progress directly in the OpenCode web UI. Hermes does not poll or wait.

## Structure

```
hermes-opencode-bridge/
├── plugin.yaml                       # Manifest (kind: standalone)
├── __init__.py                       # register(ctx) — 1 tool + 2 hooks
├── server.py                         # Server lifecycle (start / health check / dedup)
├── api.py                            # HTTP client (dispatch + seed rules)
├── template/
│   └── hermes-opencode-bridge.md     # Default rules template (seed)
└── README.md
```

User rules are stored **outside** the plugin directory at `~/.hermes/opencode-bridge-rule.md`, so plugin updates/reinstalls never touch them.

## Three-Layer Rule Delivery

| Layer | Audience | Mechanism | When |
|-------|----------|-----------|------|
| **[A]** Hermes behavior rules | Hermes (LLM) | `pre_llm_call` hook injects a directive into the user message | When code keywords are detected (English + Korean) |
| **[B]** OpenCode work rules | OpenCode (LLM) | Rules prepended to the message body on each dispatch | Every `opencode_dispatch` call |
| **[C]** Server management | System | `on_session_start` hook starts OpenCode server in background | Session start |

This separation means:

- OpenCode works fine **standalone** — the plugin doesn't touch `~/.config/opencode/opencode.json`
- The collaboration rules only apply when Hermes dispatches work
- Other users get the delegation behavior automatically (no manual SOUL.md/memory setup)

## Watching OpenCode Work

The OpenCode server exposes a web UI. Open this URL while a task is running:

```
http://localhost:4096
```

You'll see OpenCode's reasoning, tool calls, file edits, and terminal output in real time.

The server is started automatically by the `on_session_start` hook, so the web UI is available from your first `opencode_dispatch` call.

## Tool

### `opencode_dispatch`

Sends a coding task to OpenCode via HTTP API. Creates a session, injects collaboration rules, and returns immediately with the session name and web UI URL.

```json
{
  "status": "dispatched",
  "session_id": "ses_abc123",
  "session_name": "Login API",
  "web_ui": "http://localhost:4096/session/ses_abc123",
  "message": "OpenCode session 'Login API' started.\nMonitor: http://localhost:4096/session/ses_abc123"
}
```

## Installation

### Prerequisites

1. **Hermes Agent** — [install](https://hermes-agent.nousresearch.com/docs)
2. **OpenCode** — see [opencode.ai](https://opencode.ai) for installation and authentication

### Install the plugin

```bash
# Install from GitHub (recommended)
hermes plugins install dev-hann/hermes-opencode-bridge --enable

# Or use the full URL:
# hermes plugins install https://github.com/dev-hann/hermes-opencode-bridge --enable
```

That's it — `hermes plugins install` handles cloning, placement, and enabling automatically.

Start a new session (tools and hooks apply on new sessions):

```bash
hermes
```

### Verify

```bash
hermes tools list | grep opencode
# Should show: ✓ enabled  opencode  🔌 Opencode
```

## Customizing Rules

The plugin uses a **seed pattern** for collaboration rules:

1. On the first `opencode_dispatch` call, `~/.hermes/opencode-bridge-rule.md` is created by copying the plugin's `template/hermes-opencode-bridge.md`.
2. From then on, `~/.hermes/opencode-bridge-rule.md` is read on every dispatch.
3. Edit it freely — the rules file lives outside the plugin directory, so plugin updates/reinstalls never overwrite it.

The bundled template covers:

- Git workflow (worktree isolation, conventional commits)
- Code quality (TDD, no `any` types, lint passing)
- Error handling (fix before moving on)
- Communication (concise summaries)

### OpenCode standalone usage

This plugin does **not** modify OpenCode's global config. When you run `opencode` directly (without Hermes), the collaboration rules are not loaded — OpenCode behaves normally.

## Requirements

- Python 3.10+ (bundled with Hermes Agent)
- OpenCode 1.0+ (serve mode)
- Hermes Agent (any recent version with plugin support)

## License

MIT
