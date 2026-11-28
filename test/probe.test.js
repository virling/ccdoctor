import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { probe } from "../src/probe.js";
import { FAKE_SERVER, tmp, write } from "./helpers.js";

test("probe counts tools from a stdio server", async () => {
  const dir = tmp();
  const server = write(path.join(dir, "server.cjs"), FAKE_SERVER);
  assert.deepEqual(await probe("node", [server], { cwd: dir, env: process.env }), { tools: 2 });
});

test("probe reports timeouts, exits and spawn errors", async () => {
  const dir = tmp();
  const opts = { cwd: dir, env: process.env };
  assert.match((await probe("node", ["-e", "setInterval(() => {}, 1000)"], { ...opts, timeout: 300 })).error, /timed out/);
  assert.match((await probe("node", ["-e", "console.error('boom'); process.exit(3)"], opts)).error, /code 3: boom/);
  assert.match((await probe("no-such-binary-xyz", [], opts)).error, /ENOENT/);
});
