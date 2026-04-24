import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sign } from "@octokit/webhooks-methods";
import app from "../index";
import { findTaskById, updateTaskStatus, updatePullRequestUrl } from "../lib/notion";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

// ---------------------------------------------------------------------------
// Mock the entire notion module – keeps the SDK out of the Workers runtime
// ---------------------------------------------------------------------------
vi.mock("../lib/notion", () => ({
  findTaskById: vi.fn(),
  updateTaskStatus: vi.fn(),
  updatePullRequestUrl: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-webhook-secret";

const TEST_ENV = {
  GITHUB_WEBHOOK_SECRET: TEST_SECRET,
  NOTION_API_KEY: "secret_test",
  NOTION_DATABASE_ID: "db-id-123",
  NOTION_DATA_SOURCE_ID: "ds-id-456",
};

const MOCK_PAGE_ID = "page-id-abc";
const MOCK_PAGE = {
  id: MOCK_PAGE_ID,
  object: "page",
  properties: {
    ID: { type: "unique_id", unique_id: { number: 42, prefix: "LEVEL" } },
    Status: { type: "status" },
  },
} as unknown as PageObjectResponse;

async function sendWebhook(
  body: string,
  opts: { signature?: string | null; event?: string } = {}
): Promise<Response> {
  const sig =
    opts.signature !== undefined
      ? opts.signature
      : await sign(TEST_SECRET, body);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-GitHub-Event": opts.event ?? "pull_request",
  };
  if (sig !== null) headers["X-Hub-Signature-256"] = sig;

  return app.request("/webhooks/github", { method: "POST", headers, body }, TEST_ENV);
}

// ---------------------------------------------------------------------------

function makePRPayload(overrides: {
  action: string;
  title?: string;
  branch?: string;
  merged?: boolean;
  changes?: Record<string, unknown>;
}): string {
  const payload: Record<string, unknown> = {
    action: overrides.action,
    pull_request: {
      number: 1,
      title: overrides.title ?? "LEVEL-42 some work",
      html_url: "https://github.com/org/repo/pull/1",
      merged: overrides.merged ?? false,
      head: { ref: overrides.branch ?? "feature/level-42-work" },
      user: { login: "dev" },
    },
    repository: { full_name: "org/repo" },
  };
  if (overrides.changes !== undefined) payload.changes = overrides.changes;
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /webhooks/github", () => {
  beforeEach(() => {
    vi.mocked(findTaskById).mockResolvedValue(MOCK_PAGE);
    vi.mocked(updateTaskStatus).mockResolvedValue(undefined);
    vi.mocked(updatePullRequestUrl).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when signature header is missing", async () => {
    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body, { signature: null });
    expect(res.status).toBe(401);
  });

  it("returns 401 when signature is wrong", async () => {
    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body, { signature: "sha256=badbadbadbad" });
    expect(res.status).toBe(401);
  });

  it("returns 200 for a valid signature", async () => {
    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
  });

  // ── Event filtering ───────────────────────────────────────────────────────

  it("ignores non-pull_request events", async () => {
    const body = JSON.stringify({ action: "created" });
    const res = await sendWebhook(body, { event: "push" });
    expect(res.status).toBe(200);
    expect(findTaskById).not.toHaveBeenCalled();
  });

  it("ignores unhandled PR actions (e.g. labeled)", async () => {
    const body = makePRPayload({ action: "labeled" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
    expect(findTaskById).not.toHaveBeenCalled();
  });

  it("closed PR not merged → sets Canceled", async () => {
    const body = makePRPayload({ action: "closed", merged: false });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);

    expect(findTaskById).toHaveBeenCalledWith(
      expect.objectContaining({ NOTION_DATABASE_ID: TEST_ENV.NOTION_DATABASE_ID }),
      "LEVEL-42"
    );
    expect(updateTaskStatus).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_PAGE_ID,
      "Canceled"
    );
  });

  // ── Task ID extraction ────────────────────────────────────────────────────

  it("ignores PR with no task ID in title or branch", async () => {
    const body = makePRPayload({
      action: "opened",
      title: "Fix some random bug",
      branch: "hotfix-login",
    });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
    expect(findTaskById).not.toHaveBeenCalled();
  });

  // ── Status sync ───────────────────────────────────────────────────────────

  it("PR opened → finds task and sets In Progress + PR URL", async () => {
    const body = makePRPayload({ action: "opened", title: "LEVEL-42 work" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);

    expect(findTaskById).toHaveBeenCalledWith(
      expect.objectContaining({ NOTION_DATABASE_ID: TEST_ENV.NOTION_DATABASE_ID }),
      "LEVEL-42"
    );
    expect(updateTaskStatus).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_PAGE_ID,
      "In Progress"
    );
    expect(updatePullRequestUrl).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_PAGE_ID,
      "https://github.com/org/repo/pull/1"
    );
  });

  it("PR review_requested → sets In Review + PR URL", async () => {
    const body = makePRPayload({ action: "review_requested" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
    expect(updateTaskStatus).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_PAGE_ID,
      "In Review"
    );
    expect(updatePullRequestUrl).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_PAGE_ID,
      "https://github.com/org/repo/pull/1"
    );
  });

  it("PR closed+merged → sets Done + PR URL", async () => {
    const body = makePRPayload({ action: "closed", merged: true });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
    expect(updateTaskStatus).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_PAGE_ID,
      "Done"
    );
    expect(updatePullRequestUrl).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_PAGE_ID,
      "https://github.com/org/repo/pull/1"
    );
  });

  it("PR edited with title change → re-extracts task ID and sets In Progress", async () => {
    const body = makePRPayload({
      action: "edited",
      title: "LEVEL-42 updated title",
      changes: { title: { from: "old title" } },
    });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
    expect(findTaskById).toHaveBeenCalledWith(expect.anything(), "LEVEL-42");
    expect(updateTaskStatus).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_PAGE_ID,
      "In Progress"
    );
  });

  it("PR edited without title change → ignored (no Notion calls)", async () => {
    // `changes` has no `title` key — body was edited, not the title
    const body = makePRPayload({
      action: "edited",
      changes: { body: { from: "old description" } },
    });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
    expect(findTaskById).not.toHaveBeenCalled();
    expect(updateTaskStatus).not.toHaveBeenCalled();
  });

  it("falls back to branch name when title has no task ID", async () => {
    const body = makePRPayload({
      action: "opened",
      title: "No ID here",
      branch: "level-42-some-work",
    });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
    expect(findTaskById).toHaveBeenCalledWith(expect.anything(), "LEVEL-42");
    expect(updateTaskStatus).toHaveBeenCalledTimes(1);
  });

  // ── Notion error handling ─────────────────────────────────────────────────

  it("returns 200 when task is not found in Notion (log + ignore)", async () => {
    vi.mocked(findTaskById).mockResolvedValue(null);

    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
    expect(updateTaskStatus).not.toHaveBeenCalled();
    expect(updatePullRequestUrl).not.toHaveBeenCalled();
  });

  it("returns 500 when Notion query throws", async () => {
    vi.mocked(findTaskById).mockRejectedValue(new Error("network error"));

    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(500);
  });

  it("returns 500 when Notion update throws", async () => {
    vi.mocked(updateTaskStatus).mockRejectedValue(
      new Error("Notion update failed (500): Internal error")
    );

    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(500);
  });

  it("returns 500 when PR URL update throws", async () => {
    vi.mocked(updatePullRequestUrl).mockRejectedValue(
      new Error("Notion update failed (500): Internal error")
    );

    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(500);
  });
});
