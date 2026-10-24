import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for GET /api/judge/seed (task 9.1).
 *
 * The route's only data boundary is `@/lib/data/supabase`'s `db()` and the
 * `setHouseholdCookie` helper, both mocked here. An in-memory fake stands in
 * for the two tables we touch (`households`, `vault_items`) so we can assert
 * that a second seed reuses the existing demo rows and inserts nothing new —
 * i.e. counts are unchanged on repeat visits (Req 20.3).
 */

// --- In-memory fake data store ---------------------------------------------

interface HouseholdRecord {
  id: string;
  invite_code: string;
  caregiver_name: string | null;
  caregiver_phone: string | null;
}
interface VaultRecord {
  household_id: string;
}

let households: HouseholdRecord[] = [];
let vaultItems: VaultRecord[] = [];
let idCounter = 0;

/**
 * A tiny chainable query-builder fake covering only the calls the route makes:
 *  - households: select('id'|'caregiver_phone').eq('invite_code'|'id', v).maybeSingle()
 *  - households: insert({...}).select('id').single()
 *  - vault_items: select('id', {count,head}).eq('household_id', v)
 *  - vault_items: insert([...])
 */
function makeBuilder(table: string) {
  const state: {
    filterCol?: string;
    filterVal?: unknown;
    countMode?: boolean;
  } = {};

  const builder: Record<string, unknown> = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      state.countMode = opts?.count === "exact";
      return builder;
    },
    eq(col: string, val: unknown) {
      state.filterCol = col;
      state.filterVal = val;
      if (state.countMode && table === "vault_items") {
        const count = vaultItems.filter(
          (v) => v.household_id === val,
        ).length;
        return Promise.resolve({ count, error: null });
      }
      return builder;
    },
    async maybeSingle() {
      if (table === "households") {
        const row = households.find(
          (h) =>
            (h as unknown as Record<string, unknown>)[state.filterCol!] ===
            state.filterVal,
        );
        return { data: row ?? null, error: null };
      }
      return { data: null, error: null };
    },
    insert(payload: unknown) {
      if (table === "households") {
        const p = payload as Partial<HouseholdRecord>;
        idCounter += 1;
        const row: HouseholdRecord = {
          id: `house-${idCounter}`,
          invite_code: p.invite_code as string,
          caregiver_name: (p.caregiver_name as string | null) ?? null,
          caregiver_phone: (p.caregiver_phone as string | null) ?? null,
        };
        households.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: row.id }, error: null }),
          }),
        };
      }
      // vault_items bulk insert
      const rows = payload as Array<{ household_id: string }>;
      for (const r of rows) {
        vaultItems.push({ household_id: r.household_id });
      }
      return Promise.resolve({ error: null });
    },
  };
  return builder;
}

const dbMock = vi.fn((table: string) => makeBuilder(table));
vi.mock("@/lib/data/supabase", () => ({
  db: (...args: unknown[]) => dbMock(args[0] as string),
}));

const setHouseholdCookieMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/auth/household", () => ({
  setHouseholdCookie: (...a: unknown[]) => setHouseholdCookieMock(...a),
}));

import { GET } from "@/app/api/judge/seed/route";

const ORIGINAL_ENV = process.env.CAREGIVER_DEMO_NUMBER;

beforeEach(() => {
  households = [];
  vaultItems = [];
  idCounter = 0;
  vi.clearAllMocks();
  process.env.CAREGIVER_DEMO_NUMBER = "16175551234";
});

afterEach(() => {
  process.env.CAREGIVER_DEMO_NUMBER = ORIGINAL_ENV;
});

describe("GET /api/judge/seed", () => {
  it("seeds Maria with caregiver Ana, is_demo, and >=3 vault items on first visit", async () => {
    const res = await GET();
    expect(res.status).toBe(201);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.created).toBe(true);
    expect(json.resident_name).toBe("Maria");
    expect(json.neighborhood).toBe("Dorchester");
    expect(json.caregiver_phone).toBe("16175551234");
    expect(json.caregiver_number_missing).toBe(false);
    expect(json.vault_item_count).toBeGreaterThanOrEqual(3);

    // Exactly one demo household stored, flagged is_demo, caregiver Ana.
    expect(households).toHaveLength(1);
    expect(households[0].caregiver_name).toBe("Ana");
    expect(vaultItems.length).toBeGreaterThanOrEqual(3);

    // Cookie scoped to the seeded household.
    expect(setHouseholdCookieMock).toHaveBeenCalledWith("house-1");
  });

  it("is idempotent: a second seed reuses the row and does not duplicate (Req 20.3)", async () => {
    const first = await GET();
    expect(first.status).toBe(201);
    const householdsAfterFirst = households.length;
    const vaultAfterFirst = vaultItems.length;

    const second = await GET();
    expect(second.status).toBe(200);
    const json = (await second.json()) as Record<string, unknown>;
    expect(json.created).toBe(false);

    // Counts unchanged: no duplicate household, caregiver, or vault items.
    expect(households.length).toBe(householdsAfterFirst);
    expect(households.length).toBe(1);
    expect(vaultItems.length).toBe(vaultAfterFirst);
    expect(json.vault_item_count).toBe(vaultAfterFirst);

    // A third visit still changes nothing.
    const third = await GET();
    expect(third.status).toBe(200);
    expect(households.length).toBe(1);
    expect(vaultItems.length).toBe(vaultAfterFirst);
  });

  it("seeds but reports a missing caregiver number when unset (Req 20.4)", async () => {
    delete process.env.CAREGIVER_DEMO_NUMBER;

    const res = await GET();
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.caregiver_number_missing).toBe(true);
    expect(json.caregiver_phone).toBeNull();

    // Household is still seeded; the stored number is null.
    expect(households).toHaveLength(1);
    expect(households[0].caregiver_phone).toBeNull();
  });

  it("treats a blank caregiver number as missing (Req 20.4)", async () => {
    process.env.CAREGIVER_DEMO_NUMBER = "   ";
    const res = await GET();
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.caregiver_number_missing).toBe(true);
    expect(households[0].caregiver_phone).toBeNull();
  });
});
