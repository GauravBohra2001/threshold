import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';
import { getCurrentHouseholdId } from '@/lib/auth/household';
import { db } from '@/lib/data/supabase';

vi.mock('@/lib/data/supabase', () => ({
  db: vi.fn(),
}));

vi.mock('@/lib/auth/household', () => ({
  getCurrentHouseholdId: vi.fn(),
}));

const dbMock = vi.mocked(db);
const getCurrentHouseholdIdMock = vi.mocked(getCurrentHouseholdId);

/**
 * Builds a fake `cases` query surface for the city-number handler. The
 * update().eq().eq().select().maybeSingle() chain resolves to `updateResult`.
 */
function fakeCases(opts: {
  updateResult?: { data: unknown; error: unknown } | (() => Promise<unknown>);
}) {
  const maybeSingle = vi.fn(() =>
    typeof opts.updateResult === 'function'
      ? opts.updateResult()
      : Promise.resolve(opts.updateResult),
  );
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({ maybeSingle })),
      })),
    })),
  }));
  return { update, _maybeSingle: maybeSingle };
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/case/c1/city-number', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/case/[id]/city-number', () => {
  it('saves the number and sets status waiting on a valid number (Req 7.5)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const cases = fakeCases({
      updateResult: {
        data: { id: 'c1', status: 'waiting', city_case_id: '101004567890' },
        error: null,
      },
    });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(
      makeRequest({ city_case_id: '101004567890' }) as never,
      ctxFor('c1'),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      id: 'c1',
      status: 'waiting',
      city_case_id: '101004567890',
    });
    expect(cases.update).toHaveBeenCalledWith({
      city_case_id: '101004567890',
      status: 'waiting',
    });
  });

  it('trims surrounding whitespace before saving a valid number (Req 7.5)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const cases = fakeCases({
      updateResult: {
        data: { id: 'c1', status: 'waiting', city_case_id: 'ABC-42' },
        error: null,
      },
    });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(
      makeRequest({ city_case_id: '  ABC-42  ' }) as never,
      ctxFor('c1'),
    );

    expect(res.status).toBe(200);
    expect(cases.update).toHaveBeenCalledWith({
      city_case_id: 'ABC-42',
      status: 'waiting',
    });
  });

  it('rejects an empty number with a field error and never writes (Req 7.6)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const cases = fakeCases({ updateResult: { data: null, error: null } });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(
      makeRequest({ city_case_id: '' }) as never,
      ctxFor('c1'),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe('city_case_id');
    expect(typeof body.message).toBe('string');
    // The saved number is left unchanged: no update ran.
    expect(cases.update).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only number and never writes (Req 7.6)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const cases = fakeCases({ updateResult: { data: null, error: null } });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(
      makeRequest({ city_case_id: '   ' }) as never,
      ctxFor('c1'),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('city_case_id');
    expect(cases.update).not.toHaveBeenCalled();
  });

  it('rejects a number longer than 100 characters and never writes (Req 7.6)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const cases = fakeCases({ updateResult: { data: null, error: null } });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(
      makeRequest({ city_case_id: 'x'.repeat(101) }) as never,
      ctxFor('c1'),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('city_case_id');
    expect(cases.update).not.toHaveBeenCalled();
  });

  it('accepts a number exactly 100 characters long (boundary, Req 7.5)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const number = 'y'.repeat(100);
    const cases = fakeCases({
      updateResult: {
        data: { id: 'c1', status: 'waiting', city_case_id: number },
        error: null,
      },
    });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(
      makeRequest({ city_case_id: number }) as never,
      ctxFor('c1'),
    );

    expect(res.status).toBe(200);
    expect(cases.update).toHaveBeenCalledWith({
      city_case_id: number,
      status: 'waiting',
    });
  });

  it('returns 404 for a case not owned by the current household', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const cases = fakeCases({ updateResult: { data: null, error: null } });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(
      makeRequest({ city_case_id: '101004567890' }) as never,
      ctxFor('other-case'),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toMatch(/could not find/i);
  });

  it('returns 404 and never queries when there is no household cookie', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue(null);

    const res = await POST(
      makeRequest({ city_case_id: '101004567890' }) as never,
      ctxFor('c1'),
    );

    expect(res.status).toBe(404);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('returns a friendly 503 with no stack trace when the update errors (Req 22.2)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const cases = fakeCases({
      updateResult: { data: null, error: { message: 'connection refused' } },
    });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(
      makeRequest({ city_case_id: '101004567890' }) as never,
      ctxFor('c1'),
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.message).not.toMatch(/connection refused|stack|Error/i);
  });

  it('treats malformed JSON as an invalid number (Req 7.6)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const cases = fakeCases({ updateResult: { data: null, error: null } });
    dbMock.mockReturnValue(cases as never);

    const req = new Request('http://localhost/api/case/c1/city-number', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    const res = await POST(req as never, ctxFor('c1'));

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('city_case_id');
    expect(cases.update).not.toHaveBeenCalled();
  });
});
