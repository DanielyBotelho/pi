import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PullRequestInfo } from "./footer-data-provider.ts";

export interface DiffStatEntry {
	file: string;
	added: number;
	removed: number;
}

function execFileText(cmd: string, args: string[], cwd: string): Promise<string | null> {
	return new Promise((resolvePromise) => {
		execFile(cmd, args, { cwd, encoding: "utf8", timeout: 10_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
			resolvePromise(error ? null : stdout);
		});
	});
}

/**
 * Per-file +/- counts between a PR's base branch and HEAD. Tries the remote-tracking ref first
 * (usual case: base branch isn't checked out locally), then the local branch name.
 */
export async function getDiffStat(repoDir: string, baseBranch: string): Promise<DiffStatEntry[]> {
	for (const range of [`origin/${baseBranch}...HEAD`, `${baseBranch}...HEAD`]) {
		const stdout = await execFileText("git", ["diff", "--numstat", range], repoDir);
		if (stdout === null) continue;
		const entries = stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [added, removed, ...fileParts] = line.split("\t");
				return {
					file: fileParts.join("\t"),
					added: added === "-" ? 0 : Number(added),
					removed: removed === "-" ? 0 : Number(removed),
				};
			});
		if (entries.length > 0) return entries;
	}
	return [];
}

const MAX_DIFF_LINES_PER_FILE = 400;

/**
 * Unified diff hunks per changed file (no `diff --git`/`index`/`---`/`+++` preamble — the file card
 * already names the file), truncated past MAX_DIFF_LINES_PER_FILE. Tries the remote-tracking ref
 * first, same as getDiffStat, and must use the same range so paths line up with it.
 */
export async function getFileDiffs(repoDir: string, baseBranch: string): Promise<Map<string, string>> {
	for (const range of [`origin/${baseBranch}...HEAD`, `${baseBranch}...HEAD`]) {
		const stdout = await execFileText("git", ["diff", "--no-color", range], repoDir);
		if (stdout === null) continue;
		const diffs = new Map<string, string>();
		for (const chunk of stdout.split(/^diff --git /m).slice(1)) {
			const header = /^a\/(?:.*?) b\/(.*?)\n/.exec(chunk);
			if (!header) continue;
			const path = header[1];
			if (!path) continue;
			const lines = chunk.slice(header[0].length).split("\n");
			const hunkStart = lines.findIndex((l) => l.startsWith("@@"));
			if (hunkStart === -1) continue;
			const hunkLines = lines.slice(hunkStart);
			const truncated = hunkLines.length > MAX_DIFF_LINES_PER_FILE;
			const shown = truncated ? hunkLines.slice(0, MAX_DIFF_LINES_PER_FILE) : hunkLines;
			const text = shown.join("\n").trimEnd();
			diffs.set(path, truncated ? `${text}\n… (${hunkLines.length - MAX_DIFF_LINES_PER_FILE} more lines)` : text);
		}
		if (diffs.size > 0) return diffs;
	}
	return new Map();
}

/** Text before a `## Changes` heading, if the PR body has one, trimmed. Empty string otherwise. */
export function parseOverview(body: string): string {
	const index = body.indexOf("## Changes");
	return (index === -1 ? body : body.slice(0, index)).trim();
}

