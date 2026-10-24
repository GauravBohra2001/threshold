/**
 * One-time upload of the demo vault images to the private `vault` bucket at the
 * paths the judge seed uses (demo/maria/<name>), with upsert. Vercel may not
 * ship public/ files to the function runtime, so we upload them once from a
 * trusted machine. Secrets come from `node --env-file=.env.local`; this script
 * never opens .env.local itself.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("[upload] Missing Supabase env. Run via: node --env-file=.env.local");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const FILES = ["wheelchair.jpg", "front-steps.jpg", "oxygen-concentrator.jpg"];
let failed = false;

for (const name of FILES) {
  const localPath = path.join(process.cwd(), "public", "demo", "maria", name);
  const destPath = `demo/maria/${name}`;
  try {
    const bytes = await readFile(localPath);
    const { error } = await supabase.storage
      .from("vault")
      .upload(destPath, bytes, { contentType: "image/jpeg", upsert: true });
    if (error) {
      failed = true;
      console.error(`[upload] FAILED ${destPath}: ${error.message}`);
    } else {
      console.log(`[upload] OK ${destPath} (${bytes.byteLength} bytes)`);
    }
  } catch (err) {
    failed = true;
    console.error(`[upload] FAILED ${destPath}: ${err?.message ?? "read error"}`);
  }
}

if (failed) {
  console.error("[upload] One or more uploads failed.");
  process.exit(1);
}
console.log("[upload] All 3 demo images uploaded.");
