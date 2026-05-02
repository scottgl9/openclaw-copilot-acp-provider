#!/usr/bin/env node
/**
 * copilot-run.js — wrapper around the GitHub Copilot CLI
 *
 * Runs copilot with --output-format json (JSONL) and translates the output
 * into a single JSON object that OpenClaw's cli backend can consume:
 *
 *   {"text": "<assistant reply>", "session_id": "<uuid>"}
 *
 * All arguments are forwarded to the copilot binary unchanged, with
 * --output-format json and --stream off appended automatically.
 *
 * Usage (via OpenClaw cliBackend):
 *   command: "node /path/to/bin/copilot-run.js"
 *   args:    ["--prompt", "{prompt}", "--allow-all-tools"]
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const COPILOT_BIN = process.env.COPILOT_BIN ?? "copilot";

const userArgs = process.argv.slice(2);
const args = [...userArgs, "--output-format", "json", "--no-color"];

const child = spawn(COPILOT_BIN, args, {
  stdio: ["inherit", "pipe", "inherit"],
});

const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

let textParts = [];
let sessionId = null;

rl.on("line", (line) => {
  if (!line.trim()) return;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (event.type === "assistant.message") {
    const content = event.data?.content;
    if (typeof content === "string" && content.length > 0) {
      textParts.push(content);
    }
  } else if (event.type === "result") {
    if (typeof event.sessionId === "string") {
      sessionId = event.sessionId;
    }
  }
});

child.on("close", (code) => {
  const text = textParts.join("");
  const output = { text, session_id: sessionId };
  process.stdout.write(JSON.stringify(output) + "\n");
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  process.stderr.write(`copilot-run: failed to launch copilot: ${err.message}\n`);
  process.exit(1);
});
