import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { fetchSocrataAll } from './socrata';

interface FakeResponseInit {
  status?: number;
  body?: string;
}

function jsonResponse(rows: unknown[], init: FakeResponseInit = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => rows,
    text: async () => init.body ?? JSON.stringify(rows),
  } as unknown as Response;
}

afterEach(() => {
  mock.restoreAll();
});

test('fetchSocrataAll — a single short page returns all its rows and stops after one request', async () => {
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (input: URL | string) => {
    calls.push(String(input));
    return jsonResponse([{ a: 1 }, { a: 2 }]); // 2 < pageSize ⇒ last page
  });

  const rows = await fetchSocrataAll<{ a: number }>({
    domain: 'data.example.gov.uk',
    dataset: 'abcd-1234',
    pageSize: 5,
  });

  assert.deepEqual(rows, [{ a: 1 }, { a: 2 }]);
  assert.equal(calls.length, 1);

  const url = new URL(calls[0] ?? '');
  assert.equal(url.origin + url.pathname, 'https://data.example.gov.uk/resource/abcd-1234.json');
  assert.equal(url.searchParams.get('$limit'), '5');
  assert.equal(url.searchParams.get('$offset'), '0');
  assert.equal(url.searchParams.get('$order'), ':id');
});

test('fetchSocrataAll — follows pagination: full pages then a short page, concatenated in order', async () => {
  const pageSize = 3;
  // pages: [0,1,2] full, [3,4,5] full, [6] short ⇒ 3 requests, offsets 0/3/6
  const all = [0, 1, 2, 3, 4, 5, 6].map((n) => ({ n }));
  const offsets: string[] = [];
  mock.method(globalThis, 'fetch', async (input: URL | string) => {
    const u = new URL(String(input));
    const offset = Number(u.searchParams.get('$offset'));
    offsets.push(u.searchParams.get('$offset') ?? '?');
    return jsonResponse(all.slice(offset, offset + pageSize));
  });

  const rows = await fetchSocrataAll<{ n: number }>({ domain: 'd.example', dataset: 'wxyz-9876', pageSize });

  assert.deepEqual(rows, all);
  assert.deepEqual(offsets, ['0', '3', '6']);
});

test('fetchSocrataAll — an exact-multiple result still terminates (next page is empty)', async () => {
  const pageSize = 2;
  const all = [{ n: 1 }, { n: 2 }]; // exactly one full page; the follow-up page is empty
  let calls = 0;
  mock.method(globalThis, 'fetch', async (input: URL | string) => {
    calls += 1;
    const offset = Number(new URL(String(input)).searchParams.get('$offset'));
    return jsonResponse(all.slice(offset, offset + pageSize));
  });

  const rows = await fetchSocrataAll({ domain: 'd.example', dataset: 'aaaa-bbbb', pageSize });
  assert.deepEqual(rows, all);
  assert.equal(calls, 2); // first page full ⇒ asks again; second page empty ⇒ stop
});

test('fetchSocrataAll — rejects on a non-2xx response, surfacing the dataset id and status', async () => {
  mock.method(globalThis, 'fetch', async () =>
    jsonResponse([], { status: 503, body: 'service unavailable' }),
  );
  await assert.rejects(
    fetchSocrataAll({ domain: 'd.example', dataset: 'dead-beef' }),
    /Socrata dead-beef HTTP 503/,
  );
});

test('fetchSocrataAll — sends X-App-Token only when one is supplied', async () => {
  const seen: Array<Record<string, string> | undefined> = [];
  mock.method(globalThis, 'fetch', async (_input: URL | string, init?: RequestInit) => {
    seen.push(init?.headers as Record<string, string> | undefined);
    return jsonResponse([]);
  });

  await fetchSocrataAll({ domain: 'd.example', dataset: 'tok-en01', appToken: 'secret-token' });
  await fetchSocrataAll({ domain: 'd.example', dataset: 'tok-en02' });
  await fetchSocrataAll({ domain: 'd.example', dataset: 'tok-en03', appToken: null });

  assert.equal(seen[0]?.['X-App-Token'], 'secret-token');
  assert.equal(seen[1]?.['X-App-Token'], undefined);
  assert.equal(seen[2]?.['X-App-Token'], undefined);
});

test('fetchSocrataAll — passes through $select / $where and lets $order be overridden', async () => {
  let captured: URL | undefined;
  mock.method(globalThis, 'fetch', async (input: URL | string) => {
    captured = new URL(String(input));
    return jsonResponse([]);
  });

  await fetchSocrataAll({
    domain: 'd.example',
    dataset: 'soql-0001',
    select: 'a,b,c',
    where: "borough = 'camden'",
    order: 'a DESC',
    pageSize: 100,
  });

  assert.ok(captured);
  assert.equal(captured.searchParams.get('$select'), 'a,b,c');
  assert.equal(captured.searchParams.get('$where'), "borough = 'camden'");
  assert.equal(captured.searchParams.get('$order'), 'a DESC');
  assert.equal(captured.searchParams.get('$limit'), '100');
});
