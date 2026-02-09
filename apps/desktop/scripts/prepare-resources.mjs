import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "../../..");
const desktopRoot = path.resolve(__dirname, "..");

function pnpmCmd() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

async function resetDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  // Build shared, server, web, and desktop.
  run(pnpmCmd(), ["-C", path.join(repoRoot, "packages/shared"), "build"], repoRoot);
  run(pnpmCmd(), ["-C", path.join(repoRoot, "apps/server"), "build"], repoRoot);
  run(pnpmCmd(), ["-C", path.join(repoRoot, "apps/web"), "build"], repoRoot);
  run(pnpmCmd(), ["-C", desktopRoot, "build"], repoRoot);

  const outRoot = path.join(desktopRoot, "app-resources");
  await resetDir(outRoot);

  // Copy web build.
  await fs.mkdir(path.join(outRoot, "web"), { recursive: true });
  await fs.cp(path.join(repoRoot, "apps/web/dist"), path.join(outRoot, "web/dist"), {
    recursive: true
  });

  // Copy server build + package.json (needed for `type: module`).
  await fs.mkdir(path.join(outRoot, "server"), { recursive: true });
  await fs.cp(path.join(repoRoot, "apps/server/dist"), path.join(outRoot, "server/dist"), {
    recursive: true
  });
  await fs.copyFile(
    path.join(repoRoot, "apps/server/package.json"),
    path.join(outRoot, "server/package.json"),
  );
}

await main();

