import { describe, expect, it } from "vitest";

import {
  clampNearbyCount,
  forbiddenAddressesFrom,
  formatNearbyAggregate,
  guardResponse,
  roundNearbyDistance,
  stripAddresses,
  stripCoordinateKeys,
} from "./privacy";

describe("forbiddenAddressesFrom", () => {
  it("collects non-empty full_address values and dedupes them", () => {
    const result = forbiddenAddressesFrom([
      { full_address: "12 Elm St, Dorchester" },
      { full_address: "12 Elm St, Dorchester" },
      { full_address: "99 Oak Ave" },
    ]);
    expect(result.sort()).toEqual(["12 Elm St, Dorchester", "99 Oak Ave"]);
  });

  it("ignores missing, null, and whitespace-only addresses", () => {
    const result = forbiddenAddressesFrom([
      { full_address: null },
      { full_address: "   " },
      {},
      { full_address: "  5 Pine Rd  " },
    ]);
    // Whitespace around a real value is trimmed; blanks are dropped entirely.
    expect(result).toEqual(["5 Pine Rd"]);
  });
});

describe("stripAddresses", () => {
  const forbidden = ["12 Elm St, Dorchester", "99 Oak Ave"];

  it("removes a string that exactly equals a forbidden address", () => {
    expect(stripAddresses("12 Elm St, Dorchester", forbidden)).toBeNull();
  });

  it("removes a string that merely contains a forbidden address", () => {
    expect(
      stripAddresses("Reported at 12 Elm St, Dorchester near the park", forbidden),
    ).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(stripAddresses("12 ELM ST, DORCHESTER", forbidden)).toBeNull();
  });

  it("keeps permitted strings untouched", () => {
    expect(stripAddresses("3 open reports within 50 meters", forbidden)).toBe(
      "3 open reports within 50 meters",
    );
  });

  it("walks nested objects and arrays, preserving permitted data", () => {
    const response = {
      summary: "3 open reports within 50 meters",
      items: [
        { note: "near 12 Elm St, Dorchester", open: true },
        { note: "fine", open: false },
      ],
      count: 3,
    };
    const guarded = stripAddresses(response, forbidden);
    expect(guarded).toEqual({
      summary: "3 open reports within 50 meters",
      items: [
        { note: null, open: true },
        { note: "fine", open: false },
      ],
      count: 3,
    });
    // JSON serialized for the browser contains no forbidden address.
    const serialized = JSON.stringify(guarded);
    for (const address of forbidden) {
      expect(serialized).not.toContain(address);
    }
  });

  it("does not mutate the input", () => {
    const input = { note: "12 Elm St, Dorchester" };
    stripAddresses(input, forbidden);
    expect(input.note).toBe("12 Elm St, Dorchester");
  });

  it("is a no-op when there are no forbidden strings", () => {
    const input = { note: "12 Elm St, Dorchester" };
    expect(stripAddresses(input, [])).toEqual(input);
  });
});

describe("stripCoordinateKeys", () => {
  it("drops coordinate keys at any depth while keeping aggregates", () => {
    const response = {
      open_count: 3,
      latitude: 42.31,
      longitude: -71.07,
      nested: { lat: 1, lng: 2, label: "keep" },
      items: [{ lat: 1, lng: 2, overdue_count: 1 }],
    };
    expect(stripCoordinateKeys(response)).toEqual({
      open_count: 3,
      nested: { label: "keep" },
      items: [{ overdue_count: 1 }],
    });
  });
});

describe("guardResponse", () => {
  it("strips both source addresses and coordinate keys in one pass", () => {
    const sourceRecords = [
      { full_address: "12 Elm St, Dorchester", latitude: 42.3, longitude: -71.0 },
    ];
    const response = {
      summary: formatNearbyAggregate(3, 48),
      firstReportNote: "right by 12 Elm St, Dorchester",
      latitude: 42.3,
      longitude: -71.0,
    };
    const guarded = guardResponse(response, sourceRecords);
    expect(guarded).toEqual({
      summary: "3 open reports within 50 meters",
      firstReportNote: null,
    });
    expect(JSON.stringify(guarded)).not.toContain("12 Elm St, Dorchester");
  });
});

describe("clampNearbyCount", () => {
  it("floors, and clamps to [0, 999]", () => {
    expect(clampNearbyCount(3.9)).toBe(3);
    expect(clampNearbyCount(-5)).toBe(0);
    expect(clampNearbyCount(1200)).toBe(999);
    expect(clampNearbyCount(Number.NaN)).toBe(0);
  });
});

describe("roundNearbyDistance", () => {
  it("rounds to the nearest 10 and clamps to [10, 500]", () => {
    expect(roundNearbyDistance(48)).toBe(50);
    expect(roundNearbyDistance(44)).toBe(40);
    expect(roundNearbyDistance(3)).toBe(10); // rounds to 0, clamped up to 10
    expect(roundNearbyDistance(0)).toBe(10);
    expect(roundNearbyDistance(999)).toBe(500);
    expect(roundNearbyDistance(Number.POSITIVE_INFINITY)).toBe(10);
  });
});

describe("formatNearbyAggregate", () => {
  it("produces the exact permitted sentence", () => {
    expect(formatNearbyAggregate(3, 48)).toBe("3 open reports within 50 meters");
    expect(formatNearbyAggregate(0, 12)).toBe("0 open reports within 10 meters");
  });

  it("uses the singular noun for exactly one report", () => {
    expect(formatNearbyAggregate(1, 20)).toBe("1 open report within 20 meters");
  });

  it("always emits a multiple of 10 within bounds and an integer count", () => {
    const sentence = formatNearbyAggregate(1500.7, 10000);
    expect(sentence).toBe("999 open reports within 500 meters");
  });
});
