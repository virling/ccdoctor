import fs from "node:fs";
import path from "node:path";

const INTERPRETERS = new Set(["node", "bash", "sh", "zsh", "python", "python3", "ruby", "perl", "bun", "deno", "tsx"]);
const BUILTINS = new Set(["echo", "printf", "true", "false", "test", "[", "cd", "exit", ":", "exec", "source", "."]);

export const isFile = (f) => !!fs.statSync(f, { throwIfNoEntry: false })?.isFile();

export function canRun(f) {
  try {
    fs.accessSync(f, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Splits the first simple command of a shell line into words.
export function tokenize(cmd) {
  const tokens = [];
  let cur = null;
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      cur ??= "";
    } else if (c === "\\" && i + 1 < cmd.length) cur = (cur ?? "") + cmd[++i];
    else if (/\s/.test(c)) {
      if (cur !== null) tokens.push(cur);
      cur = null;
    } else if ("|&;<>()".includes(c)) break;
    else cur = (cur ?? "") + c;
  }
  if (cur !== null) tokens.push(cur);
  return tokens;
}

export const expand = (s, vars, home) =>
  s.replace(/^~(?=\/|$)/, home).replace(/\$\{(\w+)(?::-([^}]*))?\}|\$(\w+)/g, (m, a, def, b) => vars[a || b] ?? def ?? m);

export function which(exe, { PATH, cwd }) {
  if (exe.includes("/")) {
    const f = path.resolve(cwd, exe);
    return isFile(f) ? f : null;
  }
  for (const dir of PATH.split(path.delimiter)) {
    const f = path.join(dir, exe);
    if (dir && isFile(f) && canRun(f)) return f;
  }
  return null;
}

function scriptArg(args) {
  for (const a of args) {
    if (["-c", "-e", "-m", "-p", "--eval"].includes(a)) return null;
    if (!a.startsWith("-") && a !== "run") return a;
  }
  return null;
}

export function checkCommand(tokens, ctx) {
  const t = tokens.map((x) => expand(x, ctx.vars, ctx.home));
  while (t.length && /^\w+=/.test(t[0])) t.shift();
  if (!t.length) return { level: "fail", detail: "empty command", files: [] };
  const [exe, ...args] = t;
  if (BUILTINS.has(exe)) return { level: "ok", detail: "shell builtin", files: [] };
  if (exe.includes("$")) return { level: "warn", detail: `cannot resolve ${exe}`, files: [] };
  const file = which(exe, ctx);
  if (!file) return { level: "fail", detail: `${exe} not found${exe.includes("/") ? "" : " on PATH"}`, files: [] };
  if (!canRun(file)) return { level: "warn", detail: `${file} is not executable`, files: [file] };
  const script = INTERPRETERS.has(path.basename(exe)) && scriptArg(args);
  if (!script) return { level: "ok", detail: file, files: [file] };
  if (script.includes("$")) return { level: "warn", detail: `cannot resolve ${script}`, files: [file] };
  const s = path.resolve(ctx.cwd, script);
  if (!isFile(s)) return { level: "fail", detail: `script not found: ${s}`, files: [file] };
  return { level: "ok", detail: s, files: [file, s] };
}
