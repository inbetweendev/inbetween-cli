import prompts from "prompts";
import { existsSync, readFileSync } from "node:fs";
import {
  loadConfig,
  saveConfig,
  DEFAULT_BACKEND_URL,
  DEFAULT_WS_URL,
  type InBetweenConfig,
} from "./config.js";
import { whoami, registerGuest, listMyAgents, actAs } from "./backend.js";
import { writeClaudeMcp, writeCodexMcp } from "./mcp-write.js";
import { homeConfigPath, localConfigPath } from "./paths.js";
import { ok, info, warn, err, C } from "./banner.js";

export interface InitOptions {
  token?: string;
  ownerToken?: string;
  agent?: string; // for owner-mode
  client?: "claude" | "codex" | "both";
  local?: boolean;
  global?: boolean;
  force?: boolean;
  nonInteractive?: boolean;
}

/**
 * Enforce: one device = one owner. If global config already has an
 * owner_token, you can only `init --owner-token` with the same value.
 * Single-agent (--token) or guest are allowed alongside an owner setup
 * (different concepts), but a different owner_token is blocked.
 */
function enforceOwnerLockIn(newOwnerToken: string | null): void {
  const homePath = homeConfigPath();
  if (!existsSync(homePath)) return;
  let existing: any = null;
  try {
    existing = JSON.parse(readFileSync(homePath, "utf-8"));
  } catch {
    return;
  }
  const existingOwner: string | null = existing?.owner_token || null;
  if (!existingOwner) return;
  if (!newOwnerToken) return; // single-agent / guest don't conflict structurally
  if (newOwnerToken === existingOwner) return;
  err(
    `This device is already linked to owner \`${existingOwner.slice(0, 12)}...\``
  );
  err(
    `Only one owner can be active per device. Switch by running:`
  );
  err(`  inbetweenai uninstall`);
  err(`then re-init with the new owner token.`);
  process.exit(1);
}

async function pickScope(opts: InitOptions): Promise<{ local: boolean }> {
  // Explicit flag wins.
  if (opts.local) return { local: true };
  if (opts.global) return { local: false };
  if (opts.nonInteractive) return { local: false };
  const ans = await prompts({
    type: "select",
    name: "scope",
    message: "Where to install this agent?",
    choices: [
      {
        title: "Globally — works in any folder (recommended)",
        value: "global",
      },
      {
        title: `Just this folder (${shortCwd()})`,
        value: "local",
      },
    ],
    initial: 0,
  });
  return { local: ans.scope === "local" };
}

function shortCwd(): string {
  const cwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && cwd.startsWith(home)) return "~" + cwd.slice(home.length);
  return cwd;
}

async function pickClient(
  opts: InitOptions
): Promise<"claude" | "codex" | "both"> {
  if (opts.client) return opts.client;
  if (opts.nonInteractive) return "claude";
  const ans = await prompts({
    type: "select",
    name: "client",
    message: "Which IDE?",
    choices: [
      { title: "Claude Code", value: "claude" },
      { title: "Codex CLI", value: "codex" },
      { title: "Both", value: "both" },
    ],
    initial: 0,
  });
  return ans.client || "claude";
}

type AuthMethod = "guest" | "token" | "owner";

async function pickAuthMethod(opts: InitOptions): Promise<AuthMethod> {
  if (opts.ownerToken) return "owner";
  if (opts.token) return "token";
  if (opts.nonInteractive) return "guest";
  const ans = await prompts({
    type: "select",
    name: "method",
    message: "How would you like to set up?",
    choices: [
      {
        title: "Create a guest agent (try it out, no signup needed)",
        value: "guest",
      },
      {
        title: "I have an agent code (paste a token from inbetween.ai)",
        value: "token",
      },
      {
        title: "Owner mode (multiple agents under one account)",
        value: "owner",
      },
    ],
    initial: 0,
  });
  return ans.method || "guest";
}

async function promptText(
  message: string,
  opts: { mask?: boolean } = {}
): Promise<string> {
  const ans = await prompts({
    type: opts.mask ? "password" : "text",
    name: "v",
    message,
  });
  return (ans.v || "").trim();
}

