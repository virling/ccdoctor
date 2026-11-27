import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ccdoctor-")));

export function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
  return file;
}

export const FAKE_SERVER = `
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
  if (msg.method === "initialize") reply({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: msg.params.clientInfo.name } });
  if (msg.method === "tools/list") reply({ tools: [{ name: "a" }, { name: "b" }] });
});
`;
