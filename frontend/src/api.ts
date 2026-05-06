import type { AmplResponse, InternalQueryResponse } from './types';

const BASE = '/api';

export async function fetchAmplByMaterial(bmatn: string): Promise<AmplResponse> {
  const res = await fetch(`${BASE}/ampl-by-material`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ internal_part_number: bmatn }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? 'Error consultando AMPL');
  }
  return res.json();
}

export async function fetchInternalQuery(mpns: string[]): Promise<InternalQueryResponse> {
  const res = await fetch(`${BASE}/internal-query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mpns }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? 'Error consultando InternalQuery');
  }
  return res.json();
}
