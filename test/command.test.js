import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkCommand, expand, tokenize } from "../src/command.js";
import { pluginDir } from "../src/config.js";
import { tmp, write } from "./helpers.js";

const ctx = (cwd) => ({ cwd, home: cwd, PATH: process.env.PATH, vars: { CLAUDE_PROJECT_DIR: cwd } });

test("tokenize handles quotes and stops at shell operators", () => {
  assert.deepEqual(tokenize(`node "/a b/x.js" hook 'one two' | tee log`), ["node", "/a b/x.js", "hook", "one two"]);
  assert.deepEqual(tokenize(`FOO=1 bash ./run.sh && echo done`), ["FOO=1", "bash", "./run.sh"]);
});

test("expand replaces tilde and variables", () => {
  assert.equal(expand("~/x", {}, "/h"), "/h/x");
  assert.equal(expand("${CLAUDE_PROJECT_DIR}/a/$B", { CLAUDE_PROJECT_DIR: "/p", B: "b" }, "/h"), "/p/a/b");
  assert.equal(expand("${MISSING:-dflt}", {}, "/h"), "dflt");
  assert.equal(expand("$MISSING", {}, "/h"), "$MISSING");
});

test("checkCommand finds missing executables and scripts", () => {
  const dir = tmp();
  assert.equal(checkCommand(["definitely-not-a-command-xyz"], ctx(dir)).level, "fail");
  assert.match(checkCommand(tokenize("node ~/missing.js hook"), ctx(dir)).detail, /script not found: .*missing\.js/);
  write(path.join(dir, "ok.js"), "");
  assert.equal(checkCommand(tokenize("node ~/ok.js"), ctx(dir)).level, "ok");
  assert.equal(checkCommand(tokenize("node -e 1"), ctx(dir)).level, "ok");
  assert.equal(checkCommand(tokenize("python3 -m http.server"), ctx(dir)).level === "fail", false);
  assert.equal(checkCommand(tokenize("$UNSET_THING/x.sh"), ctx(dir)).level, "warn");
});

test("checkCommand warns when a script run directly is not executable", () => {
  const dir = tmp();
  const f = write(path.join(dir, "hook.sh"), "#!/bin/sh\n");
  assert.match(checkCommand(tokenize(`${f} arg`), ctx(dir)).detail, /not executable/);
  fs.chmodSync(f, 0o755);
  assert.equal(checkCommand(tokenize(`"$CLAUDE_PROJECT_DIR"/hook.sh`), ctx(dir)).level, "ok");
});

test("option values are not mistaken for scripts", () => {
  const dir = tmp();
  write(path.join(dir, "server.js"), "");
  for (const args of [["--import", "tsx", "server.js"], ["--token", "ghp_SECRET", "srv.js"], ["run", "server.js"]]) {
    const r = checkCommand(["node", ...args], ctx(dir));
    assert.equal(r.level, "ok", args.join(" "));
    assert.doesNotMatch(r.detail, /SECRET/);
  }
  assert.match(checkCommand(["node", "missing.js"], ctx(dir)).detail, /script not found/);
});

test("plugin cache fallback picks the newest version folder", () => {
  const config = tmp();
  const base = path.join(config, "plugins", "cache", "mkt", "plug");
  fs.mkdirSync(path.join(base, "0.10.0"), { recursive: true });
  fs.mkdirSync(path.join(base, "0.9.0"), { recursive: true });
  const old = new Date(Date.now() - 86400000);
  fs.utimesSync(path.join(base, "0.10.0"), old, old);
  assert.equal(pluginDir(config, "plug@mkt"), path.join(base, "0.9.0"));
});
