import prompts from "prompts";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { ok, err, info, C } from "./banner.js";

const OWNER_FILE = join(homedir(), ".inbetween", "owner.json");
const DEFAULT_BACKEND_URL =
  process.env.INBETWEEN_BACKEND_URL || "https://inbetween.up.railway.app";

interface OwnerState {
  owner_token: string;
  owner_id?: string;
  saved_at: string;
  expires_at?: string;
  ttl_days?: number;
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

function saveOwnerLocal(
  token: string,
  owner_id?: string,
  expires_at?: string,
  ttl_days?: number,
) {
  // ~/.inbetween/ created with 0700, owner.json with 0600. On POSIX umask
  // can mask the mode flag, so chmodSync forces the final perms regardless.
  // On Windows mode/chmod are no-ops; per-user homedir ACLs already isolate.
  mkdirSync(dirname(OWNER_FILE), { recursive: true, mode: 0o700 });
  const payload = JSON.stringify(
    {
      owner_token: token,
      owner_id,
      saved_at: new Date().toISOString(),
      expires_at,
      ttl_days,
    },
    null,
    2,
  );
  writeFileSync(OWNER_FILE, payload, { mode: 0o600 });
  try { chmodSync(OWNER_FILE, 0o600); } catch {}
}

function clearOwnerLocal() {
  if (existsSync(OWNER_FILE)) writeFileSync(OWNER_FILE, "{}");
}

async function cliLogin(
  email: string,
  password: string,
): Promise<{
  ok: boolean;
  owner_token?: string;
  owner_id?: string;
  expires_at?: string;
  ttl_days?: number;
  error?: string;
}> {
  try {
    const res = await fetch(`${DEFAULT_BACKEND_URL}/auth/cli-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body: any = await res.json();
        if (body?.detail) detail = body.detail;
      } catch {}
      return { ok: false, error: detail };
    }
    const data: any = await res.json();
    return {
      ok: true,
      owner_token: data?.owner_token,
      owner_id: data?.owner_id,
      expires_at: data?.expires_at,
      ttl_days: data?.ttl_days,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export interface LoginOptions {
  email?: string;
  password?: string;
  nonInteractive?: boolean;
}

export async function runLogin(opts: LoginOptions): Promise<void> {
  let email = opts.email?.trim();
  let password = opts.password;

  if (!email || !password) {
    if (opts.nonInteractive) {
      err("--email and --password required in --non-interactive mode");
      process.exit(1);
    }
    process.stderr.write(
      `Sign in with your ${C.cyan}inbetween.chat${C.reset} account.\n\n`,
    );
    if (!email) {
      const ans = await prompts({
        type: "text",
        name: "v",
        message: "Email",
        validate: (v: string) =>
          v.includes("@") && v.length >= 3 ? true : "Looks like that's not an email",
      });
      email = (ans.v || "").trim();
    }
    if (!password) {
      const ans = await prompts({
        type: "password",
        name: "v",
        message: "Password",
      });
      password = ans.v || "";
    }
  }

  if (!email || !password) {
    err("Email and password are required.");
    process.exit(1);
  }

  info("Signing in...");
  const r = await cliLogin(email, password);
  if (!r.ok || !r.owner_token) {
    err(`Login failed: ${r.error || "unknown error"}`);
    process.exit(1);
  }
  saveOwnerLocal(r.owner_token, r.owner_id, r.expires_at, r.ttl_days);
  ok(`Signed in. Saved to ${OWNER_FILE}`);
  if (r.ttl_days) {
    process.stderr.write(
      `${C.dim}Token expires in ${r.ttl_days} days — re-run \`inbetweenai login\` after that.${C.reset}\n`,
    );
  }
  process.stderr.write(
    `\n${C.bold}Next:${C.reset} run ${C.cyan}inbetweenai claude${C.reset} (or ${C.cyan}codex${C.reset}) and paste a chat onboarding prompt to start working.\n\n`,
  );
}

async function revokeOwnerTokenServerSide(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${DEFAULT_BACKEND_URL}/auth/cli-logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function runLogout(): Promise<void> {
  const state = loadOwnerLocal();
  if (!state) {
    info("Not currently signed in.");
    return;
  }
  // Best-effort server-side revoke first. If it fails (offline, backend down,
  // token already revoked), still wipe the local file — user explicitly
  // asked to log out, never strand them with a half-state.
  const r = await revokeOwnerTokenServerSide(state.owner_token);
  if (!r.ok) {
    info(`Server revoke skipped (${r.error}); clearing local file anyway.`);
  }
  clearOwnerLocal();
  ok(`Signed out. ${OWNER_FILE} cleared.`);
}

export function getOwnerState(): OwnerState | null {
  return loadOwnerLocal();
}

export { OWNER_FILE };
