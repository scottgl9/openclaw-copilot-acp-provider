#!/usr/bin/env node
/**
 * copilot-run.js — ACP client wrapper for the GitHub Copilot CLI
 *
 * Speaks the Agent Client Protocol (ACP) — JSON-RPC 2.0 over stdio — to
 * `copilot --acp --stdio` and translates the streaming response into a single
 * JSON object that OpenClaw's cliBackend can consume:
 *
 *   {"text": "<assistant reply>", "session_id": "<uuid>"}
 *
 * Protocol flow per invocation:
 *   1. Spawn `copilot --acp --stdio`
 *   2. → initialize   (protocolVersion, clientInfo)
 *   3. → session/new  (cwd)   → receive sessionId
 *   4. → session/prompt (sessionId, prompt text)
 *   5. ← stream session/update notifications:
 *        agent_message_chunk  → collect text
 *        agent_thought_chunk  → collect reasoning
 *        end_turn             → done
 *   6. ← session/request_permission → deny with outcome:cancelled
 *   7. Emit {text, session_id} and exit.
 *
 * If no text was produced but reasoning was (permission-denied scenario),
 * reasoning content is returned as text so OpenClaw gets a non-empty response.
 *
 * CLI args:
 *   --prompt <text>      Prompt text (required)
 *   --model  <model>     Model hint forwarded as text in the prompt (optional)
 *   --cwd    <path>      Working directory for the ACP session (optional)
 *   --timeout <seconds>  Timeout in seconds (default: 300)
 *
 * Env:
 *   COPILOT_BIN   Path to copilot binary (default: "copilot")
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// ── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let prompt = null;
let model = null;
let cwd = process.cwd();
let timeoutSeconds = 300;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--prompt" && args[i + 1]) {
    prompt = args[++i];
  } else if (args[i] === "--model" && args[i + 1]) {
    model = args[++i];
  } else if (args[i] === "--cwd" && args[i + 1]) {
    cwd = args[++i];
  } else if (args[i] === "--timeout" && args[i + 1]) {
    timeoutSeconds = Number(args[++i]) || 300;
  } else if (args[i].startsWith("--prompt=")) {
    prompt = args[i].slice("--prompt=".length);
  } else if (args[i].startsWith("--model=")) {
    model = args[i].slice("--model=".length);
  } else if (args[i].startsWith("--cwd=")) {
    cwd = args[i].slice("--cwd=".length);
  } else if (args[i].startsWith("--timeout=")) {
    timeoutSeconds = Number(args[i].slice("--timeout=".length)) || 300;
  }
}

if (!prompt) {
  process.stderr.write("copilot-run: --prompt is required\n");
  process.exit(1);
}

// ── Build prompt text ─────────────────────────────────────────────────────────

/**
 * Wrap the user prompt with an ACP framing header. If a model hint was
 * provided via --model, include it so Copilot can honour it.
 */
function buildPromptText(promptText, modelHint) {
  const lines = [
    "You are the active ACP agent backend for OpenClaw.",
    "Use your ACP capabilities to complete the task.",
  ];
  if (modelHint) {
    lines.push(`Requested model: ${modelHint}`);
  }
  lines.push("", promptText.trim());
  return lines.join("\n");
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function makeRequest(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

function makePermissionDenied(requestId) {
  return (
    JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      result: { outcome: { outcome: "cancelled" } },
    }) + "\n"
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const COPILOT_BIN = process.env.COPILOT_BIN ?? "copilot";

const child = spawn(COPILOT_BIN, ["--acp", "--stdio"], {
  stdio: ["pipe", "pipe", "inherit"],
  cwd,
});

child.on("error", (err) => {
  process.stderr.write(`copilot-run: failed to launch '${COPILOT_BIN}': ${err.message}\n`);
  process.exit(1);
});

const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

// State machine
let nextId = 1;
let sessionId = null;
const textParts = [];
const reasoningParts = [];
let promptCompleted = false;

// Map of pending requests: id → resolve/reject
const pending = new Map();

// Timer for overall timeout
const timeoutHandle = setTimeout(() => {
  process.stderr.write(`copilot-run: timed out after ${timeoutSeconds}s\n`);
  child.kill();
  finish(1);
}, timeoutSeconds * 1000);

function finish(exitCode) {
  clearTimeout(timeoutHandle);
  const text = textParts.join("");
  const reasoning = reasoningParts.join("");
  // Fallback: if Copilot returned only reasoning (e.g. permission-denied),
  // return reasoning as the text so OpenClaw gets a non-empty response.
  const finalText = text || reasoning;
  process.stdout.write(
    JSON.stringify({ text: finalText, session_id: sessionId }) + "\n"
  );
  process.exit(exitCode);
}

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(makeRequest(id, method, params));
  });
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  const method = msg.method;

  // ── Incoming server notification / request ───────────────────────────────
  if (method === "session/update") {
    const update = msg.params?.update ?? {};
    const kind = update.sessionUpdate;
    const content = update.content ?? {};
    const chunkText = typeof content.text === "string" ? content.text : "";

    if (kind === "agent_message_chunk" && chunkText) {
      textParts.push(chunkText);
    } else if (kind === "agent_thought_chunk" && chunkText) {
      reasoningParts.push(chunkText);
    } else if (kind === "end_turn") {
      promptCompleted = true;
    }
    return;
  }

  if (method === "session/request_permission") {
    // Always deny — OpenClaw manages permissions at a higher level.
    child.stdin.write(makePermissionDenied(msg.id ?? null));
    return;
  }

  // ── Response to one of our requests ─────────────────────────────────────
  if (msg.id != null && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) {
      reject(new Error(`ACP ${method ?? "?"}: ${msg.error.message ?? JSON.stringify(msg.error)}`));
    } else {
      resolve(msg.result ?? {});
    }
  }
});

async function run() {
  try {
    // 1. Initialize
    await send("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
      },
      clientInfo: {
        name: "openclaw-copilot-acp",
        title: "OpenClaw Copilot ACP",
        version: "0.1.0",
      },
    });

    // 2. Create session
    const session = await send("session/new", {
      cwd,
      mcpServers: [],
    });
    sessionId = typeof session.sessionId === "string" ? session.sessionId : null;
    if (!sessionId) {
      throw new Error("Copilot ACP did not return a sessionId");
    }

    // 3. Send prompt
    const promptText = buildPromptText(prompt, model);
    await send("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: promptText }],
    });

    // session/prompt resolves after the full response is collected, but
    // end_turn may arrive before the response object. Both paths are fine.
    finish(0);
  } catch (err) {
    process.stderr.write(`copilot-run: ${err.message}\n`);
    child.kill();
    finish(1);
  }
}

run();
