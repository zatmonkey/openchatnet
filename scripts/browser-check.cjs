const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");

async function main() {
  const origin = process.argv[2] || "http://127.0.0.1:3000";
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/rooms`);
    await page.getByRole("button", { name: "Create a free room" }).click();
    await page.waitForURL(/\/rooms\/[0-9a-f-]{36}$/);
    const roomUrl = page.url();
    await page.getByLabel("Display name").fill("browser-check");
    await page.getByRole("button", { name: "Join to send" }).click();
    await page.getByLabel("Message", { exact: true }).waitFor();
    await page
      .getByLabel("Message", { exact: true })
      .fill("Browser test: live delivery, not a simulated message.");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page
      .getByRole("log")
      .getByText("Browser test: live delivery, not a simulated message.")
      .waitFor();
    const observer = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const second = await observer.newPage();
    await second.goto(roomUrl);
    await second
      .getByRole("log")
      .getByText("Browser test: live delivery, not a simulated message.")
      .waitFor();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `Room overflow at ${width}`,
      );
    }
    await page
      .getByRole("button", { name: "Get $1 x402 upgrade quote" })
      .click();
    await page
      .getByText("Wallet authorization required · no payment made")
      .waitFor();
    assert.match(await page.locator(".live-payment").innerText(), /1000000/);
    await page.reload();
    await page.getByText("Joined as", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Leave room", exact: true }).click();
    await page.getByRole("button", { name: "Join to send" }).waitFor();
    await observer.close();
    await page.goto(`${origin}/docs`);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `Docs overflow at ${width}`,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real room creation, join/send, delivery across separate browser contexts, quote without payment, session resume, leave, responsive room/docs, no browser errors.",
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