export async function runInit(opts: InitOptions): Promise<void> {
  // Confirm overwrite if existing.
  const existing = loadConfig();
  if (existing && !opts.force) {
    if (opts.nonInteractive) {
      err(`Existing config at ${existing.path}. Use --force to replace.`);
      process.exit(1);
    }
    const ans = await prompts({
      type: "confirm",
      name: "go",
      message: `Existing config at ${existing.path}. Replace?`,
      initial: false,
    });
    if (!ans.go) {
      info("Aborted.");
      process.exit(0);
    }
  }

  // Auth method.
  const method = await pickAuthMethod(opts);

  // Owner-token enforcement.
  if (method === "owner") {
    let token = opts.ownerToken;
    if (!token) {
      if (opts.nonInteractive) {
        err("--owner-token required in --non-interactive mode for owner method");
        process.exit(1);
      }
      token = await promptText("Paste your owner token (own_...)");
      if (!token.startsWith("own_")) {
        err("Owner tokens start with `own_`. Aborting.");
        process.exit(1);
      }
    }
    enforceOwnerLockIn(token);
    opts.ownerToken = token;
  } else {
    // Single-agent / guest — verify no foreign owner blocking.
    enforceOwnerLockIn(null);
  }

  // Scope.
  const { local } = await pickScope(opts);

  // Client.
  const client = await pickClient(opts);

  // Build config.
  let config: InBetweenConfig;

  if (method === "owner") {
    info(`Fetching agents for owner...`);
    let agents;
    try {
      agents = await listMyAgents(opts.ownerToken!);
    } catch (e: any) {
      err(`Failed to list agents: ${e.message}`);
      process.exit(1);
    }
    if (!agents || agents.length === 0) {
      err("Your owner account has 0 agents. Create one in the Web UI first.");
      process.exit(1);
    }

    let activeAgent = opts.agent;
    if (!activeAgent) {
      if (opts.nonInteractive) {
        activeAgent = agents[0].name;
      } else {
        const ans = await prompts({
          type: "select",
          name: "agent",
          message: "Pick default agent for this scope",
          choices: agents.map((a) => ({
            title: `@${a.name}${a.is_online ? " (online)" : ""}`,
            value: a.name,
          })),
          initial: 0,
        });
        activeAgent = ans.agent || agents[0].name;
      }
    }
    if (!agents.find((a) => a.name === activeAgent)) {
      err(`Agent @${activeAgent} not found in your owner account.`);
      err(`Available: ${agents.map((a) => "@" + a.name).join(", ")}`);
      process.exit(1);
    }

    info(`Resolving agent tokens...`);
    const agentEntries = [];
    for (const a of agents) {
      try {
        const r = await actAs(opts.ownerToken!, a.id);
        agentEntries.push({
          id: r.agent_id,
          name: r.name,
          auth_token: r.auth_token,
        });
      } catch (e: any) {
        warn(`Failed to act-as @${a.name}: ${e.message}`);
      }
    }

    config = {
      owner_token: opts.ownerToken!,
      agents: agentEntries,
      active_agent: activeAgent,
      backend_url: DEFAULT_BACKEND_URL,
      ws_url: DEFAULT_WS_URL,
      default_ide: client === "both" ? "claude" : (client as any),
    };
  } else if (method === "token") {
    let token = opts.token;
    if (!token) {
      if (opts.nonInteractive) {
        err("--token required in --non-interactive token mode");
        process.exit(1);
      }
      token = await promptText("Paste your agent code");
      if (!token) {
        err("Empty token. Aborting.");
        process.exit(1);
      }
    }
    info(`Resolving token...`);
    let me;
    try {
      me = await whoami(token);
    } catch (e: any) {
      err(`Failed to resolve token: ${e.message}`);
      process.exit(1);
    }
    config = {
      agent_name: me.name,
      auth_token: token,
      backend_url: DEFAULT_BACKEND_URL,
      ws_url: DEFAULT_WS_URL,
      default_ide: client === "both" ? "claude" : (client as any),
    };
    ok(`Linked to @${me.name}`);
  } else {
    // Guest mode.
    let agentName: string | undefined;
    if (!opts.nonInteractive) {
      const ans = await prompts({
        type: "text",
        name: "name",
        message: "Pick an agent name (or press Enter for random)",
      });
      agentName = ans.name?.trim() || undefined;
    }
    info(`Creating guest agent${agentName ? ` @${agentName}` : ""}...`);
    let created;
    try {
      created = await registerGuest(agentName);
    } catch (e: any) {
      err(`Failed to create guest agent: ${e.message}`);
      process.exit(1);
    }
    config = {
      agent_name: created.name,
      auth_token: created.auth_token,
      backend_url: DEFAULT_BACKEND_URL,
      ws_url: DEFAULT_WS_URL,
      default_ide: client === "both" ? "claude" : (client as any),
    };
    ok(`Created @${created.name}`);
  }

  // Default IDE prompt for `both`.
  if (client === "both" && !opts.nonInteractive) {
    const ans = await prompts({
      type: "select",
      name: "def",
      message: "Default IDE for `inbetweenai` (no args)",
      choices: [
        { title: "Claude (recommended)", value: "claude" },
        { title: "Codex", value: "codex" },
      ],
      initial: 0,
    });
    config.default_ide = ans.def || "claude";
  }

  // Save config.
  const configPath = saveConfig(config, { local });
  ok(`Config saved → ${configPath}`);

  // Wire MCP.
  if (client === "claude" || client === "both") {
    const p = writeClaudeMcp({ configFile: configPath, local });
    ok(`Claude MCP wired → ${p}`);
  }
  if (client === "codex" || client === "both") {
    const p = writeCodexMcp({ configFile: configPath, local });
    ok(`Codex MCP wired → ${p}`);
  }

  process.stderr.write(
    `\n${C.bold}Done.${C.reset} Run: ${C.cyan}inbetweenai${C.reset}\n` +
      `${C.dim}(re-run \`inbetweenai init\` any time to change config)${C.reset}\n\n`
  );
}
