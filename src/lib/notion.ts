/**
 * Notion API client built on top of the official @notionhq/client SDK.
 *
 * Two operations:
 *  1. findTaskById    – query the database for a page whose Unique ID matches
 *  2. updateTaskStatus – update the page's Status property
 */

import { Client, isFullPage } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { parseTaskId } from "./parser";

export interface NotionEnv {
  NOTION_API_KEY: string;
  NOTION_DATABASE_ID: string;
  NOTION_DATA_SOURCE_ID: string;
  /** Set to "debug" to enable verbose response logging. */
  LOG_LEVEL?: string;
}

function makeClient(apiKey: string): Client {
  // In Cloudflare Workers, `fetch` must be called with the correct `this`
  // receiver. Pass a bound reference so the SDK doesn't lose the binding
  // when it stores and invokes it as a callback.
  return new Client({ auth: apiKey, fetch: fetch.bind(globalThis) });
}

const isDebug = (env: NotionEnv) => env.LOG_LEVEL === "debug";

// ---------------------------------------------------------------------------
// findTaskById
// ---------------------------------------------------------------------------

/**
 * Searches the Notion database for a page whose Unique ID matches taskId
 * (e.g. "LEVEL-123").
 *
 * The SDK's unique_id filter only accepts the numeric part, so we query by
 * number and then verify the prefix to avoid false positives when multiple
 * prefixes exist in the same database.
 *
 * Returns the matching page or null.
 */
export async function findTaskById(
  env: NotionEnv,
  taskId: string
): Promise<PageObjectResponse | null> {
  const { prefix, number } = parseTaskId(taskId);
  const notion = makeClient(env.NOTION_API_KEY);

  const filter = {
    property: "ID",
    unique_id: { equals: number },
  };

  console.log(
    `notion=query task=${taskId} data_source_id=${env.NOTION_DATA_SOURCE_ID} filter_property=ID filter_number=${number}`
  );

  const response = await notion.dataSources.query({
    data_source_id: env.NOTION_DATA_SOURCE_ID,
    filter,
  });

  console.log(
    `notion=query_response task=${taskId} total_results=${response.results.length} has_more=${response.has_more}`
  );

  if (isDebug(env)) {
    const summary = response.results.map((r) => {
      if (!isFullPage(r)) return { id: r.id, object: r.object, full: false };
      const idProp = r.properties["ID"];
      const uid =
        idProp?.type === "unique_id"
          ? `${idProp.unique_id.prefix ?? ""}-${idProp.unique_id.number}`
          : "n/a";
      return { id: r.id, uid };
    });
    console.log(
      `notion=query_response_debug task=${taskId} results=${JSON.stringify(summary)}`
    );
  }

  const matches = response.results.filter((page) => {
    if (!isFullPage(page)) return false;

    const idProp = page.properties["ID"];
    if (!idProp || idProp.type !== "unique_id") return false;

    const uid = idProp.unique_id;
    return (
      uid.number === number &&
      (uid.prefix ?? "").toUpperCase() === prefix.toUpperCase()
    );
  }) as PageObjectResponse[];

  if (matches.length === 0) {
    console.log(
      `notion=query_no_match task=${taskId} prefix_expected=${prefix} total_results=${response.results.length}`
    );
    return null;
  }

  if (matches.length > 1) {
    console.error(
      `notion=query_multiple_matches task=${taskId} count=${matches.length}`
    );
  }

  console.log(
    `notion=query_match task=${taskId} page_id=${matches[0].id}`
  );

  return matches[0];
}

// ---------------------------------------------------------------------------
// updateTaskStatus
// ---------------------------------------------------------------------------

/**
 * Updates the Status property of a Notion page.
 */
export async function updateTaskStatus(
  env: NotionEnv,
  pageId: string,
  status: string
): Promise<void> {
  const notion = makeClient(env.NOTION_API_KEY);

  console.log(`notion=update page_id=${pageId} status="${status}"`);

  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: {
        status: {
          name: status,
        },
      },
    },
  });

  console.log(`notion=update_success page_id=${pageId} status="${status}"`);
}
