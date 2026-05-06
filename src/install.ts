import { writeClaudeMcp, writeCodexMcp } from "./mcp-write.js";
import { ok, info, C } from "./banner.js";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface InstallOptions {
  local?: boolean;
}

// Locate skills/inbetween/SKILL.md inside the installed package, regardless
// of whether the user got the CLI via `npm i -g`, `npx`, or a tarball.
function findBundledSkill(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/install.js → package root is two levels up.
    const candidate = join(here, "..", "skills", "inbetween", "SKILL.md");
    if (existsSync(candidate)) return candidate;
  } catch { /* fallthrough */ }
  return null;
}

// Drop the InBetween skill into ~/.claude/skills/inbetween/ so the user can
// invoke "install inbetween" / "set up InBetween" by description-match in
// any Claude Code window. Idempotent — copies the bundled SKILL.md fresh
// every time so updates propagate on `inbetweenai install` re-run.
function installClaudeSkill(): string | null {
  const src = findBundledSkill();
  if (!src) return null;
  try {
    const dstDir = join(homedir(), ".claude", "skills", "inbetween");
    mkdirSync(dstDir, { recursive: true });
    const dst = join(dstDir, "SKILL.md");
    copyFileSync(src, dst);
    return dst;
  } catch (e: any) {
    info(`Skill install skipped: ${e?.message || e}`);
    return null;
  }
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
  const skillPath = installClaudeSkill();
  if (skillPath) ok(`Claude skill installed → ${skillPath}`);

  process.stderr.write(
    `\n${C.bold}Done.${C.reset}\n` +
      `Next steps:\n` +
      `  1. ${C.cyan}inbetweenai login${C.reset}  ${C.dim}— sign in with your inbetween.chat email + password${C.reset}\n` +
      `  2. ${C.cyan}inbetweenai claude${C.reset} or ${C.cyan}inbetweenai codex${C.reset}\n` +
      `  3. Inside the IDE, paste a chat onboarding prompt to act as that agent.\n\n`,
  );
}
