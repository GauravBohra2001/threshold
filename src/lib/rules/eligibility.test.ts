import { describe, expect, it } from "vitest";

import {
  assertCleanWording,
  containsForbiddenWording,
  findForbiddenWording,
  ForbiddenWordingError,
  FORBIDDEN_WORDING,
  REDACTION,
  sanitizeWording,
} from "./eligibility";

describe("FORBIDDEN_WORDING", () => {
  it("is the three promise phrases, lowercase", () => {
    expect([...FORBIDDEN_WORDING]).toEqual([
      "you will receive",
      "guaranteed",
      "approved",
    ]);
  });
});

describe("containsForbiddenWording", () => {
  it("is true for each phrase regardless of casing", () => {
    expect(containsForbiddenWording("You Will Receive $5000")).toBe(true);
    expect(containsForbiddenWording("this is GUARANTEED")).toBe(true);
    expect(containsForbiddenWording("your claim was APPROVED")).toBe(true);
  });

  it("matches phrases embedded mid-string", () => {
    expect(containsForbiddenWording("note: you will receive a letter")).toBe(true);
  });

  it("is false for honest eligibility wording", () => {
    expect(
      containsForbiddenWording(
        "You may be eligible. FEMA makes the final decision.",
      ),
    ).toBe(false);
  });

  it("is false and total for empty input", () => {
    expect(containsForbiddenWording("")).toBe(false);
  });
});

describe("findForbiddenWording", () => {
  it("returns matches in declaration order", () => {
    expect(
      findForbiddenWording("APPROVED and guaranteed, you will receive it"),
    ).toEqual(["you will receive", "guaranteed", "approved"]);
  });

  it("returns an empty array for clean text", () => {
    expect(findForbiddenWording("You may be eligible.")).toEqual([]);
  });
});

describe("assertCleanWording", () => {
  it("returns the text unchanged when clean", () => {
    const clean = "You may be eligible; FEMA makes the decision.";
    expect(assertCleanWording(clean)).toBe(clean);
  });

  it("throws ForbiddenWordingError carrying the phrases when dirty", () => {
    try {
      assertCleanWording("You will receive a guaranteed payment");
      throw new Error("expected assertCleanWording to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenWordingError);
      expect((err as ForbiddenWordingError).phrases).toEqual([
        "you will receive",
        "guaranteed",
      ]);
    }
  });
});

describe("sanitizeWording", () => {
  it("strips every forbidden phrase, preserving surrounding casing", () => {
    const out = sanitizeWording("You WILL receive $5000, Approved!");
    expect(out).toBe(`${REDACTION} $5000, ${REDACTION}!`);
  });

  it("produces output that is always clean", () => {
    const out = sanitizeWording("guaranteed approved you will receive");
    expect(containsForbiddenWording(out)).toBe(false);
  });

  it("leaves clean text untouched", () => {
    const clean = "You may be eligible.";
    expect(sanitizeWording(clean)).toBe(clean);
  });

  it("is total for empty input", () => {
    expect(sanitizeWording("")).toBe("");
  });
});
