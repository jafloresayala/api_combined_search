export interface InternalQueryItem {
  rawStandardPrice: number;
  rawStandardPricePer: number;
  rawLastPoPrice: number | null;
  rawLastPoPer: number | null;
  uomConversion: number;
  localCurrencyExchangeRate: number;
  localCurrencyExchangeRateUsd: number;
  mpn: string;
  internalPN: string;
  siteName: string;
  quantity: number;
  standardPriceLocalCurr: number;
  lastPoPriceLocalCurr: number | null;
  standardPriceUsd: number;
  lastPoPriceUsd: number | null;
  localCurrency: string;
  lastPoDate: string;
  supplierNumber: string;
  supplierName: string;
  englishName: string | null;
  manufacturerName: string;
  materialDescription: string;
}

export interface AmplActiveItem {
  MfgPartNumber: string;
  MfgName: string;
  MpnPartNumber: string;
  count: number;
}

export interface AmplResponse {
  internal_part_number: string;
  total_active: number;
  total_blocked: number;
  total_deleted: number;
  mpns_csv: string;
  mpns_list: string[];
  active: AmplActiveItem[];
  blocked: unknown[];
  deleted: unknown[];
}

export interface InternalQueryResponse {
  count: number;
  data: InternalQueryItem[];
}

export interface BestOption {
  siteName: string;
  supplierName: string;
  supplierNumber: string;
  lastPoPriceUsd: number;
  lastPoDate: string;
  mpn: string;
  quantity: number;
}

export interface PlantSummary {
  siteName: string;
  bestPrice: number | null;
  bestSupplier: string;
  lastPoDate: string;
  mpn: string;
  rows: InternalQueryItem[];
}
