import { rmSync, existsSync, statSync } from "node:fs";
import {
  homeInbetweenDir,
  localInbetweenDir,
  homeConfigPath,
  localConfigPath,
  claudeProjectMcpPath,
  codexLocalHome,
} from "./paths.js";
import { removeClaudeMcp, removeCodexMcp } from "./mcp-write.js";
import { ok, info, warn } from "./banner.js";

export interface LogoutOpts {
  all?: boolean;
  keepMcp?: boolean;
  cwd?: string;
}

/** Logout: remove config from current scope. Default: local if exists, else global. */
export function runLogout(opts: LogoutOpts): void {
  const cwd = opts.cwd || process.cwd();

  // Determine scope.
  const localCfg = localConfigPath(cwd);
  const homeCfg = homeConfigPath();
  const hasLocal = existsSync(localCfg);
  const hasHome = existsSync(homeCfg);

  if (!hasLocal && !hasHome && !opts.all) {
    info("No InBetween config found — nothing to remove.");
    return;
  }

  // --all: clean both
  if (opts.all) {
    if (hasLocal) {
      rmSync(localInbetweenDir(cwd), { recursive: true, force: true });
      ok(`Removed ${localInbetweenDir(cwd)}`);
    }
    if (hasHome) {
      rmSync(homeInbetweenDir(), { recursive: true, force: true });
      ok(`Removed ${homeInbetweenDir()}`);
    }
    if (!opts.keepMcp) {
      removeBothMcp(cwd);
    }
    ok("Logout complete (--all).");
    return;
  }

  // Default: local wins over global.
  if (hasLocal) {
    rmSync(localInbetweenDir(cwd), { recursive: true, force: true });
    ok(`Removed ${localInbetweenDir(cwd)}`);
    if (!opts.keepMcp) {
      const p = claudeProjectMcpPath(cwd);
      if (existsSync(p)) {
        // Try to surgically remove our entry; if file becomes empty, leave it (user may have other MCPs).
        const removed = removeClaudeMcp({ local: true, cwd });
        if (removed) ok(`Cleaned ${removed}`);
      }
      // Codex local config dir.
      const ch = codexLocalHome(cwd);
      if (existsSync(ch)) {
        rmSync(ch, { recursive: true, force: true });
        ok(`Removed ${ch}`);
      }
    }
    return;
  }

  if (hasHome) {
    rmSync(homeCfg, { force: true });
    ok(`Removed ${homeCfg}`);
    if (!opts.keepMcp) {
      const c = removeClaudeMcp({ local: false });
      if (c) ok(`Cleaned ${c}`);
      const x = removeCodexMcp({ local: false });
      if (x) ok(`Cleaned ${x}`);
    }
  }
}

function removeBothMcp(cwd: string) {
  const claudeLocal = removeClaudeMcp({ local: true, cwd });
  if (claudeLocal) ok(`Cleaned ${claudeLocal}`);
  const claudeHome = removeClaudeMcp({ local: false });
  if (claudeHome) ok(`Cleaned ${claudeHome}`);
  const codexLocal = removeCodexMcp({ local: true, cwd });
  if (codexLocal) ok(`Cleaned ${codexLocal}`);
  const codexHome = removeCodexMcp({ local: false });
  if (codexHome) ok(`Cleaned ${codexHome}`);
}

/** Uninstall: nuclear cleanup. */
export function runUninstall(): void {
  const cwd = process.cwd();
  // Remove ~/.inbetween/ entirely.
  if (existsSync(homeInbetweenDir())) {
    rmSync(homeInbetweenDir(), { recursive: true, force: true });
    ok(`Removed ${homeInbetweenDir()}`);
  }
  // Remove <cwd>/.inbetween/ if exists.
  if (existsSync(localInbetweenDir(cwd))) {
    rmSync(localInbetweenDir(cwd), { recursive: true, force: true });
    ok(`Removed ${localInbetweenDir(cwd)}`);
  }
  // Remove <cwd>/.mcp.json's inbetween entry.
  const claudeLocal = removeClaudeMcp({ local: true, cwd });
  if (claudeLocal) ok(`Cleaned ${claudeLocal}`);
  const claudeHome = removeClaudeMcp({ local: false });
  if (claudeHome) ok(`Cleaned ${claudeHome}`);
  // Remove Codex MCP entries.
  const codexHome = removeCodexMcp({ local: false });
  if (codexHome) ok(`Cleaned ${codexHome}`);
  // Local Codex was already wiped via .inbetween/.

  ok("Uninstall complete.");
  info("To remove the CLI itself:  npm uninstall -g @inbetweenai/cli");
  info("Your agents remain on the backend — you can return any time with the same token.");
}
