import { spawn } from "node:child_process";
import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function kill(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

const lastLine = (s) => s.trim().split("\n").at(-1)?.slice(0, 200) ?? "";

export function probe(command, args, { cwd, env, timeout = 10000 }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: "pipe", detached: process.platform !== "win32" });
    let out = "";
    let err = "";
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      kill(child);
      resolve(result);
    };
    const send = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
    const timer = setTimeout(() => finish({ error: `timed out after ${timeout / 1000}s` }), timeout);
    child.on("error", (e) => finish({ error: e.message }));
    child.on("exit", (code, signal) => {
      const why = lastLine(err);
      finish({ error: `exited with ${signal || `code ${code}`}${why ? `: ${why}` : ""}` });
    });
    child.stdin.on("error", () => {});
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => {
      out += d;
      let i;
      while ((i = out.indexOf("\n")) >= 0) {
        const line = out.slice(0, i);
        out = out.slice(i + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.method) continue;
        if (msg.id === 1) {
          if (msg.error) return finish({ error: `initialize failed: ${msg.error.message}` });
          send({ method: "notifications/initialized" });
          if (!msg.result?.capabilities?.tools) return finish({ tools: 0 });
          send({ id: 2, method: "tools/list", params: {} });
        } else if (msg.id === 2) {
          finish(msg.error ? { error: `tools/list failed: ${msg.error.message}` } : { tools: msg.result?.tools?.length ?? 0 });
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ccdoctor", version } },
    });
  });
}
