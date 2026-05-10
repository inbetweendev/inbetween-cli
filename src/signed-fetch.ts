/**
 * Same shape as the MCP / codex-shell helpers — keeps the public InBetween
 * client surface uniform. See @inbetweenai/mcp scripts/build.mjs for how
 * the secret is injected.
 */
import { createHash, createHmac, randomBytes } from "crypto";

const BUILD_SECRET = process.env.INBETWEEN_BUILD_SECRET || "";
const CLIENT_VERSION = process.env.INBETWEEN_CLIENT_VERSION || "0.0.0-dev";

function sign(
  method: string,
  pathWithQuery: string,
  body: string,
): { sig: string; ts: string; nonce: string } {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const base = `${method.toUpperCase()}\n${pathWithQuery}\n${ts}\n${nonce}\n${bodyHash}`;
  const sig = createHmac("sha256", BUILD_SECRET).update(base).digest("hex");
  return { sig, ts, nonce };
}

export async function signedFetch(
  fullUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(fullUrl);
  const method = (init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  const headers = new Headers(init.headers || {});
  headers.set("X-Client-Version", CLIENT_VERSION);
  if (BUILD_SECRET) {
    const { sig, ts, nonce } = sign(
      method,
      url.pathname + (url.search || ""),
      body,
    );
    headers.set("X-Signature", sig);
    headers.set("X-Timestamp", ts);
    headers.set("X-Nonce", nonce);
  }
  return fetch(fullUrl, { ...init, headers });
}

export { CLIENT_VERSION };
