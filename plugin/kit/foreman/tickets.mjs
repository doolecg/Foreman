import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
var BUILTIN = [
	[/[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}/g, "[secret]"],
	[/\b(sk|pk|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{16,}/g, "[secret]"],
	[/\bAKIA[A-Z0-9]{12,}/g, "[secret]"],
	[/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [secret]"],
	[/\b(authorization|x-api-key|api-key|cookie)\s*[:=]\s*\S.*$/gi, "$1: [secret]"],
	[/((?:api[_-]?key|token|secret|passw(?:or)?d|credential|auth)\w*["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi, "$1[secret]"],
	[/(\/\/[^/@\s:]*:)[^@\s/]+@/g, "$1[secret]@"]
];
function scrubConsoleText(text) {
	let out = text;
	for (const [re, to] of BUILTIN) out = out.replace(re, to);
	return out;
}
var ERROR_TEXT = /\b(error|failed|fatal|exception|panic|traceback)\b/i;
var LineBuffer = class {
	tail = "";
	push(chunk) {
		const parts = (this.tail + chunk).split(/\r?\n/);
		this.tail = parts.pop() ?? "";
		return parts;
	}
	flush() {
		const t = this.tail;
		this.tail = "";
		return t ? [t] : [];
	}
};
var ConsoleLog = class {
	lines = [];
	bytes = 0;
	nextId = 1;
	listeners = /* @__PURE__ */ new Set();
	running = /* @__PURE__ */ new Map();
	extraScrub = null;
	maxLines;
	maxBytes;
	maxLine;
	now;
	constructor(o = {}) {
		this.maxLines = o.maxLines ?? 2e3;
		this.maxBytes = o.maxBytes ?? 1e6;
		this.maxLine = o.maxLine ?? 2e3;
		this.now = o.now ?? Date.now;
	}
	setScrubber(fn) {
		this.extraScrub = fn;
	}
	add(source, stream, text, opts = {}) {
		const added = [];
		for (const raw of text.split(/\r?\n/)) {
			if (!raw.trim()) continue;
			let t = scrubConsoleText(raw);
			if (this.extraScrub) t = this.extraScrub(t);
			if (t.length > this.maxLine) t = `${t.slice(0, this.maxLine)}...`;
			const line = {
				id: this.nextId++,
				at: this.now(),
				source,
				stream,
				text: t,
				error: opts.error ?? (stream === "stderr" && ERROR_TEXT.test(t)),
				...opts.pid !== void 0 ? { pid: opts.pid } : {}
			};
			this.lines.push(line);
			this.bytes += t.length + 24;
			added.push(line);
			for (const l of this.listeners) try {
				l(line);
			} catch {}
		}
		while (this.lines.length > this.maxLines || this.bytes > this.maxBytes && this.lines.length > 1) {
			const old = this.lines.shift();
			this.bytes -= old.text.length + 24;
		}
		return added;
	}
	list(filter = {}) {
		return this.lines.filter((l) => (!filter.source || l.source === filter.source) && (filter.afterId === void 0 || l.id > filter.afterId));
	}
	clear(source) {
		this.lines = source ? this.lines.filter((l) => l.source !== source) : [];
		this.bytes = this.lines.reduce((n, l) => n + l.text.length + 24, 0);
	}
	onLine(fn) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}
	processStarted(p) {
		this.running.set(p.pid, p);
	}
	processEnded(pid) {
		this.running.delete(pid);
	}
	processes() {
		return [...this.running.values()];
	}
	isOwnProcess(pid) {
		return this.running.has(pid);
	}
};
var consoleLog = new ConsoleLog();
//#endregion
//#region core/hideshim.ts
var FILES = [["node-hide.cjs", `// Foreman: what a detached node process starts gets a hidden console (a console program it starts would open a window).
if (process.platform === 'win32') {
  const cp = require(\`node:child_process\`)
  const mark = 'FOREMAN_NO_CONSOLE'
  // This process was started detached (no console): hide every console window of what it starts in turn.
  const noConsole = process.env[mark] === '1'
  delete process.env[mark]
  const spawn = cp.ChildProcess.prototype.spawn
  cp.ChildProcess.prototype.spawn = function (options) {
    if (options) {
      if (options.detached && Array.isArray(options.envPairs)) options.envPairs.push(mark + '=1')
      if (noConsole) options.windowsHide = true
    }
    return spawn.call(this, options)
  }
  if (noConsole) {
    for (const name of ['spawnSync', 'execSync', 'execFileSync']) {
      const real = cp[name]
      cp[name] = function (...args) {
        const i = args.findIndex((a, k) => k > 0 && a && typeof a === 'object' && !Array.isArray(a))
        if (i > 0) args[i] = { ...args[i], windowsHide: true }
        else args.push({ windowsHide: true })
        return real.apply(this, args)
      }
    }
  }
}
`], ["sitecustomize.py", `# Foreman: DETACHED_PROCESS becomes CREATE_NO_WINDOW, so what the child starts keeps a hidden console.
import sys

if sys.platform == "win32":
    import subprocess

    _init = subprocess.Popen.__init__

    def _hidden_init(self, *args, **kwargs):
        flags = kwargs.get("creationflags", 0)
        if flags & 0x8:
            kwargs["creationflags"] = (flags & ~0x8) | 0x08000000
        _init(self, *args, **kwargs)

    subprocess.Popen.__init__ = _hidden_init
`]];
var written = /* @__PURE__ */ new Set();
function ensureFiles(dir) {
	if (written.has(dir)) return true;
	try {
		mkdirSync(dir, { recursive: true });
		for (const [name, text] of FILES) {
			const file = join(dir, name);
			let current = "";
			try {
				current = readFileSync(file, "utf8");
			} catch {}
			if (current !== text) writeFileSync(file, text);
		}
		written.add(dir);
		return true;
	} catch {
		return false;
	}
}
function hiddenConsoleEnv(env = process.env, platform = process.platform, dir = join(tmpdir(), "foreman-hide-console")) {
	if (platform !== "win32" || !ensureFiles(dir)) return env;
	const out = { ...env };
	const keyOf = (name) => Object.keys(out).find((k) => k.toUpperCase() === name) ?? name;
	const nodeShim = join(dir, "node-hide.cjs").replace(/\\/g, "/");
	const nodeKey = keyOf("NODE_OPTIONS");
	const nodeOptions = out[nodeKey] ?? "";
	if (!nodeOptions.includes(nodeShim)) out[nodeKey] = `--require "${nodeShim}"${nodeOptions ? ` ${nodeOptions}` : ""}`;
	const pyKey = keyOf("PYTHONPATH");
	const pyPath = out[pyKey] ?? "";
	if (!pyPath.split(delimiter).includes(dir)) out[pyKey] = pyPath ? `${dir}${delimiter}${pyPath}` : dir;
	return out;
}
//#endregion
//#region core/proc.ts
function sourceFor(cmd) {
	const name = (cmd.split(/[\\/]/).pop() ?? cmd).toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
	if (name === "uvx" || name === "uv") return "mcp";
	if (name === "git") return "git";
	if (name === "opencode") return "opencode";
	return "claude-run";
}
var MAX_ARG = 60;
function describeCommand(cmd, args, source) {
	return [
		cmd,
		...(source === "mcp" ? args.slice(0, 3) : args).map((a) => a.length > MAX_ARG ? `${a.slice(0, MAX_ARG)}...` : a),
		...source === "mcp" && args.length > 3 ? [`(+${args.length - 3} args hidden)`] : []
	].join(" ");
}
var children = /* @__PURE__ */ new Map();
function spawnHidden(cmd, args, opts = {}) {
	const { source: given, quiet, logStdout, ...rest } = opts;
	const source = given ?? sourceFor(cmd);
	if (!quiet && process.platform === "win32") rest.env = hiddenConsoleEnv(rest.env ?? process.env);
	const child = spawn(cmd, args, {
		...rest,
		windowsHide: true
	});
	if (quiet) return child;
	const label = describeCommand(cmd, args, source);
	const out = new LineBuffer();
	const err = new LineBuffer();
	const log = (stream, text, error) => consoleLog.add(source, stream, text, {
		...child.pid !== void 0 ? { pid: child.pid } : {},
		...error !== void 0 ? { error } : {}
	});
	child.on("spawn", () => {
		if (child.pid === void 0) return;
		children.set(child.pid, child);
		consoleLog.processStarted({
			pid: child.pid,
			source,
			command: label,
			startedAt: Date.now()
		});
		log("info", `started: ${label}`);
	});
	if (logStdout !== false) child.stdout?.on("data", (b) => {
		for (const l of out.push(String(b))) log("stdout", l);
	});
	child.stderr?.on("data", (b) => {
		for (const l of err.push(String(b))) log("stderr", l);
	});
	child.on("error", (e) => log("info", `${cmd}: ${e.message}`, true));
	child.on("close", (code, signal) => {
		for (const l of out.flush()) log("stdout", l);
		for (const l of err.flush()) log("stderr", l);
		if (child.pid !== void 0) {
			children.delete(child.pid);
			consoleLog.processEnded(child.pid);
		}
		log("info", `exited ${signal ? `by ${signal}` : `with code ${code}`}: ${cmd}`, !signal && code !== 0 && code !== null);
	});
	return child;
}
function execHiddenSync(cmd, args, opts = {}) {
	const rest = {
		cwd: opts.cwd,
		encoding: "utf8"
	};
	const r = spawnSync(cmd, args, {
		...rest,
		windowsHide: true
	});
	return {
		code: r.status,
		stdout: r.stdout ?? "",
		stderr: r.error ? r.error.message : r.stderr ?? ""
	};
}
//#endregion
//#region shared/tickets.ts
var TICKET_STATUSES = [
	"Draft",
	"Ready",
	"In Progress",
	"Blocked",
	"Review",
	"Done",
	"Failed"
];
var TICKET_MODES = ["Solo", "Team"];
var TICKET_VERIFICATIONS = [
	"Pending",
	"Passed",
	"Failed"
];
var TICKET_INTEGRATIONS = [
	"Pending",
	"Merged",
	"Failed",
	"Not needed"
];
var TICKET_TRANSITIONS = {
	Draft: ["Ready"],
	Ready: ["In Progress", "Blocked"],
	"In Progress": [
		"Review",
		"Blocked",
		"Failed"
	],
	Review: [
		"Done",
		"In Progress",
		"Failed"
	],
	Blocked: ["Ready", "In Progress"],
	Failed: ["Ready", "Draft"],
	Done: []
};
function canTransition(from, to) {
	return TICKET_TRANSITIONS[from].includes(to);
}
//#endregion
//#region core/tickets.ts
var ID_RE$1 = /^T-\d{3,}$/;
var COLUMNS = [
	"ID",
	"Title",
	"Status",
	"Mode",
	"Depends on",
	"Worker",
	"Branch",
	"Worktree",
	"Verification",
	"Integration"
];
function ticketsDir(folder) {
	return join(folder, ".foreman", "tickets");
}
function assertId$1(id) {
	if (typeof id !== "string" || !ID_RE$1.test(id)) throw new Error(`Invalid ticket id: ${String(id)}`);
}
function ticketPath(folder, id) {
	assertId$1(id);
	return join(ticketsDir(folder), id);
}
function writeAtomic(path, text) {
	const tmp = `${path}.tmp-${process.pid}`;
	try {
		writeFileSync(tmp, text, "utf8");
		renameSync(tmp, path);
	} catch (e) {
		rmSync(tmp, { force: true });
		throw e;
	}
}
function logEvent(folder, id, text) {
	const dir = ticketPath(folder, id);
	mkdirSync(dir, { recursive: true });
	appendFileSync(join(dir, "log.md"), `${(/* @__PURE__ */ new Date()).toISOString()} ${text.replace(/\s+/g, " ")}
`, "utf8");
}
function splitCells(line) {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	const cells = [];
	let cur = "";
	for (let i = 0; i < s.length; i++) if (s[i] === "\\" && s[i + 1] === "|") {
		cur += "|";
		i++;
	} else if (s[i] === "|") {
		cells.push(cur.trim());
		cur = "";
	} else cur += s[i];
	cells.push(cur.trim());
	return cells;
}
function cell(text) {
	return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}
function parseDeps(text) {
	const out = [];
	for (const part of text.split(";")) {
		const p = part.trim();
		if (!p) continue;
		const colon = p.indexOf(":");
		if (colon === -1) {
			for (const id of p.split(",")) if (id.trim()) out.push({
				id: id.trim(),
				reason: ""
			});
		} else out.push({
			id: p.slice(0, colon).trim(),
			reason: p.slice(colon + 1).trim()
		});
	}
	return out;
}
function formatDeps(deps) {
	return deps.map((d) => d.reason ? `${d.id}: ${d.reason.replace(/;/g, ",")}` : d.id).join("; ");
}
function oneOf(list, value, fallback) {
	if (value === void 0) return fallback;
	return list.find((v) => v.toLowerCase() === value.toLowerCase()) ?? null;
}
function parseBoard(text) {
	const rows = [];
	const skipped = [];
	const seen = /* @__PURE__ */ new Set();
	let index = null;
	for (const raw of String(text ?? "").split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (!line.startsWith("|")) {
			skipped.push(raw);
			continue;
		}
		const cells = splitCells(line);
		if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
		if (!index) {
			const names = cells.map((c) => c.toLowerCase());
			if ([
				"id",
				"title",
				"status"
			].every((n) => names.includes(n))) {
				index = {};
				cells.forEach((c, i) => {
					index[c.toLowerCase()] = i;
				});
			} else skipped.push(raw);
			continue;
		}
		const get = (name) => {
			const i = index[name.toLowerCase()];
			return i === void 0 ? void 0 : cells[i] ?? "";
		};
		const id = get("ID") ?? "";
		const status = oneOf(TICKET_STATUSES, get("Status"), "Draft");
		const mode = oneOf(TICKET_MODES, get("Mode"), "Solo");
		const verification = oneOf(TICKET_VERIFICATIONS, get("Verification"), "Pending");
		const integration = oneOf(TICKET_INTEGRATIONS, get("Integration"), "Pending");
		if (!ID_RE$1.test(id) || seen.has(id) || !status || !mode || !verification || !integration) {
			skipped.push(raw);
			continue;
		}
		seen.add(id);
		rows.push({
			id,
			title: get("Title") ?? "",
			status,
			mode,
			dependsOn: parseDeps(get("Depends on") ?? ""),
			worker: get("Worker") ?? "",
			branch: get("Branch") ?? "",
			worktree: get("Worktree") ?? "",
			verification,
			integration
		});
	}
	return {
		rows,
		skipped
	};
}
function serialiseBoard(rows) {
	return `${[
		`| ${COLUMNS.join(" | ")} |`,
		`| ${COLUMNS.map(() => "---").join(" | ")} |`,
		...rows.map((r) => `| ${[
			r.id,
			cell(r.title),
			r.status,
			r.mode,
			cell(formatDeps(r.dependsOn)),
			cell(r.worker),
			cell(r.branch),
			cell(r.worktree),
			r.verification,
			r.integration
		].join(" | ")} |`)
	].join("\n")}\n`;
}
function detectCycle(rows) {
	const deps = new Map(rows.map((r) => [r.id, r.dependsOn.map((d) => d.id)]));
	const state = /* @__PURE__ */ new Map();
	const path = [];
	const visit = (id) => {
		if (state.get(id) === 2) return null;
		if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
		state.set(id, 1);
		path.push(id);
		for (const next of deps.get(id) ?? []) {
			if (!deps.has(next)) continue;
			const found = visit(next);
			if (found) return found;
		}
		path.pop();
		state.set(id, 2);
		return null;
	};
	for (const id of deps.keys()) {
		const found = visit(id);
		if (found) return found;
	}
	return null;
}
function validateDependencies(rows, id) {
	const row = rows.find((r) => r.id === id);
	if (!row) throw new Error(`Unknown ticket: ${id}`);
	for (const dep of row.dependsOn) {
		if (dep.id === id) throw new Error(`${id} cannot depend on itself`);
		if (!rows.some((r) => r.id === dep.id)) throw new Error(`${id} depends on unknown ticket ${dep.id}`);
	}
	const cycle = detectCycle(rows);
	if (cycle) throw new Error(`Dependency cycle: ${cycle.join(" -> ")}`);
}
function readBoard(folder) {
	const file = join(ticketsDir(folder), "board.md");
	if (!existsSync(file)) return {
		rows: [],
		skipped: []
	};
	return parseBoard(readFileSync(file, "utf8"));
}
function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
var LOCK_WAIT_MS = 2e3;
var LOCK_STALE_MS = 3e4;
function removeStale(lock) {
	const moved = `${lock}.stale-${process.pid}-${Math.random().toString(36).slice(2)}`;
	try {
		renameSync(lock, moved);
	} catch (e) {
		if (e.code === "ENOENT") return;
		throw e;
	}
	rmSync(moved, { force: true });
}
function withLock(folder, fn) {
	mkdirSync(ticketsDir(folder), { recursive: true });
	const lock = join(ticketsDir(folder), ".lock");
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (;;) try {
		closeSync(openSync(lock, "wx"));
		break;
	} catch (e) {
		if (e.code !== "EEXIST") throw e;
		try {
			if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) removeStale(lock);
			else if (Date.now() >= deadline) throw new Error("board.md is locked by another process; try again");
			else sleep(25);
		} catch (inner) {
			if (inner.code !== "ENOENT") throw inner;
		}
	}
	try {
		return fn();
	} finally {
		rmSync(lock, { force: true });
	}
}
function writeBoard(folder, rows) {
	mkdirSync(ticketsDir(folder), { recursive: true });
	writeAtomic(join(ticketsDir(folder), "board.md"), serialiseBoard(rows));
}
function loadForWrite(folder) {
	const { rows, skipped } = readBoard(folder);
	if (skipped.length) throw new Error(`${join(ticketsDir(folder), "board.md")} has ${skipped.length} line(s) that cannot be read (first: ${skipped[0]?.trim()}). Fix or delete the unreadable lines, then retry.`);
	return rows;
}
function nextId(folder, rows) {
	let max = 0;
	const note = (id) => {
		if (ID_RE$1.test(id)) max = Math.max(max, Number(id.slice(2)));
	};
	rows.forEach((r) => note(r.id));
	if (existsSync(ticketsDir(folder))) readdirSync(ticketsDir(folder)).forEach(note);
	return `T-${String(max + 1).padStart(3, "0")}`;
}
function createTicket(folder, input) {
	if (!input.title?.trim()) throw new Error("A ticket needs a title");
	if (!input.eval?.trim()) throw new Error("A ticket needs acceptance criteria (eval.md cannot be empty)");
	const mode = input.mode ?? "Solo";
	if (!TICKET_MODES.includes(mode)) throw new Error(`Invalid mode: ${String(mode)}`);
	return withLock(folder, () => {
		const rows = loadForWrite(folder);
		const id = nextId(folder, rows);
		const row = {
			id,
			title: input.title.trim(),
			status: "Draft",
			mode,
			dependsOn: (input.dependsOn ?? []).map((d) => ({
				id: d.id,
				reason: d.reason ?? ""
			})),
			worker: "",
			branch: "",
			worktree: "",
			verification: "Pending",
			integration: "Pending"
		};
		const next = [...rows, row];
		validateDependencies(next, id);
		const dir = ticketPath(folder, id);
		mkdirSync(dir, { recursive: true });
		try {
			writeAtomic(join(dir, "rd.md"), input.rd ?? "");
			writeAtomic(join(dir, "eval.md"), input.eval);
			writeAtomic(join(dir, "notes.md"), "");
			logEvent(folder, id, "created");
			writeBoard(folder, next);
		} catch (e) {
			rmSync(dir, {
				recursive: true,
				force: true
			});
			throw e;
		}
		return row;
	});
}
function find(rows, id) {
	assertId$1(id);
	const row = rows.find((r) => r.id === id);
	if (!row) throw new Error(`Unknown ticket: ${id}`);
	return row;
}
function setStatus(folder, id, status) {
	if (!TICKET_STATUSES.includes(status)) throw new Error(`Invalid status: ${String(status)}`);
	return withLock(folder, () => {
		const rows = loadForWrite(folder);
		const row = find(rows, id);
		if (!canTransition(row.status, status)) throw new Error(`${id}: ${row.status} cannot go to ${status}`);
		if (status === "Done" && !(row.verification === "Passed" && (row.integration === "Merged" || row.integration === "Not needed"))) throw new Error(`${id} cannot be Done until verification is Passed and integration is Merged or Not needed`);
		const updated = {
			...row,
			status
		};
		writeBoard(folder, rows.map((r) => r.id === id ? updated : r));
		logEvent(folder, id, `status ${row.status} -> ${status}`);
		return updated;
	});
}
function claimTicket(folder, id, workerId) {
	if (typeof workerId !== "string" || !workerId.trim()) throw new Error("A claim needs a worker id");
	const worker = workerId.trim();
	return withLock(folder, () => {
		const rows = loadForWrite(folder);
		const row = find(rows, id);
		if (row.status !== "Ready") throw new Error(row.status === "In Progress" ? `${id} is already claimed${row.worker ? ` by ${row.worker}` : ""}` : `${id} is ${row.status}, only a Ready ticket can be claimed`);
		const waiting = row.dependsOn.filter((d) => rows.find((r) => r.id === d.id)?.status !== "Done").map((d) => d.id);
		if (waiting.length) throw new Error(`${id} is waiting on ${waiting.join(", ")}`);
		const updated = {
			...row,
			status: "In Progress",
			worker
		};
		writeBoard(folder, rows.map((r) => r.id === id ? updated : r));
		logEvent(folder, id, `claimed by ${worker}`);
		return updated;
	});
}
function releaseTicket(folder, id, workerId) {
	const worker = typeof workerId === "string" ? workerId.trim() : "";
	return withLock(folder, () => {
		const rows = loadForWrite(folder);
		const row = find(rows, id);
		if (row.status !== "In Progress") throw new Error(`${id} is ${row.status}, only an In Progress ticket can be released`);
		if (row.worker !== worker) throw new Error(`${id} is held by ${row.worker || "no worker"}, not ${worker}`);
		const updated = {
			...row,
			status: "Ready",
			worker: ""
		};
		writeBoard(folder, rows.map((r) => r.id === id ? updated : r));
		logEvent(folder, id, `released by ${worker}`);
		return updated;
	});
}
var CRITERION_RE = /^([ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\][ \t]+)(\S.*)$/;
var BOX_TOKEN_RE = /\[[ \t   -   　xX]\]/;
var BALLOT_RE = /^[\s ]*(?:(?:[-*+]|\d+[.)])[\s ]*)?[☐☑☒]/;
var BOM = String.fromCharCode(65279);
var FIX = "write criteria as \"- [ ] text\" lines; remove other [ ] tokens from eval.md";
function scanCriteria(text) {
	const found = [];
	const problems = [];
	(text.startsWith(BOM) ? text.slice(1) : text).split(String.fromCharCode(10)).forEach((raw, line) => {
		const row = raw.endsWith(String.fromCharCode(13)) ? raw.slice(0, -1) : raw;
		const match = CRITERION_RE.exec(row);
		const rest = match ? match[4] ?? "" : row;
		if (match) found.push({
			line,
			match
		});
		if (BOX_TOKEN_RE.test(rest) || !match && BALLOT_RE.test(row)) problems.push(`eval.md line ${line + 1}: unexpected checkbox in "${row.trim().slice(0, 40)}"; ${FIX}`);
	});
	return {
		found,
		problems
	};
}
function readCriteria(folder, id) {
	let text = "";
	try {
		text = readFileSync(join(ticketPath(folder, id), "eval.md"), "utf8");
	} catch {}
	const { found, problems } = scanCriteria(text);
	const items = found.map(({ match: m }, i) => ({
		index: i + 1,
		text: (m[4] ?? "").trim(),
		met: m[2] !== " "
	}));
	return {
		total: items.length,
		met: items.filter((i) => i.met).length,
		items,
		problems
	};
}
function markCriterion(folder, id, index, met, evidence, actor = "") {
	if (typeof evidence !== "string" || !evidence.trim()) throw new Error("A criterion needs evidence");
	return withLock(folder, () => {
		find(readBoard(folder).rows, id);
		const file = join(ticketPath(folder, id), "eval.md");
		const text = existsSync(file) ? readFileSync(file, "utf8") : "";
		const { total, problems } = readCriteria(folder, id);
		if (met && problems.length) throw new Error(problems[0]);
		if (!Number.isInteger(index) || index < 1 || index > total) throw new Error(`${id}: criterion ${String(index)} is out of range (eval.md has ${total})`);
		const bom = text.startsWith(BOM);
		const body = bom ? text.slice(1) : text;
		const lines = body.split(String.fromCharCode(10));
		const hit = scanCriteria(body).found[index - 1];
		const m = hit.match;
		const raw = lines[hit.line];
		const at = (m[1] ?? "").length;
		lines[hit.line] = `${raw.slice(0, at)}${met ? "x" : " "}${raw.slice(at + 1)}`;
		const item = {
			index,
			text: (m[4] ?? "").trim(),
			met
		};
		writeAtomic(file, (bom ? BOM : "") + lines.join(String.fromCharCode(10)));
		logEvent(folder, id, `criterion ${index} ${met ? "met" : "unmet"}${actor ? ` by ${actor}` : ""}: ${evidence.trim()}`);
		return item;
	});
}
function setVerification(folder, id, verification) {
	if (!TICKET_VERIFICATIONS.includes(verification)) throw new Error(`Invalid verification: ${String(verification)}`);
	return withLock(folder, () => {
		const rows = loadForWrite(folder);
		const row = find(rows, id);
		if (verification === "Passed") {
			const c = readCriteria(folder, id);
			if (c.problems.length) throw new Error(c.problems[0]);
			if (!c.total) throw new Error(`eval.md of ${id} has no "- [ ] criterion" lines`);
			if (c.met < c.total) throw new Error(`${c.total - c.met} of ${c.total} criteria not met (${c.items.filter((i) => !i.met).map((i) => i.index).join(", ")})`);
		}
		const updated = {
			...row,
			verification
		};
		writeBoard(folder, rows.map((r) => r.id === id ? updated : r));
		if (verification !== row.verification) logEvent(folder, id, `verification ${row.verification} -> ${verification}`);
		return updated;
	});
}
function handoffTicket(folder, id, from, to) {
	const a = typeof from === "string" ? from.trim() : "";
	const b = typeof to === "string" ? to.trim() : "";
	if (!a || !b) throw new Error("A handoff needs a from and a to worker");
	return withLock(folder, () => {
		const rows = loadForWrite(folder);
		const row = find(rows, id);
		if (row.status !== "In Progress") throw new Error(`${id} is ${row.status}, only an In Progress ticket can be handed off`);
		if (row.worker !== a) throw new Error(`${id} is held by ${row.worker || "no worker"}, not ${a}`);
		const updated = {
			...row,
			worker: b
		};
		writeBoard(folder, rows.map((r) => r.id === id ? updated : r));
		logEvent(folder, id, `handed off from ${a} to ${b}`);
		return updated;
	});
}
function updateTicket(folder, id, patch) {
	return withLock(folder, () => {
		const rows = loadForWrite(folder);
		const row = find(rows, id);
		if (patch.mode !== void 0 && !TICKET_MODES.includes(patch.mode)) throw new Error(`Invalid mode: ${String(patch.mode)}`);
		if (patch.verification !== void 0 && !TICKET_VERIFICATIONS.includes(patch.verification)) throw new Error(`Invalid verification: ${String(patch.verification)}`);
		if (patch.integration !== void 0 && !TICKET_INTEGRATIONS.includes(patch.integration)) throw new Error(`Invalid integration: ${String(patch.integration)}`);
		if (patch.title !== void 0 && !patch.title.trim()) throw new Error("A ticket needs a title");
		const updated = {
			...row,
			...patch.title !== void 0 && { title: patch.title.trim() },
			...patch.mode !== void 0 && { mode: patch.mode },
			...patch.dependsOn !== void 0 && { dependsOn: patch.dependsOn.map((d) => ({
				id: d.id,
				reason: d.reason ?? ""
			})) },
			...patch.worker !== void 0 && { worker: patch.worker },
			...patch.branch !== void 0 && { branch: patch.branch },
			...patch.worktree !== void 0 && { worktree: patch.worktree },
			...patch.verification !== void 0 && { verification: patch.verification },
			...patch.integration !== void 0 && { integration: patch.integration }
		};
		const next = rows.map((r) => r.id === id ? updated : r);
		validateDependencies(next, id);
		writeBoard(folder, next);
		if (updated.verification !== row.verification) logEvent(folder, id, `verification ${row.verification} -> ${updated.verification}`);
		return updated;
	});
}
function withFiles(folder, row) {
	const dir = join(ticketsDir(folder), row.id);
	return {
		...row,
		hasRd: existsSync(join(dir, "rd.md")),
		hasEval: existsSync(join(dir, "eval.md"))
	};
}
function listTickets(folder) {
	const { rows, skipped } = readBoard(folder);
	return {
		tickets: rows.map((r) => withFiles(folder, r)),
		skipped
	};
}
function readTouches(folder, id) {
	const file = join(ticketPath(folder, id), "rd.md");
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return [];
	}
	const line = text.split(/\r?\n/).find((l) => /^\s*touches\s*:/i.test(l));
	if (!line) return [];
	return line.slice(line.indexOf(":") + 1).split(",").map((p) => p.trim()).filter(Boolean);
}
function getTicket(folder, id) {
	const row = find(readBoard(folder).rows, id);
	const dir = ticketPath(folder, id);
	const read = (name) => existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "";
	return {
		ticket: withFiles(folder, row),
		rd: read("rd.md"),
		eval: read("eval.md")
	};
}
//#endregion
//#region core/scheduler.ts
var byId = (rows) => new Map(rows.map((r) => [r.id, r]));
function dependencyDepth(rows) {
	const map = byId(rows);
	const depth = /* @__PURE__ */ new Map();
	const visit = (id, path) => {
		const known = depth.get(id);
		if (known !== void 0) return known;
		if (path.has(id)) return 0;
		path.add(id);
		let d = 0;
		for (const dep of map.get(id)?.dependsOn ?? []) if (map.has(dep.id)) d = Math.max(d, visit(dep.id, path) + 1);
		path.delete(id);
		depth.set(id, d);
		return d;
	};
	for (const r of rows) visit(r.id, /* @__PURE__ */ new Set());
	return depth;
}
function topologicalOrder(rows) {
	const depth = dependencyDepth(rows);
	return rows.map((r) => r.id).sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || a.localeCompare(b));
}
function downstreamOf(rows, id) {
	const out = /* @__PURE__ */ new Set();
	const queue = [id];
	while (queue.length) {
		const cur = queue.shift();
		for (const r of rows) {
			if (out.has(r.id) || r.id === id || !r.dependsOn.some((d) => d.id === cur)) continue;
			out.add(r.id);
			queue.push(r.id);
		}
	}
	return [...out].sort();
}
function upstreamOf(map, id) {
	const out = /* @__PURE__ */ new Set();
	const queue = [id];
	while (queue.length) for (const dep of map.get(queue.shift())?.dependsOn ?? []) {
		if (out.has(dep.id) || dep.id === id) continue;
		out.add(dep.id);
		queue.push(dep.id);
	}
	return out;
}
var clean = (p) => p.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/(^|\/)(\.(\/|$))+/g, "$1").replace(/\/+$/, "").toLowerCase();
function overlap(a = [], b = []) {
	for (const x of a.map(clean).filter(Boolean)) for (const y of b.map(clean).filter(Boolean)) {
		if (x === y || y.startsWith(`${x}/`)) return y;
		if (x.startsWith(`${y}/`)) return x;
	}
	return null;
}
function planNext(tickets, opts) {
	const map = byId(tickets);
	const order = topologicalOrder(tickets);
	const max = Number.isFinite(opts.maxWorkers) ? Math.min(8, Math.max(1, Math.floor(opts.maxWorkers))) : 3;
	const touches = opts.touches ?? {};
	const failed = tickets.filter((t) => t.status === "Failed").map((t) => t.id);
	const brokenBy = /* @__PURE__ */ new Map();
	for (const f of failed) for (const id of downstreamOf(tickets, f)) if (!brokenBy.has(id)) brokenBy.set(id, f);
	const running = tickets.filter((t) => t.status === "In Progress").map((t) => t.id);
	const start = [];
	const waiting = [];
	const related = (a, b) => upstreamOf(map, a).has(b) || upstreamOf(map, b).has(a);
	const eligible = (t) => t.status === "Ready" && !brokenBy.has(t.id) && t.dependsOn.every((d) => map.get(d.id)?.status === "Done");
	for (const id of order) {
		const t = map.get(id);
		const failedUp = brokenBy.get(id);
		if (failedUp && (t.status === "Ready" || t.status === "Draft")) {
			waiting.push({
				id,
				reason: `blocked by failed ${failedUp}`
			});
			continue;
		}
		if (t.status !== "Ready") continue;
		const pending = t.dependsOn.filter((d) => map.get(d.id)?.status !== "Done");
		if (pending.length) {
			waiting.push({
				id,
				reason: `waiting on ${pending.map((d) => `${d.id} (${map.get(d.id)?.status ?? "missing"})`).join(", ")}`
			});
			continue;
		}
		const rivals = [
			...running,
			...start,
			...tickets.filter((o) => o.id < id && eligible(o)).map((o) => o.id)
		];
		let clash = null;
		for (const other of rivals) {
			if (other === id || related(id, other)) continue;
			const path = overlap(touches[id], touches[other]);
			if (path) {
				clash = {
					id,
					reason: `overlaps ${other} on ${path}`
				};
				break;
			}
		}
		if (clash) {
			waiting.push(clash);
			continue;
		}
		if (running.length + start.length >= max) {
			waiting.push({
				id,
				reason: `cap ${max} of ${max} in use`
			});
			continue;
		}
		start.push(id);
	}
	return {
		start,
		waiting
	};
}
//#endregion
//#region core/test-lock.ts
var WAIT_MS = 6e5;
var STALE_MS = 18e5;
var POLL_MS = 200;
function testLockPath(folder) {
	return join(ticketsDir(folder), ".testlock");
}
var pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function acquireTestLock(folder, opts = {}) {
	mkdirSync(ticketsDir(folder), { recursive: true });
	const lock = testLockPath(folder);
	const deadline = Date.now() + (opts.waitMs ?? WAIT_MS);
	const staleMs = opts.staleMs ?? STALE_MS;
	const token = randomUUID();
	for (;;) {
		try {
			const fd = openSync(lock, "wx");
			try {
				writeSync(fd, token);
			} finally {
				closeSync(fd);
			}
			return token;
		} catch (e) {
			if (e.code !== "EEXIST") throw e;
		}
		try {
			if (Date.now() - statSync(lock).mtimeMs > staleMs) removeStale(lock);
		} catch {}
		if (Date.now() >= deadline) throw new Error("Another build or test run holds the test lock; try again later");
		await pause(opts.pollMs ?? POLL_MS);
	}
}
function releaseTestLock(folder, token) {
	const lock = testLockPath(folder);
	try {
		if (readFileSync(lock, "utf8") !== token) return;
	} catch {
		return;
	}
	rmSync(lock, { force: true });
}
async function withTestLock(folder, fn, opts) {
	const token = await acquireTestLock(folder, opts);
	try {
		return await fn();
	} finally {
		releaseTestLock(folder, token);
	}
}
//#endregion
//#region core/worktrees.ts
var ID_RE = /^T-\d{3,}$/;
function assertId(id) {
	if (typeof id !== "string" || !ID_RE.test(id)) throw new Error(`Invalid ticket id: ${String(id)}`);
}
function ticketBranch(id) {
	assertId(id);
	return `foreman/${id}`;
}
function ticketWorktree(root, id) {
	assertId(id);
	return resolve(root, id);
}
function git(cwd, args) {
	const r = execHiddenSync("git", args, { cwd });
	if (r.code !== 0) throw new Error(r.stderr.trim().split("\n")[0] || `git ${args[0]} failed`);
	return r.stdout.trim();
}
function tryGit(cwd, args) {
	try {
		return git(cwd, args);
	} catch {
		return null;
	}
}
var norm = (p) => {
	try {
		return realpathSync(p).toLowerCase();
	} catch {
		return resolve(p).toLowerCase();
	}
};
var same = (a, b) => norm(a) === norm(b);
function isGitRepo(folder) {
	if (!existsSync(folder)) return false;
	const top = tryGit(folder, ["rev-parse", "--show-toplevel"]);
	return top !== null && top !== "" && same(top, folder);
}
function defaultWorktreeRoot(project) {
	const p = resolve(project);
	return join(dirname(p), ".foreman-worktrees", basename(p));
}
var branchExists = (repo, branch) => tryGit(repo, [
	"rev-parse",
	"--verify",
	"--quiet",
	`refs/heads/${branch}`
]) !== null;
function isDirty(tree, untracked) {
	return git(tree, [
		"status",
		"--porcelain",
		...untracked ? [] : ["--untracked-files=no"],
		"--",
		".",
		":(exclude).foreman"
	]) !== "";
}
function isRegisteredWorktree(repo, path, branch) {
	let current = null;
	for (const line of git(repo, [
		"worktree",
		"list",
		"--porcelain"
	]).split("\n")) if (line.startsWith("worktree ")) current = line.slice(9).trim();
	else if (line.startsWith("branch ") && current !== null && line.slice(7).trim() === `refs/heads/${branch}` && same(current, path)) return true;
	return false;
}
function createWorktree(repo, ticketId, root) {
	const branch = ticketBranch(ticketId);
	if (!isGitRepo(repo)) return { isolation: "none" };
	if (branchExists(repo, branch)) throw new Error(`branch ${branch} already exists`);
	const path = ticketWorktree(root, ticketId);
	if (existsSync(path)) throw new Error(`${path} already exists`);
	tryGit(repo, ["worktree", "prune"]);
	mkdirSync(dirname(path), { recursive: true });
	try {
		git(repo, [
			"worktree",
			"add",
			"-b",
			branch,
			path
		]);
	} catch (e) {
		throw new Error(`git worktree add failed: ${e instanceof Error ? e.message : String(e)}`);
	}
	return {
		isolation: "worktree",
		branch,
		worktree: path
	};
}
function removeWorktree(repo, ticketId, root, force = false) {
	const branch = ticketBranch(ticketId);
	const worktree = ticketWorktree(root, ticketId);
	let removed = false;
	if (existsSync(worktree)) {
		if (!isRegisteredWorktree(repo, worktree, branch)) throw new Error(`${worktree} is not the worktree of ${branch}`);
		if (!force && isDirty(worktree, true)) throw new Error(`${worktree} has uncommitted changes`);
		try {
			git(repo, [
				"worktree",
				"remove",
				...force ? ["--force"] : [],
				worktree
			]);
			removed = true;
		} catch (e) {
			throw new Error(`git worktree remove failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	let branchDeleted = false;
	let branchError;
	if (branchExists(repo, branch)) try {
		git(repo, [
			"branch",
			"-d",
			branch
		]);
		branchDeleted = true;
	} catch (e) {
		branchError = e instanceof Error ? e.message : String(e);
	}
	return {
		removed,
		branchDeleted,
		forced: force && removed,
		...branchError ? { branchError } : {}
	};
}
var describeRemoval = (r) => `worktree removed=${r.removed} forced=${r.forced}; branch -d ${r.branchDeleted ? "ok" : `not done${r.branchError ? `: ${r.branchError}` : ""}`}`;
var branchName = (ref) => ref.replace(/^heads\//, "");
function defaultBranch(repo) {
	const ref = tryGit(repo, [
		"symbolic-ref",
		"--short",
		"refs/remotes/origin/HEAD"
	]);
	return ref ? branchName(ref.replace(/^origin\//, "")) : null;
}
async function mergeTicket(repo, ticket, opts) {
	const id = ticket.id;
	const branch = ticketBranch(id);
	const worktree = ticketWorktree(opts.worktreeRoot, id);
	if (!isGitRepo(repo)) throw new Error(`merge ${id}: ${repo} is not a git repository`);
	if (ticket.status !== "Review") throw new Error(`merge ${id}: status is ${ticket.status}, not Review`);
	if (ticket.verification !== "Passed") throw new Error(`merge ${id}: verification is ${ticket.verification}, not Passed`);
	if (!branchExists(repo, branch)) throw new Error(`merge ${id}: branch ${branch} does not exist`);
	if (existsSync(worktree) && isDirty(worktree, true)) throw new Error(`merge ${id}: worktree ${worktree} has uncommitted changes`);
	if (isDirty(repo, false)) throw new Error(`merge ${id}: the main working tree has uncommitted changes`);
	const head = tryGit(repo, [
		"symbolic-ref",
		"--short",
		"HEAD"
	]);
	if (!head) throw new Error(`merge ${id}: the main working tree is on a detached HEAD`);
	const target = branchName(head);
	if ([
		"main",
		"master",
		defaultBranch(repo),
		...opts.protect ?? []
	].filter((n) => !!n).map((n) => n.trim().toLowerCase()).includes(target.toLowerCase())) throw new Error(`merge ${id}: ${target} is protected; check out a dev branch (you merge to ${target} yourself)`);
	if (git(repo, [
		"rev-list",
		"--count",
		`${target}..${branch}`
	]) === "0") throw new Error(`merge ${id}: branch commits are already in ${target} (reverted?); revert the revert or make a new commit on ${branch}`);
	const preSha = git(repo, ["rev-parse", "HEAD"]);
	opts.log(`merge ${branch} into ${target}, pre-merge ${preSha}`);
	try {
		git(repo, [
			"merge",
			"--no-ff",
			branch,
			"-m",
			`Merge ${id}: ${ticket.title}`
		]);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		const conflict = tryGit(repo, [
			"diff",
			"--name-only",
			"--diff-filter=U"
		])?.split("\n").filter(Boolean) ?? [];
		if (tryGit(repo, [
			"rev-parse",
			"--verify",
			"--quiet",
			"MERGE_HEAD"
		]) !== null) try {
			git(repo, ["merge", "--abort"]);
		} catch (abortError) {
			const why = abortError instanceof Error ? abortError.message : String(abortError);
			opts.log(`merge ${branch} into ${target} hit a conflict and git merge --abort failed: ${why}; the repo may be mid-merge`);
			updateTicket(repo, id, { integration: "Failed" });
			throw new Error(`merge ${id}: conflict, but git merge --abort failed (${why}); ${repo} may be mid-merge, run git status`);
		}
		if (!conflict.length) throw new Error(`merge ${id}: git merge failed: ${message}`);
		updateTicket(repo, id, { integration: "Failed" });
		opts.log(`merge conflict, aborted, back at ${preSha}: ${conflict.join(", ")}`);
		return {
			outcome: "conflict",
			target,
			preSha,
			conflict
		};
	}
	const mergeSha = git(repo, ["rev-parse", "HEAD"]);
	let failure = null;
	try {
		if (opts.runCheck && await opts.runCheck() !== 0) failure = "the check failed";
		else updateTicket(repo, id, { integration: "Merged" });
	} catch (e) {
		failure = `the check could not run: ${e instanceof Error ? e.message : String(e)}`;
	}
	if (failure !== null) {
		try {
			git(repo, [
				"revert",
				"-m",
				"1",
				"--no-edit",
				mergeSha
			]);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			tryGit(repo, ["revert", "--abort"]);
			updateTicket(repo, id, { integration: "Failed" });
			opts.log(`${failure}; merge ${mergeSha} NOT reverted, the revert failed: ${message}`);
			throw new Error(`merge ${id}: ${failure} and the revert failed (${message}); ${target} is at merge ${mergeSha}`);
		}
		const revertSha = git(repo, ["rev-parse", "HEAD"]);
		let warning;
		try {
			updateTicket(repo, id, { integration: "Failed" });
		} catch (e) {
			warning = `merge was reverted but integration could not be set to Failed: ${e instanceof Error ? e.message : String(e)}`;
		}
		opts.log(`${failure}; merge ${mergeSha} reverted by ${revertSha}${warning ? `; ${warning}` : ""}`);
		return {
			outcome: "check-failed",
			target,
			preSha,
			mergeSha,
			revertSha,
			reason: failure,
			...warning ? { warning } : {}
		};
	}
	opts.log(`merged ${branch} into ${target} as ${mergeSha}`);
	let cleanup = {
		removed: false,
		branchDeleted: false,
		forced: false
	};
	try {
		cleanup = removeWorktree(repo, id, opts.worktreeRoot);
		opts.log(describeRemoval(cleanup));
		if (cleanup.removed) updateTicket(repo, id, { worktree: "" });
	} catch (e) {
		opts.log(`merged, but cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
	}
	return {
		outcome: "merged",
		target,
		preSha,
		mergeSha,
		worktreeRemoved: cleanup.removed,
		branchDeleted: cleanup.branchDeleted
	};
}
//#endregion
//#region scripts/tickets-cli.ts
var USAGE = "usage: tickets.mjs [--project <folder>] list | show <id> | next [--max N] | create (JSON on stdin) | status <id> <Status> | claim <id> <worker> | release <id> <worker> | set <id> verification|integration|branch|worktree <value> [--evidence \"<text>\"] | criteria <id> | criterion <id> <n> met|unmet --evidence \"<text>\" --as reviewer|council | handoff <id> <from> <to> --as router | log <id> <text> | test-lock -- <command...> | worktree create|remove <id> [--worktree-root <dir>] | merge <id> --as merger [--protect a,b] [--check \"<command...>\" | --check <program> --check-arg <arg>... | --check -- <command...>]";
var print = (value) => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};
function takeFlag(args, name) {
	const i = args.indexOf(name);
	if (i === -1) return void 0;
	const value = args[i + 1];
	if (value === void 0) throw new Error(`${name} needs a value`);
	args.splice(i, 2);
	return value;
}
var ACTORS = [
	"router",
	"reviewer",
	"merger",
	"council"
];
function appendLog(project, id, text) {
	getTicket(project, id);
	const line = text.replace(/\s+/g, " ");
	appendFileSync(join(ticketsDir(project), id, "log.md"), `${(/* @__PURE__ */ new Date()).toISOString()} ${line}\n`, "utf8");
	return line;
}
function requireActor(project, id, actor, action, allowed = ACTORS) {
	if (!actor || !allowed.includes(actor)) throw new Error(`${action} needs --as ${allowed.join("|")}`);
	const worker = getTicket(project, id).ticket.worker;
	if (worker && worker === actor) throw new Error(`${action}: ${actor} is the worker of ${id} and cannot approve its own work`);
	return actor;
}
function commandIndex(argv) {
	for (let i = 0; i < argv.length; i++) if ([
		"--project",
		"--max",
		"--as",
		"--evidence",
		"--check",
		"--check-arg",
		"--worktree-root",
		"--protect"
	].includes(argv[i])) i++;
	else return i;
	return -1;
}
function assertRunnable(command) {
	if (process.platform === "win32" && command.some((a) => /["%]/.test(a))) throw new Error("On Windows a command cannot take an argument containing \" or %");
}
function runCommand(command, cwd, stdio) {
	assertRunnable(command);
	return new Promise((done, fail) => {
		const quote = (a) => /^[\w.:\/=@%+,-]+$/.test(a) ? a : `"${a.replace(/(\\+)$/, "$1$1")}"`;
		const child = process.platform === "win32" ? spawnHidden(command.map(quote).join(" "), [], {
			cwd,
			stdio,
			shell: true,
			quiet: true
		}) : spawnHidden(command[0], command.slice(1), {
			cwd,
			stdio,
			quiet: true
		});
		child.on("error", fail);
		child.on("close", (c) => done(c ?? 1));
	});
}
function need(args, count) {
	if (args.length < count) throw new Error(USAGE);
	return args;
}
async function main(argv) {
	const at = commandIndex(argv);
	const dash = at !== -1 && argv[at] === "test-lock" ? argv.indexOf("--", at) : at !== -1 && argv[at] === "merge" ? argv.findIndex((a, i) => i > at && a === "--check" && argv[i + 1] === "--") : -1;
	const tail = dash !== -1 && argv[at] === "merge";
	const command = dash === -1 ? [] : argv.slice(dash + (tail ? 2 : 1));
	const args = dash === -1 ? [...argv] : argv.slice(0, dash);
	const project = resolve(takeFlag(args, "--project") ?? process.cwd());
	const max = takeFlag(args, "--max");
	const actor = takeFlag(args, "--as");
	const evidence = takeFlag(args, "--evidence")?.trim();
	const check = takeFlag(args, "--check");
	const checkArgs = [];
	while (args.includes("--check-arg")) checkArgs.push(takeFlag(args, "--check-arg"));
	const protect = takeFlag(args, "--protect");
	const worktreeRoot = resolve(takeFlag(args, "--worktree-root") ?? defaultWorktreeRoot(project));
	switch (args.shift()) {
		case "list":
			print(listTickets(project));
			return 0;
		case "show":
			print(getTicket(project, need(args, 1)[0]));
			return 0;
		case "next": {
			const { tickets } = listTickets(project);
			const touches = Object.fromEntries(tickets.map((t) => [t.id, readTouches(project, t.id)]));
			print(planNext(tickets, {
				maxWorkers: max === void 0 ? 3 : Number(max),
				touches
			}));
			return 0;
		}
		case "create": {
			const input = JSON.parse(readFileSync(0, "utf8"));
			const rd = [input.rd ?? "", input.touches?.length ? `Touches: ${input.touches.join(", ")}` : ""].filter(Boolean).join("\n\n");
			const dependsOn = (input.dependsOn ?? []).map((d) => typeof d === "string" ? {
				id: d,
				reason: ""
			} : {
				id: d.id,
				reason: d.reason ?? ""
			});
			print(createTicket(project, {
				title: input.title,
				rd,
				eval: input.eval,
				dependsOn,
				mode: input.mode
			}));
			return 0;
		}
		case "status": {
			const [id, status] = need(args, 2);
			const guarded = status === "Done" || status === "Failed" ? requireActor(project, id, actor, `status ${status}`) : null;
			const row = setStatus(project, id, status);
			if (guarded) appendLog(project, id, `${status} approved by ${guarded}`);
			print(row);
			return 0;
		}
		case "claim": {
			const [id, worker] = need(args, 2);
			print(claimTicket(project, id, worker));
			return 0;
		}
		case "release": {
			const [id, worker] = need(args, 2);
			print(releaseTicket(project, id, worker));
			return 0;
		}
		case "set": {
			const [id, field, ...rest] = need(args, 3);
			const value = rest.join(" ");
			const guarded = field === "verification" && value !== "Pending" ? requireActor(project, id, actor, `set ${field} ${value}`, ["reviewer", "council"]) : field === "integration" && value !== "Pending" ? requireActor(project, id, actor, `set ${field} ${value}`, ["merger", "router"]) : null;
			if (guarded && field === "verification" && !evidence) throw new Error(`set verification ${value} needs --evidence "<text>"`);
			if (field === "verification") print(setVerification(project, id, value));
			else if (field === "integration") print(updateTicket(project, id, { integration: value }));
			else if (field === "branch" || field === "worktree") {
				const own = field === "branch" ? ticketBranch(id) : ticketWorktree(worktreeRoot, id);
				if (field === "branch" ? value !== own : resolve(value) !== own) throw new Error(`set ${field}: only ${own} is allowed for ${id}`);
				print(updateTicket(project, id, { [field]: own }));
			} else throw new Error(`Cannot set ${field}; use verification, integration, branch or worktree`);
			if (guarded) appendLog(project, id, `${field} ${value} approved by ${guarded}${field === "verification" && evidence ? `: ${evidence}` : ""}`);
			return 0;
		}
		case "criteria": {
			const [id] = need(args, 1);
			print(readCriteria(project, id));
			return 0;
		}
		case "criterion": {
			const [id, n, state] = need(args, 3);
			const by = requireActor(project, id, actor, "criterion", ["reviewer", "council"]);
			if (state !== "met" && state !== "unmet") throw new Error("criterion needs met or unmet");
			if (!evidence) throw new Error("criterion needs --evidence \"<text>\"");
			print(markCriterion(project, id, Number(n), state === "met", evidence, by));
			return 0;
		}
		case "handoff": {
			const [id, from, to] = need(args, 3);
			requireActor(project, id, actor, "handoff", ["router"]);
			print(handoffTicket(project, id, from, to));
			return 0;
		}
		case "log": {
			const [id, ...rest] = need(args, 2);
			print({
				id,
				logged: appendLog(project, id, rest.join(" "))
			});
			return 0;
		}
		case "test-lock": {
			if (!command.length) throw new Error("test-lock needs a command after \"--\"");
			const code = await withTestLock(project, () => runCommand(command, project, "inherit"));
			process.stderr.write(`${JSON.stringify({ exitCode: code })}\n`);
			return code;
		}
		case "worktree": {
			const [sub, id] = need(args, 2);
			const { ticket } = getTicket(project, id);
			if (sub === "create") {
				if (ticket.status !== "In Progress" || !ticket.worker) throw new Error(`worktree create: ${id} must be In Progress and claimed`);
				const made = createWorktree(project, id, worktreeRoot);
				if (made.isolation === "worktree") {
					updateTicket(project, id, {
						branch: made.branch,
						worktree: made.worktree
					});
					appendLog(project, id, `worktree ${made.worktree} on ${made.branch}`);
				}
				print(made);
				return 0;
			}
			if (sub === "remove") {
				if (!isGitRepo(project)) {
					print({
						removed: false,
						branchDeleted: false,
						forced: false
					});
					return 0;
				}
				const result = removeWorktree(project, id, worktreeRoot, ticket.status === "Failed");
				if (result.removed) updateTicket(project, id, { worktree: "" });
				appendLog(project, id, describeRemoval(result));
				print(result);
				return 0;
			}
			throw new Error(USAGE);
		}
		case "merge": {
			const [id] = need(args, 1);
			requireActor(project, id, actor, "merge", ["merger"]);
			const checkCommand = tail ? command : checkArgs.length ? [...check ? [check] : [], ...checkArgs] : check?.split(/\s+/).filter(Boolean) ?? [];
			if (checkArgs.length && !check) throw new Error("merge: --check-arg needs --check <program>; nothing was merged");
			if (check !== void 0 || tail) {
				if (!checkCommand.length) throw new Error("merge: --check was given but holds no command; nothing was merged");
			}
			assertRunnable(checkCommand);
			const result = await mergeTicket(project, getTicket(project, id).ticket, {
				worktreeRoot,
				protect: protect?.split(",").filter(Boolean),
				log: (text) => appendLog(project, id, text),
				runCheck: checkCommand.length ? () => withTestLock(project, () => runCommand(checkCommand, project, [
					"ignore",
					2,
					2
				])) : void 0
			});
			if (result.outcome === "conflict") {
				print({
					conflict: result.conflict,
					target: result.target,
					preSha: result.preSha
				});
				return 2;
			}
			print(result);
			return result.outcome === "check-failed" ? 3 : 0;
		}
		default: throw new Error(USAGE);
	}
}
main(process.argv.slice(2)).then((code) => {
	process.exitCode = code;
}, (e) => {
	process.stderr.write(`error: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}\n`);
	process.exitCode = 1;
});
//#endregion
