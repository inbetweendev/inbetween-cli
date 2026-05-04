import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getOwnerState } from "./auth.js";
import {
  claudeUserConfigPath,
  claudeProjectMcpPath,
  codexHomeConfigPath,
  codexLocalConfigPath,
} from "./paths.js";
import { C } from "./banner.js";

function claudeMcpWired(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const json = JSON.parse(readFileSync(path, "utf-8"));
    return !!json?.mcpServers?.inbetween;
  } catch {
    return false;
  }
}

function codexMcpWired(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const raw = readFileSync(path, "utf-8");
    return /\[mcp_servers\.inbetween\]/.test(raw);
  } catch {
    return false;
  }
}

function dep(name: string): string {
  try {
    const r = createRequire(import.meta.url);
    return r(`${name}/package.json`).version;
  } catch {
    return "(missing)";
  }
}

export function runStatus(): void {
  const owner = getOwnerState();

  const claudeGlobal = claudeUserConfigPath();
  const claudeLocal = claudeProjectMcpPath();
  const codexGlobal = codexHomeConfigPath();
  const codexLocal = codexLocalConfigPath();

  const claudeOk = claudeMcpWired(claudeGlobal) || claudeMcpWired(claudeLocal);
  const codexOk = codexMcpWired(codexGlobal) || codexMcpWired(codexLocal);

  const cliVersion = (() => {
    try {
      const r = createRequire(import.meta.url);
      return r("../package.json").version;
    } catch {
      return "(unknown)";
    }
  })();

  const dot = (ok: boolean) => (ok ? `${C.green}●${C.reset}` : `${C.dim}○${C.reset}`);

  process.stderr.write([
    "",
    `  ${C.bold}InBetween status${C.reset}`,
    "",
    `  ${dot(!!owner)} owner       ${owner ? `signed in (${owner.owner_id ?? "id unknown"})` : `not signed in — run \`inbetweenai login\``}`,
    `  ${dot(claudeOk)} claude mcp  ${claudeOk ? "wired" : "not wired — run `inbetweenai install`"}`,
    `  ${dot(codexOk)} codex mcp   ${codexOk ? "wired" : "not wired — run `inbetweenai install`"}`,
    "",
    `  ${C.dim}cli${C.reset}         ${cliVersion}`,
    `  ${C.dim}codex-shell${C.reset} ${dep("@inbetweenai/codex-shell")}`,
    "",
  ].join("\n") + "\n");
}
