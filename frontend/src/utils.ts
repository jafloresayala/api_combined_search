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

/** Precio estándar en moneda local. Fallback: rawStandardPrice / rawStandardPricePer */
export function resolveStandardPriceLocal(row: InternalQueryItem): number | null {
  if (row.standardPriceLocalCurr != null) return row.standardPriceLocalCurr
  if (row.rawStandardPrice != null && row.rawStandardPricePer)
    return row.rawStandardPrice / row.rawStandardPricePer
  return null
}

/** Precio último PO en moneda local. Fallback: rawLastPoPrice / rawLastPoPer */
export function resolveLastPoPriceLocal(row: InternalQueryItem): number | null {
  if (row.lastPoPriceLocalCurr != null) return row.lastPoPriceLocalCurr
  if (row.rawLastPoPrice != null && row.rawLastPoPer)
    return row.rawLastPoPrice / row.rawLastPoPer
  return null
}

export const fmt = (v: number | null | undefined) =>
  v == null
    ? '—'
    : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 6 })

/** Formatea un número en moneda local con su código de divisa */
export function fmtLocal(v: number | null | undefined, currency: string): string {
  if (v == null) return '—'
  try {
    return v.toLocaleString('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 4,
    })
  } catch {
    return `${currency} ${v.toFixed(4)}`
  }
}
