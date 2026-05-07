import { useState } from 'react'
import { fetchAmplByMaterial, fetchInternalQuery, fetchMarketPrices } from './api'
import type { AmplResponse, InternalQueryItem, PlantSummary, MarketPricesResponse } from './types'
import { resolveLastPoPrice, fmt } from './utils'
import { StatCard } from './components/StatCard'
import { PlantTable } from './components/PlantTable'
import { DetailTable } from './components/DetailTable'
import { MarketTable } from './components/MarketTable'

type Status = 'idle' | 'loading-ampl' | 'loading-iq' | 'loading-market' | 'done' | 'error'

function buildPlantSummaries(rows: InternalQueryItem[]): PlantSummary[] {
  const map = new Map<string, InternalQueryItem[]>()
  for (const row of rows) {
    if (!map.has(row.siteName)) map.set(row.siteName, [])
    map.get(row.siteName)!.push(row)
  }
  return Array.from(map.entries())
    .map(([siteName, siteRows]) => {
      const best = siteRows.reduce((a, b) =>
        (resolveLastPoPrice(a) ?? Infinity) <= (resolveLastPoPrice(b) ?? Infinity) ? a : b
      )
      return {
        siteName,
        bestPrice: resolveLastPoPrice(best),
        bestSupplier: best.supplierName,
        lastPoDate: best.lastPoDate,
        mpn: best.mpn,
        rows: siteRows,
      }
    })
    .sort((a, b) => (a.bestPrice ?? Infinity) - (b.bestPrice ?? Infinity))
}

