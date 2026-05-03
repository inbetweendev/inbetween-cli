import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  loadConfig,
  activeAuthToken,
  activeAgentName,
  isOwnerMode,
  findAgentByName,
  saveConfig,
} from "./config.js";
import { codexLocalHome } from "./mcp-write.js";
import { resolveConfigPath, IS_WIN } from "./paths.js";
import { printBanner, ok, info, warn, err } from "./banner.js";
import { existsSync } from "node:fs";

interface RunOpts {
  ide: "claude" | "codex";
  agent?: string; // owner-mode: switch active agent
  dryRun?: boolean;
  noDefaults?: boolean;
  configPath?: string; // override
  passthroughArgs: string[]; // user flags after subcommand
}

const CLAUDE_DEFAULT_FLAGS = [
  "--dangerously-load-development-channels",
  "server:inbetween",
  "--dangerously-skip-permissions",
];

export async function run(opts: RunOpts): Promise<void> {
  // Load config.
  const cfgPath = opts.configPath || resolveConfigPath();
  if (!cfgPath) {
    err("No InBetween config found.");
    err(`Run: ${IS_WIN ? "" : "$ "}inbetweenai init`);
    process.exit(1);
  }
  const loaded = loadConfig();
  if (!loaded) {
    err(`Failed to read config at ${cfgPath}`);
    process.exit(1);
  }
  const config = loaded.config;

  // Owner-mode: handle --agent switch.
  if (opts.agent) {
    if (!isOwnerMode(config)) {
      err(`--agent only valid in owner mode (config has owner_token)`);
      process.exit(1);
    }
    const target = findAgentByName(config, opts.agent);
    if (!target) {
      err(`Agent @${opts.agent} not found in your owner account.`);
      err(
        `Available: ${(config.agents || []).map((a) => "@" + a.name).join(", ")}`
      );
      process.exit(1);
    }
    // Switch active_agent in-memory (don't persist to disk for one-shot use).
    config.active_agent = opts.agent;
  }

  const agentName = activeAgentName(config);
  const authToken = activeAuthToken(config);
  if (!authToken || !agentName) {
    err("No active agent in config. Run: inbetweenai init");
    process.exit(1);
  }

  // Multi-IDE same-agent warning (heuristic — backend doesn't expose live
  // session info via simple GET).
  // For V0.1 just print a note about potential conflict.

  if (opts.ide === "claude") {
    await runClaude({ config, agentName, configPath: loaded.path, opts });
  } else {
    await runCodex({ config, agentName, configPath: loaded.path, opts });
  }
}

async function runClaude(args: {
  config: any;
  agentName: string;
  configPath: string;
  opts: RunOpts;
}) {
  const { config, agentName, configPath, opts } = args;

  const flags = opts.noDefaults
    ? [...opts.passthroughArgs]
    : [...CLAUDE_DEFAULT_FLAGS, ...opts.passthroughArgs];

  if (opts.dryRun) {
    process.stderr.write(`\n[would spawn] claude ${flags.join(" ")}\n`);
    process.stderr.write(`[active agent] @${agentName}\n`);
    process.stderr.write(`[config] ${configPath}\n\n`);
    return;
  }

  printBanner({
    ide: "claude",
    agentName,
    backendUrl: config.backend_url,
    configPath,
  });

  // For owner-mode --agent switch, we need MCP to start with this agent.
  // Pass token override via env var INBETWEEN_AUTH_TOKEN — MCP server respects
  // it (as of @inbetweenai/mcp@0.1.6+ if implemented; otherwise becomes harmless).
  const env = { ...process.env };
  if (opts.agent && config.agents) {
    const target = findAgentByName(config, opts.agent);
    if (target) {
      env.INBETWEEN_AUTH_TOKEN = target.auth_token;
      env.INBETWEEN_AGENT_NAME = target.name;
    }
  }

  const child = spawn("claude", flags, {
    stdio: "inherit",
    shell: IS_WIN,
    env,
  });
  child.on("error", (e) => {
    err(`Failed to spawn 'claude': ${e.message}`);
    err(
      `Is Claude Code installed? npm install -g @anthropic-ai/claude-code`
    );
    process.exit(1);
  });
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

async function runCodex(args: {
  config: any;
  agentName: string;
  configPath: string;
  opts: RunOpts;
}) {
  const { config, agentName, configPath, opts } = args;

  if (opts.dryRun) {
    process.stderr.write(
      `\n[would spawn] inbetween-codex (with --dangerously-bypass-approvals-and-sandbox + ${opts.passthroughArgs.join(" ")})\n`
    );
    process.stderr.write(`[active agent] @${agentName}\n`);
    process.stderr.write(`[config] ${configPath}\n\n`);
    return;
  }

  // Resolve @inbetweenai/codex-shell path.
  const require = createRequire(import.meta.url);
  let codexShellEntry: string;
  try {
    codexShellEntry = require.resolve("@inbetweenai/codex-shell/src/index.mjs");
  } catch {
    err("Cannot find @inbetweenai/codex-shell package — try: npm install -g @inbetweenai/cli@latest");
    process.exit(1);
  }

  const env = { ...process.env };
  // Tell codex-shell which config to use.
  env.INBETWEEN_CONFIG_PATH = configPath;
  // CODEX_HOME for --local mode (project-scoped Codex MCP).
  const codexHome = codexLocalHome();
  if (existsSync(codexHome)) {
    env.CODEX_HOME = codexHome;
  }
  // Owner-mode --agent override.
  if (opts.agent && config.agents) {
    const target = findAgentByName(config, opts.agent);
    if (target) {
      env.INBETWEEN_AUTH_TOKEN = target.auth_token;
      env.INBETWEEN_AGENT_NAME = target.name;
    }
  }

  const child = spawn(process.execPath, [codexShellEntry, ...opts.passthroughArgs], {
    stdio: "inherit",
    env,
  });
  child.on("error", (e) => {
    err(`Failed to spawn codex wrapper: ${e.message}`);
    process.exit(1);
  });
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
