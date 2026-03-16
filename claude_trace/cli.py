"""claude_trace CLI — Launch Claude Code with LiteLLM proxy tracing + live visualizer."""

import argparse
import os
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from datetime import datetime
from pathlib import Path

# ANSI colors
CYAN = "\033[0;36m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
RED = "\033[0;31m"
NC = "\033[0m"


def log_info(msg):
    print(f"{CYAN}[claude_trace]{NC} {msg}")


def log_ok(msg):
    print(f"{GREEN}[claude_trace]{NC} {msg}")


def log_warn(msg):
    print(f"{YELLOW}[claude_trace]{NC} {msg}")


def log_error(msg):
    print(f"{RED}[claude_trace]{NC} {msg}")


def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def kill_port(port):
    """Kill any process listening on the given port."""
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True, timeout=5,
        )
        pids = result.stdout.strip().split("\n")
        for pid in pids:
            if pid.strip():
                os.kill(int(pid.strip()), signal.SIGTERM)
        time.sleep(0.5)
    except Exception:
        pass


def wait_for_health(port, timeout=15):
    """Wait for the LiteLLM proxy to be healthy."""
    import urllib.request
    import urllib.error

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            req = urllib.request.Request(f"http://localhost:{port}/health")
            with urllib.request.urlopen(req, timeout=2):
                return True
        except (urllib.error.URLError, ConnectionError, OSError):
            time.sleep(0.5)
    return False


