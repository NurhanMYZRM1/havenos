/**
 * End-to-end checks against the built desktop app (run `npm run test:e2e`).
 * Each test uses its own temporary data folder; native file dialogs are
 * stubbed in the main process so the flows run unattended.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { invoke, launch, shot, tempDataDir } from "./harness.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function photoFile(name = "front.png") {
  const file = path.join(tempDataDir("photo"), name);
  fs.writeFileSync(file, PNG);
  return file;
}

/** Make the next native open dialog return `paths`. */
async function stubOpenDialog(app, paths) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p });
  }, paths);
}

async function stubSaveDialog(app, file) {
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, file);
}

/** Every app a test opens is closed afterwards, even if the test fails. */
const opened = new Set();
async function start(dir, env) {
  const session = await launch(dir, env);
  opened.add(session);
  return session;
}
afterEach(async () => {
  for (const session of opened) await session.close().catch(() => undefined);
  opened.clear();
});

async function goto(page, route) {
  await page.evaluate((r) => {
    window.location.href = `app://havenos${r}`;
  }, route);
  await page.waitForLoadState("domcontentloaded");
}

async function quickProperty(page, name = "Rumah Ujian") {
  const draft = await invoke(page, "drafts.save", {
    id: null,
    step: 4,
    data: {
      details: { name, propertyType: "terrace", addressLine1: "5 Jalan Ujian 3", addressLine2: "", postcode: "43000", city: "Kajang", state: "SGR", notes: "" },
      arrangement: {
        defaultMode: "by_room",
        units: [{ key: "u1", label: "House", floor: "", sizeSqft: "", bedrooms: "", rentalMode: "by_room", rooms: [{ key: "r1", label: "Room A", roomType: "master", beds: [] }, { key: "r2", label: "Room B", roomType: "medium", beds: [] }] }],
      },
      rent: { rentDueDay: "5", securityDepositMonths: "2", utilityDepositMonths: "0.5", defaultTenancyMonths: "12", defaultTerms: "", rents: { r1: "800", r2: "650" } },
    },
  });
  return (await invoke(page, "drafts.complete", { id: draft.id })).propertyId;
}

