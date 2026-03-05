/**
 * Notion API client.
 *
 * Two operations:
 *  1. findTaskById  – query the database for a page whose Unique ID matches
 *  2. updateTaskStatus – PATCH the page's Status property
 */

import { parseTaskId } from "./parser";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";

export interface NotionEnv {
  NOTION_API_KEY: string;
  NOTION_DATABASE_ID: string;
}

interface NotionUniqueId {
  number: number;
  prefix: string | null;
}

export interface NotionPage {
  id: string;
  properties: {
    ID: {
      type: "unique_id";
      unique_id: NotionUniqueId;
    };
    Status: {
      type: "status" | "select";
      // We only write to this; reading shape varies by type
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

interface NotionQueryResponse {
  results: NotionPage[];
}

// ---------------------------------------------------------------------------
// findTaskById
// ---------------------------------------------------------------------------

/**
 * Searches the Notion database for the page whose Unique ID matches taskId
 * (e.g. "LEVEL-123").
 *
 * The Notion API only lets us filter unique_id by number, so we query by the
 * numeric part and then verify the prefix to avoid false positives when
 * multiple prefixes are used in the same database.
 *
 * Returns the matching page or null.
 */
export async function findTaskById(
  env: NotionEnv,
  taskId: string
): Promise<NotionPage | null> {
  const { prefix, number } = parseTaskId(taskId);

  const body = {
    filter: {
      property: "ID",
      unique_id: {
        equals: number,
      },
    },
  };

  const res = await fetch(
    `${NOTION_API_BASE}/databases/${env.NOTION_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion query failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as NotionQueryResponse;

  // Verify prefix to avoid false positives
  const matches = data.results.filter((page) => {
    const uid = page.properties?.ID?.unique_id;
    return (
      uid &&
      uid.number === number &&
      (uid.prefix ?? "").toUpperCase() === prefix.toUpperCase()
    );
  });

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
 * Works for both the native "status" property type and a "select" property.
 */
export async function updateTaskStatus(
  env: NotionEnv,
  pageId: string,
  status: string
): Promise<void> {
  const body = {
    properties: {
      Status: {
        status: {
          name: status,
        },
      },
    },
  };

  const res = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion update failed (${res.status}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notionHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}
