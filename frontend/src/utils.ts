import type { InternalQueryItem } from './types'

/**
 * Precio unitario del último PO en USD.
 * Si lastPoPriceUsd ya viene calculado, se usa directamente.
 * Si es null (conversión fallida en backend), se recalcula:
 *   lastPoPriceLocalCurr = rawLastPoPrice / rawLastPoPer
 *   lastPoPriceUsd       = lastPoPriceLocalCurr * localCurrencyExchangeRateUsd
 */
export function resolveLastPoPrice(row: InternalQueryItem): number | null {
  if (row.lastPoPriceUsd != null) return row.lastPoPriceUsd

  // Calcular precio en moneda local primero
  const localPrice =
    row.rawLastPoPrice != null && row.rawLastPoPer
      ? row.rawLastPoPrice / row.rawLastPoPer
      : null

  if (localPrice == null) return null

  // Convertir a USD usando el tipo de cambio disponible
  if (row.localCurrencyExchangeRateUsd) {
    return localPrice * row.localCurrencyExchangeRateUsd
  }

  return null
}

export const fmt = (v: number | null | undefined) =>
  v == null
    ? '—'
    : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 6 })
