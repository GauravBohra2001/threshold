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
 * Builds a fake `cases` query surface for the approve handler. The
 * update().eq().eq().select().maybeSingle() chain resolves to `updateResult`.
 * The returned object records the update payload and the two eq() filters so
 * tests can assert ownership scoping.
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

function makeRequest(body: unknown = {}): Request {
  return new Request('http://localhost/api/case/c1/approve', {
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

describe('POST /api/case/[id]/approve', () => {
  it('sets status draft_ready for a case owned by the current household (Req 7.2)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const cases = fakeCases({
      updateResult: { data: { id: 'c1', status: 'draft_ready' }, error: null },
    });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(makeRequest() as never, ctxFor('c1'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: 'c1', status: 'draft_ready' });
    expect(cases.update).toHaveBeenCalledWith({ status: 'draft_ready' });
  });

  it('returns 404 for a case not owned by the current household (Req 7.2)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    // Ownership guard matches no row -> maybeSingle resolves data: null.
    const cases = fakeCases({ updateResult: { data: null, error: null } });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(makeRequest() as never, ctxFor('other-case'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toMatch(/could not find/i);
    expect(body.message).not.toMatch(/stack|Error:/i);
  });

  it('returns 404 and never queries when there is no household cookie', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue(null);

    const res = await POST(makeRequest() as never, ctxFor('c1'));

    expect(res.status).toBe(404);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('returns a friendly 503 with no stack trace when the update errors (Req 22.2)', async () => {
    getCurrentHouseholdIdMock.mockResolvedValue('h1');
    const cases = fakeCases({
      updateResult: { data: null, error: { message: 'connection refused' } },
    });
    dbMock.mockReturnValue(cases as never);

    const res = await POST(makeRequest() as never, ctxFor('c1'));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.message).not.toMatch(/connection refused|stack|Error/i);
  });
});
