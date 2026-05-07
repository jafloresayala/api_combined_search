import type { MarketOffer } from '../types';

interface Props {
  offers: MarketOffer[];
  bestOffer: MarketOffer | null;
  quantity: number;
  strictMoq: boolean;
  onSelect?: (label: string, unitPrice: number, key: string, moqWarning?: boolean) => void;
  selectedKey?: string;
}

const fmt6 = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 6 });

const fmt2 = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const RANK_STYLES: Record<number, { row: string; badge: string; label: string }> = {
  1: { row: 'bg-amber-50 border-l-4 border-amber-400',   badge: 'bg-amber-400 text-white',   label: '🥇 1°' },
  2: { row: 'bg-slate-100 border-l-4 border-slate-400',  badge: 'bg-slate-400 text-white',   label: '🥈 2°' },
  3: { row: 'bg-orange-50 border-l-4 border-orange-300', badge: 'bg-orange-400 text-white',  label: '🥉 3°' },
  4: { row: 'bg-blue-50 border-l-4 border-blue-300',     badge: 'bg-blue-400 text-white',    label: '4°' },
  5: { row: 'bg-violet-50 border-l-4 border-violet-300', badge: 'bg-violet-400 text-white',  label: '5°' },
};

export function MarketTable({ offers, bestOffer, quantity, strictMoq, onSelect, selectedKey }: Props) {
  if (!offers.length) {
    return (
      <p className="text-sm text-gray-400 py-4 text-center">
        No offers found in Nexar for these MPNs.
      </p>
    );
  }

  // Con MOQ activo: solo in-stock + fulfillable; sin MOQ: todos (ya vienen ordenados por precio)
  const rankSource = strictMoq
    ? offers.filter(o => o.can_fulfill && o.inventory > 0)
    : offers;
  const rankMap = new Map<MarketOffer, number>();
  rankSource.slice(0, 5).forEach((o, idx) => rankMap.set(o, idx + 1));

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2 text-center w-10">#</th>
            <th className="px-3 py-2 text-left">MPN</th>
            <th className="px-3 py-2 text-left">Manufacturer</th>
            <th className="px-3 py-2 text-left">Supplier</th>
            <th className="px-3 py-2 text-right">Unit Price (USD)</th>
            <th className="px-3 py-2 text-right">Total ({quantity.toLocaleString()} pcs)</th>
            <th className="px-3 py-2 text-right">Stock</th>
            <th className="px-3 py-2 text-right">MOQ</th>
            <th className="px-3 py-2 text-left">Packaging</th>
            <th className="px-3 py-2 text-left">Link</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {offers.map((o, i) => {
            const rank = rankMap.get(o);
            const style = rank ? RANK_STYLES[rank] : null;
            const dimmed = strictMoq && (!o.can_fulfill || o.inventory === 0);
            const isSelected = selectedKey === `market:${i}`;
            return (
              <tr
                key={i}
                onClick={() => onSelect?.(`${o.seller} · ${o.mpn}`, o.unit_price_usd, `market:${i}`, !o.can_fulfill)}
                className={`cursor-pointer ${
                  isSelected
                    ? `bg-blue-100 ring-2 ring-inset ring-blue-400${style ? ' font-semibold' : ''}`
                    : style
                    ? `${style.row} font-semibold`
                    : dimmed
                    ? 'opacity-40 hover:opacity-70 hover:bg-gray-50'
                    : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-3 py-2 text-center">
                  {style ? (
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${style.badge}`}>
                      {style.label}
                    </span>
                  ) : (
                    <span className="text-gray-300">{i + 1}</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono">{o.mpn}</td>
                <td className="px-3 py-2 text-gray-700">{o.manufacturer}</td>
                <td className="px-3 py-2">{o.seller}</td>
                <td className="px-3 py-2 text-right text-blue-700 font-mono">
                  {fmt6(o.unit_price_usd)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-800">
                  {fmt2(o.total_price_usd)}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={o.inventory > 0 ? 'text-green-700 font-medium' : 'text-red-500'}>
                    {o.inventory.toLocaleString()}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-gray-600">
                  {o.moq.toLocaleString()}
                  {!o.can_fulfill && (
                    <span className="ml-1 text-amber-600 text-xs">⚠ MOQ</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500">{o.packaging || '—'}</td>
                <td className="px-3 py-2">
                  {o.click_url ? (
                    <a
                      href={o.click_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      View →
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
