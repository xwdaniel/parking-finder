// Shared Socrata (SODA 2.1) client — HTTP, $limit/$offset pagination, SoQL params.
// One adapter per API borough sits on top of this (camden.ts, …); each maps that
// dataset's columns onto the common `cpz` shape.

export interface SocrataQuery {
  /** e.g. 'opendata.camden.gov.uk' */
  domain: string;
  /** dataset 4x4 id, e.g. 'vf6e-iymu' */
  dataset: string;
  /** SoQL $select */
  select?: string;
  /** SoQL $where */
  where?: string;
  /** SoQL $order; defaults to ':id' for stable pagination */
  order?: string;
  /** rows per request; Socrata allows up to 50000 */
  pageSize?: number;
  /** X-App-Token — raises the anonymous rate limit; optional */
  appToken?: string | null;
}

export async function fetchSocrataAll<T = Record<string, unknown>>(q: SocrataQuery): Promise<T[]> {
  const pageSize = q.pageSize ?? 5000;
  const out: T[] = [];
  let offset = 0;

  for (;;) {
    const url = new URL(`https://${q.domain}/resource/${q.dataset}.json`);
    url.searchParams.set('$limit', String(pageSize));
    url.searchParams.set('$offset', String(offset));
    url.searchParams.set('$order', q.order ?? ':id'); // stable order across pages
    if (q.select) url.searchParams.set('$select', q.select);
    if (q.where) url.searchParams.set('$where', q.where);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (q.appToken) headers['X-App-Token'] = q.appToken;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Socrata ${q.dataset} HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}
