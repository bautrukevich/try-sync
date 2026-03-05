/**
 * GitHub webhook utilities:
 *  - HMAC-SHA256 signature verification (X-Hub-Signature-256)
 *  - Pull request event type definitions
 */

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verifies the GitHub webhook signature.
 *
 * GitHub sends: X-Hub-Signature-256: sha256=<hex>
 * We recompute the HMAC over the raw request body using the shared secret
 * and compare with a constant-time equality check to prevent timing attacks.
 */
export async function verifySignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));

  const expected =
    "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return timingSafeEqual(signatureHeader, expected);
}

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// GitHub event types
// ---------------------------------------------------------------------------

export interface GitHubUser {
  login: string;
}

export interface GitHubRepository {
  full_name: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  merged: boolean;
  head: {
    ref: string; // branch name
  };
  user: GitHubUser;
}

/** Subset of the pull_request webhook payload we care about. */
export interface PullRequestEvent {
  action: string;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  /** Present on `edited` events; each key is the field that changed. */
  changes?: {
    title?: { from: string };
    body?: { from: string };
  };
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

export type NotionStatus = "In Progress" | "In Review" | "Done";

/**
 * Maps a GitHub pull_request event action to a Notion status.
 * Returns null for events we don't handle (should be silently ignored).
 */
export function mapEventToStatus(
  action: string,
  merged: boolean
): NotionStatus | null {
  if (action === "opened") return "In Progress";
  if (action === "edited") return "In Progress";
  if (action === "review_requested") return "In Review";
  if (action === "closed" && merged) return "Done";
  return null;
}
