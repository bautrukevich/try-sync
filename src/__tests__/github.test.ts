import { describe, it, expect } from "vitest";
import { mapEventToStatus } from "../lib/github";

// ---------------------------------------------------------------------------
// mapEventToStatus
// ---------------------------------------------------------------------------
describe("mapEventToStatus", () => {
  it("maps opened → In Progress", () => {
    expect(mapEventToStatus("opened", false)).toBe("In Progress");
  });

  it("maps edited → In Progress", () => {
    expect(mapEventToStatus("edited", false)).toBe("In Progress");
  });

  it("maps review_requested → In Review", () => {
    expect(mapEventToStatus("review_requested", false)).toBe("In Review");
  });

  it("maps closed+merged=true → Done", () => {
    expect(mapEventToStatus("closed", true)).toBe("Done");
  });

  it("returns null for closed+merged=false (not a merge, just a close)", () => {
    expect(mapEventToStatus("closed", false)).toBeNull();
  });

  it("returns null for unhandled actions", () => {
    expect(mapEventToStatus("labeled", false)).toBeNull();
    expect(mapEventToStatus("synchronize", false)).toBeNull();
    expect(mapEventToStatus("assigned", false)).toBeNull();
  });
});
