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
}

/**
 * Renders a small, self-contained "PR dashboard" page: diffstat per changed file, plus its stated
 * reason from the PR body's `## Changes` section when there is one. Matches the Forest Night theme.
 */
export function renderDashboardHtml({ pr, jiraUrl, diffStat }: DashboardInput): string {
	const changes = parseChangesSection(pr.body);
	const overview = parseOverview(pr.body);
	const maxChanged = Math.max(1, ...diffStat.map((e) => e.added + e.removed));
	const totalAdded = diffStat.reduce((sum, e) => sum + e.added, 0);
	const totalRemoved = diffStat.reduce((sum, e) => sum + e.removed, 0);

	const rows = diffStat
		.map((entry) => {
			const reason = changes.get(entry.file);
			const addedWidth = Math.round((entry.added / maxChanged) * 100);
			const removedWidth = Math.round((entry.removed / maxChanged) * 100);
			return `<tr>
				<td class="file">${escapeHtml(entry.file)}</td>
				<td class="stat added">+${entry.added}</td>
				<td class="stat removed">-${entry.removed}</td>
				<td class="bar"><span class="bar-added" style="width:${addedWidth}%"></span><span class="bar-removed" style="width:${removedWidth}%"></span></td>
				<td class="why">${reason ? escapeHtml(reason) : ""}</td>
			</tr>`;
		})
		.join("\n");

	const jiraKey = jiraUrl ? (/\/browse\/([^/]+)$/.exec(jiraUrl)?.[1] ?? "Jira") : null;
	const jiraLink = jiraUrl
		? `<a class="pill pill-jira" href="${escapeHtml(jiraUrl)}" target="_blank" rel="noopener">${escapeHtml(jiraKey ?? "Jira")}</a>`
		: "";

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pr.title)}</title>
<style>
	:root {
		--bg: #121d1c; --text: #e6ece9; --muted: #8fa39c;
		--gold: #ffb347; --aqua: #5ee6c4; --green: #7ee787; --red: #ff6b6b; --orange: #ffa368;
		--border: #22332e;
	}
	* { box-sizing: border-box; }
	body {
		margin: 0; background: var(--bg); color: var(--text); padding: 32px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}
	.wrap { max-width: 920px; margin: 0 auto; }
	h1 { font-size: 20px; margin: 0 0 10px; text-wrap: balance; }
	.pill {
		display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
		text-decoration: none; margin-right: 6px;
	}
	.pill-pr { background: rgba(94, 230, 196, 0.15); color: var(--aqua); }
	.pill-jira { background: rgba(255, 163, 104, 0.15); color: var(--orange); }
	.overview { color: var(--muted); font-size: 13px; margin: 16px 0 24px; white-space: pre-wrap; max-width: 70ch; }
	.totals { font-size: 13px; margin-bottom: 12px; }
	.totals .added { color: var(--green); }
	.totals .removed { color: var(--red); }
	table { width: 100%; border-collapse: collapse; font-size: 13px; }
	td { padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
	.file { color: var(--gold); white-space: nowrap; }
	.stat.added { color: var(--green); text-align: right; }
	.stat.removed { color: var(--red); text-align: right; }
	.bar { width: 110px; }
	.bar-added, .bar-removed { display: inline-block; height: 8px; }
	.bar-added { background: var(--green); }
	.bar-removed { background: var(--red); }
	.why { color: var(--text); }
</style>
</head>
<body>
	<div class="wrap">
		<h1>${escapeHtml(pr.title)}</h1>
		<div>
			<a class="pill pill-pr" href="${escapeHtml(pr.url)}" target="_blank" rel="noopener">${escapeHtml(pr.url)}</a>
			${jiraLink}
		</div>
		${overview ? `<div class="overview">${escapeHtml(overview)}</div>` : ""}
		<div class="totals"><span class="added">+${totalAdded}</span> <span class="removed">-${totalRemoved}</span> · ${diffStat.length} file${diffStat.length === 1 ? "" : "s"} changed</div>
		<table>
			<tbody>
				${rows || '<tr><td colspan="5" class="why">No diffstat available.</td></tr>'}
			</tbody>
		</table>
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
