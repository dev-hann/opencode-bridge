"""hermes-opencode-bridge — Delegate ALL code work to OpenCode.

Three-layer design:
  [A] Hermes behavior rules -> pre_llm_call hook (inject directive on code keywords)
  [B] OpenCode work rules   -> prepend to message body on dispatch (rules/hermes-collab.md)
  [C] Server lifecycle      -> on_session_start hook (auto-start in background)
"""

from __future__ import annotations

import logging
import os
import sys

# Add plugin directory to sys.path so sibling modules can be imported
_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
if _PLUGIN_DIR not in sys.path:
    sys.path.insert(0, _PLUGIN_DIR)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# [A] Hermes behavior rules — pre_llm_call hook
# ---------------------------------------------------------------------------

_CODE_KEYWORDS = {
    # --- English: code nouns ---
    "code", "function", "bug", "fix", "implement", "refactor", "error",
    "test", "develop", "build", "component", "script", "debug",
    "deploy", "package", "class", "method", "variable", "type",
    "api", "css", "html", "sql", "json", "yaml", "lint",
    # --- English: action verbs ---
    "write", "edit", "modify", "create", "make", "add", "remove",
    "delete", "update", "change", "improve", "optimize", "generate",
    # --- Korean: code nouns ---
    "코드", "함수", "버그", "구현", "리팩토링", "리팩터링", "테스트",
    "개발", "스크립트", "디버그", "빌드", "배포", "컴포넌트", "클래스",
    "메서드", "메소드", "변수", "타입", "에러", "오류", "로직",
    "모듈", "패키지",
    # --- Korean: action verbs ---
    "만들어", "만들어줘", "만들어봐", "작성", "작성해", "작성해줘",
    "고쳐", "고쳐줘", "수정", "수정해", "수정해줘", "추가", "추가해",
    "삭제", "삭제해", "변경", "변경해", "개선", "개선해",
    "최적화", "최적화해", "생성", "생성해", "구현해", "구현해줘",
    "리팩토링해",
    # --- Explicit bridge triggers ---
    "opencode", "오픈코드",
}

_DIRECTIVE = (
    "<opencode_bridge_directive>\n"
    "When a task requires writing, modifying, or implementing code, you MUST use the "
    "opencode_dispatch tool to delegate it to OpenCode. Do NOT edit code directly "
    "via write_file, patch, or terminal.\n"
    "Reading code (read_file, search_files), writing docs, and planning are fine to do directly.\n"
    "Break large tasks into 2-5 minute chunks and dispatch each one separately.\n"
    "After dispatching, report the session name and web UI URL from the result to the user. "
    "Then STOP — do NOT poll, sleep, check status, or wait for completion. "
    "The user monitors progress directly in OpenCode. Continue only when the user asks.\n"
    "</opencode_bridge_directive>"
)


def _on_pre_llm_call(user_message=None, **kw):
    """Inject the delegation directive into the user message when code keywords are detected."""
    if not user_message or not isinstance(user_message, str):
        return None
    msg_lower = user_message.lower()
    if not any(k in msg_lower for k in _CODE_KEYWORDS):
        return None
    return {"context": _DIRECTIVE}


# ---------------------------------------------------------------------------
# [C] Server lifecycle — on_session_start hook
# ---------------------------------------------------------------------------

def _on_session_start(session_id=None, model=None, platform=None, **kw):
    """Ensure the OpenCode server is running in the background on session start."""
    try:
        from server import ensure_server
        status = ensure_server()
        logger.info("opencode server: %s", status)
    except Exception as exc:
        logger.warning("server start failed: %s", exc)


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------

def _handle_dispatch(args, **kw):
    from api import dispatch
    return dispatch(
        directory=args.get("directory", ""),
        task=args.get("task", ""),
        title=args.get("title", ""),
    )


# ---------------------------------------------------------------------------
# check_fn
# ---------------------------------------------------------------------------

def _check_opencode():
    """Only expose tools when opencode is installed."""
    import shutil
    return shutil.which("opencode") is not None


# ---------------------------------------------------------------------------
# register
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    """Register the plugin — 1 tool + 2 hooks."""

    # -- Tools ----------------------------------------------------------

    ctx.register_tool(
        name="opencode_dispatch",
        toolset="opencode",
        schema={
            "name": "opencode_dispatch",
            "description": (
                "Dispatch a coding task to OpenCode (autonomous coding agent). "
                "This is the ONLY sanctioned path for code changes — do NOT use "
                "terminal/write_file/patch for code implementation. "
                "Break large tasks into 2-5 minute chunks before dispatching. "
                "Returns session info and web UI URL."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Absolute path to the project directory",
                    },
                    "task": {
                        "type": "string",
                        "description": "Detailed task description. A small, well-defined chunk (2-5 min of work).",
                    },
                    "title": {
                        "type": "string",
                        "description": "Optional session title for easy identification.",
                    },
                },
                "required": ["directory", "task"],
            },
        },
        handler=_handle_dispatch,
        check_fn=_check_opencode,
        description="Dispatch coding tasks to OpenCode.",
    )

    # -- Hooks ----------------------------------------------------------

    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)

    logger.info("hermes-opencode-bridge plugin registered (1 tool, 2 hooks)")
