/**
 * Real-database smoke test (npm run smoke).
 *
 * Runs the Judge-seed insert path against the REAL Supabase project to catch
 * schema/constraint bugs that the mocked unit tests cannot (e.g. the
 * households_caregiver_phone_check regression on E.164 numbers). It uses its
 * own clearly marked, throwaway test household — never the real demo household
 * (invite code DEMOMARIA) — and deletes only the rows it created.
 *
 * Secrets are provided by `node --env-file=.env.local`; this script never opens
 * or reads .env.local itself. Run with: npm run smoke
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "[smoke] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "Run with: node --env-file=.env.local (via npm run smoke).",
  );
  process.exit(1);
}

// A unique, obviously-fake test identity. Never the real demo (DEMOMARIA).
const stamp = Date.now();
const TEST_INVITE_CODE = `SMOKETEST${stamp}`;
// The exact E.164 number that triggered constraint 23514 before the fix.
const TEST_PHONE = "+16173960097";

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let householdId = null;
let failed = false;

async function main() {
  console.log("[smoke] Inserting a throwaway test household (E.164 phone)...");
  const { data: household, error: insertError } = await supabase
    .from("households")
    .insert({
      resident_name: "Smoke Test (delete me)",
      address: "1 Test Plaza, Dorchester, MA 02125",
      lat: 42.3188,
      lng: -71.0646,
      county_fips: "25025",
      neighborhood: "Dorchester",
      caregiver_name: "Smoke Caregiver",
      caregiver_phone: TEST_PHONE,
      invite_code: TEST_INVITE_CODE,
      is_demo: true,
      sim_offset_days: 0,
    })
    .select("id")
    .single();

  if (insertError || !household) {
    failed = true;
    console.error(
      `[smoke] Household insert FAILED: code=${insertError?.code} message=${insertError?.message}`,
    );
    return;
  }
  householdId = household.id;
  console.log(`[smoke] Household inserted: ${householdId}`);

  console.log("[smoke] Inserting 3 sample vault items...");
  const { error: vaultError } = await supabase.from("vault_items").insert([
    {
      household_id: householdId,
      kind: "equipment",
      label: "Wheelchair",
      ai_description: "A manual wheelchair.",
      accessibility_relevant: true,
      photo_path: `smoke/${stamp}/wheelchair.jpg`,
    },
    {
      household_id: householdId,
      kind: "equipment",
      label: "Oxygen concentrator",
      ai_description: "A portable oxygen concentrator.",
      accessibility_relevant: true,
      photo_path: `smoke/${stamp}/oxygen.jpg`,
    },
    {
      household_id: householdId,
      kind: "home_feature",
      label: "Front steps",
      ai_description: "Three concrete steps, no ramp.",
      accessibility_relevant: true,
      photo_path: `smoke/${stamp}/steps.jpg`,
    },
  ]);

  if (vaultError) {
    failed = true;
    console.error(
      `[smoke] Vault insert FAILED: code=${vaultError.code} message=${vaultError.message}`,
    );
    return;
  }

  const { count, error: countError } = await supabase
    .from("vault_items")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);

  if (countError) {
    failed = true;
    console.error(
      `[smoke] Vault count FAILED: code=${countError.code} message=${countError.message}`,
    );
    return;
  }

  if ((count ?? 0) < 3) {
    failed = true;
    console.error(`[smoke] Expected >= 3 vault items, found ${count}.`);
    return;
  }

  console.log(`[smoke] Seed succeeded: household + ${count} vault items.`);
}

async function cleanup() {
  if (!householdId) return;
  // vault_items cascade-delete with the household, but delete explicitly first
  // so we never leave rows behind if the FK cascade is ever changed.
  await supabase.from("vault_items").delete().eq("household_id", householdId);
  const { error } = await supabase
    .from("households")
    .delete()
    .eq("id", householdId);
  if (error) {
    console.error(
      `[smoke] Cleanup FAILED for ${householdId}: code=${error.code} message=${error.message}`,
    );
    failed = true;
  } else {
    console.log(`[smoke] Cleaned up test household ${householdId}.`);
  }
}

try {
  await main();
} finally {
  await cleanup();
}

if (failed) {
  console.error("[smoke] FAILED");
  process.exit(1);
}
console.log("[smoke] PASSED");
