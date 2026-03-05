/**
 * Extracts a task ID (e.g. LEVEL-123) from a GitHub pull request title
 * or branch name.
 *
 * Matching priority:
 *  1. PR title  – looks for uppercase pattern directly: LEVEL-123 or [LEVEL-123]
 *  2. Branch name – same pattern, case-insensitive, then uppercased
 *
 * Returns null when no task ID is found (event should be ignored).
 */

const TASK_ID_RE = /[A-Z]+-\d+/;
const TASK_ID_RE_CASE_INSENSITIVE = /[A-Za-z]+-\d+/;

export function extractTaskId(
  prTitle: string,
  branchName?: string
): string | null {
  // 1. Try PR title first (already uppercase by convention)
  const titleMatch = prTitle.match(TASK_ID_RE);
  if (titleMatch) {
    return titleMatch[0];
  }

  // 2. Fall back to branch name (may be lowercase: level-123)
  if (branchName) {
    const branchMatch = branchName.match(TASK_ID_RE_CASE_INSENSITIVE);
    if (branchMatch) {
      return branchMatch[0].toUpperCase();
    }
  }

  return null;
}

/**
 * Splits a task ID into its prefix and numeric parts.
 * "LEVEL-123" → { prefix: "LEVEL", number: 123 }
 */
export function parseTaskId(taskId: string): { prefix: string; number: number } {
  const dashIdx = taskId.lastIndexOf("-");
  return {
    prefix: taskId.slice(0, dashIdx),
    number: parseInt(taskId.slice(dashIdx + 1), 10),
  };
}
