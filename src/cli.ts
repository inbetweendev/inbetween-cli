#!/usr/bin/env node
/**
 * inbetweenai — unified CLI for InBetween.
 *
 *   inbetweenai init [...flags]      # one-time setup
 *   inbetweenai                      # run default IDE
 *   inbetweenai claude [...flags]    # run Claude
 *   inbetweenai codex [...flags]     # run Codex
 *   inbetweenai logout [--all]       # remove config from current scope
 *   inbetweenai uninstall            # nuclear cleanup
 *   inbetweenai --help
 *   inbetweenai --version
 */

import { runInit, type InitOptions } from "./init.js";
import { run } from "./run.js";
import { runLogout, runUninstall } from "./cleanup.js";
import { loadConfig } from "./config.js";
import { err, info, C } from "./banner.js";

const VERSION = "0.1.0";

function printHelp(): void {
  process.stderr.write(`
${C.bold}inbetweenai${C.reset} — direct line between AI agents

${C.bold}USAGE${C.reset}
  inbetweenai init [...flags]       One-time setup (Claude / Codex MCP wiring)
  inbetweenai                        Run default IDE from saved config
  inbetweenai claude [...flags]      Run Claude Code wrapped
  inbetweenai codex [...flags]       Run Codex CLI wrapped
  inbetweenai logout [--all]         Remove InBetween config from current scope
  inbetweenai uninstall              Full cleanup (config, sessions, MCP entries)
  inbetweenai --version              Print version
  inbetweenai --help                 This help

${C.bold}init flags${C.reset}
  --token <code>                    Bind to existing single-agent
  --owner-token own_xxx             Owner mode (multi-agent)
  --agent <name>                    With --owner-token: pick default agent
  --claude                          Wire Claude only (default)
  --codex                           Wire Codex only
  --client both                     Wire both
  --local                           Config in <cwd>/.inbetween/, not global
  --global                          Force global (default unless --local)
  --force                           Overwrite existing without prompt
  --non-interactive                 Fail if interactive input needed

${C.bold}run flags (claude / codex)${C.reset}
  --agent <name>                    Owner-mode: switch active agent for this run
  --dry-run                         Print spawn command, do not run
  --no-defaults                     Do not add our --dangerously-* flags
  --config <path>                   Override config path
  --                                Pass everything after to the IDE verbatim

${C.bold}logout flags${C.reset}
  --all                             Remove both local and global configs
  --keep-mcp                        Leave MCP entries (for re-init later)

${C.bold}EXAMPLES${C.reset}
  inbetweenai init
  inbetweenai init --token CP5G... --client both
  inbetweenai init --owner-token own_abc --local
  inbetweenai
  inbetweenai claude --resume my-session
  inbetweenai codex
  inbetweenai claude --agent bot2
  inbetweenai logout
`);
}

function parseFlags(args: string[]): {
  flags: Record<string, string | boolean>;
  positional: string[];
  passthrough: string[];
} {
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
 * For run subcommands, separate our consumed flags from pass-through.
 * Our flags: --agent, --dry-run, --no-defaults, --config, --version, --help
 */
function parseRunArgs(rawArgs: string[]): {
  ours: Record<string, string | boolean>;
  passthroughArgs: string[];
} {
  const OURS = new Set([
    "--agent",
    "--dry-run",
    "--no-defaults",
    "--config",
    "--version",
    "--help",
  ]);
  const ours: Record<string, string | boolean> = {};
  const passthroughArgs: string[] = [];
  let i = 0;
  let inPass = false;
  while (i < rawArgs.length) {
    const a = rawArgs[i];
    if (inPass) {
      passthroughArgs.push(a);
      i++;
      continue;
    }
    if (a === "--") {
      inPass = true;
      i++;
      continue;
    }
    if (OURS.has(a)) {
      const next = rawArgs[i + 1];
      const takesValue = a === "--agent" || a === "--config";
      if (takesValue && next !== undefined && !next.startsWith("--")) {
        ours[a.slice(2)] = next;
        i += 2;
      } else {
        ours[a.slice(2)] = true;
        i += 1;
      }
    } else {
      // Not ours — pass through.
      passthroughArgs.push(a);
      i++;
    }
  }
  return { ours, passthroughArgs };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    // No args: run default IDE.
    const loaded = loadConfig();
    if (!loaded) {
      err("No InBetween config found.");
      info("Run: inbetweenai init");
      process.exit(1);
    }
    const ide = loaded.config.default_ide || "claude";
    await run({
      ide,
      passthroughArgs: [],
    });
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

  if (sub === "init") {
    const { flags } = parseFlags(argv.slice(1));
    const opts: InitOptions = {
      token: typeof flags.token === "string" ? flags.token : undefined,
      ownerToken:
        typeof flags["owner-token"] === "string"
          ? (flags["owner-token"] as string)
          : undefined,
      agent: typeof flags.agent === "string" ? flags.agent : undefined,
      client:
        flags.claude
          ? "claude"
          : flags.codex
            ? "codex"
            : flags.client === "both"
              ? "both"
              : flags.client === "claude"
                ? "claude"
                : flags.client === "codex"
                  ? "codex"
                  : undefined,
      local: !!flags.local,
      global: !!flags.global,
      force: !!flags.force,
      nonInteractive: !!flags["non-interactive"],
    };
    await runInit(opts);
    return;
  }

  if (sub === "claude" || sub === "codex") {
    const { ours, passthroughArgs } = parseRunArgs(argv.slice(1));
    await run({
      ide: sub,
      agent: typeof ours.agent === "string" ? ours.agent : undefined,
      dryRun: !!ours["dry-run"],
      noDefaults: !!ours["no-defaults"],
      configPath: typeof ours.config === "string" ? ours.config : undefined,
      passthroughArgs,
    });
    return;
  }

  if (sub === "logout") {
    const { flags } = parseFlags(argv.slice(1));
    runLogout({
      all: !!flags.all,
      keepMcp: !!flags["keep-mcp"],
    });
    return;
  }

  if (sub === "uninstall") {
    runUninstall();
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
