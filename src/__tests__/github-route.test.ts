import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  MockInstance,
} from "vitest";
import app from "../index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-webhook-secret";

const TEST_ENV = {
  GITHUB_WEBHOOK_SECRET: TEST_SECRET,
  NOTION_API_KEY: "secret_test",
  NOTION_DATABASE_ID: "db-id-123",
};

async function sign(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

function makePRPayload(overrides: {
  action: string;
  title?: string;
  branch?: string;
  merged?: boolean;
}): string {
  return JSON.stringify({
    action: overrides.action,
    pull_request: {
      number: 1,
      title: overrides.title ?? "LEVEL-42 some work",
      merged: overrides.merged ?? false,
      head: { ref: overrides.branch ?? "feature/level-42-work" },
      user: { login: "dev" },
    },
    repository: { full_name: "org/repo" },
  });
}

async function sendWebhook(
  body: string,
  opts: {
    signature?: string | null;
    event?: string;
  } = {}
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

  return app.request(
    "/webhooks/github",
    { method: "POST", headers, body },
    TEST_ENV
  );
}

// ---------------------------------------------------------------------------
// Mock global fetch (Notion API calls)
// ---------------------------------------------------------------------------

const MOCK_PAGE_ID = "page-id-abc";

function mockNotionSuccess(): MockInstance {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    // Query endpoint → return one matching page
    if (url.includes("/query")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: MOCK_PAGE_ID,
              properties: {
                ID: {
                  type: "unique_id",
                  unique_id: { number: 42, prefix: "LEVEL" },
                },
                Status: { type: "status" },
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Update endpoint → 200 OK
    if (url.includes(`/pages/${MOCK_PAGE_ID}`)) {
      return new Response(JSON.stringify({ id: MOCK_PAGE_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /webhooks/github", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = mockNotionSuccess();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when signature header is missing", async () => {
    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body, { signature: null });
    expect(res.status).toBe(401);
  });

  it("returns 401 when signature is wrong", async () => {
    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body, {
      signature: "sha256=badbadbadbad",
    });
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
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores unhandled PR actions (e.g. labeled)", async () => {
    const body = makePRPayload({ action: "labeled" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores closed PR that was not merged", async () => {
    const body = makePRPayload({ action: "closed", merged: false });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
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
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── Status sync ───────────────────────────────────────────────────────────

  it("PR opened → queries Notion and sets In Progress", async () => {
    const body = makePRPayload({ action: "opened", title: "LEVEL-42 work" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);

    // Notion query called
    const queryCalls = (fetchSpy.mock.calls as [string, RequestInit][]).filter(
      ([url]) => url.includes("/query")
    );
    expect(queryCalls).toHaveLength(1);

    // Notion update called with correct status
    const updateCalls = (fetchSpy.mock.calls as [string, RequestInit][]).filter(
      ([url]) => url.includes(`/pages/${MOCK_PAGE_ID}`)
    );
    expect(updateCalls).toHaveLength(1);
    const updateBody = JSON.parse(updateCalls[0][1].body as string);
    expect(updateBody.properties.Status.status.name).toBe("In Progress");
  });

  it("PR review_requested → sets In Review", async () => {
    const body = makePRPayload({ action: "review_requested" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);

    const updateCalls = (fetchSpy.mock.calls as [string, RequestInit][]).filter(
      ([url]) => url.includes(`/pages/${MOCK_PAGE_ID}`)
    );
    const updateBody = JSON.parse(updateCalls[0][1].body as string);
    expect(updateBody.properties.Status.status.name).toBe("In Review");
  });

  it("PR closed+merged → sets Done", async () => {
    const body = makePRPayload({ action: "closed", merged: true });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);

    const updateCalls = (fetchSpy.mock.calls as [string, RequestInit][]).filter(
      ([url]) => url.includes(`/pages/${MOCK_PAGE_ID}`)
    );
    const updateBody = JSON.parse(updateCalls[0][1].body as string);
    expect(updateBody.properties.Status.status.name).toBe("Done");
  });

  it("falls back to branch name when title has no task ID", async () => {
    const body = makePRPayload({
      action: "opened",
      title: "No ID here",
      branch: "level-42-some-work",
    });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);

    const updateCalls = (fetchSpy.mock.calls as [string, RequestInit][]).filter(
      ([url]) => url.includes(`/pages/${MOCK_PAGE_ID}`)
    );
    expect(updateCalls).toHaveLength(1);
  });

  // ── Notion error handling ─────────────────────────────────────────────────

  it("returns 200 when task is not found in Notion (log + ignore)", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(200);
  });

  it("returns 500 when Notion query throws", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network error")
    );

    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(500);
  });

  it("returns 500 when Notion update throws", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/query")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: MOCK_PAGE_ID,
                properties: {
                  ID: {
                    type: "unique_id",
                    unique_id: { number: 42, prefix: "LEVEL" },
                  },
                  Status: { type: "status" },
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      // Update fails
      return new Response("Internal error", { status: 500 });
    });

    const body = makePRPayload({ action: "opened" });
    const res = await sendWebhook(body);
    expect(res.status).toBe(500);
  });
});
