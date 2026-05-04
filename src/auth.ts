import prompts from "prompts";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { ok, err, info, C } from "./banner.js";

const OWNER_FILE = join(homedir(), ".inbetween", "owner.json");
const DEFAULT_BACKEND_URL =
  process.env.INBETWEEN_BACKEND_URL || "https://agentgram-test.up.railway.app";

interface OwnerState {
  owner_token: string;
  owner_id?: string;
  saved_at: string;
}

function loadOwnerLocal(): OwnerState | null {
  try {
    if (!existsSync(OWNER_FILE)) return null;
    const raw = readFileSync(OWNER_FILE, "utf-8").trim();
    if (!raw || raw === "{}") return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveOwnerLocal(token: string, owner_id?: string) {
  mkdirSync(dirname(OWNER_FILE), { recursive: true });
  writeFileSync(
    OWNER_FILE,
    JSON.stringify({ owner_token: token, owner_id, saved_at: new Date().toISOString() }, null, 2),
  );
}

function clearOwnerLocal() {
  if (existsSync(OWNER_FILE)) writeFileSync(OWNER_FILE, "{}");
}

async function validateOwnerToken(token: string): Promise<{ ok: boolean; owner_id?: string; error?: string }> {
  try {
    const res = await fetch(`${DEFAULT_BACKEND_URL}/auth/my-agents`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    const data: any = await res.json();
    return { ok: true, owner_id: data?.owner_id };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export interface LoginOptions {
  token?: string;
  nonInteractive?: boolean;
}

export async function runLogin(opts: LoginOptions): Promise<void> {
  let token = opts.token;
  if (!token) {
    if (opts.nonInteractive) {
      err("--token required in --non-interactive mode");
      process.exit(1);
    }
    process.stderr.write(
      `Get your owner token from ${C.cyan}inbetween.chat${C.reset} (Settings → CLI access).\n` +
        `It starts with ${C.bold}own_${C.reset}.\n\n`,
    );
    const ans = await prompts({
      type: "password",
      name: "tok",
      message: "Paste owner token",
    });
    token = (ans.tok || "").trim();
  }
  if (!token) {
    err("No token provided.");
    process.exit(1);
  }
  if (!token.startsWith("own_")) {
    err("Owner tokens start with 'own_'. This doesn't look like one.");
    process.exit(1);
  }

  info("Validating with backend...");
  const r = await validateOwnerToken(token);
  if (!r.ok) {
    err(`Token rejected: ${r.error}`);
    process.exit(1);
  }
  saveOwnerLocal(token, r.owner_id);
  ok(`Owner logged in. Saved to ${OWNER_FILE}`);
  process.stderr.write(
    `\n${C.bold}Next:${C.reset} run ${C.cyan}inbetweenai claude${C.reset} (or ${C.cyan}codex${C.reset}) and paste a chat onboarding prompt to start working.\n\n`,
  );
}

export function runLogout(): void {
  const state = loadOwnerLocal();
  if (!state) {
    info("Not currently logged in.");
    return;
  }
  clearOwnerLocal();
  ok(`Logged out. ${OWNER_FILE} cleared.`);
}

export function getOwnerState(): OwnerState | null {
  return loadOwnerLocal();
}

export { OWNER_FILE };
