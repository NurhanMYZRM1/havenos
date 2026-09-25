import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, it } from "node:test";
import { invoke, launch, ROOT, shot, tempDataDir } from "./harness.mjs";

let session;
afterEach(async () => { await session?.close().catch(() => undefined); });

async function goto(page, route) {
  await page.evaluate((r) => { window.location.href = `app://havenos${r}`; }, route);
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("heading", { level: 1 }).waitFor();
}

async function fits(page, name) {
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('[role="status"]')).some((el) => el.textContent === "Loading…"));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} stays within the window`);
  const dialog = page.locator("dialog[open]");
  if (await dialog.count()) {
    assert.ok(await dialog.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    }), `${name} keeps its close and save controls within the window`);
  }
  await shot(page, `e2e-short-stays-${name}-960`);
}

it("short-stay screens fit the minimum window, calendar days work with the keyboard, and performance expands its figures", { timeout: 240_000 }, async () => {
  session = await launch(tempDataDir("havenos-stays-e2e"));
  const { app, page } = session;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await invoke(page, "workspace.switch", { workspace: "sample" });
  const info = await invoke(page, "app.info");
  assert.equal(await invoke(page, "app.now"), Date.parse("2026-09-23T04:00:00.000Z"), "the renderer can read the workspace's injected clock");
  const day = await invoke(page, "stays.day", { date: info.today });
  const [connection] = await invoke(page, "channels.list");
  const reservation = day.arrivals[0];
  const turnover = day.turnovers[0];
  assert.ok(reservation && turnover && connection, "sample has short-stay fixtures");

  for (const tab of ["today", "calendar", "turnovers", "performance"]) {
    await goto(page, `/stays/?tab=${tab}`);
    await page.getByRole("tab", { selected: true, name: tab === "today" ? "Today" : tab === "calendar" ? "Calendar" : tab === "turnovers" ? "Turnovers" : "Performance" }).waitFor();
    if (tab === "calendar") await page.getByRole("button", { name: /^Add on / }).first().waitFor();
    if (tab === "performance") await page.getByRole("table", { name: "Performance", exact: true }).waitFor();
    await fits(page, tab);
  }

  const report = page.getByRole("table", { name: "Performance", exact: true });
  assert.ok(await report.evaluate((el) => el.scrollWidth <= el.parentElement.clientWidth), "performance totals fit without horizontal scrolling");
  const total = report.getByRole("button", { name: "Total", exact: true });
  await total.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Imported / Entered breakdown" }).waitFor();
  await report.locator("tr:not([hidden])").getByText("Adjustments", { exact: true }).waitFor();
  assert.equal(await total.getAttribute("aria-expanded"), "true");
  await fits(page, "performance-breakdown");

  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  await fits(page, "money-entry");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Import Airbnb CSV", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  await fits(page, "import");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, path.join(ROOT, "desktop/tests/fixtures/airbnb/transactions.csv"));
  await page.getByRole("button", { name: "Choose CSV file…" }).click();
  await page.getByRole("heading", { name: "Check the import" }).waitFor();
  await fits(page, "import-preview");
  await page.keyboard.press("Escape");

  await goto(page, "/stays/?tab=calendar");
  const days = page.getByRole("button", { name: /^Add on / });
  await days.first().waitFor();
  const initialCount = await days.count();
  const rowCount = initialCount / 30;
  assert.ok(Number.isInteger(rowCount) && rowCount > 0);
  for (const count of [14, 60, 30]) {
    await page.getByRole("combobox", { name: "Days shown" }).selectOption(String(count));
    await page.waitForFunction((n) => document.querySelector('button[aria-label^="Add on "]')?.parentElement.querySelectorAll('button[aria-label^="Add on "]').length === n, count);
  }
  const firstDay = days.first();
  await firstDay.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await days.nth(1).evaluate((el) => document.activeElement === el), true);
  await page.keyboard.press("End");
  assert.equal(await days.nth(29).evaluate((el) => document.activeElement === el), true);
  await page.keyboard.press("ArrowDown");
  assert.equal(await days.nth(59).evaluate((el) => document.activeElement === el), true);
  await page.keyboard.press("Home");
  assert.equal(await days.nth(30).evaluate((el) => document.activeElement === el), true);
  assert.equal(await page.locator('button[aria-label^="Add on "][tabindex="0"]').count(), 1);
  await page.keyboard.press("Enter");
  await page.locator("dialog[open]").waitFor();
  await fits(page, "calendar-quick-add");
  await page.locator("dialog[open]").getByRole("button", { name: "Block dates" }).click();
  await page.getByRole("heading", { name: "Block dates", exact: true }).waitFor();
  await fits(page, "block");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add reservation", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  await fits(page, "reservation-add");
  await page.keyboard.press("Escape");

  await goto(page, `/stays/reservation/?id=${reservation.id}`);
  await page.getByRole("heading", { name: "History" }).waitFor();
  await fits(page, "reservation");
  await goto(page, `/stays/turnover/?id=${turnover.id}`);
  await page.getByRole("heading", { name: "Checklist", exact: true }).waitFor();
  await fits(page, "turnover");
  await goto(page, "/settings/channels/");
  await page.getByRole("heading", { name: connection.name, exact: true }).waitFor();
  await fits(page, "connections");
  await goto(page, `/settings/channels/?id=${connection.id}`);
  await page.getByRole("heading", { name: "Recent syncs" }).waitFor();
  await page.getByText(/\(3 h ago\)/).first().waitFor();
  await fits(page, "connection-detail");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  await fits(page, "connection-edit");
  await page.keyboard.press("Escape");

  await goto(page, `/properties/view/?id=${connection.propertyId}&tab=inventory`);
  await page.locator(`#space-${connection.spaceId}`).getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByText(/Remove or move the connection/).waitFor();
  await page.getByRole("link", { name: "Channel connections", exact: true }).waitFor();
  assert.deepEqual(errors, [], "short-stay screens have no renderer exceptions");
});
