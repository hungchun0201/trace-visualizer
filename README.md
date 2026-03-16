# claude_trace

One-command Claude Code API tracing with real-time DAG visualization.

`claude_trace` intercepts all Claude Code API calls via a LiteLLM proxy, logs them to JSONL, and serves a live-updating web visualizer showing agent spawning, tool usage, prefix cache ratios, and cost analysis.

## Prerequisites

- **Python 3.9+**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- **Anthropic API key**

## Installation

```bash
git clone https://github.com/hungchun0201/trace-visualizer.git
cd trace-visualizer
pip install .
```

> If your system uses externally-managed Python (e.g. Ubuntu 24.04), use one of:
> ```bash
> pip install . --break-system-packages   # system-wide
> # or
> python3 -m venv .venv && source .venv/bin/activate && pip install .  # venv
> ```

## Setup API key

Pick one:

```bash
# Option 1: export in shell
export ANTHROPIC_API_KEY='sk-ant-...'

# Option 2: save to file (auto-loaded by claude_trace)
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.claude_trace.env
```

## Usage

```bash
# Run from any project directory — traces are saved in the current directory
cd ~/my-project
claude_trace
```

This single command will:

1. Start a LiteLLM proxy (port 4000) to intercept API calls
2. Start the trace visualizer server (port 8899)
3. Auto-open the browser with a **live-updating** DAG view
4. Launch Claude Code with tracing enabled
5. Clean up all processes on exit

### Options

```bash
claude_trace --help

claude_trace --port 4001            # custom proxy port
claude_trace --viz-port 9000        # custom visualizer port
claude_trace --trace-dir ./traces   # custom trace output directory
claude_trace --no-browser           # don't auto-open browser
claude_trace --no-viz               # skip visualizer server
claude_trace -- --dangerously-skip-permissions  # pass args to claude
```

## Architecture

```
claude_trace/
  cli.py          # CLI entry point — orchestrates proxy, visualizer, claude
  callbacks.py    # LiteLLM callback that logs API calls to JSONL
  config.yaml     # LiteLLM proxy config (routes to Anthropic API)
  server.py       # HTTP server with live-poll endpoint
  visualizer/     # Static web UI
    index.html    # Main page with LIVE badge
    app.js        # DAG parser, renderer, live polling (2s interval)
    dag.js        # SVG DAG layout engine
    pricing.js    # Claude model cost calculator
    styles.css    # Dark theme UI
```

### How it works

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│ Claude Code  │────▶│ LiteLLM Proxy │────▶│ Anthropic API │
│              │     │  (port 4000)  │     │               │
└─────────────┘     └──────┬───────┘     └───────────────┘
                           │ callbacks.py
                           ▼
                    ┌──────────────┐
                    │ traces.jsonl │
                    └──────┬───────┘
                           │ poll every 2s
                           ▼
                    ┌──────────────┐     ┌─────────┐
                    │ server.py    │────▶│ Browser │
                    │ (port 8899)  │     │  (LIVE) │
                    └──────────────┘     └─────────┘
```

## Visualizer API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Visualizer UI |
| `/api/traces` | List available `.jsonl` trace files |
| `/traces/<filename>` | Serve a specific trace file |
| `/traces/<filename>/poll?after=N` | Live poll — returns new entries after line N |

## Standalone visualizer (without Claude Code)

```bash
# View existing trace files without running Claude Code
python -m claude_trace.server --port 8899 --trace-dir ./my-traces
```

## License

MIT