/** Parses a `## Changes` section (one `- \`path\`: reason` bullet per file) out of a PR body. */
export function parseChangesSection(body: string): Map<string, string> {
	const changes = new Map<string, string>();
	const section = /## Changes\s*\n([\s\S]*?)(?:\n## |$)/.exec(body)?.[1];
	if (!section) return changes;
	for (const match of section.matchAll(/^[-*]\s*`?([^`:\n]+?)`?\s*:\s*(.+)$/gm)) {
		const [, file, reason] = match;
		if (file && reason) changes.set(file.trim(), reason.trim());
	}
	return changes;
}

function escapeHtml(text: string): string {
	const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
	return text.replace(/[&<>"']/g, (c) => escapes[c] ?? c);
}

export interface DashboardInput {
	pr: PullRequestInfo;
	jiraUrl: string | null;
	diffStat: DiffStatEntry[];
	fileDiffs: Map<string, string>;
}

/** Splits a path into its directory (trailing slash kept) and final segment. */
function splitPath(path: string): { dir: string; name: string } {
	const index = path.lastIndexOf("/");
	return index === -1 ? { dir: "", name: path } : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/** Keeps only the last few directory segments, so deep paths don't crowd out the filename. */
function shortenDir(dir: string, maxSegments = 3): string {
	const segments = dir.split("/").filter(Boolean);
	if (segments.length === 0) return "";
	if (segments.length <= maxSegments) return `${segments.join("/")}/`;
	return `.../${segments.slice(-maxSegments).join("/")}/`;
}

/** One line of a unified diff hunk, classified and escaped for HTML. */
function renderDiffLine(line: string): string {
	const cls = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "rem" : "ctx";
	return `<span class="diff-line ${cls}">${escapeHtml(line)}</span>`;
}

/** Collapsible unified-diff block for one file. Open by default when the change has a stated reason. */
function renderDiffBlock(diff: string | undefined, openByDefault: boolean): string {
	if (!diff) return "";
	const body = diff.split("\n").map(renderDiffLine).join("\n");
	return `<details class="file-diff"${openByDefault ? " open" : ""}>
					<summary>Diff</summary>
					<pre class="diff-pre">${body}</pre>
				</details>`;
}

function renderFileCard(
	entry: DiffStatEntry,
	reason: string | undefined,
	maxChanged: number,
	diff: string | undefined,
): string {
	const addedWidth = (entry.added / maxChanged) * 100;
	const removedWidth = (entry.removed / maxChanged) * 100;
	const { dir, name } = splitPath(entry.file);
	const shortDir = shortenDir(dir);

	return `<li class="file-card${reason ? " has-reason" : ""}">
				<div class="file-card-top">
					<span class="file-path">${shortDir ? `<span class="file-dir">${escapeHtml(shortDir)}</span>` : ""}${escapeHtml(name)}</span>
					<span class="file-stat"><span class="added">+${entry.added}</span><span class="removed">−${entry.removed}</span></span>
				</div>
				${reason ? `<p class="file-reason">${escapeHtml(reason)}</p>` : ""}
				<div class="file-bar"><span class="file-bar-added" style="width:${addedWidth}%"></span><span class="file-bar-removed" style="width:${removedWidth}%"></span></div>
				${renderDiffBlock(diff, reason !== undefined)}
			</li>`;
}

/**
 * Renders a polished, self-contained "PR dashboard" page: every changed file, each one's stated reason
 * from the PR body's `## Changes` section when there is one, and the shape of the diff at a glance.
 * Files with a stated reason lead with it and carry an accent border; files without one sit back,
 * quieter — so what actually matters reads first. Matches the Forest Night theme.
 */
export function renderDashboardHtml({ pr, jiraUrl, diffStat, fileDiffs }: DashboardInput): string {
	const changes = parseChangesSection(pr.body);
	const overview = parseOverview(pr.body);
	const maxChanged = Math.max(1, ...diffStat.map((e) => e.added + e.removed));
	const totalAdded = diffStat.reduce((sum, e) => sum + e.added, 0);
	const totalRemoved = diffStat.reduce((sum, e) => sum + e.removed, 0);
	const totalChanged = Math.max(1, totalAdded + totalRemoved);
	const explainedCount = diffStat.filter((e) => changes.has(e.file)).length;

	// Files with a stated reason first — that's the part worth scanning — then the rest, both
	// alphabetically within their group so the list stays predictable as the PR changes.
	const sorted = [...diffStat].sort((a, b) => {
		const aHas = changes.has(a.file) ? 0 : 1;
		const bHas = changes.has(b.file) ? 0 : 1;
		return aHas !== bHas ? aHas - bHas : a.file.localeCompare(b.file);
	});

	const cards = sorted
		.map((entry) => renderFileCard(entry, changes.get(entry.file), maxChanged, fileDiffs.get(entry.file)))
		.join("\n");

	const jiraKey = jiraUrl ? (/\/browse\/([^/]+)$/.exec(jiraUrl)?.[1] ?? "Jira") : null;
	const jiraPill = jiraUrl
		? `<a class="pill pill-jira" href="${escapeHtml(jiraUrl)}" target="_blank" rel="noopener">${escapeHtml(jiraKey ?? "Jira")}</a>`
		: "";
	const fileWord = diffStat.length === 1 ? "file" : "files";

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pr.title)}</title>
<style>
	:root {
		--bg: #121d1c; --surface: #16221f; --surface-quiet: #141e1b; --border: #22332e;
		--text: #e6ece9; --muted: #8fa39c; --dim: #5f7872;
		--gold: #ffb347; --aqua: #5ee6c4; --green: #7ee787; --red: #ff6b6b; --orange: #ffa368;
		--font-sans: -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
		--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}
	* { box-sizing: border-box; }
	body {
		margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-sans);
		padding: clamp(24px, 5vw, 56px);
	}
	.page { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }

	.eyebrow {
		font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim);
		font-weight: 600; margin: 0 0 8px;
	}
	h1 { font-size: clamp(22px, 3vw, 28px); line-height: 1.25; margin: 0 0 14px; text-wrap: balance; }
	.pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
	.pill {
		display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 999px;
		font-size: 12.5px; font-weight: 500; text-decoration: none; font-family: var(--font-mono);
	}
	.pill-pr { background: rgba(94, 230, 196, 0.13); color: var(--aqua); }
	.pill-jira { background: rgba(255, 163, 104, 0.13); color: var(--orange); }
	.overview {
		color: var(--muted); font-size: 14.5px; line-height: 1.6; white-space: pre-wrap; max-width: 62ch;
		margin: 0;
	}

	.summary {
		display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
		padding: 16px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
	}
	.summary-stat { display: flex; flex-direction: column; gap: 2px; }
	.summary-stat .num { font-family: var(--font-mono); font-size: 17px; font-weight: 600; }
	.summary-stat .num.added { color: var(--green); }
	.summary-stat .num.removed { color: var(--red); }
	.summary-stat .label { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.04em; }
	.summary-bar {
		flex: 1 1 140px; min-width: 100px; height: 6px; border-radius: 3px; overflow: hidden;
		display: flex; background: var(--border);
	}
	.summary-bar-added { background: var(--green); height: 100%; }
	.summary-bar-removed { background: var(--red); height: 100%; }

	.section-label {
		font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim);
		font-weight: 600; margin: 0;
	}
	.file-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
	.file-card {
		background: var(--surface-quiet); border: 1px solid var(--border); border-radius: 10px;
		padding: 13px 16px; border-left: 3px solid transparent;
	}
	.file-card.has-reason { background: var(--surface); border-left-color: var(--gold); }
	.file-card-top {
		display: flex; justify-content: space-between; align-items: baseline; gap: 14px; flex-wrap: wrap;
	}
	.file-path { font-family: var(--font-mono); font-size: 12.5px; color: var(--muted); word-break: break-all; }
	.file-card.has-reason .file-path { color: var(--text); }
	.file-dir { color: var(--dim); }
	.file-stat { font-family: var(--font-mono); font-size: 12px; white-space: nowrap; }
	.file-stat .added { color: var(--green); }
	.file-stat .removed { color: var(--red); margin-left: 7px; }
	.file-reason { margin: 8px 0 0; font-size: 14.5px; line-height: 1.5; color: var(--text); }
	.file-bar {
		height: 4px; border-radius: 2px; overflow: hidden; display: flex; margin-top: 10px;
		background: var(--border);
	}
	.file-bar-added { background: var(--green); height: 100%; }
	.file-bar-removed { background: var(--red); height: 100%; }

	.file-diff { margin-top: 12px; }
	.file-diff summary {
		cursor: pointer; font-size: 12px; color: var(--muted); font-family: var(--font-mono);
		user-select: none;
	}
	.file-diff summary:hover { color: var(--text); }
	.file-diff[open] summary { margin-bottom: 8px; }
	.diff-pre {
		margin: 0; padding: 12px 14px; background: var(--surface-quiet); border: 1px solid var(--border);
		border-radius: 8px; overflow-x: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.6;
	}
	.diff-line { display: block; white-space: pre; }
	.diff-line.add { color: var(--green); background: rgba(126, 231, 135, 0.08); }
	.diff-line.rem { color: var(--red); background: rgba(255, 107, 107, 0.08); }
	.diff-line.ctx { color: var(--muted); }
	.diff-line.hunk { color: var(--aqua); opacity: 0.8; margin: 4px 0; }

	footer { font-size: 12px; color: var(--dim); text-align: center; }
