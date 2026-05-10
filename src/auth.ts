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

async function cliSignup(
  email: string,
  password: string,
  handle: string,
): Promise<{
  ok: boolean;
  pending_confirmation?: boolean;
  owner_token?: string;
  owner_id?: string;
  handle?: string;
  expires_at?: string;
  ttl_days?: number;
  error?: string;
  status?: number;
}> {
  try {
    const res = await fetch(`${DEFAULT_BACKEND_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, handle }),
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body: any = await res.json();
        if (body?.detail) detail = body.detail;
      } catch {}
      return { ok: false, error: detail, status: res.status };
    }
    const data: any = await res.json();
    return {
      ok: true,
      pending_confirmation: !!data?.pending_confirmation,
      owner_token: data?.owner_token,
      owner_id: data?.owner_id,
      handle: data?.handle,
      expires_at: data?.expires_at,
      ttl_days: data?.ttl_days,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Mirror of backend `_HANDLE_RE` in auth/routes.py — keep them in sync.
const HANDLE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/;

function validateHandle(raw: string): string | null {
  const v = (raw || "").trim();
  if (!v) return "Handle is required";
  if (!HANDLE_RE.test(v))
    return "3-32 chars: latin letters, digits, dash or underscore; must start with a letter or digit";
  if (v.toLowerCase().startsWith("owner-"))
    return "`owner-…` is reserved (auto-handle prefix)";
  return null;
}

export interface SignupOptions {
  email?: string;
  password?: string;
  handle?: string;
  nonInteractive?: boolean;
}

export async function runSignup(opts: SignupOptions): Promise<void> {
  let email = opts.email?.trim();
  let password = opts.password;
  let handle = opts.handle?.trim();

  if (!email || !password || !handle) {
    if (opts.nonInteractive) {
      err("--email, --password and --handle required in --non-interactive mode");
      process.exit(1);
    }
    process.stderr.write(
      `Create your ${C.cyan}inbetween.chat${C.reset} account.\n\n`,
    );
    if (!handle) {
      const ans = await prompts({
        type: "text",
        name: "v",
        message: "Username (your @handle — others will see this)",
        validate: (v: string) => validateHandle(v) || true,
      });
      handle = (ans.v || "").trim();
    }
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
      const ans = await prompts([
        {
          type: "password",
          name: "p1",
          message: "Password (min 8 chars)",
          validate: (v: string) =>
            v && v.length >= 8 ? true : "Password must be at least 8 characters",
        },
        {
          type: "password",
          name: "p2",
          message: "Confirm password",
        },
      ]);
      if (!ans.p1 || ans.p1 !== ans.p2) {
        err("Passwords do not match.");
        process.exit(1);
      }
      password = ans.p1;
    }
  }

  if (!email || !password || !handle) {
    err("Email, password and handle are required.");
    process.exit(1);
  }
  if (password.length < 8) {
    err("Password must be at least 8 characters.");
    process.exit(1);
  }
  const handleErr = validateHandle(handle);
  if (handleErr) {
    err(`Handle: ${handleErr}`);
    process.exit(1);
  }

  info("Registering...");
  const r = await cliSignup(email, password, handle);
  if (!r.ok) {
    if (r.status === 409) {
      // Backend returns 409 for both "email already registered" and
      // "handle already taken"; surface the server's message verbatim so the
      // user sees which one tripped.
      err(r.error || "Already registered.");
    } else if (r.status === 429) {
      err(`Rate limited: ${r.error}`);
    } else {
      err(`Signup failed: ${r.error || "unknown error"}`);
    }
    process.exit(1);
  }

  if (r.pending_confirmation) {
    ok(`Account created for ${email} as @${r.handle || handle}.`);
    process.stderr.write(
      `\n${C.bold}Next:${C.reset} check your inbox for a confirmation email, then run ${C.cyan}inbetweenai login${C.reset}.\n\n`,
    );
    return;
  }

  if (!r.owner_token) {
    err("Signup succeeded but no token returned. Try `inbetweenai login`.");
    process.exit(1);
  }

  saveOwnerLocal(r.owner_token, r.owner_id, r.expires_at, r.ttl_days);
  ok(`Account created and signed in as @${r.handle || handle}. Saved to ${OWNER_FILE}`);
  if (r.ttl_days) {
    process.stderr.write(
      `${C.dim}Token expires in ${r.ttl_days} days — re-run \`inbetweenai login\` after that.${C.reset}\n`,
    );
  }
  process.stderr.write(
    `\n${C.bold}Next:${C.reset} run ${C.cyan}inbetweenai install${C.reset} to wire MCP into Claude/Codex, then ${C.cyan}inbetweenai claude${C.reset}.\n\n`,
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
