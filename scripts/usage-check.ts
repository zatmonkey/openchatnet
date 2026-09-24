import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import Redis from "ioredis";
import { RedisMemoryServer } from "redis-memory-server";
import { UsageService } from "../lib/server/usage";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

function encoded(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encoded);
  if (typeof value === "string" && value !== "OK")
    return Buffer.from(value).toString("base64");
  return value;
}

async function main() {
  const fixture = await RedisMemoryServer.create();
  const redis = new Redis(await fixture.getPort(), await fixture.getHost());
  let app: ChildProcess | undefined;
  let output = "";
  let failUsageWrites = false;
  const adapter = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      const pipeline = request.url === "/pipeline";
      const commands: [string, ...string[]][] = pipeline ? payload : [payload];
      const results = [];
      for (const [command, ...args] of commands) {
        try {
          if (
            failUsageWrites &&
            command.toUpperCase() === "EVAL" &&
            args[2]?.startsWith("ocn:usage:")
          )
            throw new Error("Simulated metrics outage");
          const result = await redis.call(command, ...args);
          results.push({
            result:
              request.headers["upstash-encoding"] === "base64"
                ? encoded(result)
                : result,
          });
        } catch {
          results.push({ error: "Isolated Redis fixture rejected command" });
        }
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(pipeline ? results : results[0]));
    } catch {
      response.writeHead(500).end();
    }
  });
  try {
    const redisPort = await listen(adapter);
    const reservation = createServer();
    const port = await listen(reservation);
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    app = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        env: {
          ...process.env,
          UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${redisPort}`,
          UPSTASH_REDIS_REST_TOKEN: "isolated-test-only",
          SITE_URL: origin,
          USAGE_METRICS_ENABLED: "true",
          X402_PAY_TO_ADDRESS: "0xac5d932D7a16D74F713309be227659d387c69429",
          VERCEL: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    app.stdout?.on("data", (chunk) => {
      output = (output + chunk).slice(-8000);
    });
    app.stderr?.on("data", (chunk) => {
      output = (output + chunk).slice(-8000);
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        ready = (await fetch(origin)).ok;
      } catch {}
      if (ready || app.exitCode !== null) break;
      await delay(100);
    }
    assert.ok(ready, output);
    const smoke = spawn(process.execPath, ["scripts/smoke.mjs", origin], {
      stdio: "inherit",
    });
    assert.equal(
      await new Promise((resolve) => smoke.once("exit", resolve)),
      0,
    );

    const usage = new UsageService({
      async eval<T>(script: string, keys: string[], args: (string | number)[]) {
        return (await redis.eval(script, keys.length, ...keys, ...args)) as T;
      },
    });
    const beacon = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${origin}/api/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    assert.equal((await beacon({ page: "home" })).status, 204);
    assert.equal((await beacon({ page: "/rooms/private-id" })).status, 400);
    assert.equal(
      (await beacon({ page: "home", room_id: "private-id" })).status,
      400,
    );
    assert.equal(
      (await beacon({ page: "home" }, { Origin: "https://evil.invalid" }))
        .status,
      403,
    );
    assert.equal((await beacon({ page: "home" }, { DNT: "1" })).status, 204);
    assert.equal(
      (await beacon({ page: "home" }, { "Sec-GPC": "1" })).status,
      204,
    );
    await delay(500);
    const totals = (await usage.report(1)).totals;
    assert.equal(totals["http.create_room.success"], 1);
    assert.equal(totals["http.send_message.success"], 2);
    assert.equal(totals["http.join_room.client_error"], 1);
    assert.equal(totals["http.upgrade_room.payment_required"], 1);
    assert.equal(totals["mcp.read_messages.success"], 2);
    assert.equal(totals["mcp.upgrade_room.payment_required"], 1);
    assert.ok(totals["mcp_transport.request.success"] > 0);
    assert.ok(totals["mcp_transport.request.client_error"] >= 1);
    assert.equal(totals["page.home.success"], 1);
    for (const key of await redis.keys("ocn:usage:*")) {
      const ttl = await redis.ttl(key);
      assert.ok(ttl > 29 * 86400 && ttl <= 30 * 86400);
      assert.ok(
        !JSON.stringify(await redis.hgetall(key)).includes("private-id"),
      );
    }

    failUsageWrites = true;
    assert.equal(
      (await fetch(`${origin}/api/rooms`, { method: "POST" })).status,
      201,
    );
    await delay(500);
    failUsageWrites = false;
    assert.equal((await usage.report(1)).totals["http.create_room.success"], 1);

    if (process.env.PLAYWRIGHT_PATH) {
      const { chromium } = createRequire(import.meta.url)(
        process.env.PLAYWRIGHT_PATH,
      );
      const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH,
        args: ["--no-sandbox"],
      });
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const requests: { body: unknown; headers: Record<string, string> }[] =
          [];
        await page.route(
          "**/api/usage",
          async (route: {
            request(): {
              postDataJSON(): unknown;
              headers(): Record<string, string>;
            };
            fulfill(options: { status: number }): Promise<void>;
          }) => {
            requests.push({
              body: route.request().postDataJSON(),
              headers: route.request().headers(),
            });
            await route.fulfill({ status: 204 });
          },
        );
        await page.goto(`${origin}/?secret=never-collected`);
        await page.waitForTimeout(300);
        assert.deepEqual(
          requests.map((request) => request.body),
          [{ page: "home" }],
        );
        assert.equal(requests[0].headers.referer, undefined);
        assert.equal(requests[0].headers.cookie, undefined);
        await page.goto(
          `${origin}/rooms/00000000-0000-4000-8000-000000000001?secret=never-collected`,
        );
        await page.waitForTimeout(300);
        assert.deepEqual(requests[1].body, { page: "room" });
        for (const preference of ["doNotTrack", "globalPrivacyControl"]) {
          const privateContext = await browser.newContext();
          await privateContext.addInitScript(
            (name: string) =>
              Object.defineProperty(navigator, name, {
                value: name === "doNotTrack" ? "1" : true,
              }),
            preference,
          );
          const privatePage = await privateContext.newPage();
          let beacons = 0;
          await privatePage.route(
            "**/api/usage",
            async (route: {
              fulfill(options: { status: number }): Promise<void>;
            }) => {
              beacons++;
              await route.fulfill({ status: 204 });
            },
          );
          await privatePage.goto(origin);
          await privatePage.waitForTimeout(300);
          assert.equal(beacons, 0);
          await privateContext.close();
        }
        await context.close();
      } finally {
        await browser.close();
      }
      const homepage = spawn(
        process.execPath,
        ["scripts/homepage-check.cjs", origin],
        { stdio: "inherit" },
      );
      assert.equal(
        await new Promise((resolve) => homepage.once("exit", resolve)),
        0,
      );
    }
    console.log(
      "PASS: isolated HTTP/MCP usage counters, response outcomes, beacon validation/opt-outs, fixed TTL, and no identifiers. No production Redis used.",
    );
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    if (app && app.exitCode === null) {
      app.kill("SIGTERM");
      await new Promise((resolve) => app!.once("exit", resolve));
    }
    adapter.closeAllConnections();
    await new Promise<void>((resolve) => adapter.close(() => resolve()));
    await redis.quit();
    await fixture.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
