import type { PlantSummary } from '../types';
import { resolveLastPoPrice, fmt } from '../utils';

interface Props {
  plants: PlantSummary[];
  bestPlant: string;
  onSelect?: (label: string, unitPrice: number, key: string, moqWarning?: boolean) => void;
  selectedKey?: string;
  pinnedSite?: string;
  onPin?: (plant: PlantSummary) => void;
}

export function PlantTable({ plants, bestPlant, onSelect, selectedKey, pinnedSite, onPin }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-3 w-8" />
            <th className="px-4 py-3 text-left">Plant</th>
            <th className="px-4 py-3 text-left">Internal P/N</th>
            <th className="px-4 py-3 text-left">Manufacturer</th>
            <th className="px-4 py-3 text-left">Best Supplier</th>
            <th className="px-4 py-3 text-right">Last PO Price (USD)</th>
            <th className="px-4 py-3 text-right">Standard Price (USD)</th>
            <th className="px-4 py-3 text-right">Raw Last PO Price</th>
            <th className="px-4 py-3 text-right">Raw Last PO Per</th>
            <th className="px-4 py-3 text-right">Raw Std Price</th>
            <th className="px-4 py-3 text-right">Raw Std Per</th>
            <th className="px-4 py-3 text-right">Quantity</th>
            <th className="px-4 py-3 text-left">MPN</th>
            <th className="px-4 py-3 text-left">Last PO Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {plants.map((p) => {
            const isBest = p.siteName === bestPlant;
            const isPinned = p.siteName === pinnedSite;
            const isSelected = selectedKey === `plant:${p.siteName}`;
            const bestRow = p.rows.reduce((a, b) =>
              (resolveLastPoPrice(a) ?? Infinity) <= (resolveLastPoPrice(b) ?? Infinity) ? a : b
            );
            const lastPo = resolveLastPoPrice(bestRow);
            const stdUnderLastPo = lastPo != null && bestRow.standardPriceUsd < lastPo;
            return (
              <tr
                key={p.siteName}
                onClick={() => p.bestPrice != null && onSelect?.(`${p.siteName} · ${p.bestSupplier}`, p.bestPrice, `plant:${p.siteName}`)}
                className={[
                  onSelect && p.bestPrice != null ? 'cursor-pointer' : '',
                  isBest ? 'font-semibold' : '',
                  isSelected
                    ? 'bg-blue-100 ring-2 ring-inset ring-blue-400'
                    : isPinned
                    ? 'bg-indigo-50 ring-2 ring-inset ring-indigo-400'
                    : stdUnderLastPo
                    ? 'bg-red-50 ring-2 ring-inset ring-red-400'
                    : isBest ? 'bg-green-50' : 'hover:bg-gray-50',
                ].join(' ')}
              >
                <td className="px-3 py-3 text-center">
                  <button
                    onClick={e => { e.stopPropagation(); onPin?.(p); }}
                    title={isPinned ? 'Remove reference' : 'Pin as comparison reference'}
                    className={`text-base leading-none transition-opacity ${
                      isPinned ? 'opacity-100' : 'opacity-20 hover:opacity-70'
                    }`}
                  >
                    📌
                  </button>
                </td>
                <td className="px-4 py-3 flex items-center gap-2">
                  {isBest && (
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                  )}
                  {isPinned && (
                    <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
                  )}
                  <span>{p.siteName}</span>
                </td>
                {(() => {
                  return (<>
                <td className="px-4 py-3 font-mono text-xs text-gray-700">{bestRow.internalPN}</td>
                <td className="px-4 py-3 text-gray-700">{bestRow.manufacturerName}</td>
                <td className="px-4 py-3 text-gray-700">{p.bestSupplier}</td>
                <td className="px-4 py-3 text-right text-blue-700 font-mono">
                  {fmt(p.bestPrice)}
                </td>
                <td className="px-4 py-3 text-right text-gray-600 font-mono">
                  {fmt(bestRow.standardPriceUsd)}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">
                  {bestRow.rawLastPoPrice != null ? bestRow.rawLastPoPrice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 }) : '—'}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">
                  {bestRow.rawLastPoPer != null ? bestRow.rawLastPoPer : '—'}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">
                  {bestRow.rawStandardPrice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">
                  {bestRow.rawStandardPricePer}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {bestRow.quantity.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{p.mpn}</td>
                <td className="px-4 py-3 text-gray-500">{p.lastPoDate}</td>
                  </>);
                })()}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
