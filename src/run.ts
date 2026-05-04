import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { codexLocalHome, IS_WIN } from "./paths.js";
import { getOwnerState } from "./auth.js";
import { warn, err, info, C } from "./banner.js";

interface RunOpts {
  ide: "claude" | "codex";
  dryRun?: boolean;
  noDefaults?: boolean;
  passthroughArgs: string[];
}

const CLAUDE_DEFAULT_FLAGS = [
  "--dangerously-load-development-channels",
  "server:inbetween",
  "--dangerously-skip-permissions",
];

function printBootBanner(ide: "claude" | "codex") {
  const ideLabel = ide === "claude" ? "Claude" : "Codex";
  const owner = getOwnerState();
  const lines = [
    "",
    `  ${C.bold}${C.cyan}╭─────────────────────────────────────────────╮${C.reset}`,
    `  ${C.bold}${C.cyan}│${C.reset}  ${C.bold}InBetween${C.reset} ${C.dim}×${C.reset} ${C.bold}${ideLabel}${C.reset}                          ${C.bold}${C.cyan}│${C.reset}`,
    `  ${C.bold}${C.cyan}│${C.reset}  ${C.dim}direct line between AI agents${C.reset}              ${C.bold}${C.cyan}│${C.reset}`,
    `  ${C.bold}${C.cyan}╰─────────────────────────────────────────────╯${C.reset}`,
    "",
  ];
  if (owner) {
    lines.push(`  ${C.green}●${C.reset} owner authenticated`);
  } else {
    lines.push(
      `  ${C.dim}You're not logged in as an owner yet.${C.reset}`,
      `  ${C.dim}Inside ${ideLabel}, paste your owner token via owner_login(\"own_...\").${C.reset}`,
      `  ${C.dim}Or run \`inbetweenai login\` and skip the paste.${C.reset}`,
    );
  }
  lines.push(
    "",
    `  ${C.dim}Inside ${ideLabel}, paste any chat onboarding prompt to act as${C.reset}`,
    `  ${C.dim}that agent (calls agent_login under the hood).${C.reset}`,
    "",
  );
  process.stderr.write(lines.join("\n") + "\n");
}

export async function run(opts: RunOpts): Promise<void> {
  if (opts.ide === "claude") {
    await runClaude(opts);
  } else {
    await runCodex(opts);
  }
}

async function runClaude(opts: RunOpts) {
  const flags = opts.noDefaults
    ? [...opts.passthroughArgs]
    : [...CLAUDE_DEFAULT_FLAGS, ...opts.passthroughArgs];

  if (opts.dryRun) {
    process.stderr.write(`\n[would spawn] claude ${flags.join(" ")}\n\n`);
    return;
  }

  printBootBanner("claude");

  const child = spawn("claude", flags, {
    stdio: "inherit",
    shell: IS_WIN,
    env: process.env,
  });
  child.on("error", (e) => {
    err(`Failed to spawn 'claude': ${e.message}`);
    info("Is Claude Code installed? npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function runCodex(opts: RunOpts) {
  if (opts.dryRun) {
    process.stderr.write(
      `\n[would spawn] inbetween-codex (with --dangerously-bypass-approvals-and-sandbox + ${opts.passthroughArgs.join(" ")})\n\n`,
    );
    return;
  }

  // Resolve @inbetweenai/codex-shell path. It's a peer-bundled wrapper that
  // injects messages into Codex via app-server JSON-RPC; without it Codex
  // falls back to MCP-only (no live push since Codex doesn't render
  // notifications/claude/channel natively).
  const require = createRequire(import.meta.url);
  let codexShellEntry: string;
  try {
    codexShellEntry = require.resolve("@inbetweenai/codex-shell/src/index.mjs");
  } catch {
    err("Codex wrapper not found. Try: npm install -g @inbetweenai/cli@latest");
    process.exit(1);
  }

  printBootBanner("codex");

  const env = { ...process.env };
  // CODEX_HOME for project-scoped MCP if user installed --local in this folder.
  const codexHome = codexLocalHome();
  if (existsSync(codexHome)) {
    env.CODEX_HOME = codexHome;
  }

  const child = spawn(process.execPath, [codexShellEntry, ...opts.passthroughArgs], {
    stdio: "inherit",
    env,
  });
  child.on("error", (e) => {
    err(`Failed to spawn codex wrapper: ${e.message}`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}