function getMarketDecision(priceDiffPct: number | null, offersWithStock: number, totalOffers: number) {
  if (totalOffers === 0)    return { icon: '❓', text: 'No market data',          color: 'text-gray-500',    bg: 'bg-gray-50',    border: 'border-gray-200' }
  if (offersWithStock === 0) return { icon: '⚠️', text: 'No market stock',          color: 'text-red-600',     bg: 'bg-red-50',     border: 'border-red-200' }
  if (priceDiffPct === null) return { icon: '🔍', text: 'Review manually',           color: 'text-gray-600',    bg: 'bg-gray-50',    border: 'border-gray-200' }
  if (priceDiffPct <= -10)   return { icon: '🚀', text: 'Savings opportunity',       color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' }
  if (priceDiffPct <= 0)     return { icon: '✅', text: 'Competitive price',          color: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200' }
  if (priceDiffPct <= 15)    return { icon: '🔍', text: 'Evaluate alternatives',     color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' }
  return                     { icon: '🔒', text: 'Keep current supplier',     color: 'text-gray-700',    bg: 'bg-gray-100',   border: 'border-gray-200' }
}

export default function App() {
  const [bmatn, setBmatn] = useState('')
  const [quantity, setQuantity] = useState(100)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [ampl, setAmpl] = useState<AmplResponse | null>(null)
  const [iqRows, setIqRows] = useState<InternalQueryItem[]>([])
  const [plantSummaries, setPlantSummaries] = useState<PlantSummary[]>([])
  const [showDetail, setShowDetail] = useState(false)
  const [marketData, setMarketData] = useState<MarketPricesResponse | null>(null)
  const [showMarket, setShowMarket] = useState(true)
  const [strictMoq, setStrictMoq] = useState(true)
  const [selectedPrice, setSelectedPrice] = useState<{ label: string; unitPrice: number; key: string; moqWarning: boolean } | null>(null)
  const [pinnedPlant, setPinnedPlant] = useState<PlantSummary | null>(null)

  const handleSelectPrice = (label: string, unitPrice: number, key: string, moqWarning = false) =>
    setSelectedPrice(prev => prev?.key === key ? null : { label, unitPrice, key, moqWarning })

  const search = async () => {
    if (!bmatn.trim()) return
    setError('')
    setAmpl(null)
    setIqRows([])
    setPlantSummaries([])
    setShowDetail(false)
    setMarketData(null)
    setSelectedPrice(null)
    setPinnedPlant(null)

    try {
      setStatus('loading-ampl')
      const amplData = await fetchAmplByMaterial(bmatn.trim().toUpperCase())
      setAmpl(amplData)

      if (!amplData.mpns_list.length) {
        setError('No active MPNs found for this component.')
        setStatus('error')
        return
      }

      setStatus('loading-iq')
      const iqData = await fetchInternalQuery(amplData.mpns_list)
      const rows: InternalQueryItem[] = Array.isArray(iqData.data) ? iqData.data : []
      setIqRows(rows)
      setPlantSummaries(buildPlantSummaries(rows))

      setStatus('loading-market')
      const marketResp = await fetchMarketPrices(amplData.mpns_list, quantity)
      setMarketData(marketResp)

      setStatus('done')
    } catch (e: unknown) {
      console.error('Dashboard error:', e)
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  const bestPlant = plantSummaries[0]
  const globalBest = iqRows.length
    ? iqRows.reduce((a, b) =>
        (resolveLastPoPrice(a) ?? Infinity) <= (resolveLastPoPrice(b) ?? Infinity) ? a : b
      )
    : null

  const displayOffers = marketData
    ? strictMoq
      ? marketData.offers
      : [...marketData.offers].sort((a, b) => a.unit_price_usd - b.unit_price_usd)
    : []
  const displayBest = displayOffers[0] ?? null
  const internalBestPrice = globalBest ? resolveLastPoPrice(globalBest) : null
  // KPI reference: pinned plant if set, otherwise global best
  const refPrice = pinnedPlant?.bestPrice ?? internalBestPrice
  const refLabel = pinnedPlant ? pinnedPlant.siteName : 'Global'
  const marketBestPrice = displayBest?.unit_price_usd ?? null
  const priceDiffPct = refPrice && marketBestPrice
    ? ((marketBestPrice - refPrice) / refPrice) * 100
    : null
  const offersWithStock = marketData?.offers.filter(o => o.inventory > 0).length ?? 0
  const decision = getMarketDecision(priceDiffPct, offersWithStock, marketData?.total_offers ?? 0)

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 shadow-sm">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
          K
        </div>
        <div>
          <h1 className="font-bold text-gray-800 leading-tight">Price Calculator</h1>
          <p className="text-xs text-gray-400">Kimball Electronics — Data Science — SAP + Market Prices</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Search */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex gap-6 mb-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-600 mb-2">
                Component Number
              </label>
              <input
                type="text"
                placeholder="e.g. EC03018"
                value={bmatn}
                onChange={(e) => setBmatn(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
              />
            </div>
            <div className="w-44">
              <label className="block text-sm font-medium text-gray-600 mb-2">
                Component Quantity
              </label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <button
            onClick={search}
            disabled={status === 'loading-ampl' || status === 'loading-iq' || status === 'loading-market'}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {status === 'loading-ampl'
              ? 'Fetching MPNs...'
              : status === 'loading-iq'
              ? 'Querying prices...'
              : status === 'loading-market'
              ? 'Querying market...'
              : 'Search'}
          </button>
        </div>

        {/* Loading indicator */}
        {(status === 'loading-ampl' || status === 'loading-iq' || status === 'loading-market') && (
          <div className="flex items-center gap-3 text-sm text-gray-500 bg-white rounded-xl border border-gray-200 px-5 py-4">
            <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {status === 'loading-ampl'
              ? 'Fetching MPNs from SAP...'
              : status === 'loading-iq'
              ? 'Querying prices in EMS...'
              : 'Querying market prices in Nexar...'}
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Results */}
        {status === 'done' && ampl && globalBest && (
          <>
            {/* Component info */}
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-gray-800">{ampl.internal_part_number}</h2>
              <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                {iqRows[0]?.materialDescription}
              </span>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                icon="🏭"
                label="Best Plant Price"
                value={bestPlant?.siteName ?? '—'}
                sub={`Price: ${fmt(bestPlant?.bestPrice)}`}
                highlight
              />
              <StatCard
                icon="🤝"
                label="Best Supplier"
                value={globalBest.supplierName}
                sub={`#${globalBest.supplierNumber}`}
              />
              <StatCard
                icon="💰"
                label="Best Price (USD)"
                value={fmt(resolveLastPoPrice(globalBest))}
                sub={`Last PO: ${globalBest.lastPoDate}`}
              />
            </div>

            {/* Por planta */}
            <div>
              <h3 className="text-base font-semibold text-gray-700 mb-1">Plant Summary</h3>
              <p className="text-xs text-gray-400 mb-3">Click a row to calculate total · Use 📌 to pin as comparison reference</p>
              <PlantTable
                plants={plantSummaries}
                bestPlant={bestPlant?.siteName ?? ''}
                onSelect={handleSelectPrice}
                selectedKey={selectedPrice?.key}
                pinnedSite={pinnedPlant?.siteName}
                onPin={p => setPinnedPlant(prev => prev?.siteName === p.siteName ? null : p)}
              />
            </div>

            {/* Detalle toggle */}
            <div>
              <button
                onClick={() => setShowDetail((v) => !v)}
                className="text-sm text-blue-600 hover:underline font-medium"
              >
                {showDetail ? '▲ Hide full detail' : '▼ Show full detail'}
              </button>
              {showDetail && (
                <div className="mt-3">
                    <DetailTable rows={iqRows} onSelect={handleSelectPrice} selectedKey={selectedPrice?.key} />
                  </div>
              )}
            </div>

            {/* Precios de mercado Nexar */}
            {marketData && (
              <div className="space-y-4">
                {/* Header + controles */}
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-700">Market Prices — Nexar</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {marketData.total_offers} offers · {quantity.toLocaleString()} pcs
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <span className="text-sm text-gray-600">Filter by MOQ</span>
                      <button
                        role="switch"
                        aria-checked={strictMoq}
                        onClick={() => setStrictMoq(v => !v)}
                        className={`relative inline-flex w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${strictMoq ? 'bg-blue-500' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${strictMoq ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    </label>
                    <button
                      onClick={() => setShowMarket(v => !v)}
                      className="text-sm text-blue-600 hover:underline font-medium"
                    >
                      {showMarket ? '▲ Hide' : '▼ Show'}
                    </button>
                  </div>
                </div>

                {/* Market KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-400 mb-1">💹 Best Market Price</p>
                    <p className="text-lg font-bold text-gray-800">{displayBest ? fmt(displayBest.unit_price_usd) : '—'}</p>
                    <p className="text-xs text-gray-500 truncate">{displayBest?.seller ?? 'No offers'}</p>
                  </div>
                  <div className={`rounded-xl border p-4 ${
                    priceDiffPct !== null && priceDiffPct < 0
                      ? 'bg-emerald-50 border-emerald-200'
                      : priceDiffPct !== null && priceDiffPct > 15
                      ? 'bg-red-50 border-red-200'
                      : 'bg-white border-gray-200'
                  }`}>
                    <p className="text-xs text-gray-400 mb-1">📊 vs. {refLabel} {pinnedPlant ? '📌' : '(best PO)'}</p>
                    <p className={`text-lg font-bold ${
                      priceDiffPct !== null
                        ? priceDiffPct < 0 ? 'text-emerald-700' : priceDiffPct > 15 ? 'text-red-600' : 'text-amber-600'
                        : 'text-gray-400'
                    }`}>
                      {priceDiffPct !== null ? `${priceDiffPct > 0 ? '+' : ''}${priceDiffPct.toFixed(1)}%` : '—'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {priceDiffPct !== null ? (priceDiffPct < 0 ? 'Market is cheaper' : 'Market is more expensive') : 'No comparison'}
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-400 mb-1">📦 In Stock</p>
                    <p className="text-lg font-bold text-gray-800">{offersWithStock}</p>
                    <p className="text-xs text-gray-500">of {marketData.total_offers} suppliers</p>
                  </div>
                  <div className={`rounded-xl border p-4 ${decision.bg} ${decision.border}`}>
                    <p className="text-xs text-gray-400 mb-1">🎯 Suggested Decision</p>
                    <p className={`text-sm font-bold leading-tight ${decision.color}`}>{decision.icon} {decision.text}</p>
                    <p className="text-xs text-gray-500 mt-1">Ref ({refLabel}): {fmt(refPrice)}</p>
                  </div>
                </div>

                {/* Tabla */}
                {showMarket && (
                  <MarketTable
                    offers={displayOffers}
                    bestOffer={displayBest}
                    quantity={quantity}
                    strictMoq={strictMoq}
                    onSelect={handleSelectPrice}
                    selectedKey={selectedPrice?.key}
                  />
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Comparison widget (top-right) — pinned plant vs selected provider */}
      {pinnedPlant && pinnedPlant.bestPrice != null && selectedPrice && (() => {
        const rp = pinnedPlant.bestPrice!
        const sp = selectedPrice.unitPrice
        const diffUnit = sp - rp
        const diffPct = (diffUnit / rp) * 100
        const diffTotal = diffUnit * quantity
        const cheaper = diffUnit < 0
        const same = Math.abs(diffPct) < 0.001
        return (
          <div className="fixed top-6 right-6 z-50 bg-white border-2 border-indigo-300 rounded-2xl shadow-2xl p-4 w-80">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-indigo-700">📊 Comparison Analysis</span>
              <button onClick={() => setPinnedPlant(null)} className="text-gray-300 hover:text-gray-500 text-lg leading-none" aria-label="Close">×</button>
            </div>
            {/* Referencia */}
            <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 mb-2">
              <p className="text-xs text-indigo-400 font-medium mb-0.5">📌 Reference (pinned plant)</p>
              <p className="text-sm font-semibold text-indigo-800 truncate">{pinnedPlant.siteName} · {pinnedPlant.bestSupplier}</p>
              <p className="text-base font-bold text-indigo-700 font-mono mt-0.5">{rp.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 6 })}</p>
            </div>
            {/* Seleccionado */}
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 mb-3">
              <p className="text-xs text-blue-400 font-medium mb-0.5">🔵 Selected</p>
              <p className="text-sm font-semibold text-blue-800 truncate" title={selectedPrice.label}>{selectedPrice.label}</p>
              <p className="text-base font-bold text-blue-700 font-mono mt-0.5">{sp.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 6 })}</p>
            </div>
            {/* Stats */}
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Unit difference</span>
                <span className={`font-mono text-sm font-bold ${ same ? 'text-gray-500' : cheaper ? 'text-emerald-600' : 'text-red-500'}`}>
                  {same ? '—' : `${cheaper ? '' : '+'}${diffUnit.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 6 })}`}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Variation %</span>
                <span className={`font-bold text-sm ${ same ? 'text-gray-500' : cheaper ? 'text-emerald-600' : 'text-red-500'}`}>
                  {same ? '0.0%' : `${cheaper ? '' : '+'}${diffPct.toFixed(2)}%`}
                </span>
              </div>
              {/* Bar visual */}
              {!same && (
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden mt-1">
                  <div
                    className={`h-full rounded-full transition-all ${ cheaper ? 'bg-emerald-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(Math.abs(diffPct) * 2, 100)}%` }}
                  />
                </div>
              )}
              <div className={`flex justify-between items-center rounded-lg px-2.5 py-2 mt-1 ${ same ? 'bg-gray-50' : cheaper ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <span className="text-xs font-medium text-gray-600">{ same ? 'No difference' : cheaper ? `Savings x${quantity.toLocaleString()}` : `Extra cost x${quantity.toLocaleString()}`}</span>
                <span className={`font-mono font-bold text-sm ${ same ? 'text-gray-500' : cheaper ? 'text-emerald-700' : 'text-red-600'}`}>
                  {same ? '—' : `${cheaper ? '-' : '+'}${Math.abs(diffTotal).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })}`}
                </span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Floating total widget (bottom-right) */}
      {selectedPrice && (
        <div className={`fixed bottom-6 right-6 z-50 bg-white rounded-2xl shadow-2xl p-4 w-72 border-2 ${
          selectedPrice.moqWarning ? 'border-amber-400' : 'border-blue-300'
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-gray-400 mb-0.5">Selected provider</p>
              <p className="text-sm font-semibold text-gray-800 truncate" title={selectedPrice.label}>
                {selectedPrice.label}
              </p>
            </div>
            <button
              onClick={() => setSelectedPrice(null)}
              className="text-gray-300 hover:text-gray-500 text-lg leading-none flex-shrink-0 mt-0.5"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {selectedPrice.moqWarning && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              <span>⚠️</span>
              <span>MOQ exceeds your requested quantity</span>
            </div>
          )}
          <div className="mt-3 border-t border-gray-100 pt-3 space-y-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Unit price</span>
              <span className="font-mono text-blue-700">
                {selectedPrice.unitPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 6 })}
              </span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Quantity</span>
              <span className="font-mono">{quantity.toLocaleString()} pcs</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-2 mt-2">
              <span className="text-gray-700">Estimated total</span>
              <span className={`font-mono ${selectedPrice.moqWarning ? 'text-amber-600' : 'text-emerald-600'}`}>
                {(selectedPrice.unitPrice * quantity).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
