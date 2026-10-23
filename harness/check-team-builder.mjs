import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const button = (name) => page.getByRole("button", { name, exact: true });
try {
  await page.goto("http://127.0.0.1:5199/harness/team-builder.html");
  await button("Open team").click();
  await button("Inspect frontend").click();
  await page.getByText("Configuration preview.", { exact: false }).waitFor();
  assert(await page.getByText("react", { exact: true }).count());
  await button("settings").click();
  await page.getByLabel("Reports to", { exact: true }).selectOption("lead");
  await button("Save team").click();
  await page.waitForFunction(
    () =>
      window.savedTeams()[0].roles.find((r) => r.name === "frontend")
        .reports_to === "lead",
  );
  // Return to original manager; then prevent a manager from becoming its descendant's report.
  await page
    .getByLabel("Reports to", { exact: true })
    .selectOption("engineering");
  await button("Inspect engineering").click();
  await button("settings").click();
  assert.equal(
    await page
      .getByLabel("Reports to", { exact: true })
      .locator('option[value="engineering"]')
      .count(),
    0,
  );
  assert.equal(
    await page.getByLabel("Agent type", { exact: true }).isDisabled(),
    true,
  );
  await button("Save team").click();
  await button("Back to teams").click();
  await button("Open team").click();
  await button("Inspect frontend").click();
  await button("activity").click();
  await page.getByRole("button", { name: /Build settings panel/ }).click();
  await page.getByText(/EXACT SAVED PROMPT/).waitFor();
  await button("Inspect qa").click();
  await button("activity").click();
  assert.equal(await page.getByText(/EXACT SAVED PROMPT/).count(), 0);
  await button("Inspect frontend").click();
  await button("Zoom out").click();
  await button("Zoom out").click();
  await page.screenshot({
    path: "/workspace/scratch/cab930b2968f/team-builder-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await button("Fit").click();
  await page.screenshot({
    path: "/workspace/scratch/cab930b2968f/team-builder-mobile.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "mobile page must not overflow horizontally",
  );
  await page.setViewportSize({ width: 1560, height: 1000 });
  await button("Add agent under engineering").click();
  await page.getByLabel("Saved agent", { exact: true }).selectOption("agent-6");
  await page.getByLabel("Role ID", { exact: true }).fill("release");
  await button("Save team").click();
  await page.waitForFunction(() =>
    window
      .savedTeams()[0]
      .roles.some(
        (r) => r.name === "release" && r.reports_to === "engineering",
      ),
  );
  await button("Back to teams").click();
  await button("Create team").click();
  await page.getByLabel("Team name", { exact: true }).fill("New team");
  await page.getByLabel("Team ID", { exact: true }).fill("new-team");
  await button("Add agent under lead").click();
  await page.getByLabel("Saved agent", {exact:true}).selectOption("agent-1");
  await button("Inspect lead").click(); await button("settings").click();
  await page.getByLabel("Role ID", { exact: true }).fill("");
  await page.getByLabel("Role ID", { exact: true }).fill("new-lead");
  await page.getByLabel("Saved agent", { exact: true }).selectOption("agent-0");
  await button("Save team").click();
  await page.waitForFunction(() =>
    window
      .savedTeams()
      .some((t) => t.id === "new-team" && !t.roles[0].reports_to && t.roles[1].reports_to === "new-lead"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: hierarchy editing, save/reopen, parent restrictions, run snapshots, mobile layout and empty root rename",
  );
} finally {
  console.log("Browser errors:", errors);
  await browser.close();
}