</style>
</head>
<body>
	<div class="page">
		<header>
			<p class="eyebrow">Pull request #${pr.number}</p>
			<h1>${escapeHtml(pr.title)}</h1>
			<div class="pills">
				<a class="pill pill-pr" href="${escapeHtml(pr.url)}" target="_blank" rel="noopener">View on GitHub</a>
				${jiraPill}
			</div>
			${overview ? `<p class="overview">${escapeHtml(overview)}</p>` : ""}
		</header>

		<section class="summary">
			<div class="summary-stat"><span class="num added">+${totalAdded}</span><span class="label">Added</span></div>
			<div class="summary-stat"><span class="num removed">−${totalRemoved}</span><span class="label">Removed</span></div>
			<div class="summary-stat"><span class="num">${diffStat.length}</span><span class="label">${fileWord}</span></div>
			<div class="summary-bar">
				<span class="summary-bar-added" style="width:${(totalAdded / totalChanged) * 100}%"></span>
				<span class="summary-bar-removed" style="width:${(totalRemoved / totalChanged) * 100}%"></span>
			</div>
			${explainedCount > 0 ? `<div class="summary-stat"><span class="num">${explainedCount}/${diffStat.length}</span><span class="label">Explained</span></div>` : ""}
		</section>

		<section>
			<p class="section-label">Changes</p>
			<ul class="file-list">
				${cards || '<li class="file-card">No diffstat available.</li>'}
			</ul>
		</section>

		<footer>Generated by pi · ${new Date().toLocaleString()}</footer>
	</div>
</body>
</html>
`;
}

/** Writes the dashboard HTML to a temp file, one per repo+PR (overwritten on refresh). Returns its path. */
export function writeDashboardFile(repoSlug: string, prNumber: number, html: string): string {
	const dir = join(tmpdir(), "pi-pr-dashboards");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${repoSlug}-pr-${prNumber}.html`);
	writeFileSync(path, html, "utf8");
	return path;
}
