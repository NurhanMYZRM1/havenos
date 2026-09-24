#!/usr/bin/env node
/**
 * Desktop build & dev runner (cross-platform — no shell env syntax).
 *
 *   node scripts/desktop.mjs main      compile Electron main/preload/core → dist-desktop/
 *   node scripts/desktop.mjs renderer  static Next.js export → out/
 *   node scripts/desktop.mjs build     both
 *   node scripts/desktop.mjs dev       next dev (first free port from 3000, or $PORT)
 *                                      + Electron pointed at it
 *
 * Cloud backup endpoints are baked in at build time from
 * HAVENOS_CLOUD_URL and HAVENOS_CLOUD_ANON_KEY (public values only — the
 * Supabase project URL and its publishable/anon key). When they are absent
 * the app shows cloud backup as "not available in this build".
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
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

/** True when nothing is listening on `port` (checked the way Next binds: all interfaces). */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

/** PORT is honoured exactly; otherwise the first free port from 3000 up. */
async function choosePort() {
  if (process.env.PORT) {
    const port = Number(process.env.PORT);
    if (!(await isPortFree(port))) throw new Error(`Port ${port} is already in use. Stop whatever is using it, or unset PORT to pick a free one.`);
    return port;
  }
  for (let port = 3000; port < 3050; port++) if (await isPortFree(port)) return port;
  throw new Error("No free port between 3000 and 3049.");
}

/**
 * Wait until OUR dev server answers. Fails fast if that process exits, so
 * Electron can never end up attached to some other app on the same port.
 */
function waitForServer(url, child, timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let exited = false;
    child.once("exit", (code) => {
      exited = true;
      reject(new Error(`The Next.js dev server stopped before it was ready (exit code ${code}).`));
    });
    const attempt = () => {
      if (exited) return;
      http
        .get(url, (res) => {
          res.resume();
          if (!exited) resolve();
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
  const port = await choosePort();
  const url = `http://localhost:${port}`;
  const children = [];
  const stop = () => {
    for (const child of children) if (child.exitCode === null) child.kill();
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(143);
  });

  const next = spawn(process.execPath, [bin.next, "dev", "-p", String(port)], { cwd: root, stdio: "inherit", env: { ...process.env, DESKTOP_BUILD: "1" } });
  const tscWatch = spawn(process.execPath, [bin.tsc, "-p", "desktop/tsconfig.json", "--watch", "--preserveWatchOutput"], { cwd: root, stdio: "inherit" });
  children.push(next, tscWatch);
  try {
    await waitForServer(`${url}/dashboard`, next);
  } catch (err) {
    stop();
    throw err;
  }
  console.log(`Opening HavenOS against ${url}`);
  const electronPath = require("electron");
  const app = spawn(electronPath, ["."], { cwd: root, stdio: "inherit", env: { ...process.env, HAVENOS_DEV_SERVER_URL: url } });
  children.push(app);
  app.on("exit", () => {
    stop();
    process.exit(0);
  });
  next.on("exit", () => {
    console.error("The Next.js dev server stopped; closing HavenOS.");
    stop();
    process.exit(1);
  });
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
