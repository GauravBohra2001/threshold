import { describe, it, expect } from "vitest";

import {
  ADDRESS_MAX,
  RESIDENT_NAME_MAX,
  generateInviteCode,
  validateHouseholdInput,
} from "@/lib/rules/household-input";

describe("validateHouseholdInput (Req 1.3)", () => {
  it("accepts a valid name and address, storing both trimmed", () => {
    const result = validateHouseholdInput({
      resident_name: "  Maria  ",
      address: "  123 Dorchester Ave, Boston MA  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.resident_name).toBe("Maria");
      expect(result.value.address).toBe("123 Dorchester Ave, Boston MA");
    }
  });

  it("rejects an empty resident name with a field-level error", () => {
    const result = validateHouseholdInput({ resident_name: "   ", address: "1 Main St" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("resident_name");
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  it("rejects a resident name longer than the max", () => {
    const result = validateHouseholdInput({
      resident_name: "a".repeat(RESIDENT_NAME_MAX + 1),
      address: "1 Main St",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("resident_name");
  });

  it("rejects a whitespace-only address", () => {
    const result = validateHouseholdInput({ resident_name: "Maria", address: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("address");
  });

  it("rejects an address longer than the max", () => {
    const result = validateHouseholdInput({
      resident_name: "Maria",
      address: "x".repeat(ADDRESS_MAX + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("address");
  });

  it("accepts an address exactly at the max length", () => {
    const result = validateHouseholdInput({
      resident_name: "Maria",
      address: "x".repeat(ADDRESS_MAX),
    });
    expect(result.ok).toBe(true);
  });

  it("treats missing fields as invalid rather than throwing", () => {
    expect(validateHouseholdInput(undefined).ok).toBe(false);
    expect(validateHouseholdInput({}).ok).toBe(false);
    expect(validateHouseholdInput({ resident_name: 5 as unknown as string }).ok).toBe(
      false,
    );
  });
});

describe("generateInviteCode", () => {
  it("produces an 8-character uppercase alphanumeric code", () => {
    const code = generateInviteCode(
      () => "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
    expect(code).toBe("A1B2C3D4");
    expect(code).toMatch(/^[0-9A-Z]{8}$/);
  });
});