describe("HavenOS desktop app", { timeout: 240_000 }, () => {
  it("photo onboarding creates a real property that survives a restart, with no network requests", async () => {
    const dir = tempDataDir();
    let { app, page, close } = await start(dir);
    const external = [];
    page.on("request", (r) => {
      if (!/^(app|havenos-file|data|blob|devtools):/.test(r.url())) external.push(r.url());
    });

    await page.getByRole("link", { name: "Add your first property" }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByLabel("Property name").fill("Seri Kenanga B-7-2");
    await page.getByLabel("Property type").selectOption("condominium");
    await page.getByLabel("Address line 1").fill("Jalan Kenanga 7, Block B");
    await page.getByLabel("Postcode").fill("5045");
    await page.getByLabel("City / town").fill("Kuala Lumpur");
    await page.getByLabel("State or federal territory").selectOption("KUL");
    await page.getByRole("button", { name: "Next" }).click();
    // Validation keeps us on step 1 with a clear message.
    await page.getByText("Malaysian postcodes have 5 digits").waitFor();
    await page.getByLabel("Postcode").fill("50450");
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByRole("radio", { name: /By room/ }).check({ force: true });
    await page.getByRole("button", { name: "Add room" }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByLabel("Rent for Unit 1 › Master bedroom").fill("1,100");
    await page.getByLabel("Rent for Unit 1 › Room 2").fill("850.50");
    await page.getByRole("button", { name: "Next" }).click();

    await stubOpenDialog(app, [photoFile("front.png"), photoFile("living.png")]);
    await page.getByRole("button", { name: "Add photos" }).click();
    await page.getByRole("img", { name: "living.png" }).waitFor();
    await page.getByRole("button", { name: "Make cover" }).click();
    await page.waitForTimeout(400);
    await shot(page, "e2e-onboarding-photos");
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByText("4 lettable spaces").waitFor();
    await page.getByRole("button", { name: "Save property" }).click();
    await page.getByRole("heading", { name: "Seri Kenanga B-7-2" }).waitFor();
    await page.getByText("0 of 4 let").first().waitFor();
    await shot(page, "e2e-property-created");
    await close();

    ({ app, page, close } = await start(dir));
    await goto(page, "/properties/");
    await page.getByRole("link", { name: /Seri Kenanga B-7-2/ }).waitFor();
    const cover = page.getByRole("img", { name: "Seri Kenanga B-7-2" });
    await cover.waitFor();
    assert.ok(await cover.evaluate((img) => img.complete && img.naturalWidth > 0), "cover photo loads from local storage after restart");
    const [property] = await invoke(page, "properties.list", { includeArchived: false });
    const detail = await invoke(page, "properties.get", { id: property.id });
    assert.deepEqual(detail.photos.map((p) => p.fileName), ["living.png", "front.png"]);
    assert.deepEqual(detail.units[0].children.map((r) => r.defaultRentSen), [110000, 85050, 0, 0]);
    await close();
    assert.deepEqual(external, [], "the app made no network requests");
  });

  it("maintenance edits, notes and photos persist; the old Work Orders URL redirects", async () => {
    const dir = tempDataDir();
    let { app, page, close } = await start(dir);
    const propertyId = await quickProperty(page);
    await goto(page, "/dashboard/work-orders/");
    await page.waitForURL(/\/maintenance\/$/);

    await page.getByRole("button", { name: "New request" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What needs doing?").fill("Water heater tripping");
    await dialog.getByLabel("Property", { exact: true }).selectOption(propertyId);
    await dialog.getByLabel("Priority").selectOption("critical");
    await dialog.getByLabel("Estimated cost").fill("350");
    await dialog.getByRole("button", { name: "Create request" }).click();
    await page.getByText("Request M-0001 created").waitFor();
    await page.getByRole("link", { name: "Water heater tripping" }).click();

    await stubOpenDialog(app, [photoFile("heater.png")]);
    await page.getByRole("button", { name: "Add photos" }).click();
    await page.getByRole("img", { name: "heater.png" }).waitFor();
    await page.getByRole("button", { name: "Schedule" }).click();
    await page.getByText("Changes saved").first().waitFor();
    await page.getByLabel("Add a note").fill("Electrician booked for Friday.");
    await page.getByRole("button", { name: "Add note" }).click();
    await page.getByText("Electrician booked for Friday.").waitFor();
    await shot(page, "e2e-maintenance-detail");
    await close();

    ({ app, page, close } = await start(dir));
    const [item] = await invoke(page, "maintenance.list", { propertyId: null, status: "all", priority: null, overdueOnly: false, query: "" });
    await goto(page, `/maintenance/view/?id=${item.id}`);
    await page.getByText("Electrician booked for Friday.").waitFor();
    await page.getByText("Status: New → Scheduled").waitFor();
    const photo = page.getByRole("img", { name: "heater.png" });
    await photo.waitFor();
    assert.ok(await photo.evaluate((img) => img.naturalWidth > 0));
    const detail = await invoke(page, "maintenance.get", { id: item.id });
    assert.equal(detail.status, "scheduled");
    assert.equal(detail.priority, "critical");
    assert.equal(detail.estimatedCostSen, 35000);
    await close();
  });

  it("rejects overlapping rentals of a room and its whole unit", async () => {
    const { page, close } = await start(tempDataDir());
    const propertyId = await quickProperty(page);
    const detail = await invoke(page, "properties.get", { id: propertyId });
    const unit = detail.units[0];
    const room = unit.children[0];
    const base = { tenantId: null, endDate: "2027-09-30", monthlyRentSen: 80000, rentDueDay: 5, rentStartMonth: "2026-10", securityDepositSen: 0, utilityDepositSen: 0, terms: "", stagingKey: null };
    await invoke(page, "tenancies.create", { ...base, newTenant: { fullName: "Aina", phone: "012-345 6789", email: "", emergencyName: "", emergencyPhone: "", notes: "" }, spaceId: room.id, startDate: "2026-10-01" });
    await assert.rejects(
      invoke(page, "tenancies.create", { ...base, newTenant: { fullName: "Whole family", phone: "", email: "", emergencyName: "", emergencyPhone: "", notes: "" }, spaceId: unit.id, startDate: "2027-01-01", endDate: "2027-12-31", rentStartMonth: "2027-01" }),
      /already let to Aina/,
    );
    // The form marks the room as taken for those dates.
    await goto(page, `/tenancies/new/?propertyId=${propertyId}`);
    await page.getByLabel("Start date").fill("2027-01-01");
    await page.getByLabel("End date").fill("2027-12-31");
    await page.waitForTimeout(500);
    const option = page.locator("option", { hasText: "let to Aina for these dates" });
    await option.first().waitFor({ state: "attached" });
    assert.equal(await option.first().isDisabled(), true);
    await close();
  });

  it("backs up and restores records and attachments, keeping a safety copy", async () => {
    const dir = tempDataDir();
    const { app, page, close } = await start(dir);
    const propertyId = await quickProperty(page);
    // Dropped files arrive from the UI as Uint8Array bytes; send one the same way.
    await page.evaluate(async ([id, bytes]) => {
      const r = await window.havenos.invoke("attachments.importDropped", { owner: { kind: "property", id }, purpose: "photo", files: [{ name: "front.png", bytes: new Uint8Array(bytes) }] });
      if (!r.ok) throw new Error(r.error.message);
    }, [propertyId, Array.from(PNG)]);

    const backupFile = path.join(tempDataDir("backups"), "mine.havenos-backup");
    await stubSaveDialog(app, backupFile);
    await goto(page, "/settings/");
    await page.getByRole("button", { name: "Back up to a file…" }).click();
    await page.getByText(`Backup saved to ${backupFile}`).waitFor();
    assert.ok(fs.statSync(backupFile).size > 0);

    await quickProperty(page, "Made after backup");
    assert.equal((await invoke(page, "properties.list", { includeArchived: false })).length, 2);

    await stubOpenDialog(app, [backupFile]);
    await page.getByRole("button", { name: "Choose a backup file…" }).click();
    await page.getByText("1 properties, 0 tenants").waitFor();
    await shot(page, "e2e-restore-confirm");
    await page.getByRole("button", { name: "Replace my records" }).click();
    await page.getByText(/Restore complete/).waitFor();

    const list = await invoke(page, "properties.list", { includeArchived: false });
    assert.deepEqual(list.map((p) => p.name), ["Rumah Ujian"]);
    const restored = await invoke(page, "properties.get", { id: propertyId });
    assert.equal(restored.photos.length, 1);
    const safety = fs.readdirSync(path.join(dir, "backups")).filter((f) => f.startsWith("HavenOS-before-restore"));
    assert.equal(safety.length, 1);
    await close();
  });

  it("records a partial payment, shows the overdue balance, and saves a PDF receipt", async () => {
    const { app, page, close } = await start(tempDataDir());
    const propertyId = await quickProperty(page);
    const room = (await invoke(page, "properties.get", { id: propertyId })).units[0].children[1];
    const tenancy = await invoke(page, "tenancies.create", {
      tenantId: null,
      newTenant: { fullName: "Hakim", phone: "+60 11-2345 6789", email: "", emergencyName: "", emergencyPhone: "", notes: "" },
      spaceId: room.id,
      startDate: "2026-08-01",
      endDate: "2027-07-31",
      monthlyRentSen: 65000,
      rentDueDay: 5,
      rentStartMonth: "2026-08",
      securityDepositSen: 130000,
      utilityDepositSen: 0,
      terms: "",
      stagingKey: null,
    });
    await goto(page, `/tenancies/view/?id=${tenancy.id}`);
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount received").fill("1000");
    await dialog.getByLabel("Reference").fill("DN-8812");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await page.getByText("Payment recorded — receipt R-00001").waitFor();
    await page.getByText("RM 300.00 (Overdue RM 300.00)").waitFor();
    await shot(page, "e2e-tenancy-ledger");

    const detail = await invoke(page, "tenancies.get", { id: tenancy.id });
    await goto(page, `/receipt/?id=${detail.payments[0].id}`);
    await page.getByText("DN-8812").waitFor();
    const pdf = path.join(tempDataDir("receipt"), "receipt.pdf");
    await stubSaveDialog(app, pdf);
    await page.getByRole("button", { name: "Save as PDF" }).click();
    await page.getByText(/Saved .*receipt\.pdf/).waitFor({ timeout: 30_000 });
    assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), "%PDF-");
    await close();
  });

  it("is keyboard navigable: skip link, search with Ctrl/⌘+K, and visible focus", async () => {
    const { page, close } = await start(tempDataDir());
    await quickProperty(page, "Taman Keyboard");
    await goto(page, "/dashboard/");
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.keyboard.press("Tab");
    const skip = await page.evaluate(() => document.activeElement?.textContent);
    assert.equal(skip, "Skip to main content");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.equal(outline, "solid");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await page.getByRole("combobox", { name: "Search" }).fill("keyboard");
    await page.getByRole("option", { name: /Taman Keyboard/ }).waitFor();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Taman Keyboard" }).waitFor();
    await close();
  });

  it("shows cloud backup honestly as unavailable when this build has no service configured", async () => {
    const { page, close } = await start(tempDataDir());
    await goto(page, "/settings/?tab=cloud");
    await page.getByText("Cloud backup isn't available in this build of HavenOS.").waitFor();
    await page.getByText(/If your subscription ends, nothing on this computer changes/).waitFor();
    const status = await invoke(page, "cloud.status", { refresh: true });
    assert.equal(status.configured, false);
    await assert.rejects(invoke(page, "cloud.backupNow"), /isn't configured/);
    await close();
  });
});
