import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, session } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api()', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    session.setToken('old-token');
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('sends the bearer token and parses JSON', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api('/meta/nav-counts')).resolves.toEqual({ ok: true });
    const headers = fetchMock.mock.calls[0]![1]!.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer old-token');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { accessToken: 'new-token', expiresIn: 900, user: {} }))
      .mockResolvedValueOnce(json(200, { data: 1 }));
    await expect(api('/meta/nav-counts')).resolves.toEqual({ data: 1 });
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/auth/refresh');
    expect((fetchMock.mock.calls[2]![1]!.headers as Headers).get('Authorization')).toBe(
      'Bearer new-token',
    );
  });

  it('runs a single refresh for parallel 401s', async () => {
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshCalls++;
        return json(200, { accessToken: 'fresh', expiresIn: 900, user: {} });
      }
      const auth = (init?.headers as Headers).get('Authorization');
      return auth === 'Bearer fresh'
        ? json(200, { ok: url })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    });
    await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(refreshCalls).toBe(1);
  });

  it('reports a lost session when refresh fails', async () => {
    const lost = vi.fn();
    session.onLost(lost);
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } }))
      .mockResolvedValueOnce(
        json(401, { error: { code: 'UNAUTHENTICATED', message: 'no cookie' } }),
      );
    await expect(api('/meta/nav-counts')).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalledOnce();
  });

  it('throws ApiError with the server error body', async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, {
        error: { code: 'CONFLICT', message: 'Invoice exists', details: { constraint: 'x' } },
      }),
    );
    const err = await api('/x', { method: 'POST', json: {} }).catch((e: unknown) => e);
    expect(err).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Invoice exists',
      details: { constraint: 'x' },
    });
  });

  it('serialises query params and skips empty values', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await api('/shipments', { query: { page: 2, q: '', clientId: ['a', 'b'], status: undefined } });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/shipments?page=2&clientId=a&clientId=b');
  });
});
