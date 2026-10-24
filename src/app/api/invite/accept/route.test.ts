import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';
import { db } from '@/lib/data/supabase';

vi.mock('@/lib/data/supabase', () => ({
  db: vi.fn(),
}));

const dbMock = vi.mocked(db);

/**
 * Builds a fake households query surface. `lookupResult` is returned by the
 * select().eq().maybeSingle() chain; `updateResult` by the
 * update().eq().is().select().maybeSingle() chain.
 */
function fakeHouseholds(opts: {
  lookupResult?: { data: unknown; error: unknown } | (() => Promise<unknown>);
  updateResult?: { data: unknown; error: unknown } | (() => Promise<unknown>);
}) {
  const lookupMaybeSingle = vi.fn(() =>
    typeof opts.lookupResult === 'function'
      ? opts.lookupResult()
      : Promise.resolve(opts.lookupResult),
  );
  const updateMaybeSingle = vi.fn(() =>
    typeof opts.updateResult === 'function'
      ? opts.updateResult()
      : Promise.resolve(opts.updateResult),
  );

  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle: lookupMaybeSingle })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          select: vi.fn(() => ({ maybeSingle: updateMaybeSingle })),
        })),
      })),
    })),
    _lookupMaybeSingle: lookupMaybeSingle,
    _updateMaybeSingle: updateMaybeSingle,
  };
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/invite/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/invite/accept', () => {
  it('attaches the caregiver on a valid, unused invite (Req 2.2)', async () => {
    const households = fakeHouseholds({
      lookupResult: {
        data: { id: 'h1', caregiver_name: null, caregiver_phone: null },
        error: null,
      },
      updateResult: { data: { id: 'h1' }, error: null },
    });
    dbMock.mockReturnValue(households as never);

    const res = await POST(
      makeRequest({
        code: 'ABC123',
        caregiver_name: 'Ana',
        caregiver_phone: '6175551234',
      }) as never,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(households.update).toHaveBeenCalledWith({
      caregiver_name: 'Ana',
      caregiver_phone: '6175551234',
    });
  });

  it('rejects an empty caregiver name and attaches nothing (Req 2.3)', async () => {
    const res = await POST(
      makeRequest({ code: 'ABC123', caregiver_name: '', caregiver_phone: '6175551234' }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe('caregiver_name');
    expect(typeof body.message).toBe('string');
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('rejects a name longer than 100 characters (Req 2.3)', async () => {
    const res = await POST(
      makeRequest({
        code: 'ABC123',
        caregiver_name: 'x'.repeat(101),
        caregiver_phone: '6175551234',
      }) as never,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('caregiver_name');
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('rejects a phone that is not 10-15 digits and attaches nothing (Req 2.3)', async () => {
    const res = await POST(
      makeRequest({ code: 'ABC123', caregiver_name: 'Ana', caregiver_phone: '12345' }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe('caregiver_phone');
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('rejects a phone with non-digit characters (Req 2.3)', async () => {
    const res = await POST(
      makeRequest({
        code: 'ABC123',
        caregiver_name: 'Ana',
        caregiver_phone: '617-555-1234',
      }) as never,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('caregiver_phone');
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('returns a plain-language 404 when the invite code matches no household (Req 2.4)', async () => {
    const households = fakeHouseholds({
      lookupResult: { data: null, error: null },
    });
    dbMock.mockReturnValue(households as never);

    const res = await POST(
      makeRequest({ code: 'NOPE', caregiver_name: 'Ana', caregiver_phone: '6175551234' }) as never,
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toMatch(/not valid/i);
    expect(body.message).not.toMatch(/stack|error:/i);
    expect(households.update).not.toHaveBeenCalled();
  });

  it('treats a missing invite code as not valid and attaches nothing (Req 2.4)', async () => {
    const res = await POST(
      makeRequest({ caregiver_name: 'Ana', caregiver_phone: '6175551234' }) as never,
    );

    expect(res.status).toBe(404);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('does not attach a second caregiver when one already exists (Req 2.5)', async () => {
    const households = fakeHouseholds({
      lookupResult: {
        data: { id: 'h1', caregiver_name: 'Existing', caregiver_phone: '6175550000' },
        error: null,
      },
    });
    dbMock.mockReturnValue(households as never);

    const res = await POST(
      makeRequest({ code: 'ABC123', caregiver_name: 'Ana', caregiver_phone: '6175551234' }) as never,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toMatch(/already been used/i);
    expect(households.update).not.toHaveBeenCalled();
  });

  it('returns 409 when the guarded update matches no row (concurrent accept) (Req 2.5)', async () => {
    const households = fakeHouseholds({
      lookupResult: {
        data: { id: 'h1', caregiver_name: null, caregiver_phone: null },
        error: null,
      },
      updateResult: { data: null, error: null },
    });
    dbMock.mockReturnValue(households as never);

    const res = await POST(
      makeRequest({ code: 'ABC123', caregiver_name: 'Ana', caregiver_phone: '6175551234' }) as never,
    );

    expect(res.status).toBe(409);
  });

  it('returns a friendly 503 with no stack trace when the lookup errors (Req 2.6)', async () => {
    const households = fakeHouseholds({
      lookupResult: { data: null, error: { message: 'connection refused' } },
    });
    dbMock.mockReturnValue(households as never);

    const res = await POST(
      makeRequest({ code: 'ABC123', caregiver_name: 'Ana', caregiver_phone: '6175551234' }) as never,
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.message).toMatch(/could not complete this invite/i);
    expect(body.message).not.toMatch(/connection refused|stack|Error/i);
    expect(households.update).not.toHaveBeenCalled();
  });

  it('returns a friendly 503 when the data store throws (Req 2.6)', async () => {
    const households = fakeHouseholds({
      lookupResult: () => Promise.reject(new Error('network down')),
    });
    dbMock.mockReturnValue(households as never);

    const res = await POST(
      makeRequest({ code: 'ABC123', caregiver_name: 'Ana', caregiver_phone: '6175551234' }) as never,
    );

    expect(res.status).toBe(503);
    expect((await res.json()).message).not.toMatch(/network down/i);
  });

  it('treats malformed JSON as an invalid invite (Req 2.4)', async () => {
    const req = new Request('http://localhost/api/invite/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    const res = await POST(req as never);

    expect(res.status).toBe(404);
    expect(dbMock).not.toHaveBeenCalled();
  });
});
