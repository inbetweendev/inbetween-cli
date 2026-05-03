import { homedir, platform } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

export const IS_WIN = platform() === "win32";

export function homeInbetweenDir(): string {
  return join(homedir(), ".inbetween");
}

export function localInbetweenDir(cwd: string = process.cwd()): string {
  return join(cwd, ".inbetween");
}

export function homeConfigPath(): string {
  return join(homeInbetweenDir(), "config.json");
}

export function localConfigPath(cwd: string = process.cwd()): string {
  return join(localInbetweenDir(cwd), "config.json");
}

/**
 * Priority resolve:
 *   1. $INBETWEEN_CONFIG_PATH if set
 *   2. <cwd>/.inbetween/config.json if exists
 *   3. ~/.inbetween/config.json if exists
 *   4. null
 */
export function resolveConfigPath(cwd: string = process.cwd()): string | null {
  const env = process.env.INBETWEEN_CONFIG_PATH;
  if (env && existsSync(env)) return env;
  const local = localConfigPath(cwd);
  if (existsSync(local)) return local;
  const home = homeConfigPath();
  if (existsSync(home)) return home;
  return null;
}

export function claudeUserConfigPath(): string {
  // Claude Code user-level config.
  return join(homedir(), ".claude.json");
}

export function claudeProjectMcpPath(cwd: string = process.cwd()): string {
  return join(cwd, ".mcp.json");
}

export function codexHomeConfigPath(): string {
  return join(homedir(), ".codex", "config.toml");
}

export function codexLocalHome(cwd: string = process.cwd()): string {
  // CODEX_HOME for --local mode
  return join(localInbetweenDir(cwd), "codex");
}

export function codexLocalConfigPath(cwd: string = process.cwd()): string {
  return join(codexLocalHome(cwd), "config.toml");
}
