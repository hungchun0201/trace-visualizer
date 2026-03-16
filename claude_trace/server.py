"""HTTP server for trace visualizer with live-reload polling support."""

import argparse
import http.server
import json
import os
import sys
import threading
import time
from functools import partial
from pathlib import Path


class TraceHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler that serves visualizer UI + trace files + live poll API."""

    def __init__(self, *args, trace_dir=None, **kwargs):
        self.trace_dir = Path(trace_dir) if trace_dir else None
        super().__init__(*args, **kwargs)

    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/api/traces":
            self._handle_list_traces()
        elif path.startswith("/traces/") and path.endswith("/poll"):
            self._handle_poll()
        elif path.startswith("/traces/"):
            self._handle_serve_trace()
        else:
            super().do_GET()

    def _handle_list_traces(self):
        """List available .jsonl trace files."""
        if not self.trace_dir or not self.trace_dir.is_dir():
            self._json_response(200, {"traces": []})
            return

        traces = []
        for f in sorted(self.trace_dir.glob("*.jsonl"), reverse=True):
            stat = f.stat()
            traces.append({
                "name": f.name,
                "size": stat.st_size,
                "modified": stat.st_mtime,
                "url": f"/traces/{f.name}",
            })

        self._json_response(200, {"traces": traces})

    def _handle_poll(self):
        """Return new lines after a given line count for live updates.

        GET /traces/<filename>/poll?after=<line_count>
        Returns: {"lines": [...new JSON objects...], "total": <current_total>}
        """
        # Parse filename from path: /traces/<filename>/poll
        parts = self.path.split("?")[0]
        filename = parts[len("/traces/"):-len("/poll")]
        filename = os.path.basename(filename)

        if not self.trace_dir:
            self._json_response(404, {"error": "No trace directory configured"})
            return

        filepath = self.trace_dir / filename
        if not filepath.is_file():
            self._json_response(200, {"lines": [], "total": 0})
            return

        # Parse ?after=N
        after = 0
        qs = self.path.split("?")[1] if "?" in self.path else ""
        for param in qs.split("&"):
            if param.startswith("after="):
                try:
                    after = int(param[6:])
                except ValueError:
                    pass

        try:
            with open(filepath, "r") as f:
                all_lines = f.readlines()

            total = len(all_lines)
            new_lines = []
            for line in all_lines[after:]:
                line = line.strip()
                if not line:
                    continue
                try:
                    new_lines.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

            self._json_response(200, {"lines": new_lines, "total": total})
        except Exception as e:
            self._json_response(500, {"error": str(e)})

    def _handle_serve_trace(self):
        """Serve a trace file from the trace directory."""
        if not self.trace_dir:
            self._json_response(404, {"error": "No trace directory configured"})
            return

        filename = self.path[len("/traces/"):]
        filename = os.path.basename(filename.split("?")[0])

        filepath = self.trace_dir / filename
        if not filepath.is_file():
            self._json_response(404, {"error": f"Trace file not found: {filename}"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/x-jsonlines")
        self.send_header("Content-Length", str(filepath.stat().st_size))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        with open(filepath, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def _json_response(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        """Suppress default logging to reduce noise."""
        pass


def start_server(port, trace_dir, quiet=False):
    """Start the trace visualizer server. Returns (server, thread)."""
    trace_dir_abs = str(Path(trace_dir).resolve()) if trace_dir else None

    # Serve static files from the visualizer/ directory inside this package
    serve_dir = str(Path(__file__).parent / "visualizer")
    if not Path(serve_dir).is_dir():
        # Fallback: try the old visualizer location
        serve_dir = str(Path(__file__).parent.parent / "visualizer")

    os.chdir(serve_dir)

    handler = partial(TraceHandler, trace_dir=trace_dir_abs)
    server = http.server.HTTPServer(("127.0.0.1", port), handler)

    if not quiet:
        print(f"[trace-server] Serving at http://localhost:{port}/")
        if trace_dir:
            print(f"[trace-server] Trace directory: {trace_dir}")

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    return server, thread


def main():
    """Standalone server entry point."""
    parser = argparse.ArgumentParser(description="Trace Visualizer HTTP Server")
    parser.add_argument("--port", type=int, default=8899, help="Port to listen on")
    parser.add_argument(
        "--trace-dir", type=str, default=None,
        help="Directory containing .jsonl trace files",
    )
    parser.add_argument("--quiet", action="store_true", help="Suppress output")
    args = parser.parse_args()

    trace_dir_abs = str(Path(args.trace_dir).resolve()) if args.trace_dir else None
    serve_dir = str(Path(__file__).parent / "visualizer")
    if not Path(serve_dir).is_dir():
        serve_dir = str(Path(__file__).parent.parent / "visualizer")

    os.chdir(serve_dir)

    handler = partial(TraceHandler, trace_dir=trace_dir_abs)
    server = http.server.HTTPServer(("127.0.0.1", args.port), handler)

    if not args.quiet:
        print(f"[trace-server] Serving at http://localhost:{args.port}/")
        if args.trace_dir:
            print(f"[trace-server] Trace directory: {args.trace_dir}")
        print("[trace-server] Press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        if not args.quiet:
            print("\n[trace-server] Stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
