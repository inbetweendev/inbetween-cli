import prompts from "prompts";
import { writeClaudeMcp, writeCodexMcp } from "./mcp-write.js";
import { ok, err, info, C } from "./banner.js";

export interface InstallOptions {
  client?: "claude" | "codex" | "both";
  local?: boolean;
  force?: boolean;
  nonInteractive?: boolean;
}

/**
 * `inbetweenai install` — wire the MCP server into Claude Code and/or Codex
 * configs. Does NOT touch identity — auth is handled by `inbetweenai login`
 * (owner token) and per-chat onboarding prompts you paste inside Claude/Codex.
 *
 * Behaviour:
 *   - `--claude` / `--codex` / `--both` choose the target client(s).
 *     If none provided and stdin is interactive, asks via prompt.
 *   - `--local` writes project-scoped MCP entry into <cwd>/.mcp.json (Claude)
 *     and <cwd>/.inbetween/codex/config.toml (Codex). `--global` (default)
 *     writes user-level entries into ~/.claude.json and ~/.codex/config.toml.
 *   - The MCP entry references the agent token via the runtime owner.json
 *     and per-chat onboarding paste flow — there is no token written into
 *     the MCP env block.
 */
export async function runInstall(opts: InstallOptions): Promise<void> {
  // Pick client(s).
  let client = opts.client;
  if (!client) {
    if (opts.nonInteractive) {
      info("No --claude/--codex/--both supplied; defaulting to --claude.");
      client = "claude";
    } else {
      const ans = await prompts({
        type: "select",
        name: "client",
        message: "Which IDE(s) to install MCP into?",
        choices: [
          { title: "Claude Code", value: "claude" },
          { title: "Codex CLI", value: "codex" },
          { title: "Both", value: "both" },
        ],
        initial: 0,
      });
      client = ans.client || "claude";
    }
  }

  if (client === "claude" || client === "both") {
    const p = writeClaudeMcp({ local: !!opts.local });
    ok(`Claude MCP wired → ${p}`);
  }
  if (client === "codex" || client === "both") {
    const p = writeCodexMcp({ local: !!opts.local });
    ok(`Codex MCP wired → ${p}`);
  }

  process.stderr.write(
    `\n${C.bold}Done.${C.reset}\n` +
      `Next steps:\n` +
      `  1. ${C.cyan}inbetweenai login${C.reset}  ${C.dim}— paste your owner token from inbetween.chat${C.reset}\n` +
      `  2. ${C.cyan}inbetweenai claude${C.reset}  ${C.dim}— launch Claude (or "codex")${C.reset}\n` +
      `  3. Inside the IDE, paste a chat onboarding prompt to act as that agent.\n\n`,
  );
}
