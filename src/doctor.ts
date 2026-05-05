import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { getOwnerState, OWNER_FILE } from "./auth.js";
import {
  claudeUserConfigPath,
  claudeProjectMcpPath,
  codexHomeConfigPath,
  codexLocalConfigPath,
  IS_WIN,
} from "./paths.js";
import { C } from "./banner.js";

const BACKEND_URL =
  process.env.INBETWEEN_BACKEND_URL || "https://inbetween.up.railway.app";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

function bin(cmd: string, args: string[] = ["--version"]): { ok: boolean; out: string } {
  try {
    const r = spawnSync(cmd, args, {
      shell: IS_WIN,
      encoding: "utf-8",
      timeout: 5000,
    });
    if (r.error || r.status !== 0) {
      return { ok: false, out: (r.error?.message || r.stderr || "").trim() };
    }
    return { ok: true, out: (r.stdout || r.stderr || "").trim().split("\n")[0] };
  } catch (e: any) {
    return { ok: false, out: e?.message || String(e) };
  }
}

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

async function backendReachable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    if (res.ok) {
      const body: any = await res.json().catch(() => ({}));
      return { ok: true, detail: `${BACKEND_URL} → ${body?.status || res.status}` };
    }
    return { ok: false, detail: `${BACKEND_URL} → HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, detail: `${BACKEND_URL} unreachable (${e?.message || e})` };
  }
}

export async function runDoctor(): Promise<void> {
  const checks: Check[] = [];

  // Claude in PATH
  const cl = bin("claude");
  checks.push({
    name: "claude in PATH",
    ok: cl.ok,
    detail: cl.ok ? cl.out : cl.out || "not found",
    hint: cl.ok ? undefined : "npm install -g @anthropic-ai/claude-code",
  });

  // Codex in PATH
  const cx = bin("codex");
  checks.push({
    name: "codex in PATH",
    ok: cx.ok,
    detail: cx.ok ? cx.out : cx.out || "not found",
    hint: cx.ok ? undefined : "https://github.com/openai/codex",
  });

  // Claude MCP entry
  const claudeGlobal = claudeUserConfigPath();
  const claudeLocal = claudeProjectMcpPath();
  const claudeWired = claudeMcpWired(claudeGlobal) || claudeMcpWired(claudeLocal);
  checks.push({
    name: "claude MCP entry",
    ok: claudeWired,
    detail: claudeWired
      ? `inbetween in ${claudeMcpWired(claudeGlobal) ? claudeGlobal : claudeLocal}`
      : "not wired",
    hint: claudeWired ? undefined : "inbetweenai install",
  });

  // Codex MCP entry
  const codexGlobal = codexHomeConfigPath();
  const codexLocal = codexLocalConfigPath();
  const codexWired = codexMcpWired(codexGlobal) || codexMcpWired(codexLocal);
  checks.push({
    name: "codex MCP entry",
    ok: codexWired,
    detail: codexWired
      ? `inbetween in ${codexMcpWired(codexGlobal) ? codexGlobal : codexLocal}`
      : "not wired",
    hint: codexWired ? undefined : "inbetweenai install",
  });

  // Owner signed in
  const owner = getOwnerState();
  checks.push({
    name: "owner signed in",
    ok: !!owner,
    detail: owner
      ? `as ${owner.owner_id ?? "(id unknown)"} (${OWNER_FILE})`
      : `${OWNER_FILE} missing or empty`,
    hint: owner ? undefined : "inbetweenai login",
  });

  // Backend reachable
  const be = await backendReachable();
  checks.push({
    name: "backend reachable",
    ok: be.ok,
    detail: be.detail,
    hint: be.ok ? undefined : "check INBETWEEN_BACKEND_URL or your network",
  });

  // CLI / dep versions
  const r = createRequire(import.meta.url);
  const cliVer = (() => {
    try { return r("../package.json").version; } catch { return "(unknown)"; }
  })();
  const cxShellVer = (() => {
    try { return r("@inbetweenai/codex-shell/package.json").version; } catch { return "(missing)"; }
  })();

  // Render
  const lines: string[] = ["", `  ${C.bold}InBetween doctor${C.reset}`, ""];
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    const mark = c.ok ? `${C.green}✓${C.reset}` : `${C.dim}✗${C.reset}`;
    lines.push(`  ${mark} ${c.name.padEnd(22)} ${c.detail}`);
    if (c.hint && !c.ok) {
      lines.push(`    ${C.dim}↳ ${c.hint}${C.reset}`);
    }
  }
  lines.push("");
  lines.push(`  ${C.dim}cli ${cliVer} · codex-shell ${cxShellVer}${C.reset}`);
  lines.push("");
  if (!allOk) {
    lines.push(`  ${C.dim}Some checks failed — fix the ones with hints above.${C.reset}`);
    lines.push("");
  }
  process.stderr.write(lines.join("\n") + "\n");
  if (!allOk) process.exitCode = 1;
}
