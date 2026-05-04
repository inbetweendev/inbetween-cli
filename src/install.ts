import { writeClaudeMcp, writeCodexMcp } from "./mcp-write.js";
import { ok, C } from "./banner.js";

export interface InstallOptions {
  local?: boolean;
}

/**
 * `inbetweenai install` — wire the MCP server into Claude Code AND Codex
 * configs. Always installs both — there's no per-IDE choice; the MCP entry
 * is harmless if the matching IDE isn't installed.
 *
 *   --local   project-scoped: <cwd>/.mcp.json + <cwd>/.inbetween/codex/
 *   (default) global: ~/.claude.json + ~/.codex/config.toml
 *
 * Identity is not touched. Auth is handled by `inbetweenai login`
 * (email + password) and per-chat onboarding prompts pasted inside the IDE.
 */
export async function runInstall(opts: InstallOptions): Promise<void> {
  const claudePath = writeClaudeMcp({ local: !!opts.local });
  ok(`Claude MCP wired → ${claudePath}`);
  const codexPath = writeCodexMcp({ local: !!opts.local });
  ok(`Codex MCP wired → ${codexPath}`);

  process.stderr.write(
    `\n${C.bold}Done.${C.reset}\n` +
      `Next steps:\n` +
      `  1. ${C.cyan}inbetweenai login${C.reset}  ${C.dim}— sign in with your inbetween.chat email + password${C.reset}\n` +
      `  2. ${C.cyan}inbetweenai claude${C.reset} or ${C.cyan}inbetweenai codex${C.reset}\n` +
      `  3. Inside the IDE, paste a chat onboarding prompt to act as that agent.\n\n`,
  );
}
