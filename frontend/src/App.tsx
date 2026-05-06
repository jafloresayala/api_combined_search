import { useState } from 'react'
import { fetchAmplByMaterial, fetchInternalQuery } from './api'
import type { AmplResponse, InternalQueryItem, PlantSummary } from './types'
import { resolveLastPoPrice, fmt } from './utils'
import { StatCard } from './components/StatCard'
import { PlantTable } from './components/PlantTable'
import { DetailTable } from './components/DetailTable'

type Status = 'idle' | 'loading-ampl' | 'loading-iq' | 'done' | 'error'

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

export default function App() {
  const [bmatn, setBmatn] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [ampl, setAmpl] = useState<AmplResponse | null>(null)
  const [iqRows, setIqRows] = useState<InternalQueryItem[]>([])
  const [plantSummaries, setPlantSummaries] = useState<PlantSummary[]>([])
  const [showDetail, setShowDetail] = useState(false)

  const search = async () => {
    if (!bmatn.trim()) return
    setError('')
    setAmpl(null)
    setIqRows([])
    setPlantSummaries([])
    setShowDetail(false)

    try {
      setStatus('loading-ampl')
      const amplData = await fetchAmplByMaterial(bmatn.trim().toUpperCase())
      setAmpl(amplData)

      if (!amplData.mpns_list.length) {
        setError('No se encontraron MPNs activos para este componente.')
        setStatus('error')
        return
      }

      setStatus('loading-iq')
      const iqData = await fetchInternalQuery(amplData.mpns_list)
      const rows: InternalQueryItem[] = Array.isArray(iqData.data) ? iqData.data : []
      setIqRows(rows)
      setPlantSummaries(buildPlantSummaries(rows))
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

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 shadow-sm">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
          K
        </div>
        <div>
          <h1 className="font-bold text-gray-800 leading-tight">Component Price Dashboard</h1>
          <p className="text-xs text-gray-400">Kimball Electronics — SAP + EMS</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Search */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <label className="block text-sm font-medium text-gray-600 mb-2">
            Número de Componente (BMATN)
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Ej: EC03018"
              value={bmatn}
              onChange={(e) => setBmatn(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
            />
            <button
              onClick={search}
              disabled={status === 'loading-ampl' || status === 'loading-iq'}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'loading-ampl'
                ? 'Buscando MPNs...'
                : status === 'loading-iq'
                ? 'Consultando precios...'
                : 'Buscar'}
            </button>
          </div>
        </div>

        {/* Loading indicator */}
        {(status === 'loading-ampl' || status === 'loading-iq') && (
          <div className="flex items-center gap-3 text-sm text-gray-500 bg-white rounded-xl border border-gray-200 px-5 py-4">
            <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {status === 'loading-ampl' ? 'Obteniendo MPNs desde SAP...' : 'Consultando precios en EMS...'}
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon="🏭"
                label="Mejor Planta"
                value={bestPlant?.siteName ?? '—'}
                sub={`Precio: ${fmt(bestPlant?.bestPrice ?? 0)}`}
                highlight
              />
              <StatCard
                icon="🤝"
                label="Mejor Proveedor"
                value={globalBest.supplierName}
                sub={`#${globalBest.supplierNumber}`}
              />
              <StatCard
                icon="💰"
                label="Mejor Precio (USD)"
                value={fmt(globalBest.lastPoPriceUsd)}
                sub={`Último PO: ${globalBest.lastPoDate}`}
              />
              <StatCard
                icon="📦"
                label="MPNs Activos"
                value={String(ampl.total_active)}
                sub={`${ampl.total_blocked} bloqueados · ${ampl.total_deleted} eliminados`}
              />
            </div>

            {/* Por planta */}
            <div>
              <h3 className="text-base font-semibold text-gray-700 mb-3">Resumen por Planta</h3>
              <PlantTable plants={plantSummaries} bestPlant={bestPlant?.siteName ?? ''} />
            </div>

            {/* Detalle toggle */}
            <div>
              <button
                onClick={() => setShowDetail((v) => !v)}
                className="text-sm text-blue-600 hover:underline font-medium"
              >
                {showDetail ? '▲ Ocultar detalle completo' : '▼ Ver detalle completo'}
              </button>
              {showDetail && (
                <div className="mt-3">
                  <DetailTable rows={iqRows} />
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
