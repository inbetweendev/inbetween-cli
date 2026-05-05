import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { C } from "./banner.js";

// Per-package cache lives under ~/.inbetween/.update-check-<pkg>. Each line:
// `<latest>\t<checkedAtMs>`. TTL 24h.
const CACHE_DIR = join(homedir(), ".inbetween");
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

const CLI_PKG = "@inbetweenai/cli";

function cacheFile(pkg: string): string {
  // Replace slashes / @ for filesystem safety. e.g. @inbetweenai/cli → inbetweenai-cli.
  const safe = pkg.replace(/^@/, "").replace(/\//g, "-");
  return join(CACHE_DIR, `.update-check-${safe}`);
}

function readCache(pkg: string): { latest: string; checkedAt: number } | null {
  try {
    const f = cacheFile(pkg);
    if (!existsSync(f)) return null;
    const raw = readFileSync(f, "utf-8").trim();
    const [latest, ts] = raw.split("\t");
    const checkedAt = Number(ts);
    if (!latest || !Number.isFinite(checkedAt)) return null;
    return { latest, checkedAt };
  } catch {
    return null;
  }
}

function writeCache(pkg: string, latest: string): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile(pkg), `${latest}\t${Date.now()}`);
  } catch {}
}

function isCacheFresh(pkg: string): boolean {
  const c = readCache(pkg);
  return !!c && Date.now() - c.checkedAt < TTL_MS;
}

export function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => Number(x.split("-")[0]) || 0);
  const pb = b.split(".").map((x) => Number(x.split("-")[0]) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

function currentCliVersion(): string | null {
  try {
    const r = createRequire(import.meta.url);
    return r("../package.json").version;
  } catch {
    return null;
  }
}

/**
 * Fetch the latest version of `pkg` from npm, or return cached if still fresh.
 * Returns null if the registry is unreachable and no cache exists.
 */
export async function fetchLatest(pkg: string): Promise<string | null> {
  if (isCacheFresh(pkg)) {
    return readCache(pkg)!.latest;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // Fall back to stale cache if any.
      const c = readCache(pkg);
      return c?.latest ?? null;
    }
    const body: any = await res.json();
    const latest: string | undefined = body?.version;
    if (!latest) {
      const c = readCache(pkg);
      return c?.latest ?? null;
    }
    writeCache(pkg, latest);
    return latest;
  } catch {
    const c = readCache(pkg);
    return c?.latest ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check whether `current` is older than the latest published version of `pkg`.
 * Best-effort, network-cached. Returns null if we have no info either way.
 */
export interface DriftInfo {
  current: string;
  latest: string;
  outdated: boolean;
}
export async function checkDrift(pkg: string, current: string): Promise<DriftInfo | null> {
  const latest = await fetchLatest(pkg);
  if (!latest) return null;
  return { current, latest, outdated: semverGt(latest, current) };
}

/**
 * Foreground notification used at CLI start. Prints a single update banner if
 * the cli itself is outdated. Quiet on cache-hit / disabled / network failure.
 */
export async function maybeNotifyUpdate(): Promise<void> {
  // Opt-out hatch for CI / pipelines / paranoid users.
  if (process.env.INBETWEEN_NO_UPDATE_CHECK === "1") return;
  if (isCacheFresh(CLI_PKG)) return;

  const current = currentCliVersion();
  if (!current) return;

  const latest = await fetchLatest(CLI_PKG);
  if (latest && semverGt(latest, current)) {
    process.stderr.write(
      `\n${C.bold}[inbetween]${C.reset} update available: ${C.dim}${current}${C.reset} → ${C.bold}${latest}${C.reset}\n` +
        `  ${C.cyan}npm install -g ${CLI_PKG}@latest${C.reset}\n\n`,
    );
  }
}
