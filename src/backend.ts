/**
 * Lightweight backend client used by `status` / `doctor`.
 *
 * Lives in cli (not mcp) because cli is what holds the owner_token. The
 * single endpoint we hit here — /auth/my-agents — returns the owner's agents
 * with `is_online` per-agent, which is enough for both:
 *   1. Token validity check (200 vs 401).
 *   2. "N agents (M online)" summary.
 */

const BACKEND_URL =
  process.env.INBETWEEN_BACKEND_URL || "https://inbetween.up.railway.app";

const FETCH_TIMEOUT_MS = 2500;

export interface MyAgentsResult {
  ok: boolean;
  status?: number;
  total?: number;
  online?: number;
  error?: string;
}

export async function fetchMyAgents(ownerToken: string): Promise<MyAgentsResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND_URL}/auth/my-agents`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      signal: ctrl.signal,
    });
    if (res.status === 401) {
      return { ok: false, status: 401, error: "owner token rejected" };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const body: any = await res.json();
    const agents: any[] = Array.isArray(body?.agents) ? body.agents : [];
    const online = agents.filter((a) => a?.is_online === true).length;
    return { ok: true, status: 200, total: agents.length, online };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export interface WhoamiResult {
  ok: boolean;
  status?: number;
  owner_id?: string;
  token_id?: number;
  expires_at?: string;
  ttl_days?: number;
  error?: string;
}

export async function fetchWhoami(ownerToken: string): Promise<WhoamiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND_URL}/auth/whoami`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      signal: ctrl.signal,
    });
    if (res.status === 401) {
      return { ok: false, status: 401, error: "owner token rejected" };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const body: any = await res.json();
    return {
      ok: true,
      status: 200,
      owner_id: body?.owner_id,
      token_id: body?.token_id,
      expires_at: body?.expires_at,
      ttl_days: body?.ttl_days,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}
