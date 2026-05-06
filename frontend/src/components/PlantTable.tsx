import type { PlantSummary } from '../types';
import { resolveLastPoPrice, fmt } from '../utils';

interface Props {
  plants: PlantSummary[];
  bestPlant: string;
}

export function PlantTable({ plants, bestPlant }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">Planta</th>
            <th className="px-4 py-3 text-left">Mejor Proveedor</th>
            <th className="px-4 py-3 text-right">Último PO Price (USD)</th>
            <th className="px-4 py-3 text-right">Precio Estándar (USD)</th>
            <th className="px-4 py-3 text-right">Cantidad</th>
            <th className="px-4 py-3 text-left">MPN</th>
            <th className="px-4 py-3 text-left">Fecha Último PO</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {plants.map((p) => {
            const isBest = p.siteName === bestPlant;
            const bestRow = p.rows.reduce((a, b) =>
              (resolveLastPoPrice(a) ?? Infinity) <= (resolveLastPoPrice(b) ?? Infinity) ? a : b
            );
            return (
              <tr
                key={p.siteName}
                className={isBest ? 'bg-green-50 font-semibold' : 'hover:bg-gray-50'}
              >
                <td className="px-4 py-3 flex items-center gap-2">
                  {isBest && (
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                  )}
                  <span>{p.siteName}</span>
                </td>
                <td className="px-4 py-3 text-gray-700">{p.bestSupplier}</td>
                <td className="px-4 py-3 text-right text-blue-700 font-mono">
                  {fmt(p.bestPrice)}
                </td>
                <td className="px-4 py-3 text-right text-gray-600 font-mono">
                  {fmt(bestRow.standardPriceUsd)}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {bestRow.quantity.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{p.mpn}</td>
                <td className="px-4 py-3 text-gray-500">{p.lastPoDate}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
