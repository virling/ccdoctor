import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const file = ".claude-plugin/plugin.json";
fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), version }, null, 2) + "\n");
