/**
 * One-time cleanup: remove the 3 non-seeded TEST uploads from the demo
 * household (rows + storage files), keeping only the 3 seeded demo/maria items.
 * Uses the service-role key via `node --env-file=.env.local`; never reads
 * .env.local directly.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("[cleanup] Missing Supabase env. Run via node --env-file=.env.local");
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const HOUSEHOLD = "0c1ea127-ad38-44de-b588-f6c36ca82b1c";
const KEEP = [
  "demo/maria/wheelchair.jpg",
  "demo/maria/front-steps.jpg",
  "demo/maria/oxygen-concentrator.jpg",
];

// Find the test uploads: this household's vault items NOT in the keep list.
const { data: items, error: selErr } = await supabase
  .from("vault_items")
  .select("id, label, photo_path")
  .eq("household_id", HOUSEHOLD);
if (selErr) {
  console.error(`[cleanup] select failed: ${selErr.message}`);
  process.exit(1);
}
const toDelete = (items ?? []).filter((i) => !KEEP.includes(i.photo_path));
if (toDelete.length === 0) {
  console.log("[cleanup] Nothing to delete; only seeded items remain.");
  process.exit(0);
}
console.log("[cleanup] Deleting these test uploads:");
for (const i of toDelete) console.log(`  - ${i.label} (${i.photo_path})`);

// 1) Remove storage files.
const paths = toDelete.map((i) => i.photo_path);
const { error: rmErr } = await supabase.storage.from("vault").remove(paths);
if (rmErr) {
  console.error(`[cleanup] storage remove failed: ${rmErr.message}`);
  process.exit(1);
}
console.log(`[cleanup] Removed ${paths.length} storage file(s).`);

// 2) Remove DB rows.
const ids = toDelete.map((i) => i.id);
const { error: delErr } = await supabase.from("vault_items").delete().in("id", ids);
if (delErr) {
  console.error(`[cleanup] row delete failed: ${delErr.message}`);
  process.exit(1);
}
console.log(`[cleanup] Deleted ${ids.length} vault_items row(s).`);

// 3) Verify only the 3 seeded items remain.
const { data: after } = await supabase
  .from("vault_items")
  .select("photo_path")
  .eq("household_id", HOUSEHOLD);
console.log(`[cleanup] Remaining items (${after?.length ?? 0}):`);
for (const i of after ?? []) console.log(`  - ${i.photo_path}`);
console.log("[cleanup] DONE");
