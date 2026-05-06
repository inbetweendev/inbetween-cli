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
import { findCwdAgent } from "./sessions.js";
import { checkDrift, semverGt } from "./update-check.js";
import { fetchMyAgents, fetchWhoami } from "./backend.js";

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

function depVersion(pkg: string): string {
  try {
    const r = createRequire(import.meta.url);
    return r(`${pkg}/package.json`).version;
  } catch {
    return "(missing)";
  }
}

function cliVersion(): string {
  try {
    const r = createRequire(import.meta.url);
    return r("../package.json").version;
  } catch {
    return "(unknown)";
  }
}

function fmtExpiry(iso: string | undefined): string | null {
  if (!iso) return null;
  const exp = new Date(iso).getTime();
  if (!isFinite(exp)) return null;
  const days = Math.round((exp - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `${C.yellow}expired${C.reset} — re-run \`inbetweenai login\``;
  if (days === 0) return `${C.yellow}expires today${C.reset}`;
  if (days <= 7) return `${C.yellow}expires in ${days}d${C.reset}`;
  return `${C.dim}expires in ${days}d${C.reset}`;
}

function fmtDrift(current: string, latest: string | null, viaNpx = false): string {
  // Special case for npx-only packages (e.g. @inbetweenai/mcp, fetched on
  // demand by Claude / Codex via their MCP config). cli doesn't import them
  // as a hard dep, so the "current" lookup returns "(missing)". Fall back
  // to showing only the published version with a note.
  if (current === "(missing)") {
    return latest
      ? `${latest} ${C.dim}(via npx)${C.reset}`
      : `${C.dim}(via npx, version unknown)${C.reset}`;
  }
  if (!latest) return current;
  if (semverGt(latest, current)) {
    return `${current} ${C.dim}(latest ${latest})${C.reset}`;
  }
  return `${current} ${C.dim}(latest)${C.reset}`;
}

export async function runStatus(): Promise<void> {
  const owner = getOwnerState();

  const claudeGlobal = claudeUserConfigPath();
  const claudeLocal = claudeProjectMcpPath();
  const codexGlobal = codexHomeConfigPath();
  const codexLocal = codexLocalConfigPath();

  const claudeOk = claudeMcpWired(claudeGlobal) || claudeMcpWired(claudeLocal);
  const codexOk = codexMcpWired(codexGlobal) || codexMcpWired(codexLocal);

  const cwdAgent = findCwdAgent();

  const cliVer = cliVersion();
  const mcpVer = depVersion("@inbetweenai/mcp");
  const codexShellVer = depVersion("@inbetweenai/codex-shell");

  // Best-effort online checks. Each is bounded by its own timeout, so worst
  // case `status` takes ~3s. Failures fall back to offline display.
  const driftPromises = Promise.all([
    checkDrift("@inbetweenai/cli", cliVer).catch(() => null),
    checkDrift("@inbetweenai/mcp", mcpVer).catch(() => null),
    checkDrift("@inbetweenai/codex-shell", codexShellVer).catch(() => null),
  ]);
  const agentsPromise = owner?.owner_token
    ? fetchMyAgents(owner.owner_token).catch(() => null)
    : Promise.resolve(null);
  // For old owner.json without expires_at, hit /auth/whoami once to backfill.
  const whoamiPromise = owner?.owner_token && !owner.expires_at
    ? fetchWhoami(owner.owner_token).catch(() => null)
    : Promise.resolve(null);

  const [drifts, agents, whoami] = await Promise.all([
    driftPromises, agentsPromise, whoamiPromise,
  ]);
  const [cliDrift, mcpDrift, codexShellDrift] = drifts;
  const expiresAt = owner?.expires_at || whoami?.expires_at;

  const dot = (ok: boolean) => (ok ? `${C.green}●${C.reset}` : `${C.dim}○${C.reset}`);
  const warn = `${C.yellow}⚠${C.reset}`;

  const ownerLabel = (() => {
    if (!owner) return "not signed in — run `inbetweenai login`";
    let line = `signed in as ${C.bold}${owner.owner_id ?? "(id unknown)"}${C.reset}`;
    if (agents?.ok) {
      line += `  ${C.dim}— ${agents.total} agents (${agents.online} online)${C.reset}`;
    } else if (agents?.status === 401) {
      line += `  ${warn} ${C.yellow}token rejected — run \`inbetweenai login\`${C.reset}`;
    }
    const exp = fmtExpiry(expiresAt);
    if (exp) line += `  ${exp}`;
    return line;
  })();

  const cwdLabel = cwdAgent
    ? `${C.bold}${cwdAgent.display_name || cwdAgent.agent_name || "agent"}${C.reset}` +
      (cwdAgent.chat_id !== undefined ? ` ${C.dim}(chat ${cwdAgent.chat_id})${C.reset}` : "") +
      (cwdAgent.variant !== "default" ? ` ${C.dim}[${cwdAgent.variant}]${C.reset}` : "")
    : `${C.dim}no agent linked — paste an onboarding prompt in Claude${C.reset}`;

  const lines = [
    "",
    `  ${C.bold}InBetween status${C.reset}`,
    "",
    `  ${dot(!!owner)} owner       ${ownerLabel}`,
    `  ${dot(claudeOk)} claude mcp  ${claudeOk ? "wired" : "not wired — run `inbetweenai install`"}`,
    `  ${dot(codexOk)} codex mcp   ${codexOk ? "wired" : "not wired — run `inbetweenai install`"}`,
    `  ${dot(!!cwdAgent)} this dir    ${cwdLabel}`,
    "",
    `  ${C.dim}cli${C.reset}         ${fmtDrift(cliVer, cliDrift?.latest ?? null)}`,
    `  ${C.dim}mcp${C.reset}         ${fmtDrift(mcpVer, mcpDrift?.latest ?? null, true)}`,
    `  ${C.dim}codex-shell${C.reset} ${fmtDrift(codexShellVer, codexShellDrift?.latest ?? null)}`,
    "",
  ];

  // Append drift hint only when the *CLI itself* is outdated. mcp/codex-shell
  // are pulled via npx so they update transparently — calling them out as
  // "update available" was confusing because owners can't pin them globally.
  if (cliDrift?.outdated) {
    lines.push(
      `  ${warn} cli update available — ${C.cyan}npm install -g @inbetweenai/cli@latest${C.reset}`,
      "",
    );
  } else if (mcpDrift?.outdated || codexShellDrift?.outdated) {
    // Soft hint only — owner can clear npx cache when convenient.
    lines.push(
      `  ${C.dim}note:${C.reset} npx-cached MCP/codex-shell version drift; run ${C.cyan}npm cache clean --force${C.reset} ${C.dim}to refresh${C.reset}`,
      "",
    );
  }

  process.stderr.write(lines.join("\n") + "\n");
}
