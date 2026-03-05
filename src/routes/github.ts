import { Hono } from "hono";
import { verifySignature, mapEventToStatus, PullRequestEvent } from "../lib/github";
import { extractTaskId } from "../lib/parser";
import { findTaskById, updateTaskStatus, NotionEnv } from "../lib/notion";

type Bindings = NotionEnv & {
  GITHUB_WEBHOOK_SECRET: string;
  LOG_LEVEL?: string;
};

const github = new Hono<{ Bindings: Bindings }>();

github.post("/webhooks/github", async (c) => {
  // ------------------------------------------------------------------
  // 1. Read raw body (required for HMAC verification)
  // ------------------------------------------------------------------
  const rawBody = await c.req.text();

  // ------------------------------------------------------------------
  // 2. Verify HMAC-SHA256 signature
  // ------------------------------------------------------------------
  const signature = c.req.header("X-Hub-Signature-256") ?? null;
  const valid = await verifySignature(
    c.env.GITHUB_WEBHOOK_SECRET,
    rawBody,
    signature
  );

  if (!valid) {
    console.warn("event=webhook result=unauthorized");
    return c.text("Unauthorized", 401);
  }

  // ------------------------------------------------------------------
  // 3. Only handle pull_request events
  // ------------------------------------------------------------------
  const eventType = c.req.header("X-GitHub-Event");
  if (eventType !== "pull_request") {
    return c.text("OK");
  }

  let payload: PullRequestEvent;
  try {
    payload = JSON.parse(rawBody) as PullRequestEvent;
  } catch {
    console.warn("event=pull_request result=invalid_json");
    return c.text("Bad Request", 400);
  }

  const { action, pull_request: pr, changes } = payload;

  // ------------------------------------------------------------------
  // 4. For `edited` events, only react when the title changed.
  //    GitHub fires `edited` for body/base-branch changes too; those
  //    don't affect the task-ID we derive from the title.
  // ------------------------------------------------------------------
  if (action === "edited" && !changes?.title) {
    return c.text("OK");
  }

  // ------------------------------------------------------------------
  // 5. Map action → Notion status (ignore unhandled actions)
  // ------------------------------------------------------------------
  const status = mapEventToStatus(action, pr.merged);
  if (!status) {
    return c.text("OK");
  }

  // ------------------------------------------------------------------
  // 6. Extract task ID from PR title, fall back to branch name
  // ------------------------------------------------------------------
  const taskId = extractTaskId(pr.title, pr.head.ref);
  if (!taskId) {
    console.log(
      `event=pull_request.${action} result=ignored reason=no_task_id title="${pr.title}" branch="${pr.head.ref}"`
    );
    return c.text("OK");
  }

  // ------------------------------------------------------------------
  // 7. Find the task in Notion
  // ------------------------------------------------------------------
  let page: Awaited<ReturnType<typeof findTaskById>>;
  try {
    page = await findTaskById(c.env, taskId);
  } catch (err) {
    console.error(
      `event=pull_request.${action} task=${taskId} result=notion_query_error error="${err}"`
    );
    return c.text("Internal Server Error", 500);
  }

  if (!page) {
    console.warn(
      `event=pull_request.${action} task=${taskId} status="${status}" result=not_found`
    );
    return c.text("OK");
  }

  // ------------------------------------------------------------------
  // 8. Update the task status in Notion
  // ------------------------------------------------------------------
  try {
    await updateTaskStatus(c.env, page.id, status);
  } catch (err) {
    console.error(
      `event=pull_request.${action} task=${taskId} status="${status}" result=notion_update_error error="${err}"`
    );
    return c.text("Internal Server Error", 500);
  }

  console.log(
    `event=pull_request.${action} task=${taskId} status="${status}" result=updated`
  );

  return c.text("OK");
});

export default github;
