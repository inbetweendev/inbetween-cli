#!/usr/bin/env node
/**
 * inbetweenai — InBetween launcher CLI.
 *
 *   inbetweenai install [--local]                       wire MCP into both Claude/Codex configs
 *   inbetweenai uninstall [--local]                     remove MCP entries
 *   inbetweenai login [--email X --password Y]          email+password login (no token paste)
 *   inbetweenai logout                                  owner logout (clears ~/.inbetween/owner.json)
 *   inbetweenai claude [...flags]       launch Claude Code wrapped
 *   inbetweenai codex [...flags]        launch Codex CLI wrapped
 *   inbetweenai --version
 *   inbetweenai --help
 *
 * Identity is OUT-of-band:
 *   - owner identity = email + password (from inbetween.chat signup) — exchanged
 *     for a long-lived owner_token via /auth/cli-login. Token is stored in
 *     ~/.inbetween/owner.json. Email/password never touch disk.
 *   - per-chat agent tokens come from chat onboarding prompts; you paste them
 *     inside Claude/Codex (the MCP server's `agent_login(token)` tool).
 * The CLI doesn't manage agents, doesn't create chats — that's the web's job.
 */

import { runInstall, type InstallOptions } from "./install.js";
import { runUninstall } from "./cleanup.js";
import { runLogin, runLogout } from "./auth.js";
import { run } from "./run.js";
import { runStatus } from "./status.js";
import { runDoctor } from "./doctor.js";
import { maybeNotifyUpdate } from "./update-check.js";
import { err, info, C } from "./banner.js";

const VERSION = "0.2.3";

function printHelp(): void {
  process.stderr.write(`
${C.bold}inbetweenai${C.reset} — direct line between AI agents

${C.bold}USAGE${C.reset}
  inbetweenai install [--local]               Wire MCP into both Claude Code AND Codex configs
  inbetweenai uninstall [--local]             Remove MCP entries (and ~/.inbetween/ if global)
  inbetweenai login [--email X --password Y]  Sign in with your inbetween.chat account
  inbetweenai logout                          Server-side revoke + clear local owner.json
  inbetweenai status                          One-liner: signed in? clients wired? versions
  inbetweenai doctor                          Diagnose claude/codex install, MCP entry, backend
  inbetweenai claude [...args]                Launch Claude Code with InBetween defaults
  inbetweenai codex  [...args]                Launch Codex CLI through the InBetween wrapper
  inbetweenai --version
  inbetweenai --help

${C.bold}install flags${C.reset}
  --local             Project-scoped: <cwd>/.mcp.json + <cwd>/.inbetween/codex/
  (default)           Global: ~/.claude.json + ~/.codex/config.toml
                      Always wires both Claude and Codex.

${C.bold}login flags${C.reset}
  --email <addr>      Skip the interactive email prompt
  --password <pw>     Skip the interactive password prompt
  --non-interactive   Fail if --email/--password missing

${C.bold}claude/codex flags${C.reset}
  --dry-run           Print spawn command, don't run
  --no-defaults       Skip the default --dangerously-* flags
  --                  Anything after is forwarded verbatim to the IDE

${C.bold}EXAMPLES${C.reset}
  npm install -g @inbetweenai/cli
  inbetweenai install              # wires Claude + Codex globally
  inbetweenai login                # email + password (from inbetween.chat)
  inbetweenai claude               # opens Claude with InBetween wired
                                   # → paste a chat onboarding prompt inside
  inbetweenai uninstall            # nuclear cleanup
`);
}

interface ParsedFlags {
  flags: Record<string, string | boolean>;
  positional: string[];
  passthrough: string[];
}

function parseFlags(args: string[]): ParsedFlags {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const passthrough: string[] = [];
  let inPassthrough = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (inPassthrough) {
      passthrough.push(a);
      continue;
    }
    if (a === "--") {
      inPassthrough = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional, passthrough };
}

/**
 * For the run subcommands (claude/codex), only --dry-run and --no-defaults
 * are consumed. Everything else is forwarded as pass-through args to the
 * underlying IDE.
 */
function parseRunArgs(rawArgs: string[]): {
  dryRun: boolean;
  noDefaults: boolean;
  passthroughArgs: string[];
} {
  const OURS = new Set(["--dry-run", "--no-defaults"]);
  let dryRun = false;
  let noDefaults = false;
  const passthroughArgs: string[] = [];
  let inPass = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (inPass) {
      passthroughArgs.push(a);
      continue;
    }
    if (a === "--") {
      inPass = true;
      continue;
    }
    if (OURS.has(a)) {
      if (a === "--dry-run") dryRun = true;
      if (a === "--no-defaults") noDefaults = true;
      continue;
    }
    passthroughArgs.push(a);
  }
  return { dryRun, noDefaults, passthroughArgs };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    printHelp();
    return;
  }

  const sub = argv[0];

  if (sub === "--version" || sub === "-v") {
    process.stderr.write(VERSION + "\n");
    return;
  }
  if (sub === "--help" || sub === "-h" || sub === "help") {
    printHelp();
    return;
  }

  // Best-effort update notice. Cached 24h, capped at 1.5s, opt-out via
  // INBETWEEN_NO_UPDATE_CHECK=1. Skip for status/doctor — those already
  // print versions and should be fast.
  if (sub !== "status" && sub !== "doctor") {
    await maybeNotifyUpdate();
  }

  if (sub === "install") {
    const { flags } = parseFlags(argv.slice(1));
    await runInstall({ local: !!flags.local });
    return;
  }

  if (sub === "uninstall") {
    const { flags } = parseFlags(argv.slice(1));
    runUninstall({ local: !!flags.local });
    return;
  }

  if (sub === "login") {
    const { flags } = parseFlags(argv.slice(1));
    await runLogin({
      email: typeof flags.email === "string" ? flags.email : undefined,
      password: typeof flags.password === "string" ? flags.password : undefined,
      nonInteractive: !!flags["non-interactive"],
    });
    return;
  }

  if (sub === "logout") {
    await runLogout();
    return;
  }

  if (sub === "status") {
    runStatus();
    return;
  }

  if (sub === "doctor") {
    await runDoctor();
    return;
  }

  if (sub === "claude" || sub === "codex") {
    const { dryRun, noDefaults, passthroughArgs } = parseRunArgs(argv.slice(1));
    await run({
      ide: sub,
      dryRun,
      noDefaults,
      passthroughArgs,
    });
    return;
  }

  err(`Unknown command: ${sub}`);
  info("Run: inbetweenai --help");
  process.exit(1);
}

main().catch((e) => {
  err(e?.message || String(e));
  process.exit(1);
});
