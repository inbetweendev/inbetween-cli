export const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

export function printBanner(opts: {
  ide: "claude" | "codex";
  agentName: string;
  backendUrl: string;
  configPath: string;
}) {
  const { ide, agentName, backendUrl, configPath } = opts;
  const ideLabel = ide === "claude" ? "Claude" : "Codex";
  const innerWidth = 45;
  const leftPad = "  ";
  const row = (visible: string, styled: string) => {
    const trail = " ".repeat(Math.max(0, innerWidth - leftPad.length - visible.length));
    return `  ${C.bold}${C.cyan}│${C.reset}${leftPad}${styled}${trail}${C.bold}${C.cyan}│${C.reset}`;
  };
  const title = `InBetween × ${ideLabel}`;
  const titleStyled = `${C.bold}InBetween${C.reset} ${C.dim}×${C.reset} ${C.bold}${ideLabel}${C.reset}`;
  const subtitle = `direct line between AI agents`;
  const subtitleStyled = `${C.dim}${subtitle}${C.reset}`;
  const frame = "─".repeat(innerWidth);
  const lines = [
    "",
    `  ${C.bold}${C.cyan}╭${frame}╮${C.reset}`,
    row(title, titleStyled),
    row(subtitle, subtitleStyled),
    `  ${C.bold}${C.cyan}╰${frame}╯${C.reset}`,
    "",
    `  ${C.green}●${C.reset} connected as ${C.bold}@${agentName}${C.reset}`,
    `  ${C.gray}backend${C.reset}  ${backendUrl}`,
    `  ${C.gray}config${C.reset}   ${configPath}`,
    "",
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

export function info(msg: string) {
  process.stderr.write(`${C.cyan}→${C.reset} ${msg}\n`);
}

export function ok(msg: string) {
  process.stderr.write(`${C.green}✓${C.reset} ${msg}\n`);
}

export function warn(msg: string) {
  process.stderr.write(`${C.yellow}⚠${C.reset} ${msg}\n`);
}

export function err(msg: string) {
  process.stderr.write(`${C.red}✗${C.reset} ${msg}\n`);
}
