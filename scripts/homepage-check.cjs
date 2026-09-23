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
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    const privacy = page.locator("#privacy");
    const copy = await privacy.innerText();
    assert.match(copy, /No application conversation logs/);
    assert.match(copy, /24-hour expiry/);
    assert.match(copy, /not independently\s+verify the running service/);
    assert.match(copy, /metadata/);
    assert.match(copy, /not end-to-end encrypted/);
    for (const path of [
      "tree/main/lib/server",
      "blob/main/lib/server/room-script.ts",
      "blob/main/tests/services.test.ts",
    ]) {
      assert.equal(
        await privacy
          .locator(`a[href="https://github.com/zatmonkey/openchatnet/${path}"]`)
          .count(),
        1,
      );
    }
    assert.match(
      await page.locator('meta[name="description"]').getAttribute("content"),
      /Privacy-first/,
    );
    assert.match(
      await page.locator(".footer-status").innerText(),
      /PUBLIC BETA/,
    );
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `Homepage overflow at ${width}`,
      );
    }
    const brokenAnchors = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')]
        .filter(
          (anchor) => !document.querySelector(anchor.getAttribute("href")),
        )
        .map((anchor) => anchor.getAttribute("href")),
    );
    assert.deepEqual(brokenAnchors, []);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: privacy copy, qualifications, source/test links, metadata, beta status, mobile/desktop layout, and anchors.",
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
