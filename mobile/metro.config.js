// The mobile app reuses the desktop app's code from the parent folder:
//   ../desktop/core   business rules + SQLite schema, run on the phone's JS thread
//   ../lib            domain rules, API contract, i18n
//   ../app, ../components   the existing screens, shown in DOM components
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");
const src = (p) => path.join(projectRoot, "src", p);

const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];

const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
config.resolver.blockList = [
  new RegExp(`^${escape(repoRoot)}/(node_modules|\\.next|out|dist-desktop|release|ios|android)/.*`),
  new RegExp(`^${escape(projectRoot)}/(ios|android)/.*`),
];

// Node built-ins used by ../desktop/core, backed by Expo modules.
const nodeShims = {
  "node:sqlite": src("core/shims/node-sqlite.ts"),
  "node:fs": src("core/shims/fs.ts"),
  "node:path": src("core/shims/path.ts"),
  "node:crypto": src("core/shims/crypto.ts"),
  "node:net": src("core/shims/net.ts"),
  "node:zlib": src("core/shims/unsupported.ts"),
  "node:stream": src("core/shims/unsupported.ts"),
  "node:stream/promises": src("core/shims/unsupported.ts"),
  "node:http": src("core/shims/unsupported.ts"),
  "node:https": src("core/shims/unsupported.ts"),
};

// Next.js APIs used by the shared screens, backed by the native router.
const domShims = {
  "next/link": src("dom/shims/next-link.tsx"),
  "next/navigation": src("dom/shims/next-navigation.ts"),
};

const isBare = (name) => !name.startsWith(".") && !name.startsWith("/");
const insideMobile = (file) => file.startsWith(projectRoot + path.sep);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shim = nodeShims[moduleName] ?? domShims[moduleName];
  if (shim) return { type: "sourceFile", filePath: shim };

  // UI copy: the desktop catalogue with "this computer" wording adapted (src/i18n/en.ts).
  if (moduleName === "./en" && context.originModulePath === path.join(repoRoot, "lib/i18n/index.ts")) {
    return { type: "sourceFile", filePath: src("i18n/en.ts") };
  }

  // Shared code uses "@/…" for the repo root (Next's alias); mobile code uses "~/…".
  if (moduleName.startsWith("@/")) {
    return context.resolveRequest(context, path.join(repoRoot, moduleName.slice(2)), platform);
  }
  if (moduleName.startsWith("~/")) {
    return context.resolveRequest(context, src(moduleName.slice(2)), platform);
  }

  // Packages imported by shared files resolve from mobile/node_modules, so
  // there is exactly one React even if the desktop deps are installed too.
  if (isBare(moduleName) && !insideMobile(context.originModulePath)) {
    return context.resolveRequest({ ...context, originModulePath: path.join(projectRoot, "package.json") }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
