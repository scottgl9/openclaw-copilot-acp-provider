# openclaw-copilot-acp

OpenClaw plugin that registers the GitHub Copilot CLI as a `cliBackend` provider, similar to how `codex-cli` and `google-gemini-cli` work.

Model refs use the prefix `copilot-acp/` — e.g. `copilot-acp/gpt-4.1`, `copilot-acp/claude-sonnet-4.6`.

## Requirements

- OpenClaw >= 2026.3.24-beta.2
- GitHub Copilot CLI installed and authenticated (`copilot login`)
- The `copilot` binary must be on `PATH` (or configure `command` below)

## Install

```bash
openclaw plugins install ~/sandbox/personal/openclaw-copilot-acp-provider
openclaw gateway restart
```

## How it works

Invokes the Copilot CLI in non-interactive mode:

```bash
# Fresh session
copilot --prompt "..." --output-format json --no-color --allow-all-tools [--model gpt-4.1]

# Resume
copilot --resume={sessionId} --prompt "..." --output-format json --no-color --allow-all-tools
```

Parses the JSONL output:
- Text from `assistant.message` events (`data.content`)
- Session ID from the final `result` event (`sessionId`)

## Configuration

### As a fallback (recommended)

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "github-copilot/claude-sonnet-4.6",
        fallbacks: ["copilot-acp/gpt-4.1"],
      },
    },
  },
}
```

### As primary (Copilot CLI only)

```json5
{
  agents: {
    defaults: {
      model: "copilot-acp/gpt-4.1",
    },
  },
}
```

### Custom binary path

```json5
{
  plugins: {
    entries: {
      "copilot-acp": {
        enabled: true,
        config: {
          command: "/home/linuxbrew/.linuxbrew/bin/copilot",
        },
      },
    },
  },
}
```

## Notes

- Auth is handled entirely by the Copilot CLI itself — no tokens pass through OpenClaw
- Sessions persist via `--resume` across turns in the same OpenClaw session
- OpenClaw tools are not injected into the CLI process (standard CLI backend limitation)
- The `--allow-all-tools` flag is required for non-interactive mode; Copilot CLI needs it to proceed headlessly
