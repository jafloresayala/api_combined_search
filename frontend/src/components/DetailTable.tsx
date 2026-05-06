import type { InternalQueryItem } from '../types';
import { resolveLastPoPrice, fmt } from '../utils';

interface Props {
  rows: InternalQueryItem[];
}

export function DetailTable({ rows }: Props) {
  const sorted = [...rows].sort((a, b) =>
    (resolveLastPoPrice(a) ?? Infinity) - (resolveLastPoPrice(b) ?? Infinity)
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left">MPN</th>
            <th className="px-3 py-2 text-left">Planta</th>
            <th className="px-3 py-2 text-left">Proveedor</th>
            <th className="px-3 py-2 text-right">Último PO (USD)</th>
            <th className="px-3 py-2 text-right">Estándar (USD)</th>
            <th className="px-3 py-2 text-right">Cantidad</th>
            <th className="px-3 py-2 text-left">Moneda</th>
            <th className="px-3 py-2 text-left">Fecha PO</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((row, i) => (
            <tr key={i} className={i === 0 ? 'bg-green-50 font-semibold' : 'hover:bg-gray-50'}>
              <td className="px-3 py-2 font-mono">{row.mpn}</td>
              <td className="px-3 py-2">{row.siteName}</td>
              <td className="px-3 py-2 text-gray-700">{row.supplierName}</td>
              <td className="px-3 py-2 text-right text-blue-700 font-mono">
                {fmt(resolveLastPoPrice(row))}
              </td>
              <td className="px-3 py-2 text-right text-gray-600 font-mono">
                {fmt(row.standardPriceUsd)}
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