def find_config():
    """Find config.yaml bundled with the package."""
    pkg_dir = Path(__file__).parent
    config = pkg_dir / "config.yaml"
    if config.is_file():
        return str(config)
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Launch Claude Code with API tracing and live visualization",
        usage="claude_trace [options] [-- claude_args...]",
    )
    parser.add_argument(
        "--port", type=int, default=4000,
        help="LiteLLM proxy port (default: 4000)",
    )
    parser.add_argument(
        "--viz-port", type=int, default=8899,
        help="Visualizer server port (default: 8899)",
    )
    parser.add_argument(
        "--trace-dir", type=str, default=None,
        help="Directory to store trace files (default: current directory)",
    )
    parser.add_argument(
        "--no-browser", action="store_true",
        help="Don't auto-open the browser",
    )
    parser.add_argument(
        "--no-viz", action="store_true",
        help="Don't start the visualizer server",
    )
    parser.add_argument(
        "--config", type=str, default=None,
        help="Custom LiteLLM config.yaml path",
    )
    parser.add_argument(
        "claude_args", nargs="*",
        help="Arguments to pass to claude CLI",
    )

    args = parser.parse_args()

    # ─── Resolve paths ──────────────────────────────────────────────
    trace_dir = Path(args.trace_dir).resolve() if args.trace_dir else Path.cwd()
    trace_dir.mkdir(parents=True, exist_ok=True)

    config_file = args.config or find_config()
    if not config_file or not Path(config_file).is_file():
        log_error("Config file not found! Use --config to specify one.")
        sys.exit(1)

    # ─── Check API key ──────────────────────────────────────────────
    if not os.environ.get("ANTHROPIC_API_KEY"):
        env_file = Path.home() / ".claude_trace.env"
        if env_file.is_file():
            log_info(f"Loading API key from {env_file}...")
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ[key.strip()] = value.strip().strip("'\"")

    if not os.environ.get("ANTHROPIC_API_KEY"):
        log_error("ANTHROPIC_API_KEY is not set!")
        log_error("Set it via:")
        log_error("  1. export ANTHROPIC_API_KEY='sk-...'")
        log_error(f"  2. Add it to ~/.claude_trace.env")
        sys.exit(1)

    # ─── Check prerequisites ────────────────────────────────────────
    for cmd in ["litellm", "claude"]:
        if not _which(cmd):
            log_error(f"'{cmd}' not found! Please install it first.")
            sys.exit(1)

    # ─── Kill existing process on proxy port ────────────────────────
    if is_port_in_use(args.port):
        log_warn(f"Port {args.port} is in use. Stopping existing process...")
        kill_port(args.port)
        time.sleep(0.5)

    # ─── Generate timestamped trace file ────────────────────────────
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    trace_file = trace_dir / f"traces_{timestamp}.jsonl"
    os.environ["CLAUDE_TRACE_FILE"] = str(trace_file)

    log_info(f"Trace file: {trace_file}")

    # ─── Track child processes for cleanup ──────────────────────────
    litellm_proc = None
    viz_server = None

    def cleanup(signum=None, frame=None):
        if litellm_proc and litellm_proc.poll() is None:
            log_info("Stopping LiteLLM Proxy...")
            litellm_proc.terminate()
            try:
                litellm_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                litellm_proc.kill()
            log_ok("LiteLLM Proxy stopped.")
        if viz_server:
            log_info("Stopping visualizer server...")
            viz_server.shutdown()

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    try:
        # ─── Start LiteLLM Proxy ───────────────────────────────────
        log_info(f"Starting LiteLLM Proxy on port {args.port}...")
        litellm_log = trace_dir / f"litellm_{timestamp}.log"
        litellm_proc = subprocess.Popen(
            ["litellm", "--config", config_file, "--port", str(args.port)],
            stdout=open(litellm_log, "w"),
            stderr=subprocess.STDOUT,
            env=os.environ.copy(),
        )

        log_info("Waiting for proxy to be ready...")
        if not wait_for_health(args.port, timeout=15):
            if litellm_proc.poll() is not None:
                log_error("LiteLLM Proxy failed to start. Log:")
                try:
                    print(litellm_log.read_text()[-2000:])
                except Exception:
                    pass
            else:
                log_error("LiteLLM Proxy did not become healthy within 15s.")
                log_error(f"Check log: {litellm_log}")
            cleanup()
            sys.exit(1)

        log_ok(f"LiteLLM Proxy is ready! (PID {litellm_proc.pid})")

        # ─── Start Visualizer Server ───────────────────────────────
        trace_basename = trace_file.name
        viz_url = (
            f"http://localhost:{args.viz_port}"
            f"/?file=/traces/{trace_basename}&live=true"
        )

        if not args.no_viz:
            from claude_trace.server import start_server

            if is_port_in_use(args.viz_port):
                kill_port(args.viz_port)
                time.sleep(0.5)

            viz_server, viz_thread = start_server(
                port=args.viz_port,
                trace_dir=str(trace_dir),
                quiet=True,
            )
            log_ok(f"Visualizer live at: {viz_url}")

            # ─── Auto-open browser ─────────────────────────────────
            if not args.no_browser:
                try:
                    webbrowser.open(viz_url)
                    log_ok("Browser opened with live trace view.")
                except Exception:
                    log_warn(f"Could not open browser. Open manually: {viz_url}")

        # ─── Launch Claude Code ─────────────────────────────────────
        log_ok("=" * 59)
        log_ok("  Claude Code is starting with trace recording enabled!")
        log_ok(f"  Trace -> {trace_file}")
        if not args.no_viz:
            log_ok(f"  Live visualizer -> {viz_url}")
        log_ok("=" * 59)
        print()

        claude_env = os.environ.copy()
        claude_env["ANTHROPIC_BASE_URL"] = f"http://localhost:{args.port}"

        claude_cmd = ["claude"] + args.claude_args
        result = subprocess.run(claude_cmd, env=claude_env)
        claude_exit_code = result.returncode

        # ─── Post-session summary ───────────────────────────────────
        print()
        if trace_file.is_file() and trace_file.stat().st_size > 0:
            line_count = sum(1 for _ in open(trace_file))
            log_ok(f"Session complete! {line_count} trace entries recorded.")
            log_ok(f"Trace file: {trace_file}")
            if not args.no_viz:
                log_ok(f"Visualizer still running at: {viz_url}")
                log_info("Press Ctrl+C to stop the visualizer server.")
                try:
                    viz_thread.join()
                except KeyboardInterrupt:
                    pass
        else:
            log_warn("No trace data recorded in this session.")

        cleanup()
        sys.exit(claude_exit_code)

    except KeyboardInterrupt:
        print()
        log_info("Interrupted.")
        cleanup()
        sys.exit(130)
    except Exception as e:
        log_error(f"Unexpected error: {e}")
        cleanup()
        sys.exit(1)


def _which(cmd):
    """Check if a command exists in PATH."""
    import shutil
    return shutil.which(cmd)


if __name__ == "__main__":
    main()
