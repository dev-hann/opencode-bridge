# opencode-bridge

An [OpenClaw](https://github.com/openclaw/openclaw) plugin that delegates **ALL code work** to [OpenCode](https://opencode.ai).

OpenClaw acts as the planner/reviewer; OpenCode acts as the coder. This plugin automates the handoff — server lifecycle, task dispatch, and rule injection — so you never have to manually orchestrate the two agents.

## How It Works

```
You: "Implement login API"
      │
      ▼
┌─────────────────────────────┐
│ OpenClaw (Planner/Reviewer)  │
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

**Fire and forget** — OpenClaw dispatches the task and reports the session name + URL. You watch progress directly in the OpenCode web UI. OpenClaw does not poll or wait.

## Three-Layer Design

| Layer | Audience | Mechanism | When |
|-------|----------|-----------|------|
| **[A]** Behavior rules | OpenClaw (LLM) | `before_agent_reply` hook injects directive | When code keywords are detected (English + Korean) |
| **[B]** OpenCode work rules | OpenCode (LLM) | Rules prepended to the message body on dispatch | Every `opencode_dispatch` call |
| **[C]** Server management | System | `gateway:startup` hook starts OpenCode server | Gateway startup |

## Installation

### Prerequisites

1. **OpenClaw** — [install](https://docs.openclaw.ai)
2. **OpenCode** — see [opencode.ai](https://opencode.ai)

### Install the plugin

```bash
# From local path (development)
openclaw plugins install --link ./opencode-bridge

# From git
openclaw plugins install git:github.com/dev-hann/hermes-opencode-bridge
```

### Configuration

```json5
{
  plugins: {
    entries: {
      "opencode-bridge": {
        enabled: true,
        config: {
          port: 4096,
          hostname: "0.0.0.0",
          rulesFile: "~/.openclaw/opencode-bridge-rules.md"  // optional
        }
      }
    }
  }
}
```

## Customizing Rules

The plugin ships with bundled rules in `rules/opencode-bridge.md`. To customize:

1. Copy `rules/opencode-bridge.md` to your preferred location
2. Set `rulesFile` in plugin config to point to it

## Tool Policy

The `opencode_dispatch` tool is registered by the plugin, but **it is filtered out by the `coding` tool profile** (the default for local setups). To make the tool visible to the model, add it to `tools.alsoAllow` in your Gateway config:

```json5
{
  tools: {
    profile: "coding",
    alsoAllow: ["opencode_dispatch"],
  },
}
```

Without this, the plugin loads successfully (hooks fire, directive is injected), but the model never receives the `opencode_dispatch` tool schema, so it cannot actually call it.

If you use `tools.profile: "full"` or have no profile set, no extra config is needed.

## Tool

### `opencode_dispatch`

```typescript
opencode_dispatch({
  directory: "/path/to/project",
  task: "Fix login validation in LoginForm component",
  title: "fix-login-validation"  // optional
})
```

Returns:

```json
{
  "status": "dispatched",
  "session_id": "ses_abc123",
  "session_name": "fix-login-validation",
  "web_ui": "http://localhost:4096/session/ses_abc123",
  "message": "OpenCode session 'fix-login-validation' started.\nMonitor: http://localhost:4096/session/ses_abc123\nAttach: opencode attach http://localhost:4096 --dir /path/to/project --session ses_abc123"
}
```

## Migration from Hermes

This plugin is a direct port of [hermes-opencode-bridge](https://github.com/dev-hann/hermes-opencode-bridge), adapted for the OpenClaw plugin SDK.

| Hermes (Python) | OpenClaw (TypeScript) |
|-----------------|----------------------|
| `__init__.py` → `pre_llm_call` hook | `before_agent_reply` hook |
| `__init__.py` → `on_session_start` hook | `gateway:startup` hook |
| `server.py` | `src/server.ts` |
| `api.py` | `src/api.ts` |
| `rules/hermes-opencode-bridge.md` | `rules/opencode-bridge.md` |

## License

MIT
