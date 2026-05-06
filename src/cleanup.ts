import { rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  homeInbetweenDir,
  localInbetweenDir,
  codexLocalHome,
} from "./paths.js";
import { removeClaudeMcp, removeCodexMcp } from "./mcp-write.js";
import { ok, info } from "./banner.js";

export interface UninstallOpts {
  local?: boolean;
  cwd?: string;
}

/**
 * `inbetweenai uninstall` — remove MCP entries.
 *
 *   `--local`   removes <cwd>/.mcp.json + <cwd>/.inbetween/codex/
 *   no flag     removes ~/.claude.json's inbetween block
 *               + ~/.codex/config.toml's inbetween block
 *               + ~/.inbetween/owner.json (full owner logout)
 *
 * The npm package itself isn't touched — to remove it run
 * `npm uninstall -g @inbetweenai/cli` afterwards. Agents on the
 * backend stay live; nothing destructive on the server side.
 */
export function runUninstall(opts: UninstallOpts = {}): void {
  const cwd = opts.cwd || process.cwd();

  if (opts.local) {
    const claudeLocal = removeClaudeMcp({ local: true, cwd });
    if (claudeLocal) ok(`Cleaned ${claudeLocal}`);
    const localCodex = codexLocalHome(cwd);
    if (existsSync(localCodex)) {
      rmSync(localCodex, { recursive: true, force: true });
      ok(`Removed ${localCodex}`);
    }
    const localInb = localInbetweenDir(cwd);
    if (existsSync(localInb)) {
      rmSync(localInb, { recursive: true, force: true });
      ok(`Removed ${localInb}`);
    }
    info("Local install removed. Global install (and owner login) untouched — use `inbetweenai uninstall` (no --local) to wipe those too.");
    return;
  }

  // Global wipe.
  const claudeHome = removeClaudeMcp({ local: false });
  if (claudeHome) ok(`Cleaned ${claudeHome}`);
  const codexHome = removeCodexMcp({ local: false });
  if (codexHome) ok(`Cleaned ${codexHome}`);

  // Claude skill installed by `inbetweenai install`.
  const skillDir = join(homedir(), ".claude", "skills", "inbetween");
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true, force: true });
    ok(`Removed ${skillDir}`);
  }

  // ~/.inbetween/ — owner.json, sessions, logs.
  if (existsSync(homeInbetweenDir())) {
    rmSync(homeInbetweenDir(), { recursive: true, force: true });
    ok(`Removed ${homeInbetweenDir()}`);
  }

  ok("Uninstall complete.");
  info("To remove the npm package: `npm uninstall -g @inbetweenai/cli`");
  info("Your agents stay on the backend — log back in any time at inbetween.chat.");
}
