import prompts from "prompts";
import {
  loadConfig,
  saveConfig,
  DEFAULT_BACKEND_URL,
  DEFAULT_WS_URL,
  type InBetweenConfig,
} from "./config.js";
import { whoami, registerGuest, listMyAgents, actAs } from "./backend.js";
import { writeClaudeMcp, writeCodexMcp } from "./mcp-write.js";
import { ok, info, warn, err, C } from "./banner.js";

export interface InitOptions {
  token?: string;
  ownerToken?: string;
  agent?: string; // for owner-mode
  client?: "claude" | "codex" | "both";
  local?: boolean;
  force?: boolean;
  nonInteractive?: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  // Detect existing config — confirm overwrite unless --force.
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

  // Determine which IDE(s).
  let client = opts.client;
  if (!client && !opts.nonInteractive) {
    const ans = await prompts({
      type: "select",
      name: "client",
      message: "Pick IDE",
      choices: [
        { title: "Claude Code", value: "claude" },
        { title: "Codex CLI", value: "codex" },
        { title: "Both", value: "both" },
      ],
      initial: 0,
    });
    client = ans.client || "claude";
  }
  if (!client) client = "claude";

  // Build config.
  let config: InBetweenConfig;

  if (opts.ownerToken) {
    // Owner mode.
    info(`Fetching agents for owner...`);
    let agents;
    try {
      agents = await listMyAgents(opts.ownerToken);
    } catch (e: any) {
      err(`Failed to list agents: ${e.message}`);
      process.exit(1);
    }
    if (!agents || agents.length === 0) {
      err("Your owner account has 0 agents. Create one in the Web UI first.");
      process.exit(1);
    }

    // Pick default agent.
    let activeAgent = opts.agent;
    if (!activeAgent) {
      if (opts.nonInteractive) {
        // Default to first agent.
        activeAgent = agents[0].name;
      } else {
        const ans = await prompts({
          type: "select",
          name: "agent",
          message: "Pick default agent for this folder/machine",
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

    // Resolve all agent_tokens via /auth/act-as.
    info(`Resolving agent tokens...`);
    const agentEntries = [];
    for (const a of agents) {
      try {
        const r = await actAs(opts.ownerToken, a.id);
        agentEntries.push({ id: r.agent_id, name: r.name, auth_token: r.auth_token });
      } catch (e: any) {
        warn(`Failed to act-as @${a.name}: ${e.message}`);
      }
    }

    config = {
      owner_token: opts.ownerToken,
      agents: agentEntries,
      active_agent: activeAgent,
      backend_url: DEFAULT_BACKEND_URL,
      ws_url: DEFAULT_WS_URL,
      default_ide: client === "both" ? "claude" : (client as any),
    };
  } else if (opts.token) {
    // Single-agent mode with explicit token.
    info(`Resolving token...`);
    let me;
    try {
      me = await whoami(opts.token);
    } catch (e: any) {
      err(`Failed to resolve token: ${e.message}`);
      process.exit(1);
    }
    config = {
      agent_name: me.name,
      auth_token: opts.token,
      backend_url: DEFAULT_BACKEND_URL,
      ws_url: DEFAULT_WS_URL,
      default_ide: client === "both" ? "claude" : (client as any),
    };
    ok(`Linked to @${me.name}`);
  } else {
    // Guest mode — interactive name picker.
    let agentName: string | undefined;
    if (!opts.nonInteractive) {
      const ans = await prompts({
        type: "text",
        name: "name",
        message: "Pick agent name (Enter for random guest)",
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

  // For 'both' client mode — ask user for default IDE.
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
  const configPath = saveConfig(config, { local: opts.local });
  ok(`Config saved → ${configPath}`);

  // Wire MCP entries.
  if (client === "claude" || client === "both") {
    const p = writeClaudeMcp({ configFile: configPath, local: opts.local });
    ok(`Claude MCP wired → ${p}`);
  }
  if (client === "codex" || client === "both") {
    const p = writeCodexMcp({ configFile: configPath, local: opts.local });
    ok(`Codex MCP wired → ${p}`);
  }

  process.stderr.write(
    `\n${C.bold}Done.${C.reset} Run: ${C.cyan}inbetweenai${C.reset}\n\n`
  );
}
