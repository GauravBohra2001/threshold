import { describe, it, expect } from "vitest";
import { rightsLibrary } from "./library";

const EXPECTED_IDS = [
  "shelter-no-exclusion",
  "shelter-service-animal",
  "shelter-communication",
  "boston-ada-grievance",
  "boston-curb-ramp",
  "fema-accessibility-repairs",
  "fema-medical-equipment",
  "fema-late-registration",
  "fema-helpline",
  "fema-appeal",
];

describe("rights library", () => {
  it("contains all 10 expected entries", () => {
    expect(rightsLibrary).toHaveLength(10);
    expect(rightsLibrary.map((r) => r.id)).toEqual(EXPECTED_IDS);
  });

  it("every entry has a non-empty source_url and plain_statement", () => {
    for (const entry of rightsLibrary) {
      expect(entry.source_url.trim().length).toBeGreaterThan(0);
      expect(entry.source_url).toMatch(/^https:\/\//);
      expect(entry.plain_statement.trim().length).toBeGreaterThan(0);
      expect(entry.applies_when.trim().length).toBeGreaterThan(0);
    }
  });
});
