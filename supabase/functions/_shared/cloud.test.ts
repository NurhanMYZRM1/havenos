// Run with: npm run test:cloud-functions   (Node's built-in TypeScript support)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { handleCloud, type BackupRecord, type CloudPorts } from "./cloud-handler.ts";
import { evaluateEntitlement, type EntitlementRow } from "./entitlement.ts";
import { checkoutParams, entitlementFromEvent, formEncode, verifyStripeSignature } from "./stripe.ts";

const NOW = new Date("2026-09-23T04:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("entitlement rules", () => {
  it("allows uploads only during a paid period", () => {
    const row = (status: EntitlementRow["status"], endOffsetDays: number): EntitlementRow => ({ status, plan: "monthly", current_period_end: iso(NOW.getTime() + endOffsetDays * DAY) });
    assert.deepEqual(
      [evaluateEntitlement(null, NOW).status, evaluateEntitlement(row("active", 10), NOW).status, evaluateEntitlement(row("active", -3), NOW).status, evaluateEntitlement(row("active", -8), NOW).status],
      ["none", "active", "grace", "expired"],
    );
    assert.equal(evaluateEntitlement(row("active", 10), NOW).canUpload, true);
    const grace = evaluateEntitlement(row("active", -3), NOW);
    assert.equal(grace.canUpload, false);
    assert.equal(grace.canDownload, true);
    // A failing payment never uploads, even mid-period.
    const pastDue = evaluateEntitlement(row("past_due", 20), NOW);
    assert.equal(pastDue.status, "grace");
    assert.equal(pastDue.canUpload, false);
    const expired = evaluateEntitlement(row("canceled", -30), NOW);
    assert.equal(expired.canDownload, false);
  });
});

function fakePorts(entitlement: EntitlementRow | null): CloudPorts & { backups: BackupRecord[]; objects: Map<string, number> } {
  const backups: BackupRecord[] = [];
  const objects = new Map<string, number>();
  return {
    backups,
    objects,
    now: () => NOW,
    userFromToken: async (t) => (t === "good" ? { id: "user-1", email: "a@example.com" } : null),
    getEntitlement: async () => entitlement,
    insertBackup: async (r) => void backups.push(r),
    getBackup: async (u, id) => backups.find((b) => b.user_id === u && b.id === id) ?? null,
    listBackups: async (u) => backups.filter((b) => b.user_id === u),
    markAvailable: async (id) => {
      backups.find((b) => b.id === id)!.status = "available";
    },
    deleteBackup: async (r) => {
      backups.splice(backups.indexOf(r), 1);
      objects.delete(r.object_path);
    },
    signedUploadUrl: async (p) => ({ url: `https://storage.example/upload/${p}?token=x`, headers: {} }),
    signedDownloadUrl: async (p) => `https://storage.example/download/${p}?token=y`,
    objectSize: async (p) => objects.get(p) ?? null,
    billing: { configured: () => false, checkoutUrl: async () => "", portalUrl: async () => null },
  };
}

const sha = "a".repeat(64);
const active: EntitlementRow = { status: "active", plan: "monthly", current_period_end: iso(NOW.getTime() + 10 * DAY) };

