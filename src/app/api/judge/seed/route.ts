import { readFile } from "node:fs/promises";
import path from "node:path";

import { setHouseholdCookie } from "@/lib/auth/household";
import { db, uploadToVault } from "@/lib/data/supabase";
import { logServerError } from "@/lib/log";

/**
 * GET /api/judge/seed — idempotent Judge Mode demo seeding (Req 20.1–20.4).
 *
 * Invoked when the `/judge` screen loads. Seeds a single fictional household
 * "Maria" in Dorchester with caregiver "Ana" (phone from
 * `CAREGIVER_DEMO_NUMBER`), `is_demo=true`, and three sample vault items. All
 * database access happens here with the service-role Supabase client; the
 * browser never talks to Supabase directly (Req 22.4, 22.5).
 *
 * Idempotency (Req 20.3): seeding keys on the fixed demo invite code
 * (`DEMO_INVITE_CODE`). If the demo household already exists it is reused and
 * neither the household, the caregiver, nor the vault items are duplicated, so
 * repeat visits leave total counts unchanged.
 *
 * Honesty + safety: the caregiver demo number is only stored and displayed; no
 * outbound call is ever placed during seeding (Req 20.2). If
 * `CAREGIVER_DEMO_NUMBER` is unset/empty the household is still seeded, the
 * number is left null, and the response signals a plain-language fallback so
 * the screen can explain it and place no call (Req 20.4). On completion the
 * HTTP-only household cookie is set so the demo is immediately usable.
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4
 */

// This handler reads env + writes cookies and the data store at request time,
// so it runs dynamically under Cache Components without a route segment config.

/**
 * Fixed identity for the demo household. Seeding keys on this invite code so a
 * repeat visit reuses the same row instead of inserting a duplicate.
 */
export const DEMO_INVITE_CODE = "DEMOMARIA";

/** Fictional demo people. Clearly labeled as fictional on the screen. */
const DEMO_RESIDENT_NAME = "Maria";
const DEMO_CAREGIVER_NAME = "Ana";

/**
 * A fixed Dorchester location (neighborhood + Suffolk County FIPS 25025). Using
 * stable values keeps seeding deterministic and avoids a live geocoder call.
 */
const DEMO_HOUSEHOLD = {
  resident_name: DEMO_RESIDENT_NAME,
  address: "500 Columbia Rd, Dorchester, MA 02125",
  lat: 42.3188,
  lng: -71.0646,
  county_fips: "25025",
  neighborhood: "Dorchester",
  invite_code: DEMO_INVITE_CODE,
  is_demo: true,
  sim_offset_days: 0,
} as const;

/**
 * Three sample vault items (Req 20.1 "≥3"). `photo_path` is a placeholder — no
 * real upload is needed for the seed — but must stay non-null to satisfy the
 * schema. Each item carries a label and an accessibility_relevant flag.
 */
const DEMO_VAULT_ITEMS = [
  {
    kind: "equipment",
    label: "Wheelchair",
    ai_description: "A manual wheelchair used for daily mobility.",
    accessibility_relevant: true,
    photo_path: "demo/maria/wheelchair.jpg",
  },
  {
    kind: "equipment",
    label: "Oxygen concentrator",
    ai_description:
      "A portable oxygen concentrator that requires mains power to run.",
    accessibility_relevant: true,
    photo_path: "demo/maria/oxygen-concentrator.jpg",
  },
  {
    kind: "home_feature",
    label: "Front steps",
    ai_description:
      "Three concrete steps at the front entrance with no ramp.",
    accessibility_relevant: true,
    photo_path: "demo/maria/front-steps.jpg",
  },
] as const;

const SEED_FAILED_MESSAGE =
  "We couldn't load the demo data right now. Please try again in a moment.";

/** Reads the configured caregiver demo number, or null when unset/empty. */
function readCaregiverDemoNumber(): string | null {
  const value = process.env.CAREGIVER_DEMO_NUMBER;
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

/** Shape returned to the `/judge` screen. */
interface SeedView {
  household_id: string;
  resident_name: string;
  neighborhood: string;
  /** The caregiver demo number as stored, or null when not configured. */
  caregiver_phone: string | null;
  /** True when CAREGIVER_DEMO_NUMBER is unset/empty (Req 20.4). */
  caregiver_number_missing: boolean;
  vault_item_count: number;
  /** True on the first seed, false when the existing demo was reused. */
  created: boolean;
}

/**
 * Find the existing demo household (by the fixed invite code), if any.
 * Returns the row or null; throws when the data store is unreachable.
 */
async function findDemoHousehold(): Promise<{ id: string } | null> {
  const { data, error } = await db("households")
    .select("id")
    .eq("invite_code", DEMO_INVITE_CODE)
    .maybeSingle();

  if (error) {
    throw new Error("demo household lookup failed");
  }
  return (data as { id: string } | null) ?? null;
}

/** Count the demo household's vault items. Throws when the store is down. */
async function countVaultItems(householdId: string): Promise<number> {
  const { count, error } = await db("vault_items")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);

  if (error) {
    throw new Error("demo vault count failed");
  }
  return count ?? 0;
}


