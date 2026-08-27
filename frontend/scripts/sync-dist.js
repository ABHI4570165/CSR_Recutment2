/*
 * Publish the freshly built frontend to the directory the backend actually
 * serves.
 *
 *   frontend/dist   →   backend/client/dist
 *
 * server.js serves backend/client/dist for every non-/api route, so a build
 * that is not copied here is invisible to anyone using the app on port 8080.
 * That gap is exactly how the served UI drifted months behind the source.
 *
 * The target is wiped first so stale hashed assets from an older build cannot
 * linger and be served. dist is BUILD OUTPUT — never edit it by hand; edit the
 * source and re-run `npm run deploy`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "dist");
const DEST = path.join(here, "..", "..", "backend", "client", "dist");

if (!fs.existsSync(path.join(SRC, "index.html"))) {
  console.error(`✖ No build found at ${SRC}. Run "npm run build" first.`);
  process.exit(1);
}

// Replace the contents rather than the directory itself: on Windows the folder
// can be held open by the running server, which makes a rename/delete fail.
fs.mkdirSync(DEST, { recursive: true });
for (const entry of fs.readdirSync(DEST)) {
  fs.rmSync(path.join(DEST, entry), { recursive: true, force: true });
}
fs.cpSync(SRC, DEST, { recursive: true });

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p) : files.push(p);
  }
})(DEST);

const entry = fs.readFileSync(path.join(DEST, "index.html"), "utf8")
  .match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] || "(entry not found)";

console.log(`✔ Published ${files.length} files → ${DEST}`);
console.log(`  entry: ${entry}`);
console.log("  http://localhost:8080 now serves this build (restart not required — static files).");
