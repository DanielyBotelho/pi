import { type ExecFileException, execFile, spawnSync } from "child_process";
import { existsSync, type FSWatcher, readFileSync, type Stats, statSync, unwatchFile, watchFile } from "fs";
import { basename, dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
import { closeWatcher, FS_WATCH_RETRY_DELAY_MS, watchWithErrorHandler } from "../utils/fs-watch.ts";
import { openBrowser } from "../utils/open-browser.ts";
import { getDiffStat, getFileDiffs, renderDashboardHtml, writeDashboardFile } from "./pr-dashboard.ts";

export type GitPaths = {
	repoDir: string;
	commonGitDir: string;
	headPath: string;
};

/**
 * Find git metadata paths by walking up from cwd.
 * Handles both regular git repos (.git is a directory) and worktrees (.git is a file).
 */
export function findGitPaths(cwd: string): GitPaths | null {
	let dir = cwd;
	while (true) {
		const gitPath = join(dir, ".git");
		if (existsSync(gitPath)) {
			try {
				const stat = statSync(gitPath);
				if (stat.isFile()) {
					const content = readFileSync(gitPath, "utf8").trim();
					if (content.startsWith("gitdir: ")) {
						const gitDir = resolve(dir, content.slice(8).trim());
						const headPath = join(gitDir, "HEAD");
						if (!existsSync(headPath)) return null;
						const commonDirPath = join(gitDir, "commondir");
						const commonGitDir = existsSync(commonDirPath)
							? resolve(gitDir, readFileSync(commonDirPath, "utf8").trim())
							: gitDir;
						return { repoDir: dir, commonGitDir, headPath };
					}
				} else if (stat.isDirectory()) {
					const headPath = join(gitPath, "HEAD");
					if (!existsSync(headPath)) return null;
					return { repoDir: dir, commonGitDir: gitPath, headPath };
				}
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/** Ask git for the current branch. Returns null on detached HEAD or if git is unavailable. */
function resolveBranchWithGitSync(repoDir: string): string | null {
	const result = spawnSync("git", ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"], {
		cwd: repoDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const branch = result.status === 0 ? result.stdout.trim() : "";
	return branch || null;
}

/** Ask git for the current branch asynchronously. Returns null on detached HEAD or if git is unavailable. */
function resolveBranchWithGitAsync(repoDir: string): Promise<string | null> {
	return new Promise((resolvePromise) => {
		execFile(
			"git",
			["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
			{
				cwd: repoDir,
				encoding: "utf8",
			},
			(error: ExecFileException | null, stdout: string) => {
				if (error) {
					resolvePromise(null);
					return;
				}
				const branch = stdout.trim();
				resolvePromise(branch || null);
			},
		);
	});
}

/**
 * The `owner/repo` slug of the `origin` remote, parsed from its URL (SSH or HTTPS). On a fork, `gh pr
 * view` with no `--repo` can resolve against the upstream parent instead of `origin` — passing this
 * slug explicitly keeps PR/Jira/dashboard lookups pinned to the repo the branch was actually pushed to.
 */
function resolveOriginRepoSlug(repoDir: string): string | null {
	const result = spawnSync("git", ["remote", "get-url", "origin"], {
		cwd: repoDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) return null;
	const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(result.stdout.trim());
	return match?.[1] ?? null;
}

export type PullRequestInfo = {
	url: string;
	title: string;
	body: string;
	baseRefName: string;
	number: number;
};

/**
 * Ask `gh` for `branch`'s open pull request (URL, title, body, base branch, number). Null if there isn't
 * one, or `gh` is unavailable. Fetches everything the Jira-key fallback and PR dashboard need in one
 * call, rather than a separate `gh` round trip for each.
 */
function resolvePullRequestInfo(repoDir: string, branch: string): Promise<PullRequestInfo | null> {
	const repoSlug = resolveOriginRepoSlug(repoDir);
	// `--repo` requires an explicit branch argument: it disables gh's own current-branch detection,
	// which (on a fork) can resolve against the upstream parent repo instead of `origin`.
	const args = repoSlug
		? ["pr", "view", branch, "--repo", repoSlug, "--json", "url,title,body,baseRefName,number"]
		: ["pr", "view", "--json", "url,title,body,baseRefName,number"];
	return new Promise((resolvePromise) => {
		execFile(
			"gh",
			args,
			{ cwd: repoDir, encoding: "utf8", timeout: 5000 },
			(error: ExecFileException | null, stdout: string) => {
				if (error) {
					resolvePromise(null);
					return;
				}
				try {
					const parsed = JSON.parse(stdout) as {
						url?: string;
						title?: string;
						body?: string;
						baseRefName?: string;
						number?: number;
					};
					resolvePromise(
						parsed.url && parsed.number !== undefined
							? {
									url: parsed.url,
									title: parsed.title ?? "",
									body: parsed.body ?? "",
									baseRefName: parsed.baseRefName ?? "main",
									number: parsed.number,
								}
							: null,
					);
				} catch {
					resolvePromise(null);
				}
			},
		);
	});
}

/**
 * Base URL used to build Jira issue links shown in the footer (e.g. `${JIRA_BASE_URL}/browse/SYN-123`).
 * Update this if the Jira instance changes.
 */
const JIRA_BASE_URL = "https://syngenta.atlassian.net";

/** Jira keys are an uppercase letter prefix (no digits) followed by a dash and a number, e.g. SYN-123. */
const JIRA_KEY_PATTERN = /\b([A-Z]{2,10}-\d+)\b/;

/** Find a Jira issue key in free text (branch name, PR title/body). Case-insensitive, returns it uppercased. */
function extractJiraKey(text: string): string | null {
	return JIRA_KEY_PATTERN.exec(text.toUpperCase())?.[1] ?? null;
}

function isWslEnvironment(): boolean {
	return process.platform === "linux" && !!(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

function isWindowsMountedRepoPath(repoDir: string): boolean {
	return /^\/mnt\/[a-z](?:\/|$)/i.test(repoDir);
}

function shouldPollGitHead(repoDir: string): boolean {
	return isWslEnvironment() && isWindowsMountedRepoPath(repoDir);
}

/**
 * Provides git branch and extension statuses - data not otherwise accessible to extensions.
 * Context usage on ctx.getContextUsage(), token stats on ctx.sessionManager.getEntries(), model info on ctx.model.
 */
export class FooterDataProvider {
	private cwd: string;
	private static readonly WATCH_DEBOUNCE_MS = 500;

	private extensionStatuses = new Map<string, string>();
	private cachedBranch: string | null | undefined = undefined;
	private cachedPrInfo: PullRequestInfo | null | undefined = undefined;
	private prFetchInFlight = false;
	private prPollTimer: ReturnType<typeof setTimeout> | null = null;
	private static readonly PR_POLL_MS = 20_000;
	private cachedDashboardPath: string | null = null;
	private gitPaths: GitPaths | null | undefined = undefined;
	private headWatcher: FSWatcher | null = null;
	private headWatchFilePath: string | null = null;
	private headWatchFileListener: ((current: Stats, previous: Stats) => void) | null = null;
	private reftableWatcher: FSWatcher | null = null;
	private reftableTablesListWatcher: FSWatcher | null = null;
	private reftableTablesListPath: string | null = null;
	private branchChangeCallbacks = new Set<() => void>();
	private availableProviderCount = 0;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private gitWatcherRetryTimer: ReturnType<typeof setTimeout> | null = null;
	private refreshInFlight = false;
	private refreshPending = false;
	private disposed = false;

	constructor(cwd: string) {
		this.cwd = cwd;
		this.gitPaths = findGitPaths(cwd);
		this.setupGitWatcher();
	}

	/** Current git branch, null if not in repo, "detached" if detached HEAD */
	getGitBranch(): string | null {
		if (this.cachedBranch === undefined) {
			this.cachedBranch = this.resolveGitBranchSync();
		}
		return this.cachedBranch;
	}

	/**
	 * Kicks off a background fetch of the current branch's pull request via `gh pr view`, and notifies
	 * branch-change subscribers once it resolves. `getPullRequestUrl` and `getJiraUrl` share this fetch
	 * since the Jira-key fallback reads the PR title/body fetched alongside its URL.
	 *
	 * While no PR exists yet, re-polls every `PR_POLL_MS` so a PR opened mid-session (e.g. the agent
	 * running `gh pr create`) is picked up without restarting pi. A PR found on the *first* check (one
	 * that already existed before this session started) does not auto-open its dashboard; one found by
	 * a later poll (created during this session) does.
	 */
	private ensurePrInfoFetch(isPoll = false): void {
		if (this.prFetchInFlight || !this.gitPaths) return;
		if (this.cachedPrInfo !== undefined && !isPoll) return;
		const branch = this.getGitBranch();
		if (!branch || branch === "detached") return;
		this.prFetchInFlight = true;
		const repoDir = this.gitPaths.repoDir;
		const hadNoPrYet = this.cachedPrInfo === null;
		void resolvePullRequestInfo(repoDir, branch).then(async (info) => {
			this.prFetchInFlight = false;
			if (this.disposed) return;
			const isNewlyCreated = hadNoPrYet && info !== null;
			const urlChanged = this.cachedPrInfo !== undefined && this.cachedPrInfo?.url !== info?.url;
			this.cachedPrInfo = info;
			if (info) {
				await this.generateDashboard(repoDir, info, isNewlyCreated);
			} else {
				this.schedulePrPoll();
			}
			if (urlChanged || isNewlyCreated) this.notifyBranchChange();
		});
	}

	private schedulePrPoll(): void {
		if (this.disposed || this.prPollTimer) return;
		this.prPollTimer = setTimeout(() => {
			this.prPollTimer = null;
			this.ensurePrInfoFetch(true);
		}, FooterDataProvider.PR_POLL_MS);
		this.prPollTimer.unref?.();
	}

	/** Builds the PR dashboard HTML, writes it to a temp file, and opens it in the browser if `autoOpen`. */
	private async generateDashboard(repoDir: string, info: PullRequestInfo, autoOpen: boolean): Promise<void> {
		try {
			const [diffStat, fileDiffs] = await Promise.all([
				getDiffStat(repoDir, info.baseRefName),
				getFileDiffs(repoDir, info.baseRefName),
			]);
			const html = renderDashboardHtml({ pr: info, jiraUrl: this.getJiraUrl(), diffStat, fileDiffs });
			const repoSlug = basename(repoDir).replace(/[^a-zA-Z0-9_-]/g, "_") || "repo";
			const path = writeDashboardFile(repoSlug, info.number, html);
			this.cachedDashboardPath = path;
			if (autoOpen) openBrowser(pathToFileURL(path).href);
		} catch {
			// Best-effort: the dashboard link simply won't appear if this fails.
		}
	}

	/** URL of the open pull request for the current branch, null if there isn't one (or `gh` isn't available). */
	getPullRequestUrl(): string | null {
		this.ensurePrInfoFetch();
		return this.cachedPrInfo?.url ?? null;
	}

	/** `file://` URL of the generated PR dashboard, null until one has been generated for an open PR. */
	getDashboardUrl(): string | null {
		return this.cachedDashboardPath ? pathToFileURL(this.cachedDashboardPath).href : null;
	}

	/**
	 * Jira issue link related to the current work: a key in the branch name wins (e.g.
	 * `feature/SYN-123-thing`), falling back to one mentioned in the PR title or body. Null if neither
	 * has one, there's no PR, or `gh` is unavailable.
	 */
	getJiraUrl(): string | null {
		const branch = this.getGitBranch();
		const branchKey = branch ? extractJiraKey(branch) : null;
		if (branchKey) return `${JIRA_BASE_URL}/browse/${branchKey}`;

		this.ensurePrInfoFetch();
		if (!this.cachedPrInfo) return null;
		const prKey = extractJiraKey(`${this.cachedPrInfo.title}\n${this.cachedPrInfo.body}`);
		return prKey ? `${JIRA_BASE_URL}/browse/${prKey}` : null;
	}

	/** Extension status texts set via ctx.ui.setStatus() */
	getExtensionStatuses(): ReadonlyMap<string, string> {
		return this.extensionStatuses;
	}

	/** Subscribe to git branch changes. Returns unsubscribe function. */
	onBranchChange(callback: () => void): () => void {
		this.branchChangeCallbacks.add(callback);
		return () => this.branchChangeCallbacks.delete(callback);
	}

	/** Internal: set extension status */
	setExtensionStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.extensionStatuses.delete(key);
		} else {
			this.extensionStatuses.set(key, text);
		}
	}

	/** Internal: clear extension statuses */
	clearExtensionStatuses(): void {
		this.extensionStatuses.clear();
	}

	/** Number of unique providers with available models (for footer display) */
	getAvailableProviderCount(): number {
		return this.availableProviderCount;
	}

	/** Internal: update available provider count */
	setAvailableProviderCount(count: number): void {
		this.availableProviderCount = count;
	}

	setCwd(cwd: string): void {
		if (this.cwd === cwd) {
			return;
		}

		this.cwd = cwd;
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		if (this.prPollTimer) {
			clearTimeout(this.prPollTimer);
			this.prPollTimer = null;
		}
		this.clearGitWatchers();
		this.cachedBranch = undefined;
		this.cachedPrInfo = undefined;
		this.cachedDashboardPath = null;
		this.gitPaths = findGitPaths(cwd);
		this.setupGitWatcher();
		this.notifyBranchChange();
	}

	/** Internal: cleanup */
	dispose(): void {
		this.disposed = true;
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		if (this.prPollTimer) {
			clearTimeout(this.prPollTimer);
			this.prPollTimer = null;
		}
		this.clearGitWatchers();
		this.branchChangeCallbacks.clear();
	}

	private notifyBranchChange(): void {
		for (const cb of this.branchChangeCallbacks) cb();
	}

	private scheduleRefresh(): void {
		if (this.disposed || this.refreshTimer) return;
		if (this.refreshInFlight) {
			this.refreshPending = true;
			return;
		}
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			void this.refreshGitBranchAsync();
		}, FooterDataProvider.WATCH_DEBOUNCE_MS);
	}

	private async refreshGitBranchAsync(): Promise<void> {
		if (this.disposed) return;
		if (this.refreshInFlight) {
			this.refreshPending = true;
			return;
		}

		this.refreshInFlight = true;
		try {
			const nextBranch = await this.resolveGitBranchAsync();
			if (this.disposed) return;
			if (this.cachedBranch !== undefined && this.cachedBranch !== nextBranch) {
				this.cachedBranch = nextBranch;
				this.cachedPrInfo = undefined;
				this.cachedDashboardPath = null;
				if (this.prPollTimer) {
					clearTimeout(this.prPollTimer);
					this.prPollTimer = null;
				}
				this.notifyBranchChange();
				return;
			}
			this.cachedBranch = nextBranch;
		} finally {
			this.refreshInFlight = false;
			if (this.refreshPending && !this.disposed) {
				this.refreshPending = false;
				this.scheduleRefresh();
			}
		}
	}

	private resolveGitBranchSync(): string | null {
		try {
			if (!this.gitPaths) return null;
			const content = readFileSync(this.gitPaths.headPath, "utf8").trim();
			if (content.startsWith("ref: refs/heads/")) {
				const branch = content.slice(16);
				return branch === ".invalid" ? (resolveBranchWithGitSync(this.gitPaths.repoDir) ?? "detached") : branch;
			}
			return "detached";
		} catch {
			return null;
		}
	}

	private async resolveGitBranchAsync(): Promise<string | null> {
		try {
			if (!this.gitPaths) return null;
			const content = readFileSync(this.gitPaths.headPath, "utf8").trim();
			if (content.startsWith("ref: refs/heads/")) {
				const branch = content.slice(16);
				return branch === ".invalid"
					? ((await resolveBranchWithGitAsync(this.gitPaths.repoDir)) ?? "detached")
					: branch;
			}
			return "detached";
		} catch {
			return null;
		}
	}

	private clearGitWatchers(): void {
		closeWatcher(this.headWatcher);
		this.headWatcher = null;
		if (this.headWatchFilePath && this.headWatchFileListener) {
			unwatchFile(this.headWatchFilePath, this.headWatchFileListener);
			this.headWatchFilePath = null;
			this.headWatchFileListener = null;
		}
		closeWatcher(this.reftableWatcher);
		this.reftableWatcher = null;
		closeWatcher(this.reftableTablesListWatcher);
		this.reftableTablesListWatcher = null;
		if (this.reftableTablesListPath) {
			unwatchFile(this.reftableTablesListPath);
			this.reftableTablesListPath = null;
		}
		if (this.gitWatcherRetryTimer) {
			clearTimeout(this.gitWatcherRetryTimer);
			this.gitWatcherRetryTimer = null;
		}
	}

	private scheduleGitWatcherRetry(): void {
		if (this.disposed || this.gitWatcherRetryTimer) {
			return;
		}

		this.gitWatcherRetryTimer = setTimeout(() => {
			this.gitWatcherRetryTimer = null;
			this.setupGitWatcher();
		}, FS_WATCH_RETRY_DELAY_MS);
	}

	private handleGitWatcherError(): void {
		this.clearGitWatchers();
		this.scheduleGitWatcherRetry();
	}

	private setupGitWatcher(): void {
		this.clearGitWatchers();
		if (!this.gitPaths) return;

		const pollGitHead = shouldPollGitHead(this.gitPaths.repoDir);

		// Watch the directory containing HEAD, not HEAD itself.
		// Git uses atomic writes (write temp, rename over HEAD), which changes the inode.
		// fs.watch on a file stops working after the inode changes.
		this.headWatcher = watchWithErrorHandler(
			dirname(this.gitPaths.headPath),
			(_eventType, filename) => {
				if (!filename || filename === "HEAD") {
					this.scheduleRefresh();
				}
			},
			() => this.handleGitWatcherError(),
		);
		if (pollGitHead) {
			this.headWatchFilePath = this.gitPaths.headPath;
			this.headWatchFileListener = (current, previous) => {
				if (
					current.mtimeMs !== previous.mtimeMs ||
					current.ctimeMs !== previous.ctimeMs ||
					current.size !== previous.size
				) {
					this.scheduleRefresh();
				}
			};
			watchFile(this.headWatchFilePath, { interval: 1000 }, this.headWatchFileListener);
		}
		if (!this.headWatcher && !pollGitHead) {
			return;
		}

		// In reftable repos, branch switches update files in the reftable directory
		// instead of HEAD. Watch it separately so the footer picks up those changes.
		const reftableDir = join(this.gitPaths.commonGitDir, "reftable");
		if (existsSync(reftableDir)) {
			this.reftableWatcher = watchWithErrorHandler(
				reftableDir,
				() => {
					this.scheduleRefresh();
				},
				() => this.handleGitWatcherError(),
			);
			if (!this.reftableWatcher) {
				return;
			}

			const tablesListPath = join(reftableDir, "tables.list");
			if (existsSync(tablesListPath)) {
				this.reftableTablesListPath = tablesListPath;
				this.reftableTablesListWatcher = watchWithErrorHandler(
					tablesListPath,
					() => {
						this.scheduleRefresh();
					},
					() => this.handleGitWatcherError(),
				);
				if (!this.reftableTablesListWatcher) {
					return;
				}
				watchFile(tablesListPath, { interval: 250 }, (current, previous) => {
					if (
						current.mtimeMs !== previous.mtimeMs ||
						current.ctimeMs !== previous.ctimeMs ||
						current.size !== previous.size
					) {
						this.scheduleRefresh();
					}
				});
			}
		}
	}
}

/** Read-only view for extensions - excludes setExtensionStatus, setAvailableProviderCount and dispose */
export type ReadonlyFooterDataProvider = Pick<
	FooterDataProvider,
	| "getGitBranch"
	| "getPullRequestUrl"
	| "getJiraUrl"
	| "getDashboardUrl"
	| "getExtensionStatuses"
	| "getAvailableProviderCount"
	| "onBranchChange"
>;
