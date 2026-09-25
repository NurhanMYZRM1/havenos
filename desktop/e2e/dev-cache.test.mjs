import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { it } from "node:test";
import { invoke, launch, tempDataDir } from "./harness.mjs";

it("reproduces a stale permanent redirect and clears only dev HTTP cache before navigation", { timeout: 120_000 }, async () => {
  let legacy = true;
  const server = http.createServer((req, res) => {
    const redirect = legacy ? req.url === "/dashboard/" : req.url === "/dashboard";
    if (redirect) {
      res.writeHead(308, { Location: legacy ? "/dashboard" : "/dashboard/", "Cache-Control": "public, max-age=31536000" });
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      res.end(`<html><body>${legacy ? "legacy" : "current"}</body></html>`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const dir = tempDataDir("havenos-dev-cache");
  let run;
  try {
    run = await launch(dir, { HAVENOS_DEV_SERVER_URL: url });
    assert.equal(await run.page.textContent("body"), "legacy");
    const settings = await invoke(run.page, "settings.get");
    await invoke(run.page, "settings.update", { ...settings, landlordName: "Cache regression sentinel" });
    fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
    const sentinels = [path.join(dir, "attachments", "sentinel.txt"), path.join(dir, "backups", "sentinel.txt")];
    for (const file of sentinels) fs.writeFileSync(file, "preserve");
    legacy = false;
    await assert.rejects(run.page.goto(`${url}/dashboard/`), /ERR_TOO_MANY_REDIRECTS/);
    await run.close();
    run = null;

    // A normal app:// launch preserves the existing HTTP cache.
    run = await launch(dir, { HAVENOS_DEV_SERVER_URL: "" });
    const cachedBytes = await run.app.evaluate(({ session }) => session.defaultSession.getCacheSize());
    assert.ok(cachedBytes > 0);
    await run.close();
    run = null;

    run = await launch(dir, { HAVENOS_DEV_SERVER_URL: url });
    assert.equal(run.page.url(), `${url}/dashboard/`);
    assert.equal(await run.page.textContent("body"), "current");
    assert.equal((await invoke(run.page, "settings.get")).landlordName, "Cache regression sentinel");
    for (const file of sentinels) assert.equal(fs.readFileSync(file, "utf8"), "preserve");
  } finally {
    if (run) await run.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
