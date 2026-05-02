import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// Resolve the path to the ACP wrapper script bundled with this plugin.
// bin/copilot-run.js implements the ACP client protocol:
//   spawn copilot --acp --stdio → JSON-RPC 2.0 over stdio → collect chunks
//   emits: {"text": "<assistant reply>", "session_id": "<uuid>"}
const __dirname = dirname(fileURLToPath(import.meta.url));
const WRAPPER = join(__dirname, "bin", "copilot-run.js");

export default definePluginEntry({
  id: "copilot-acp",
  name: "GitHub Copilot CLI",
  description: "GitHub Copilot CLI as a text provider backend via ACP (copilot-acp/*)",

  register(api) {
    const pluginConfig = api.getPluginConfig<{
      command?: string;
      defaultModel?: string;
      cwd?: string;
    }>();

    // If user configured a custom copilot binary path, pass it through
    // to the wrapper via COPILOT_BIN env var.
    const copilotBin = pluginConfig?.command;
    const env = copilotBin ? { COPILOT_BIN: copilotBin } : undefined;

    // Optional CWD override — defaults to process.cwd() inside the wrapper.
    const cwdArg = pluginConfig?.cwd ? ["--cwd", pluginConfig.cwd] : [];

    api.registerCliBackend({
      id: "copilot-acp",
      label: "GitHub Copilot CLI (ACP)",

      // The ACP wrapper script — speaks JSON-RPC 2.0 to copilot --acp --stdio
      // and translates the response into {"text":"...","session_id":"..."}
      config: {
        command: "node",
        args: [
          WRAPPER,
          "--prompt", "{prompt}",
          "--model", "{model}",
          ...cwdArg,
        ],

        // Wrapper outputs a single JSON object
        output: "json",

        // ACP sessions are scoped to one subprocess per turn; conversation
        // continuity is provided by OpenClaw's context injection in {prompt}.
        // No cross-invocation resume is supported in ACP mode.
        sessionMode: "none",

        // Wrapper emits {"session_id": "..."} — extracted by OpenClaw for
        // diagnostics / logging (not used for resume).
        sessionIdFields: ["session_id"],

        // Serialize same-lane runs to avoid parallel ACP subprocess collisions.
        serialize: true,

        // Inject COPILOT_BIN when a custom binary path is configured.
        ...(env ? { env } : {}),
      },
    });
  },
});
