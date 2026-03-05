import { Hono } from "hono";
import { verify } from "@octokit/webhooks-methods";
import { mapEventToStatus, PullRequestEvent } from "../lib/github";
import { extractTaskId } from "../lib/parser";
import { findTaskById, updateTaskStatus, NotionEnv } from "../lib/notion";

type Bindings = NotionEnv & {
  GITHUB_WEBHOOK_SECRET: string;
};

const github = new Hono<{ Bindings: Bindings }>();

github.post("/webhooks/github", async (c) => {
  // ------------------------------------------------------------------
  // 1. Read raw body (required for HMAC verification)
  // ------------------------------------------------------------------
  const rawBody = await c.req.text();

  // ------------------------------------------------------------------
  // 2. Verify HMAC-SHA256 signature via @octokit/webhooks-methods
  // ------------------------------------------------------------------
  const signature = c.req.header("X-Hub-Signature-256");
  if (!signature) {
    console.warn("event=webhook result=unauthorized reason=missing_signature");
    return c.text("Unauthorized", 401);
  }

  let valid = false;
  try {
    valid = await verify(c.env.GITHUB_WEBHOOK_SECRET, rawBody, signature);
  } catch {
    // verify() throws on malformed input (e.g. missing sha256= prefix)
    valid = false;
  }

  if (!valid) {
    console.warn("event=webhook result=unauthorized reason=invalid_signature");
    return c.text("Unauthorized", 401);
  }

  // ------------------------------------------------------------------
  // 3. Only handle pull_request events
  // ------------------------------------------------------------------
  const eventType = c.req.header("X-GitHub-Event");
  console.log(`event=webhook_received type=${eventType ?? "unknown"} body_bytes=${rawBody.length}`);

  if (eventType !== "pull_request") {
    console.log(`event=webhook_ignored type=${eventType ?? "unknown"}`);
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

  console.log(
    `event=pull_request action=${action} pr=${pr.number} repo="${payload.repository.full_name}" user="${pr.user.login}" title="${pr.title}" branch="${pr.head.ref}" merged=${pr.merged}`
  );

  // ------------------------------------------------------------------
  // 4. For `edited` events, only react when the title changed.
  //    GitHub fires `edited` for body/base-branch changes too; those
  //    don't affect the task-ID we derive from the title.
  // ------------------------------------------------------------------
  if (action === "edited" && !changes?.title) {
    console.log(`event=pull_request.edited result=ignored reason=no_title_change changed_fields=${Object.keys(changes ?? {}).join(",") || "none"}`);
    return c.text("OK");
  }

  // ------------------------------------------------------------------
  // 5. Map action → Notion status (ignore unhandled actions)
  // ------------------------------------------------------------------
  const status = mapEventToStatus(action, pr.merged);
  if (!status) {
    console.log(`event=pull_request.${action} result=ignored reason=unhandled_action`);
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

  console.log(`event=pull_request.${action} task=${taskId} target_status="${status}"`);

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
    `event=pull_request.${action} task=${taskId} page_id=${page.id} status="${status}" result=updated`
  );

  return c.text("OK");
});

export default github;
