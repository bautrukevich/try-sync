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
}

function makeClient(apiKey: string): Client {
  return new Client({ auth: apiKey });
}

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

  const response = await notion.dataSources.query({
    data_source_id: env.NOTION_DATA_SOURCE_ID,
    filter: {
      property: "ID",
      unique_id: {
        equals: number,
      },
    },
  });

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

  if (matches.length === 0) return null;

  if (matches.length > 1) {
    console.error(
      `task=${taskId} result=multiple_found count=${matches.length}`
    );
  }

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
}
