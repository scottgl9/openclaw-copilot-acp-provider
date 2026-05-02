# openclaw-copilot-acp

OpenClaw plugin that registers the GitHub Copilot CLI as a `cliBackend` provider using the **Agent Client Protocol (ACP)**.

Model refs use the prefix `copilot-acp/` — e.g. `copilot-acp/gpt-4.1`, `copilot-acp/claude-sonnet-4.6`.

## How it works

Unlike a simple JSON output mode, this plugin uses Copilot's full **ACP mode** (`copilot --acp --stdio`) — a JSON-RPC 2.0 protocol over stdio. Each turn:

1. Spawns `copilot --acp --stdio` as a subprocess
2. Sends `initialize` → `session/new` → `session/prompt` over stdin
3. Streams `session/update` notifications (text chunks, reasoning chunks, end_turn)
4. Denies any `session/request_permission` requests with `cancelled`
5. Returns `{"text": "...", "session_id": "..."}` to OpenClaw

Session history is maintained by OpenClaw's normal context injection; each ACP subprocess is short-lived (one turn).

**Reasoning-only fallback:** If Copilot produces only reasoning content (e.g. when a permission is denied), the reasoning text is returned as the response so OpenClaw doesn't see an empty reply.

## Requirements

- OpenClaw >= 2026.3.24-beta.2
- GitHub Copilot CLI installed and authenticated (`copilot login`)
- The `copilot` binary must be on `PATH` (or configure `command` below)

## Install

```bash
openclaw plugins install ~/sandbox/personal/openclaw-copilot-acp-provider
openclaw gateway restart
```

## ACP Protocol flow

```
spawn: copilot --acp --stdio
→ initialize  { protocolVersion: 1, clientInfo: { name: "openclaw-copilot-acp" } }
← { protocolVersion: 1 }
→ session/new { cwd: "...", mcpServers: [] }
← { sessionId: "uuid" }
→ session/prompt { sessionId, prompt: [{ type: "text", text: "..." }] }
← session/update (streaming):
     { sessionUpdate: "agent_message_chunk", content: { text: "..." } }
     { sessionUpdate: "agent_thought_chunk", content: { text: "..." } }  // reasoning
     { sessionUpdate: "end_turn" }
← session/request_permission → respond { outcome: "cancelled" }
← session/prompt response {}
emit {"text": "...", "session_id": "uuid"} → exit
```

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

### Custom working directory for ACP sessions

```json5
{
  plugins: {
    entries: {
      "copilot-acp": {
        enabled: true,
        config: {
          cwd: "/home/scott/projects",
        },
      },
    },
  },
}
```

## Notes

- Auth is handled entirely by the Copilot CLI itself — no tokens pass through OpenClaw
- ACP sessions are single-turn subprocesses; OpenClaw provides context continuity
- Tool calls are not supported — Copilot's ACP tools run inside the subprocess, not in OpenClaw
- The `--acp --stdio` flags are required; Copilot starts as a JSON-RPC 2.0 server over stdin/stdout
- Permission requests from Copilot (file access, URLs) are automatically denied via `cancelled`
- If Copilot returns only reasoning content (permission-denied scenario), reasoning is used as the text response

## Related

- [GitHub Copilot ACP announcement](https://github.com/orgs/community/discussions/185860)
- [Zed Agent Client Protocol](https://zed.dev/acp)
- [OpenClaw CLI Backends docs](https://docs.openclaw.ai/gateway/cli-backends)
