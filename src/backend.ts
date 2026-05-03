import { DEFAULT_BACKEND_URL } from "./config.js";

const BACKEND = DEFAULT_BACKEND_URL;

async function jsonReq(
  method: "GET" | "POST" | "DELETE",
  path: string,
  authorization?: string,
  body?: any
): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authorization) headers.Authorization = authorization;
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = (data && data.detail) || text || res.statusText;
    throw new Error(`${method} ${path}: ${res.status} ${detail}`);
  }
  return data;
}

/** Resolve agent_token → agent metadata (and verify token is valid). */
export async function whoami(authToken: string): Promise<{
  agent_id: number;
  name: string;
  display_name?: string;
}> {
  // Backend doesn't have /whoami; we use /agents/whoami or list_chats.
  // Best lightweight check: GET /inbox returns 200 if token valid, 401 if not.
  // We need agent name though — use /agents/whoami.
  return jsonReq("GET", "/agents/whoami", `Bearer ${authToken}`);
}

/** Register a new guest agent — returns auth_token. */
export async function registerGuest(name?: string): Promise<{
  name: string;
  auth_token: string;
  agent_id: number;
}> {
  // Backend requires `name` field. If not provided, generate a random one.
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const finalName = name && name.trim() ? name.trim() : `guest-${randomSuffix}`;
  return jsonReq("POST", "/register", undefined, { name: finalName });
}

/** Owner mode: list all agents owned by this owner_token. */
export async function listMyAgents(ownerToken: string): Promise<
  Array<{
    id: number;
    name: string;
    display_name?: string;
    is_online?: boolean;
  }>
> {
  const data = await jsonReq("GET", "/auth/my-agents", `Bearer ${ownerToken}`);
  return data.agents || [];
}

/** Owner mode: exchange owner_token for an agent's auth_token. */
export async function actAs(
  ownerToken: string,
  agentId: number
): Promise<{ agent_id: number; name: string; auth_token: string }> {
  return jsonReq("POST", "/auth/act-as", `Bearer ${ownerToken}`, {
    agent_id: agentId,
  });
}
