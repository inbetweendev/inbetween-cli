import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const SESSION_DIR = join(homedir(), ".inbetween", "sessions");

export interface SessionInfo {
  agent_name?: string;
  display_name?: string;
  agent_id?: number;
  chat_id?: number | string;
  /** Path to the file the data was loaded from. */
  source: string;
  /** "default" for `<cwdHash>.json`, or the per-session key suffix. */
  variant: string;
}

function cwdHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

function loadSession(path: string, variant: string): SessionInfo | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return null;
    const json = JSON.parse(raw);
    return {
      agent_name: json.agent_name,
      display_name: json.display_name ?? json.agent_name,
      agent_id: json.agent_id,
      chat_id: json.chat_id,
      source: path,
      variant,
    };
  } catch {
    return null;
  }
}

/**
 * Find the agent (if any) bound to the current working directory.
 * Returns the default-session agent (`<cwdHash>.json`) if present;
 * otherwise the first per-key session for this cwd if one exists;
 * otherwise null.
 */
export function findCwdAgent(cwd: string = process.cwd()): SessionInfo | null {
  const hash = cwdHash(cwd);
  const defaultFile = join(SESSION_DIR, `${hash}.json`);

  const def = loadSession(defaultFile, "default");
  if (def) return def;

  // Fallback — any `<hash>__<key>.json` file (multi-window per-session id).
  try {
    if (!existsSync(SESSION_DIR)) return null;
    const matches = readdirSync(SESSION_DIR).filter(
      (f) => f.startsWith(`${hash}__`) && f.endsWith(".json"),
    );
    for (const f of matches) {
      const variant = f.slice(hash.length + 2, -".json".length);
      const info = loadSession(join(SESSION_DIR, f), variant);
      if (info) return info;
    }
  } catch {}
  return null;
}
