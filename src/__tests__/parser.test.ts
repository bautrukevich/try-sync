import { describe, it, expect } from "vitest";
import { extractTaskId, parseTaskId } from "../lib/parser";

describe("extractTaskId", () => {
  describe("from PR title", () => {
    it("extracts a bare task ID at the start of the title", () => {
      expect(extractTaskId("LEVEL-123 Implement audio block")).toBe("LEVEL-123");
    });

    it("extracts a task ID wrapped in brackets", () => {
      expect(extractTaskId("[LEVEL-123] Fix audio autoplay bug")).toBe(
        "LEVEL-123"
      );
    });

    it("extracts a task ID anywhere in the title", () => {
      expect(extractTaskId("Fix bug for LEVEL-42 in player")).toBe("LEVEL-42");
    });

    it("extracts multi-character prefix", () => {
      expect(extractTaskId("MYPROJECT-999 do something")).toBe("MYPROJECT-999");
    });

    it("returns null when title has no task ID", () => {
      expect(extractTaskId("Fix a random bug")).toBeNull();
    });

    it("returns null for lowercase-only title without branch", () => {
      expect(extractTaskId("fix some thing")).toBeNull();
    });
  });

  describe("branch name fallback", () => {
    it("extracts uppercase ID from a lowercase branch name", () => {
      expect(extractTaskId("Fix some bug", "level-123")).toBe("LEVEL-123");
    });

    it("extracts ID from branch with extra path segments", () => {
      expect(extractTaskId("No ID here", "feature/level-55-add-login")).toBe(
        "LEVEL-55"
      );
    });

    it("returns null when neither title nor branch has a task ID", () => {
      expect(extractTaskId("Fix a bug", "main")).toBeNull();
    });

    it("prefers title over branch name", () => {
      expect(extractTaskId("TITLE-10 something", "branch-20")).toBe("TITLE-10");
    });

    it("works when branchName is undefined", () => {
      expect(extractTaskId("no id here", undefined)).toBeNull();
    });
  });
});

describe("parseTaskId", () => {
  it("splits prefix and number correctly", () => {
    expect(parseTaskId("LEVEL-123")).toEqual({ prefix: "LEVEL", number: 123 });
  });

  it("handles multi-segment prefix", () => {
    expect(parseTaskId("MY-PROJECT-7")).toEqual({
      prefix: "MY-PROJECT",
      number: 7,
    });
  });
});
