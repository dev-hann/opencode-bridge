"""OpenCode server lifecycle management."""

from __future__ import annotations

import json
import logging
import os
import shutil
import signal
import subprocess
import time
import urllib.request

logger = logging.getLogger(__name__)

OPENCODE_PORT = 4096
OPENCODE_HOST = "0.0.0.0"
BASE_URL = f"http://localhost:{OPENCODE_PORT}"
_HEALTH_TIMEOUT = 3
_BOOT_WAIT = 15  # max seconds to wait for boot

def is_installed() -> bool:
    """Check if the opencode binary is available on PATH."""
    return shutil.which("opencode") is not None


def is_running() -> bool:
    """Health check — is the server responding?"""
    try:
        with urllib.request.urlopen(
            f"{BASE_URL}/global/health", timeout=_HEALTH_TIMEOUT
        ) as resp:
            data = json.loads(resp.read())
            return bool(data.get("healthy"))
    except Exception:
        return False


def _find_server_process() -> tuple[int, bool] | None:
    """Find a running `opencode serve` process.

    Uses pgrep + ps to find an `opencode serve` invocation and verifies
    that it was started with the expected --port and --hostname arguments.

    Works on both Linux and macOS (no /proc dependency).

    Returns:
        * (pid, True)  — a correctly-configured server is running
        * (pid, False) — a server is running but with wrong port/hostname
        * None         — no `opencode serve` process found
    """
    expected_port = str(OPENCODE_PORT)
    expected_host = str(OPENCODE_HOST)

    try:
        result = subprocess.run(
            ["pgrep", "-f", "opencode serve"],
            capture_output=True, text=True, timeout=5,
        )
        pids_raw = result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None

    if not pids_raw:
        return None

    for pid_str in pids_raw.splitlines():
        try:
            pid = int(pid_str.strip())
        except ValueError:
            continue

        # Get the full command line for this PID (portable across Linux/macOS).
        try:
            ps_result = subprocess.run(
                ["ps", "-p", str(pid), "-o", "command="],
                capture_output=True, text=True, timeout=5,
            )
            cmdline = ps_result.stdout.strip()
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue

        if not cmdline:
            continue

        args = cmdline.split()
        if len(args) < 2:
            continue
        # Match `opencode serve ...` (basename match so /usr/bin/opencode works)
        if os.path.basename(args[0]) != "opencode" or args[1] != "serve":
            continue

        # Validate port and hostname. Missing flags count as misconfigured
        # because we cannot guarantee they target our endpoint.
        port_ok = False
        host_ok = False
        for i, arg in enumerate(args[2:], start=2):
            if arg == "--port" and i + 1 < len(args):
                port_ok = args[i + 1] == expected_port
            elif arg.startswith("--port="):
                port_ok = arg.split("=", 1)[1] == expected_port
            elif arg == "--hostname" and i + 1 < len(args):
                host_ok = args[i + 1] == expected_host
            elif arg.startswith("--hostname="):
                host_ok = arg.split("=", 1)[1] == expected_host

        return (pid, port_ok and host_ok)

    return None


def ensure_server() -> str:
    """Start the server in the background if it is not already running.

    Strategy:
      1. Look for a running `opencode serve` process via _find_server_process().
      2. If one exists but with wrong port/hostname, kill it (SIGTERM).
      3. If no correctly-configured server is running, start a new one.

    Called from the on_session_start hook — never blocks.
    Returns a status string.
    """
    if not is_installed():
        logger.warning("opencode binary not found — skipping server start")
        return "opencode not installed"

    found = _find_server_process()

    # Kill a misconfigured server before starting a new one.
    status_prefix = "starting"
    if found is not None:
        pid, correct = found
        if correct:
            logger.info("opencode server already running (pid=%s)", pid)
            return f"already running (pid={pid})"
        # Misconfigured — kill it.
        try:
            os.kill(pid, signal.SIGTERM)
            logger.warning(
                "killed misconfigured opencode server (pid=%s); restarting", pid
            )
        except ProcessLookupError:
            pass
        # Give the kernel a moment to release the port.
        time.sleep(1.0)
        status_prefix = f"killed misconfigured server (pid={pid}), starting new one"

    cmd = [
        "opencode", "serve",
        "--port", str(OPENCODE_PORT),
        "--hostname", OPENCODE_HOST,
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,  # detach from parent process
    )
    logger.info("opencode server starting (pid=%s)", proc.pid)
    return f"{status_prefix} (pid={proc.pid})"


def wait_until_ready(timeout: int = _BOOT_WAIT) -> bool:
    """Wait until the server is ready. Called right before dispatch."""
    for _ in range(timeout):
        if is_running():
            return True
        time.sleep(1)
    return False
