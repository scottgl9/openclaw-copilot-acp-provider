import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// Resolve the path to the wrapper script bundled with this plugin.
// bin/copilot-run.js handles Copilot's JSONL output and produces:
//   {"text": "<assistant reply>", "session_id": "<uuid>"}
const __dirname = dirname(fileURLToPath(import.meta.url));
const WRAPPER = join(__dirname, "bin", "copilot-run.js");

export default definePluginEntry({
  id: "copilot-acp",
  name: "GitHub Copilot CLI",
  description: "GitHub Copilot CLI as a text provider backend (copilot-acp/*)",

  register(api) {
    const pluginConfig = api.getPluginConfig<{
      command?: string;
      defaultModel?: string;
    }>();

    // If user configured a custom copilot binary path, pass it through
    // to the wrapper via COPILOT_BIN env var.
    const copilotBin = pluginConfig?.command;
    const env = copilotBin ? { COPILOT_BIN: copilotBin } : undefined;

    api.registerCliBackend({
      id: "copilot-acp",
      label: "GitHub Copilot CLI",

      // The wrapper script — translates Copilot JSONL → {"text":"...","session_id":"..."}
      config: {
        command: `node`,
        args: [
          WRAPPER,
          "--prompt", "{prompt}",
          "--allow-all-tools",
        ],
        resumeArgs: [
          WRAPPER,
          "--resume={sessionId}",
          "--prompt", "{prompt}",
          "--allow-all-tools",
        ],

        // Wrapper outputs a single JSON object
        output: "json",

        // Model flag forwarded to copilot by the wrapper
        modelArg: "--model",

        // Only resume when we have a stored session ID
        sessionMode: "existing",

        // Wrapper emits {"session_id": "..."} — extracted by OpenClaw
        sessionIdFields: ["session_id"],

        // Serialize same-lane runs
        serialize: true,

        // Inject COPILOT_BIN when a custom binary path is configured
        ...(env ? { env } : {}),
      },
    });
  },
});
