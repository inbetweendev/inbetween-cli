import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { C } from "./banner.js";

const CACHE_FILE = join(homedir(), ".inbetween", ".update-check");
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;
const PKG = "@inbetweenai/cli";

function cacheValid(): boolean {
  try {
    if (!existsSync(CACHE_FILE)) return false;
    const t = Number(readFileSync(CACHE_FILE, "utf-8").trim());
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < TTL_MS;
  } catch {
    return false;
  }
}

function bumpCache(): void {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, String(Date.now()));
  } catch {}
}

function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => Number(x.split("-")[0]) || 0);
  const pb = b.split(".").map((x) => Number(x.split("-")[0]) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

function currentVersion(): string | null {
  try {
    const r = createRequire(import.meta.url);
    return r("../package.json").version;
  } catch {
    return null;
  }
}

export async function maybeNotifyUpdate(): Promise<void> {
  // Opt-out hatch for CI / pipelines / paranoid users.
  if (process.env.INBETWEEN_NO_UPDATE_CHECK === "1") return;
  if (cacheValid()) return;

  const current = currentVersion();
  if (!current) return;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://registry.npmjs.org/${PKG}/latest`, {
      signal: ctrl.signal,
    });
    if (!res.ok) return;
    const body: any = await res.json();
    const latest: string | undefined = body?.version;
    if (latest && semverGt(latest, current)) {
      process.stderr.write(
        `\n${C.bold}[inbetween]${C.reset} update available: ${C.dim}${current}${C.reset} → ${C.bold}${latest}${C.reset}\n` +
          `  ${C.cyan}npm install -g ${PKG}@latest${C.reset}\n\n`,
      );
    }
    bumpCache();
  } catch {
    // Silent — best-effort. Don't bump cache on network failure so we'll
    // retry sooner.
  } finally {
    clearTimeout(timer);
  }
}
