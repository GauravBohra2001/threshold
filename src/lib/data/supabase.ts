/**
 * Server-only Supabase client.
 *
 * This module reads SUPABASE_SERVICE_ROLE_KEY and must never be imported into
 * browser/client code. The browser never talks to Supabase directly; all
 * database and storage access happens here, inside Next.js server routes
 * (Requirements 1.6, 3.3, 22.4, 22.5). Photos are served only through
 * short-lived signed URLs (Requirement 3.8).
 */
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

// Hard client-side guard. If this module is ever bundled into and executed in
// the browser, fail loudly rather than leak the service role key. The secret
// is read only below, in server code.
if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/data/supabase.ts is server-only and must not be imported in the browser.',
  );
}

/** Name of the private Storage bucket that holds vault photos. */
export const VAULT_BUCKET = 'vault';

/** Default signed-URL lifetime in seconds. Capped at 300s per Requirement 3.8. */
export const SIGNED_URL_TTL_SECONDS = 300;

let cachedClient: SupabaseClient | null = null;

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    // Never include the secret value itself in the error.
    throw new Error(`Missing required server environment variable: ${name}`);
  }
  return value;
}

/**
 * Returns a cached Supabase client created with the service role key.
 *
 * Uses NEXT_PUBLIC_SUPABASE_URL (safe to expose) and the server-only
 * SUPABASE_SERVICE_ROLE_KEY. The service role bypasses RLS, so this client
 * must only ever run in server code.
 */
export function getSupabase(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

  cachedClient = createClient(url, serviceRoleKey, {
    auth: {
      // Server-only client: no browser session, no token refresh.
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}

/**
 * Database accessor. Returns a query builder for the given table using the
 * service-role client, e.g. `db('households').select('*')`.
 */
export function db(table: string) {
  return getSupabase().from(table);
}

/**
 * Uploads a resized photo to the private `vault` bucket.
 *
 * @param path   Object path within the bucket, e.g. `<householdId>/<id>.jpg`.
 * @param body   The image bytes (Blob/ArrayBuffer/Uint8Array/Buffer).
 * @param contentType  MIME type, defaults to image/jpeg (we always resize to JPEG).
 * @returns The stored object path on success.
 * @throws when the upload fails; callers translate this into a plain-language
 *         fallback and create no vault_item row (Requirement 3.4).
 */
export async function uploadToVault(
  path: string,
  body: Blob | ArrayBuffer | Uint8Array | Buffer,
  contentType = 'image/jpeg',
): Promise<string> {
  const { data, error } = await getSupabase()
    .storage.from(VAULT_BUCKET)
    .upload(path, body, { contentType, upsert: false });

  if (error || !data) {
    throw new Error(`vault upload failed for path "${path}"`);
  }

  return data.path;
}

/**
 * Creates a short-lived signed URL for a private vault object.
 *
 * The expiry is clamped to at most 300 seconds so a stored photo is never
 * reachable longer than Requirement 3.8 allows.
 *
 * @param path             Object path within the `vault` bucket.
 * @param expiresInSeconds Requested lifetime; clamped to 1..300.
 * @returns The signed URL string.
 * @throws when signing fails.
 */
export async function createSignedUrl(
  path: string,
  expiresInSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const ttl = Math.max(
    1,
    Math.min(SIGNED_URL_TTL_SECONDS, Math.floor(expiresInSeconds)),
  );

  const { data, error } = await getSupabase()
    .storage.from(VAULT_BUCKET)
    .createSignedUrl(path, ttl);

  if (error || !data?.signedUrl) {
    throw new Error(`could not create signed URL for path "${path}"`);
  }

  return data.signedUrl;
}
