import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  homeConfigPath,
  localConfigPath,
  resolveConfigPath,
} from "./paths.js";

export interface AgentEntry {
  id: number;
  name: string;
  auth_token: string;
}

export interface InBetweenConfig {
  // Single-agent mode
  agent_name?: string;
  auth_token?: string;
  // Owner mode
  owner_token?: string;
  agents?: AgentEntry[];
  active_agent?: string;
  // Common
  backend_url: string;
  ws_url: string;
  default_ide?: "claude" | "codex";
}

export const DEFAULT_BACKEND_URL =
  process.env.INBETWEEN_BACKEND_URL ||
  "https://agentgram-test.up.railway.app";
export const DEFAULT_WS_URL =
  process.env.INBETWEEN_WS_URL ||
  "wss://agentgram-test.up.railway.app/ws";

export function loadConfig(cwd: string = process.cwd()): {
  config: InBetweenConfig;
  path: string;
} | null {
  const path = resolveConfigPath(cwd);
  if (!path) return null;
  try {
    const config = JSON.parse(readFileSync(path, "utf-8")) as InBetweenConfig;
    return { config, path };
  } catch (e) {
    throw new Error(`Failed to parse config at ${path}: ${e}`);
  }
}

export function saveConfig(
  config: InBetweenConfig,
  opts: { local?: boolean; cwd?: string }
): string {
  const cwd = opts.cwd || process.cwd();
  const path = opts.local ? localConfigPath(cwd) : homeConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  return path;
}

/** Get the auth_token to use given current config & active selection. */
export function activeAuthToken(config: InBetweenConfig): string | null {
  if (config.auth_token) return config.auth_token;
  if (config.agents && config.active_agent) {
    const found = config.agents.find((a) => a.name === config.active_agent);
    if (found) return found.auth_token;
  }
  if (config.agents && config.agents.length > 0) {
    return config.agents[0].auth_token;
  }
  return null;
}

export function activeAgentName(config: InBetweenConfig): string | null {
  if (config.agent_name) return config.agent_name;
  if (config.active_agent) return config.active_agent;
  if (config.agents && config.agents.length > 0) return config.agents[0].name;
  return null;
}

/** Find agent in owner-mode list. */
export function findAgentByName(
  config: InBetweenConfig,
  name: string
): AgentEntry | null {
  if (!config.agents) return null;
  return config.agents.find((a) => a.name === name) || null;
}

export function isOwnerMode(config: InBetweenConfig): boolean {
  return !!config.owner_token;
}
