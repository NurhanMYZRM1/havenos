import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ChannelScheduler } from "../core/channels/scheduler";
import { closeCore } from "../core/context";
import { AppError } from "../core/errors";
import type { HandlerContext, Platform } from "../core/handler-utils";
import { channelHandlers } from "../core/handlers-channels";
import { MemorySecretStore, type FeedFetcher } from "../core/integrations/channels";
import type { Workspaces } from "../core/workspace";
import { makeCore, seedProperty } from "./helpers";

const V1 = fs.readFileSync(path.resolve(process.cwd(), "desktop/tests/fixtures/airbnb/listing-a-v1.ics"), "utf8");
const URL_A = "https://www.airbnb.com/calendar/ical/900000000000000001.ics?s=0123456789abcdef0123456789abcdef";

function setup(workspace = "main") {
  const core = makeCore();
  const p = seedProperty(core);
  const fetcher: FeedFetcher = { fetch: async () => ({ status: 200, body: V1 }) };
  const ws = { current: core, workspace } as unknown as Workspaces;
  const channels = new ChannelScheduler({ workspaces: ws, secrets: new MemorySecretStore(), fetcher, emit: () => undefined, log: () => undefined });
  const ctx: HandlerContext = { ws, platform: {} as Platform, channels, core: () => core };
  return { core, p, h: channelHandlers(ctx), channels };
}

async function fields(fn: () => unknown): Promise<Record<string, string> | string> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    assert.ok(err instanceof AppError);
    return err.fields ?? err.messageKey ?? err.code;
  }
}

describe("channels.* handlers", () => {
  it("validate untrusted params strictly", async () => {
    const { core, p, h } = setup();
    const good = { channel: "airbnb", name: "Studio", spaceId: p.unitA2, feedUrl: URL_A, checkInTime: "15:00", checkOutTime: "11:00" };
    assert.deepEqual(await fields(() => h["channels.create"]({ ...good, checkInTime: "3pm", channel: "vrbo", name: "" })), {
      channel: "validation.chooseOne",
      name: "validation.required",
      checkInTime: "errors.channels.invalidTime",
    });
    assert.deepEqual(await fields(() => h["channels.create"]({ ...good, feedUrl: `${URL_A}${"x".repeat(2000)}` })), { feedUrl: "errors.channels.feedUrlTooLong" });
    assert.deepEqual(await fields(() => h["channels.create"]({ ...good, spaceId: "../../etc" })), { spaceId: "validation.chooseOne" });
    assert.deepEqual(await fields(() => h["channels.setPaused"]({ id: "abc", paused: "yes" })), { paused: "validation.chooseOne" });
    assert.deepEqual(await fields(() => h["channels.resolveEvent"]({ eventId: "abc", action: "delete" })), { action: "validation.chooseOne" });
    assert.deepEqual(await fields(() => h["channels.acknowledgeBlock"]({ connectionId: "abc", start: "2026-10-05", end: "2026-10-01", done: true })), {
      end: "validation.endBeforeStart",
    });
    const created = await h["channels.create"](good);
    assert.deepEqual(
      await fields(() =>
        h["channels.update"]({ id: created.id, name: "Studio", spaceId: p.unitA2, feedUrl: null, checkInTime: "15:00", checkOutTime: "11:00", turnoverChecklist: Array(41).fill("x") }),
      ),
      { turnoverChecklist: "errors.channels.checklistTooLong" },
    );
    closeCore(core);
  });

  it("create starts a setup sync; refresh waits for it and returns the list", async () => {
    const { core, p, h, channels } = setup();
    const created = await h["channels.create"]({ channel: "airbnb", name: "Studio", spaceId: p.unitA2, feedUrl: URL_A, checkInTime: "15:00", checkOutTime: "11:00" });
    assert.equal(created.health, "syncing");
    const list = await h["channels.refresh"]({ id: created.id, acceptShrink: false });
    assert.equal(channels.running().length, 0);
    assert.equal(list[0].counts.upcoming, 2);
    const triggers = core.db.all<{ trigger: string }>("SELECT trigger FROM channel_sync_runs ORDER BY rowid").map((r) => r.trigger);
    assert.equal(triggers[0], "setup");
    const detail = await h["channels.get"]({ id: created.id });
    assert.ok(detail.runs.length >= 1);
    closeCore(core);
  });

  it("tolerates a stored conflict with no details", async () => {
    const { core, p, h } = setup();
    const created = await h["channels.create"]({ channel: "airbnb", name: "Studio", spaceId: p.unitA2, feedUrl: URL_A, checkInTime: "15:00", checkOutTime: "11:00" });
    await h["channels.refresh"]({ id: created.id, acceptShrink: false });
    const now = new Date().toISOString();
    core.db.run(
      `INSERT INTO channel_events (id, connection_id, kind, external_uid, start_date, end_date, state, conflict, first_seen_at, last_seen_at)
       VALUES ('e1', ?, 'reservation', 'u1', '2027-01-01', '2027-01-03', 'conflict', NULL, ?, ?), ('e2', ?, 'reservation', 'u2', '2027-02-01', '2027-02-03', 'conflict', '{"not":"a list"}', ?, ?)`,
      [created.id, now, now, created.id, now, now],
    );
    const detail = await h["channels.get"]({ id: created.id });
    assert.deepEqual(detail.events.map((e) => e.conflicts), [[], []]);
    closeCore(core);
  });

  it("refuses to connect a calendar in the sample workspace", async () => {
    const { core, p, h } = setup("sample");
    assert.equal(
      await fields(() => h["channels.create"]({ channel: "airbnb", name: "Studio", spaceId: p.unitA2, feedUrl: URL_A, checkInTime: "15:00", checkOutTime: "11:00" })),
      "errors.channels.sampleWorkspace",
    );
    closeCore(core);
  });
});
