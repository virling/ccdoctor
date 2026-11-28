import fs from "node:fs";
import path from "node:path";

const DAYS = 7;
export const MIN_PROMPTS = 5;
const MAX_BYTES = 50 * 1024 * 1024;

const transcriptDir = (configDir, root) => path.join(configDir, "projects", path.resolve(root).replace(/[^a-zA-Z0-9]/g, "-"));

function recentTranscripts(dir, since) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith(".jsonl")) files.push(full);
    const sub = path.join(full, "subagents");
    if (e.isDirectory() && fs.existsSync(sub)) files.push(...fs.readdirSync(sub).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(sub, f)));
  }
  return files.filter((f) => {
    const st = fs.statSync(f);
    return st.mtimeMs >= since && st.size <= MAX_BYTES;
  });
}

function repoRoot(dir) {
  for (let d = dir; d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, ".git"))) return d;
  return dir;
}

function folders(command, cwd, home) {
  const cds = new Set([...command.matchAll(/(?:^|[;&|]\s*)cd\s+(\S+)/g)].map((m) => m[1]));
  const dirs = [];
  for (const m of command.matchAll(/(?:^|[\s=])(~?\/[^\s;&|'"`)]+)/g)) {
    const p = m[1].replace(/^~(?=\/|$)/, home);
    dirs.push(repoRoot(cds.has(m[1]) || !path.extname(p) ? p : path.dirname(p)));
  }
  if (!dirs.length && cwd) dirs.push(repoRoot(cwd));
  return [...new Set(dirs)];
}

// Folders that tool calls read outside the project in recent sessions, each needing a manual approval.
export function outsideReads(p, root, added = []) {
  const inside = (d) => [root, ...added].some((a) => d === a || d.startsWith(`${a}/`));
  const counts = new Map();
  let prompts = 0;
  for (const file of recentTranscripts(transcriptDir(p.configDir, root), Date.now() - DAYS * 86400000)) {
    const uses = new Map();
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.includes('"tool_use"') && !line.includes('"permissionDecision"')) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const content = Array.isArray(e.message?.content) ? e.message.content : [];
      for (const c of content) if (c.type === "tool_use") uses.set(c.id, c);
      if (!e.permissionDecision?.source?.startsWith("user")) continue;
      prompts++;
      if (!e.permissionDecision.reasonCode?.includes("outsideReadsBlocked")) continue;
      const use = uses.get(content.find((c) => c.type === "tool_result")?.tool_use_id);
      const target = use?.input?.command || use?.input?.file_path || use?.input?.path || "";
      const dirs = use?.name === "Bash" ? folders(target, e.cwd, p.home) : target.startsWith("/") ? [repoRoot(path.dirname(target))] : [];
      for (const d of dirs.filter((d) => !inside(d))) counts.set(d, (counts.get(d) || 0) + 1);
    }
  }
  return { prompts, days: DAYS, folders: [...counts].sort((a, b) => b[1] - a[1]).map(([dir, count]) => ({ dir, count })) };
}
