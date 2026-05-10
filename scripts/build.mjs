/**
 * Bundle + minify the CLI into dist/cli.js with the per-build HMAC
 * secret baked in. See @inbetweenai/mcp scripts/build.mjs for the
 * shared rationale.
 */
import { build } from "esbuild";
import { readFileSync, rmSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const SECRET = process.env.INBETWEEN_BUILD_SECRET || "";

if (!SECRET) {
  console.warn(
    "⚠ INBETWEEN_BUILD_SECRET is empty. Bundle will be unsigned — fine " +
      "for dev smoke tests, NOT for `npm publish`.",
  );
}

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli.js",
  minify: false,
  sourcemap: false,
  legalComments: "inline",
  banner: { js: "#!/usr/bin/env node" },
  define: {
    "process.env.INBETWEEN_BUILD_SECRET": JSON.stringify(SECRET),
    "process.env.INBETWEEN_CLIENT_VERSION": JSON.stringify(pkg.version),
  },
  external: ["@inbetweenai/codex-shell", "prompts"],
});

console.log(`✓ built dist/cli.js (v${pkg.version})`);
