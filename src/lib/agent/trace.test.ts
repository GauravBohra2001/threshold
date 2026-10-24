import { describe, expect, it } from "vitest";

import { appendStep, formatStep, formatTrace, type TraceStep, type TraceStepInput } from "./trace";

const sampleInput: TraceStepInput = {
  tool: "classify_photo",
  input_summary: "Looked at the photo of the sidewalk.",
  observation_summary: "Found a blocked sidewalk.",
  reasoning_note: "Need the barrier type before choosing a route.",
};

describe("appendStep", () => {
  it("assigns step 1 and an ISO timestamp to the first step", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const [step] = appendStep([], sampleInput, now);
    expect(step.step).toBe(1);
    expect(step.at).toBe("2026-01-01T00:00:00.000Z");
    expect(step.tool).toBe("classify_photo");
  });

  it("assigns strictly increasing 1-based indices across appends", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    let trace: TraceStep[] = [];
    trace = appendStep(trace, sampleInput, now);
    trace = appendStep(trace, { ...sampleInput, tool: "search_nearby_311" }, now);
    trace = appendStep(trace, { ...sampleInput, tool: "draft_filing" }, now);
    expect(trace.map((s) => s.step)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input trace", () => {
    const original: TraceStep[] = [];
    const result = appendStep(original, sampleInput, new Date());
    expect(original).toHaveLength(0);
    expect(result).toHaveLength(1);
  });

  it("bases the next index on the highest existing step, not array length", () => {
    const existing: TraceStep[] = [
      { ...sampleInput, step: 5, at: "2026-01-01T00:00:00.000Z" },
    ];
    const [, appended] = appendStep(existing, sampleInput, new Date());
    expect(appended.step).toBe(6);
  });
});

describe("formatStep / formatTrace", () => {
  it("renders a labeled plain-language block for a step", () => {
    const step: TraceStep = { ...sampleInput, step: 1, at: "2026-01-01T00:00:00.000Z" };
    const text = formatStep(step);
    expect(text).toContain("Step 1: classify_photo");
    expect(text).toContain("What I did: Looked at the photo of the sidewalk.");
    expect(text).toContain("What I found: Found a blocked sidewalk.");
    expect(text).toContain("Why: Need the barrier type before choosing a route.");
  });

  it("renders a placeholder for an empty trace", () => {
    expect(formatTrace([])).toBe("No steps yet.");
  });

  it("renders steps in step order regardless of array order", () => {
    const out: TraceStep[] = [
      { ...sampleInput, step: 2, at: "2026-01-01T00:00:00.000Z" },
      { ...sampleInput, step: 1, at: "2026-01-01T00:00:00.000Z" },
    ];
    const text = formatTrace(out);
    expect(text.indexOf("Step 1")).toBeLessThan(text.indexOf("Step 2"));
  });
});
