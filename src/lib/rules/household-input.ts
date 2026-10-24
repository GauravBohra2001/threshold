/**
 * Pure household-input validation (no I/O).
 *
 * Validates the resident name and address for household creation so the rule
 * can be unit-tested without the route handler. Returns a field-level error
 * `{ field, message }` so the UI can render the message next to the offending
 * field and retain the entered values (Req 1.3).
 *
 * Requirements: 1.3
 */

/** Allowed resident-name length bounds (inclusive). */
export const RESIDENT_NAME_MIN = 1;
export const RESIDENT_NAME_MAX = 100;

/** Trimmed-address length bounds (inclusive). */
export const ADDRESS_MIN = 1;
export const ADDRESS_MAX = 200;

export interface HouseholdInput {
  resident_name: string;
  address: string;
}

export interface FieldError {
  field: "resident_name" | "address";
  message: string;
}

export type HouseholdInputResult =
  | { ok: true; value: { resident_name: string; address: string } }
  | { ok: false; error: FieldError };

/**
 * Validate and normalize household creation input. The resident name is
 * required at 1-100 characters; the address must be non-empty after trimming
 * and at most 200 characters. The address is stored trimmed. The resident name
 * is trimmed only for the length check but stored as entered (trimmed) so
 * leading/trailing spaces never count toward the limit yet display cleanly.
 */
export function validateHouseholdInput(
  input: Partial<HouseholdInput> | null | undefined,
): HouseholdInputResult {
  const rawName = typeof input?.resident_name === "string" ? input.resident_name : "";
  const rawAddress = typeof input?.address === "string" ? input.address : "";

  const name = rawName.trim();
  const address = rawAddress.trim();

  if (name.length < RESIDENT_NAME_MIN || name.length > RESIDENT_NAME_MAX) {
    return {
      ok: false,
      error: {
        field: "resident_name",
        message: `Please enter a name between ${RESIDENT_NAME_MIN} and ${RESIDENT_NAME_MAX} characters.`,
      },
    };
  }

  if (address.length < ADDRESS_MIN) {
    return {
      ok: false,
      error: {
        field: "address",
        message: "Please enter an address.",
      },
    };
  }

  if (address.length > ADDRESS_MAX) {
    return {
      ok: false,
      error: {
        field: "address",
        message: `Please enter an address up to ${ADDRESS_MAX} characters.`,
      },
    };
  }

  return { ok: true, value: { resident_name: name, address } };
}

/**
 * Generate a short, human-friendly invite code derived from a UUID. Uppercase
 * alphanumerics only (no ambiguous separators), e.g. "A1B2C3D4". Uniqueness is
 * ultimately enforced by the DB unique constraint on `invite_code`; the route
 * retries on a collision.
 */
export function generateInviteCode(
  randomUUID: () => string = () => crypto.randomUUID(),
): string {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}
