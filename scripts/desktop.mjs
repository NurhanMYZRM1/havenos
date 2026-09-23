#!/usr/bin/env node
/**
 * Desktop build & dev runner (cross-platform — no shell env syntax).
 *
 *   node scripts/desktop.mjs main      compile Electron main/preload/core → dist-desktop/
 *   node scripts/desktop.mjs renderer  static Next.js export → out/
 *   node scripts/desktop.mjs build     both
 *   node scripts/desktop.mjs dev       next dev + Electron pointed at it
 *
 * Cloud backup endpoints are baked in at build time from
 * HAVENOS_CLOUD_URL and HAVENOS_CLOUD_ANON_KEY (public values only — the
 * Supabase project URL and its publishable/anon key). When they are absent
 * the app shows cloud backup as "not available in this build".
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const bin = {
  tsc: path.join(root, "node_modules/typescript/bin/tsc"),
  next: path.join(root, "node_modules/next/dist/bin/next"),
};

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} ${args.join(" ")} exited with ${code}`))));
  });
}

function writeCloudConfig() {
  const url = process.env.HAVENOS_CLOUD_URL?.trim();
  const anonKey = process.env.HAVENOS_CLOUD_ANON_KEY?.trim();
  if (anonKey && /service_role|sb_secret_/i.test(anonKey)) {
    throw new Error("HAVENOS_CLOUD_ANON_KEY looks like a secret/service-role key. Only the public anon/publishable key may be bundled.");
  }
  const config = url && anonKey ? { url: url.replace(/\/+$/, ""), anonKey } : null;
  fs.mkdirSync(path.join(root, "dist-desktop"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist-desktop/cloud-config.json"), JSON.stringify(config, null, 2));
  console.log(config ? `Cloud backup endpoint: ${config.url}` : "Cloud backup: not configured in this build (local-only).");
}

async function buildMain() {
  fs.rmSync(path.join(root, "dist-desktop"), { recursive: true, force: true });
  await run(process.execPath, [bin.tsc, "-p", "desktop/tsconfig.json"]);
  writeCloudConfig();
}

async function buildRenderer() {
  fs.rmSync(path.join(root, "out"), { recursive: true, force: true });
  await run(process.execPath, [bin.next, "build"], { DESKTOP_BUILD: "1" });
}

function waitForServer(url, timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - started > timeoutMs) reject(new Error(`Timed out waiting for ${url}`));
          else setTimeout(attempt, 500);
        });
    };
    attempt();
  });
}

async function dev() {
  await buildMain();
  const port = process.env.PORT ?? "3000";
  const url = `http://localhost:${port}`;
  const next = spawn(process.execPath, [bin.next, "dev", "-p", port], { cwd: root, stdio: "inherit", env: { ...process.env, DESKTOP_BUILD: "1" } });
  const tscWatch = spawn(process.execPath, [bin.tsc, "-p", "desktop/tsconfig.json", "--watch", "--preserveWatchOutput"], { cwd: root, stdio: "inherit" });
  await waitForServer(`${url}/dashboard`);
  const electronPath = require("electron");
  const app = spawn(electronPath, ["."], { cwd: root, stdio: "inherit", env: { ...process.env, HAVENOS_DEV_SERVER_URL: url } });
  const stop = () => {
    next.kill();
    tscWatch.kill();
    app.kill();
  };
  app.on("exit", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const command = process.argv[2];
try {
  if (command === "main") await buildMain();
  else if (command === "renderer") await buildRenderer();
  else if (command === "build") {
    await buildRenderer();
    await buildMain();
  } else if (command === "dev") await dev();
  else {
    console.error("Usage: node scripts/desktop.mjs <main|renderer|build|dev>");
    process.exit(2);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
