import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { CloudProgress } from "../../lib/api/contract";
import { CloudService, MemorySecretStore } from "../core/cloud/service";
import { AppError } from "../core/errors";
import { createMaintenance, listMaintenance } from "../core/services/maintenance";
import { Workspaces } from "../core/workspace";
import { FIXED_NOW, seedProperty, tempDir } from "./helpers";

/**
 * A stand-in for the Supabase Auth + `cloud` function contract, used only
 * to test the desktop client's behaviour. Entitlement is decided here, on
 * the "server", exactly as the real function does.
 */
function fakeCloud() {
  const state = {
    entitled: false,
    objects: new Map<string, Buffer>(),
    backups: [] as { id: string; createdAt: string; sizeBytes: number; sha256: string; appVersion: string; counts: Record<string, number> }[],
    pending: new Map<string, { sha256: string; sizeBytes: number; appVersion: string; counts: Record<string, number> }>(),
    calls: [] as string[],
  };
  let base = "";
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const url = req.url ?? "";
      state.calls.push(`${req.method} ${url.split("?")[0]}`);
      if (url === "/auth/v1/otp") return json(200, {});
      if (url === "/auth/v1/verify" || url.startsWith("/auth/v1/token")) {
        return json(200, { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, user: { email: "owner@example.com" } });
      }
      if (url === "/auth/v1/logout") return json(204, {});
      if (url.startsWith("/upload/")) {
        state.objects.set(url.slice(8), body);
        return json(200, {});
      }
      if (url.startsWith("/download/")) {
        res.writeHead(200);
        return res.end(state.objects.get(url.slice(10)));
      }
      if (url === "/functions/v1/cloud") {
        if (req.headers.authorization !== "Bearer access-1") return json(401, { error: { code: "unauthorized", message: "Sign in" } });
        const msg = JSON.parse(body.toString("utf8"));
        const entitlement = state.entitled
          ? { status: "active", plan: "monthly", currentPeriodEnd: "2026-10-23T00:00:00Z", canUpload: true, canDownload: true }
          : { status: "expired", plan: "monthly", currentPeriodEnd: "2026-08-01T00:00:00Z", canUpload: false, canDownload: false };
        const deny = () => json(402, { error: { code: "not_entitled", message: "Cloud backup needs an active subscription." } });
        switch (msg.action) {
          case "entitlement":
            return json(200, entitlement);
          case "start-upload": {
            if (!entitlement.canUpload) return deny();
            const id = crypto.randomUUID();
            state.pending.set(id, { sha256: msg.sha256, sizeBytes: msg.sizeBytes, appVersion: msg.appVersion, counts: msg.counts });
            return json(200, { backupId: id, uploadUrl: `${base}/upload/${id}`, headers: {} });
          }
          case "complete-upload": {
            const p = state.pending.get(msg.backupId);
            const obj = state.objects.get(msg.backupId);
            if (!p || !obj || obj.length !== p.sizeBytes) return json(400, { error: { code: "invalid_request", message: "upload incomplete" } });
            state.backups.push({ id: msg.backupId, createdAt: new Date().toISOString(), ...p });
            return json(200, { ok: true });
          }
          case "list":
            if (!entitlement.canDownload) return deny();
            return json(200, { backups: state.backups.map(({ sha256: _s, ...b }) => b) });
          case "download": {
            if (!entitlement.canDownload) return deny();
            const b = state.backups.find((x) => x.id === msg.backupId);
            if (!b) return json(404, { error: { code: "not_found", message: "no such backup" } });
            return json(200, { url: `${base}/download/${b.id}`, sha256: b.sha256, sizeBytes: b.sizeBytes });
          }
          default:
            return json(400, { error: { code: "invalid_request", message: "unknown action" } });
        }
      }
      json(404, {});
    });
  });
  return {
    state,
    start: () =>
      new Promise<string>((resolve) =>
        server.listen(0, "127.0.0.1", () => {
          base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
          resolve(base);
        }),
      ),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function setup(url: string | null) {
  const root = tempDir();
  const ws = new Workspaces({ rootDir: root, appVersion: "1.2.3", now: () => FIXED_NOW });
  const p = seedProperty(ws.current);
  const progress: CloudProgress[] = [];
  const opened: string[] = [];
  const cloud = new CloudService({
    config: url ? { url, anonKey: "public-anon-key" } : null,
    secrets: new MemorySecretStore(),
    stateFile: path.join(root, "cloud-state.json"),
    tempDir: path.join(root, "tmp"),
    workspaces: ws,
    emitProgress: (pr) => progress.push(pr),
    openExternal: async (u) => {
      opened.push(u);
    },
  });
  return { ws, cloud, progress, opened, p };
}

const code = (c: string) => (e: unknown) => e instanceof AppError && e.code === c;

describe("optional cloud backup", () => {
  const server = fakeCloud();
  let url = "";
  before(async () => {
    url = await server.start();
  });
  after(() => server.stop());

  it("is clearly unavailable when the build has no cloud configuration", async () => {
    const { ws, cloud } = setup(null);
    const status = await cloud.status(true);
    assert.equal(status.configured, false);
    await assert.rejects(cloud.backupNow(), code("CLOUD_NOT_CONFIGURED"));
    ws.close();
  });

  it("requires sign-in and explicit consent before any upload", async () => {
    const { ws, cloud } = setup(url);
    await assert.rejects(cloud.backupNow(), code("CLOUD_AUTH"));
    await cloud.requestCode("owner@example.com");
    await cloud.verifyCode("owner@example.com", "123456");
    await assert.rejects(cloud.backupNow(), code("CLOUD_CONSENT"));
    await assert.rejects(cloud.setOptIn(true, false), code("CLOUD_CONSENT"));
    assert.equal(server.state.calls.filter((c) => c.startsWith("PUT")).length, 0);
    ws.close();
  });

  it("uploads nothing without a valid server-side entitlement, and local use carries on", async () => {
    server.state.entitled = false;
    const { ws, cloud, progress, p } = setup(url);
    await cloud.verifyCode("owner@example.com", "123456");
    await cloud.setOptIn(true, true);
    const before = server.state.objects.size;
    await cloud.runBackup();
    const status = await cloud.status();
    assert.equal(status.entitlement?.status, "expired");
    assert.equal(status.lastAttempt?.ok, false);
    assert.match(status.lastAttempt?.error ?? "", /active subscription/);
    assert.equal(progress.at(-1)?.phase, "error");
    assert.equal(server.state.objects.size, before);
    await assert.rejects(cloud.list(), code("CLOUD_ENTITLEMENT"));
    // Local records, local backup and restore still work.
    createMaintenance(ws.current, {
      propertyId: p.propertyId, spaceId: null, tenantId: null, title: "Still works offline-first", description: "",
      category: "general", priority: "low", status: "triage", dueDate: null, assigneeName: "", assigneePhone: "",
      estimatedCostSen: null, actualCostSen: null, reportedOn: "2026-09-23", stagingKey: null,
    });
    assert.equal(listMaintenance(ws.current, { propertyId: null, status: "all", priority: null, overdueOnly: false, query: "" }).length, 1);
    const local = await ws.backupTo(path.join(tempDir(), "local.havenos-backup"));
    assert.equal(local.counts.maintenance_requests, 1);
    ws.close();
  });

  it("backs up with progress when entitled, then restores from the cloud copy", async () => {
    server.state.entitled = true;
    const { ws, cloud, progress } = setup(url);
    await cloud.verifyCode("owner@example.com", "123456");
    await cloud.setOptIn(true, true);
    await cloud.runBackup();
    const status = await cloud.status();
    assert.equal(status.lastAttempt?.ok, true);
    assert.ok(status.lastSuccessAt);
    assert.ok(progress.some((pr) => pr.phase === "uploading" && pr.bytesDone > 0));
    assert.equal(progress.at(-1)?.phase, "done");

    const list = await cloud.list();
    assert.equal(list.length, 1);
    const inspection = await cloud.restore(list[0].id);
    assert.equal(inspection.summary.counts.properties, 1);
    await ws.restore(inspection.token);
    ws.close();
  });

  it("only opens billing links on the expected payment hosts", async () => {
    const { ws, cloud, opened } = setup(url);
    // The fake server has no checkout action; the client must not open anything.
    await cloud.verifyCode("owner@example.com", "123456");
    await assert.rejects(cloud.openCheckout("monthly"));
    assert.deepEqual(opened, []);
    ws.close();
  });
});
