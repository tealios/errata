// Patch the Nitro server to set Bun.serve idleTimeout (default 10s is too short
// for LLM streaming endpoints). Nitro's srvx wraps Bun.serve and spreads
// options.bun into serveOptions, but Nitro has no config key for this.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "../.output/server/index.mjs");

const content = readFileSync(serverPath, "utf-8");
const patched = content.replace(
  /bun:\s*{\s*websocket:\s*void\s+0\s*}/,
  "bun: { websocket: void 0, idleTimeout: 255 }",
);

writeFileSync(serverPath, patched, "utf-8");
console.log("Patched idleTimeout in .output/server/index.mjs");
