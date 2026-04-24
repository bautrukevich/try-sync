/**
 * GitHub webhook utilities:
 *  - Pull request event type definitions
 *  - Status mapping
 *
 * Signature verification is handled by @octokit/webhooks-methods.
 */

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
  html_url: string;
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

export type NotionStatus = "In Progress" | "In Review" | "Done" | "Canceled";

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
  if (action === "closed" && !merged) return "Canceled";
  return null;
}