/**
 * If a demo image exists under public/<photo_path>, upload it to the vault
 * bucket at that same path so the seeded vault items show a real photo. Missing
 * files are skipped without failing the seed (Req 20: demo must not error).
 */
async function uploadDemoImageIfPresent(photoPath: string): Promise<void> {
  try {
    const abs = path.join(process.cwd(), "public", photoPath);
    const bytes = await readFile(abs);
    await uploadToVault(photoPath, bytes, "image/jpeg");
  } catch {
    // File not present (or unreadable) / already uploaded: skip silently.
  }
}

export async function GET(): Promise<Response> {
  const caregiverPhone = readCaregiverDemoNumber();

  try {
    const existing = await findDemoHousehold();

    // Idempotent path (Req 20.3): reuse the existing demo household and vault
    // items untouched so repeat visits do not change any counts.
    if (existing) {
      const vaultItemCount = await countVaultItems(existing.id);

      // The stored caregiver number is read back so the screen displays only
      // what is persisted; seeding never places a call (Req 20.2).
      const { data: hh } = await db("households")
        .select("caregiver_phone")
        .eq("id", existing.id)
        .maybeSingle();
      const storedPhone =
        (hh as { caregiver_phone: string | null } | null)?.caregiver_phone ??
        null;

      await setHouseholdCookie(existing.id);

      const view: SeedView = {
        household_id: existing.id,
        resident_name: DEMO_RESIDENT_NAME,
        neighborhood: DEMO_HOUSEHOLD.neighborhood,
        caregiver_phone: storedPhone,
        caregiver_number_missing: caregiverPhone === null,
        vault_item_count: vaultItemCount,
        created: false,
      };
      return Response.json(view, { status: 200 });
    }

    // First seed: insert the household. The caregiver demo number is only
    // stored (Req 20.2); when unset we persist null and the screen shows a
    // plain-language fallback (Req 20.4).
    const { data: inserted, error: insertError } = await db("households")
      .insert({
        ...DEMO_HOUSEHOLD,
        caregiver_name: DEMO_CAREGIVER_NAME,
        caregiver_phone: caregiverPhone,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      // A unique-violation here means a concurrent seed won the race; fall back
      // to reusing that row rather than failing the demo.
      const raced = await findDemoHousehold();
      if (!raced) {
        throw new Error("demo household insert failed");
      }
      const vaultItemCount = await countVaultItems(raced.id);
      await setHouseholdCookie(raced.id);
      const view: SeedView = {
        household_id: raced.id,
        resident_name: DEMO_RESIDENT_NAME,
        neighborhood: DEMO_HOUSEHOLD.neighborhood,
        caregiver_phone: caregiverPhone,
        caregiver_number_missing: caregiverPhone === null,
        vault_item_count: vaultItemCount,
        created: false,
      };
      return Response.json(view, { status: 200 });
    }

    const householdId = (inserted as { id: string }).id;

    // Insert the sample vault items for the newly created household.
    const { error: vaultError } = await db("vault_items").insert(
      DEMO_VAULT_ITEMS.map((item) => ({
        household_id: householdId,
        kind: item.kind,
        label: item.label,
        ai_description: item.ai_description,
        accessibility_relevant: item.accessibility_relevant,
        photo_path: item.photo_path,
      })),
    );

    if (vaultError) {
      throw new Error("demo vault insert failed");
    }

    // Best-effort: upload any demo images present under public/demo/maria/.
    await Promise.all(
      DEMO_VAULT_ITEMS.map((item) => uploadDemoImageIfPresent(item.photo_path)),
    );

    await setHouseholdCookie(householdId);

    const view: SeedView = {
      household_id: householdId,
      resident_name: DEMO_RESIDENT_NAME,
      neighborhood: DEMO_HOUSEHOLD.neighborhood,
      caregiver_phone: caregiverPhone,
      caregiver_number_missing: caregiverPhone === null,
      vault_item_count: DEMO_VAULT_ITEMS.length,
      created: true,
    };
    return Response.json(view, { status: 201 });
  } catch (error) {
    // Data store unavailable: friendly fallback, no stack trace.
    logServerError("GET /api/judge/seed", error);
    return Response.json({ message: SEED_FAILED_MESSAGE }, { status: 502 });
  }
}
