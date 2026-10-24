import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the arguments createClient is called with, and provide a fake
// storage/query surface we can assert against.
const uploadMock = vi.fn();
const createSignedUrlMock = vi.fn();
const fromStorageMock = vi.fn(() => ({
  upload: uploadMock,
  createSignedUrl: createSignedUrlMock,
}));
const fromTableMock = vi.fn(() => ({ select: vi.fn() }));
const createClientMock = vi.fn((..._args: unknown[]) => ({
  from: fromTableMock,
  storage: { from: fromStorageMock },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const URL_VALUE = 'https://example.supabase.co';
const SERVICE_KEY = 'service-role-secret-value';

async function loadModule() {
  // Fresh module each time so the cached client and env reads are re-evaluated.
  vi.resetModules();
  return import('./supabase');
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_VALUE;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe('getSupabase', () => {
  it('creates the client with the URL and service role key, server-only auth', async () => {
    const { getSupabase } = await loadModule();
    getSupabase();

    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClientMock.mock.calls[0] as unknown as [
      string,
      string,
      { auth: { autoRefreshToken: boolean; persistSession: boolean } },
    ];
    expect(url).toBe(URL_VALUE);
    expect(key).toBe(SERVICE_KEY);
    expect(options.auth.autoRefreshToken).toBe(false);
    expect(options.auth.persistSession).toBe(false);
  });

  it('caches the client across calls', async () => {
    const { getSupabase } = await loadModule();
    const a = getSupabase();
    const b = getSupabase();
    expect(a).toBe(b);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('throws a message without the secret value when the key is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { getSupabase } = await loadModule();
    try {
      getSupabase();
      throw new Error('expected getSupabase to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(message).not.toContain(SERVICE_KEY);
    }
  });
});

describe('db', () => {
  it('returns a query builder for the requested table', async () => {
    const { db } = await loadModule();
    db('households');
    expect(fromTableMock).toHaveBeenCalledWith('households');
  });
});

describe('uploadToVault', () => {
  it('uploads to the private vault bucket and returns the stored path', async () => {
    uploadMock.mockResolvedValue({ data: { path: 'home1/a.jpg' }, error: null });
    const { uploadToVault, VAULT_BUCKET } = await loadModule();

    const body = new Uint8Array([1, 2, 3]);
    const path = await uploadToVault('home1/a.jpg', body);

    expect(fromStorageMock).toHaveBeenCalledWith(VAULT_BUCKET);
    expect(uploadMock).toHaveBeenCalledWith('home1/a.jpg', body, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    expect(path).toBe('home1/a.jpg');
  });

  it('throws when the upload errors', async () => {
    uploadMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { uploadToVault } = await loadModule();
    await expect(uploadToVault('home1/a.jpg', new Uint8Array())).rejects.toThrow(
      /vault upload failed/,
    );
  });
});

describe('createSignedUrl', () => {
  it('defaults to a 300 second lifetime', async () => {
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: 'https://signed/url' },
      error: null,
    });
    const { createSignedUrl, VAULT_BUCKET } = await loadModule();

    const url = await createSignedUrl('home1/a.jpg');

    expect(fromStorageMock).toHaveBeenCalledWith(VAULT_BUCKET);
    expect(createSignedUrlMock).toHaveBeenCalledWith('home1/a.jpg', 300);
    expect(url).toBe('https://signed/url');
  });

  it('clamps requested lifetimes above 300 down to 300 (Req 3.8)', async () => {
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: 'https://signed/url' },
      error: null,
    });
    const { createSignedUrl } = await loadModule();

    await createSignedUrl('home1/a.jpg', 100_000);

    expect(createSignedUrlMock).toHaveBeenCalledWith('home1/a.jpg', 300);
  });

  it('clamps non-positive lifetimes up to at least 1 second', async () => {
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: 'https://signed/url' },
      error: null,
    });
    const { createSignedUrl } = await loadModule();

    await createSignedUrl('home1/a.jpg', 0);

    expect(createSignedUrlMock).toHaveBeenCalledWith('home1/a.jpg', 1);
  });

  it('throws when signing fails', async () => {
    createSignedUrlMock.mockResolvedValue({ data: null, error: { message: 'no' } });
    const { createSignedUrl } = await loadModule();
    await expect(createSignedUrl('home1/a.jpg')).rejects.toThrow(
      /could not create signed URL/,
    );
  });
});