describe("cloud function", () => {
  it("rejects unauthenticated calls", async () => {
    const r = await handleCloud(null, { action: "entitlement" }, fakePorts(active));
    assert.equal(r.status, 401);
    assert.equal((await handleCloud("Bearer forged", { action: "entitlement" }, fakePorts(active))).status, 401);
  });

  it("refuses uploads and downloads without a valid entitlement", async () => {
    for (const row of [null, { ...active, current_period_end: iso(NOW.getTime() - 30 * DAY) }]) {
      const ports = fakePorts(row);
      const up = await handleCloud("Bearer good", { action: "start-upload", sizeBytes: 100, sha256: sha }, ports);
      assert.equal(up.status, 402);
      assert.equal(ports.backups.length, 0, "no upload slot is created");
      assert.equal((await handleCloud("Bearer good", { action: "list" }, ports)).status, 402);
      assert.equal((await handleCloud("Bearer good", { action: "download", backupId: "x" }, ports)).status, 402);
    }
  });

  it("issues an upload URL, verifies the stored size, and keeps the latest backups", async () => {
    const ports = fakePorts(active);
    for (let i = 0; i < 12; i++) {
      const r = await handleCloud("Bearer good", { action: "start-upload", sizeBytes: 100 + i, sha256: sha, appVersion: "1.0.0", schemaVersion: 1, counts: {} }, ports);
      assert.equal(r.status, 200);
      const { backupId } = r.body as { backupId: string };
      const row = ports.backups.find((b) => b.id === backupId)!;
      row.created_at = iso(NOW.getTime() + i * 1000);
      ports.objects.set(row.object_path, 100 + i);
      assert.equal((await handleCloud("Bearer good", { action: "complete-upload", backupId }, ports)).status, 200);
    }
    const list = (await handleCloud("Bearer good", { action: "list" }, ports)).body as { backups: { sizeBytes: number }[] };
    assert.equal(list.backups.length, 10);
    assert.equal(list.backups[0].sizeBytes, 111);
  });

  it("rejects an incomplete upload", async () => {
    const ports = fakePorts(active);
    const r = await handleCloud("Bearer good", { action: "start-upload", sizeBytes: 500, sha256: sha }, ports);
    const { backupId } = r.body as { backupId: string };
    ports.objects.set(ports.backups[0].object_path, 20);
    assert.equal((await handleCloud("Bearer good", { action: "complete-upload", backupId }, ports)).status, 400);
    assert.equal(ports.backups.length, 0);
  });

  it("reports billing honestly when it isn't configured", async () => {
    const r = await handleCloud("Bearer good", { action: "checkout", plan: "monthly" }, fakePorts(null));
    assert.equal(r.status, 503);
    assert.equal((r.body as { error: { code: string } }).error.code, "billing_not_configured");
  });
});

describe("Stripe integration helpers", () => {
  it("verifies webhook signatures and rejects tampering or stale events", async () => {
    const secret = "whsec_test";
    const payload = JSON.stringify({ id: "evt_1" });
    const t = Math.floor(NOW.getTime() / 1000);
    const sig = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
    assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, t), true);
    assert.equal(await verifyStripeSignature(`${payload} `, `t=${t},v1=${sig}`, secret, t), false);
    assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, "whsec_other", t), false);
    assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, t + 3600), false);
    assert.equal(await verifyStripeSignature(payload, null, secret, t), false);
  });

  it("maps subscription and annual-payment events to entitlements", () => {
    const sub = entitlementFromEvent(
      { type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "active", metadata: { user_id: "user-1" }, items: { data: [{ current_period_end: NOW.getTime() / 1000 + 86400 * 30 }] } } } },
      null,
      NOW,
    )!;
    assert.equal(sub.userId, "user-1");
    assert.equal(sub.row.status, "active");
    assert.equal(sub.row.current_period_end, iso(NOW.getTime() + 30 * DAY));

    const deleted = entitlementFromEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled", ended_at: NOW.getTime() / 1000, metadata: {} } } }, sub.row, NOW)!;
    assert.equal(evaluateEntitlement(deleted.row, NOW).canUpload, false);

    // FPX: nothing is granted until the payment actually succeeds.
    const pending = entitlementFromEvent({ type: "checkout.session.completed", data: { object: { mode: "payment", payment_status: "unpaid", metadata: { plan: "annual", user_id: "user-1" } } } }, null, NOW);
    assert.equal(pending, null);
    const paid = entitlementFromEvent({ type: "checkout.session.async_payment_succeeded", data: { object: { mode: "payment", payment_status: "paid", client_reference_id: "user-1", metadata: { plan: "annual" } } } }, sub.row, NOW)!;
    assert.equal(paid.row.plan, "annual");
    assert.equal(paid.row.current_period_end, iso(NOW.getTime() + 30 * DAY + 365 * DAY), "annual extends from the current end");
  });

  it("builds Checkout parameters: card subscription monthly, card/FPX one-off annual", () => {
    const monthly = formEncode(checkoutParams({ plan: "monthly", userId: "u", customerId: "cus", monthlyPrice: "price_m", annualPrice: "price_a", successUrl: "https://x/s", cancelUrl: "https://x/c" }));
    assert.match(monthly, /mode=subscription/);
    assert.match(monthly, /line_items%5B0%5D%5Bprice%5D=price_m/);
    assert.doesNotMatch(monthly, /fpx/);
    const annual = formEncode(checkoutParams({ plan: "annual", userId: "u", customerId: "cus", monthlyPrice: "price_m", annualPrice: "price_a", successUrl: "https://x/s", cancelUrl: "https://x/c" }));
    assert.match(annual, /mode=payment/);
    assert.match(annual, /payment_method_types%5B1%5D=fpx/);
  });
});
