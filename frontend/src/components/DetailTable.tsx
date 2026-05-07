import type { InternalQueryItem } from '../types';
import { resolveLastPoPrice, resolveStandardPriceLocal, resolveLastPoPriceLocal, fmt, fmtLocal } from '../utils';

interface Props {
  rows: InternalQueryItem[];
  onSelect?: (label: string, unitPrice: number, key: string, moqWarning?: boolean) => void;
  selectedKey?: string;
}

export function DetailTable({ rows, onSelect, selectedKey }: Props) {
  const sorted = [...rows].sort((a, b) =>
    (resolveLastPoPrice(a) ?? Infinity) - (resolveLastPoPrice(b) ?? Infinity)
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left">MPN</th>
            <th className="px-3 py-2 text-left">Plant</th>
            <th className="px-3 py-2 text-left">Internal P/N</th>
            <th className="px-3 py-2 text-left">Manufacturer</th>
            <th className="px-3 py-2 text-left">Supplier</th>
            <th className="px-3 py-2 text-right">Last PO (USD)</th>
            <th className="px-3 py-2 text-right">Standard (USD)</th>
            <th className="px-3 py-2 text-right">Last PO (Local)</th>
            <th className="px-3 py-2 text-right">Standard (Local)</th>
            <th className="px-3 py-2 text-right">Quantity</th>
            <th className="px-3 py-2 text-left">Currency</th>
            <th className="px-3 py-2 text-left">PO Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((row, i) => (
            <tr
              key={i}
              onClick={() => { const p = resolveLastPoPrice(row); if (p != null) onSelect?.(`${row.supplierName} · ${row.siteName}`, p); }}
              className={[
                onSelect ? 'cursor-pointer' : '',
                i === 0 ? 'font-semibold' : '',
                selectedKey === `detail:${i}`
                  ? 'bg-blue-100 ring-2 ring-inset ring-blue-400'
                  : i === 0 ? 'bg-green-50' : 'hover:bg-gray-50',
              ].join(' ')}
            >
              <td className="px-3 py-2 font-mono">{row.mpn}</td>
              <td className="px-3 py-2">{row.siteName}</td>
              <td className="px-3 py-2 font-mono text-xs text-gray-700">{row.internalPN}</td>
              <td className="px-3 py-2 text-gray-700">{row.manufacturerName}</td>
              <td className="px-3 py-2 text-gray-700">{row.supplierName}</td>
              <td className="px-3 py-2 text-right text-blue-700 font-mono">
                {fmt(resolveLastPoPrice(row))}
              </td>
              <td className="px-3 py-2 text-right text-gray-600 font-mono">
                {fmt(row.standardPriceUsd)}
              </td>
              <td className="px-3 py-2 text-right text-indigo-700 font-mono">
                {fmtLocal(resolveLastPoPriceLocal(row), row.localCurrency)}
              </td>
              <td className="px-3 py-2 text-right text-gray-500 font-mono">
                {fmtLocal(resolveStandardPriceLocal(row), row.localCurrency)}
              </td>
              <td className="px-3 py-2 text-right">{row.quantity.toLocaleString()}</td>
              <td className="px-3 py-2">{row.localCurrency}</td>
              <td className="px-3 py-2 text-gray-500">{row.lastPoDate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
