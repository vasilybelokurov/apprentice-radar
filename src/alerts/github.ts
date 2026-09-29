// Minimal GitHub REST client for alert issues, using the workflow's GITHUB_TOKEN.
export const ALERT_LABEL = "alert";

export interface Issue {
  number: number;
  state: "open" | "closed";
  body: string | null;
  pull_request?: unknown;
}

export interface GitHubOptions {
  token: string;
  repo: string; // "owner/name"
  fetch?: typeof fetch;
  apiUrl?: string;
}

export function createGitHubClient(options: GitHubOptions) {
  const token = options.token.trim();
  if (!token) throw new Error("GitHub token is empty");
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error(`invalid repo "${options.repo}"`);
  const doFetch = options.fetch ?? fetch;
  const api = `${options.apiUrl ?? "https://api.github.com"}/repos/${options.repo}`;
  const redact = (s: string) => s.split(token).join("<redacted>");

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await doFetch(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    return response;
  }

  async function expectOk(response: Response, what: string) {
    if (!response.ok) {
      const text = redact((await response.text().catch(() => "")).slice(0, 300));
      throw new Error(`GitHub ${what} failed: HTTP ${response.status} ${text}`);
    }
  }

  /** All issues (open and closed) with the alert label; pull requests excluded. */
  async function listAlertIssues(): Promise<Issue[]> {
    const all: Issue[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await call("GET", `/issues?labels=${ALERT_LABEL}&state=all&per_page=100&page=${page}`);
      await expectOk(r, "list issues");
      const batch = (await r.json()) as Issue[];
      all.push(...batch.filter((i) => !i.pull_request));
      if (batch.length < 100) break;
    }
    return all;
  }

  async function ensureLabel() {
    const r = await call("POST", "/labels", { name: ALERT_LABEL, color: "1d4e89", description: "Weekly vacancy alert" });
    if (r.status === 422) return; // already exists
    await expectOk(r, "create label");
  }

  async function createIssue(title: string, body: string, assignee: string): Promise<number> {
    const r = await call("POST", "/issues", { title, body, labels: [ALERT_LABEL], assignees: [assignee] });
    await expectOk(r, "create issue");
    return ((await r.json()) as { number: number }).number;
  }

  async function closeIssue(number: number) {
    const r = await call("PATCH", `/issues/${number}`, { state: "closed", state_reason: "completed" });
    await expectOk(r, `close issue #${number}`);
  }

  return { listAlertIssues, ensureLabel, createIssue, closeIssue, redact };
}

export type GitHubClient = ReturnType<typeof createGitHubClient>;
