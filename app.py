import os
import re
import time
from collections import Counter
from typing import Any, Dict, List, Optional

import requests
import pandas as pd
import urllib3
from requests_negotiate_sspi import HttpNegotiateAuth

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from io import BytesIO


load_dotenv()

EMS_VERIFY_SSL = os.getenv("EMS_VERIFY_SSL", "false").lower() == "true"

if not EMS_VERIFY_SSL:
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class InternalQueryRequest(BaseModel):
    mpns: List[str] = Field(
        ...,
        description="Lista de MPNs a consultar",
        examples=[
            [
                "GRM1555C1H271JA01D",
                "UMK105CG271JV-F",
                "RMUMK105CG271JV-F"
            ]
        ]
    )


class AmplRequest(BaseModel):
    internal_part_number: str = Field(
        ...,
        description="Número de componente interno (BMATN)",
        examples=["EC03018"]
    )


class NexarRequest(BaseModel):
    mpns: List[str] = Field(..., description="Lista de MPNs a consultar")
    quantity: int = Field(..., description="Cantidad deseada de piezas", ge=1)


class EMSMaterialClient:
    def __init__(self):
        self.base_url = "https://www.ems.keint.com"
        self.session = requests.Session()

        self.session.headers.update({
            "accept": "*/*",
            "content-type": "application/json; charset=utf-8",
            "origin": self.base_url,
            "referer": f"{self.base_url}/materials/comp-search/",
            "user-agent": "Mozilla/5.0"
        })

        cookies = {
            ".AspNetCore.Cookies": os.getenv("EMS_COOKIE_MAIN"),
            ".AspNetCore.CookiesC1": os.getenv("EMS_COOKIE_C1"),
            ".AspNetCore.CookiesC2": os.getenv("EMS_COOKIE_C2"),
            ".AspNetCore.CookiesC3": os.getenv("EMS_COOKIE_C3")
        }

        missing_cookies = [key for key, value in cookies.items() if not value]

        if missing_cookies:
            raise RuntimeError(
                f"Faltan cookies en variables de entorno: {missing_cookies}"
            )

        self.session.cookies.update(cookies)

    def internal_query(self, mpns: List[str]):
        url = f"{self.base_url}/materials/comp-search/api/InternalQuery"

        clean_mpns = self._clean_mpns(mpns)

        if not clean_mpns:
            raise ValueError("La lista de MPNs está vacía después de limpiar datos.")

        payload = {
            "mpns": clean_mpns
        }

        try:
            response = self.session.post(
                url,
                json=payload,
                timeout=30,
                verify=EMS_VERIFY_SSL
            )

            if response.status_code in [401, 403]:
                raise HTTPException(
                    status_code=response.status_code,
                    detail="No autorizado. La cookie pudo haber expirado o no tiene permisos."
                )

            response.raise_for_status()

            return response.json()

        except requests.exceptions.Timeout:
            raise HTTPException(
                status_code=504,
                detail="Timeout consultando InternalQuery."
            )

        except requests.exceptions.SSLError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Error SSL consultando InternalQuery: {str(e)}"
            )

        except requests.exceptions.RequestException as e:
            raise HTTPException(
                status_code=502,
                detail=f"Error consultando InternalQuery: {str(e)}"
            )

    @staticmethod
    def _clean_mpns(mpns: List[str]) -> List[str]:
        clean = []

        for mpn in mpns:
            if mpn is None:
                continue

            mpn_clean = str(mpn).strip()

            if mpn_clean and mpn_clean not in clean:
                clean.append(mpn_clean)

        return clean


app = FastAPI(
    title="EMS InternalQuery API",
    description="API wrapper para consultar InternalQuery de EMS Comp Search.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


SAP_BASE_URL = os.getenv("SAP_GENERAL_API_BASE_URL", "http://nts5102/SapGeneralApi")

NEXAR_GRAPHQL_URL = "https://api.nexar.com/graphql/"
NEXAR_TOKEN_URL = "https://identity.nexar.com/connect/token"
NEXAR_CLIENT_ID = os.getenv("NEXAR_CLIENT_ID", "")
NEXAR_CLIENT_SECRET = os.getenv("NEXAR_CLIENT_SECRET", "")
NEXAR_TOKEN_STATIC = os.getenv("NEXAR_TOKEN", "")  # Token directo, igual que las cookies EMS
_nexar_token_cache: Dict[str, Any] = {"token": None, "expires_at": 0.0}
# Caché para token obtenido automáticamente desde EMS api/NexarToken
_ems_nexar_token_cache: Dict[str, Any] = {"token": None, "expires_at": 0.0}

_NEXAR_QUERY = """
query MultiMatchSearch($queries: [SupPartMatchQuery!]!) {
  supMultiMatch(queries: $queries, currency: \"USD\") {
    hits
    parts {
      manufacturer { name }
      mpn
      shortDescription
      sellers(authorizedOnly: true) {
        company { name }
        offers {
          clickUrl
          inventoryLevel
          moq
          packaging
          prices {
            convertedCurrency
            convertedPrice
            quantity
          }
        }
      }
    }
  }
}
"""


def fetch_ampl_from_sap(bmatn: str) -> List[Dict[str, Any]]:
    url = f"{SAP_BASE_URL}/api/Ampl/FetchAmplByMaterials"
    payload = {
        "InternalPartNumbers": [
            {
                "BMATN": bmatn.strip().upper(),
                "I": "Include",
                "fieldname": "string"
            }
        ]
    }
    try:
        response = requests.post(url, json=payload, auth=HttpNegotiateAuth(), timeout=30)
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Componente '{bmatn}' no encontrado en SAP.")
        if response.status_code == 401:
            raise HTTPException(
                status_code=401,
                detail="No autorizado en SAP. Configura SAP_USER y SAP_PASSWORD en el archivo .env."
            )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Timeout consultando SAP AMPL.")
    except HTTPException:
        raise
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error consultando SAP AMPL: {str(e)}")


def process_ampl_results(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Agrupa MfgPartNumbers, cuenta duplicados y separa bloqueados/eliminados."""
    active_map: Dict[str, Dict[str, Any]] = {}
    blocked: List[Dict[str, Any]] = []
    deleted: List[Dict[str, Any]] = []

    for item in items:
        mpn = (item.get("MfgPartNumber") or "").strip()
        is_deleted = bool((item.get("Deleted") or "").strip())
        is_blocked = bool((item.get("Blocked") or "").strip())

        if is_deleted:
            deleted.append(item)
        elif is_blocked:
            blocked.append(item)
        else:
            if mpn not in active_map:
                active_map[mpn] = {
                    "MfgPartNumber": mpn,
                    "MfgName": item.get("MfgName", ""),
                    "MpnPartNumber": item.get("MpnPartNumber", ""),
                    "count": 0
                }
            active_map[mpn]["count"] += 1

    active_list = sorted(active_map.values(), key=lambda x: x["count"], reverse=True)
    mpns_only = [x["MfgPartNumber"] for x in active_list if x["MfgPartNumber"]]

    return {
        "total_active": sum(x["count"] for x in active_list),
        "total_blocked": len(blocked),
        "total_deleted": len(deleted),
        "mpns_csv": ",".join(mpns_only),
        "mpns_list": mpns_only,
        "active": active_list,
        "blocked": blocked,
        "deleted": deleted
    }


def get_client() -> EMSMaterialClient:
    try:
        return EMSMaterialClient()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/")
def root():
    return {
        "message": "EMS InternalQuery API funcionando",
        "docs": "/docs",
        "endpoints": [
            "/internal-query",
            "/internal-query/excel",
            "/ampl-by-material",
            "/ampl-by-material/excel",
            "/health"
        ]
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "ssl_verification": EMS_VERIFY_SSL
    }


@app.get("/debug-nexar-extract")
def debug_nexar_extract():
    """
    Diagnóstico: muestra qué encuentra el servidor al intentar extraer credenciales Nexar de EMS.
    Soporta Blazor WebAssembly (DLLs .NET) y busca también en appsettings.json.
    """
    result: Dict[str, Any] = {
        "architecture": "Blazor WebAssembly",
        "page_status": None,
        "appsettings_checked": [],
        "boot_json_status": None,
        "assemblies_found": 0,
        "nexar_dlls": [],
        "credential_search_results": [],
        "extracted_client_id": None,
        "error": None,
    }

    try:
        client = get_client()
    except HTTPException as e:
        result["error"] = str(e.detail)
        return result

    base_app_url = "https://www.ems.keint.com/materials/comp-search"
    framework_url = f"{base_app_url}/_framework"

    # Verificar que la página carga
    try:
        page_r = client.session.get(f"{base_app_url}/", verify=EMS_VERIFY_SSL, timeout=15)
        result["page_status"] = page_r.status_code
    except requests.exceptions.RequestException as e:
        result["error"] = f"Error al acceder a la página: {e}"
        return result

    # Estrategia 1: appsettings.json
    for name in ("appsettings.json", "appsettings.Production.json"):
        url = f"{base_app_url}/{name}"
        info: Dict[str, Any] = {"url": url, "status": None, "contains_nexar": False, "match": None}
        try:
            r = client.session.get(url, verify=EMS_VERIFY_SSL, timeout=10)
            info["status"] = r.status_code
            if r.status_code == 200:
                info["contains_nexar"] = "nexar" in r.text.lower()
                info["preview"] = r.text[:500]
                if info["contains_nexar"]:
                    cid, csec = _search_text_for_nexar_creds(r.text)
                    if cid:
                        info["match"] = {"client_id": cid, "client_secret": "***"}
                        result["extracted_client_id"] = cid
        except requests.exceptions.RequestException as e:
            info["error"] = str(e)
        result["appsettings_checked"].append(info)

    # Estrategia 2: blazor.boot.json → DLLs
    try:
        boot_r = client.session.get(f"{framework_url}/blazor.boot.json", verify=EMS_VERIFY_SSL, timeout=15)
        result["boot_json_status"] = boot_r.status_code
        if boot_r.status_code != 200:
            result["error"] = "blazor.boot.json no devolvió 200"
            return result
        boot_data = boot_r.json()
    except Exception as e:
        result["error"] = f"Error leyendo blazor.boot.json: {e}"
        return result

    resources = boot_data.get("resources", {})
    assemblies: Dict[str, Any] = {}
    assemblies.update(resources.get("assembly", {}))
    assemblies.update(resources.get("lazyAssembly", {}))
    result["assemblies_found"] = len(assemblies)
    result["all_dll_names"] = list(assemblies.keys())

    SKIP_PREFIXES = ("microsoft.", "system.", "mudblazor", "blazor", "netstandard",
                     "mscorlib", "mono.", "mono_", "runtime.", "nuget.")
    app_dlls = [n for n in assemblies if not any(n.lower().startswith(p) for p in SKIP_PREFIXES)]
    result["app_dlls"] = app_dlls

    for dll_name in app_dlls:
        dll_info: Dict[str, Any] = {"name": dll_name, "status": None, "size_kb": None,
                                     "contains_nexar": False, "match_utf8": None, "match_utf16": None}
        try:
            dll_r = client.session.get(f"{framework_url}/{dll_name}", verify=EMS_VERIFY_SSL, timeout=20)
            dll_info["status"] = dll_r.status_code
            if dll_r.status_code != 200:
                continue
            content = dll_r.content
            dll_info["size_kb"] = round(len(content) / 1024, 1)
            dll_info["contains_nexar"] = b"nexar" in content.lower()
            if dll_info["contains_nexar"]:
                result["nexar_dlls"].append(dll_name)
                # UTF-8
                text8 = content.decode("utf-8", errors="ignore")
                cid, csec = _search_text_for_nexar_creds(text8)
                if cid:
                    dll_info["match_utf8"] = {"client_id": cid, "client_secret": "***"}
                    result["extracted_client_id"] = cid
                # UTF-16LE
                text16 = content.decode("utf-16-le", errors="ignore")
                cid16, csec16 = _search_text_for_nexar_creds(text16)
                if cid16:
                    dll_info["match_utf16"] = {"client_id": cid16, "client_secret": "***"}
                    result["extracted_client_id"] = cid16
                # Contexto alrededor de "nexar" en UTF-8 para inspección manual
                snippets = []
                for m in re.finditer(r'.{0,120}nexar.{0,120}', text8, re.IGNORECASE):
                    snippets.append(m.group(0))
                    if len(snippets) >= 8:
                        break
                dll_info["nexar_context_utf8"] = snippets
        except requests.exceptions.RequestException as e:
            dll_info["error"] = str(e)
        if dll_info["contains_nexar"] or dll_info.get("error"):
            result["credential_search_results"].append(dll_info)

    return result


@app.post("/internal-query")
def internal_query(request: InternalQueryRequest):
    """
    Consulta InternalQuery enviando una lista de MPNs.
    """
    client = get_client()
    results = client.internal_query(request.mpns)

    return {
        "count": len(results),
        "data": results
    }


@app.get("/internal-query")
def internal_query_get(
    mpns: str = Query(
        ...,
        description="MPNs separados por coma. Ejemplo: GRM1555C1H271JA01D,UMK105CG271JV-F"
    )
):
    """
    Consulta rápida usando query string.
    """
    mpn_list = [x.strip() for x in mpns.split(",") if x.strip()]

    client = get_client()
    results = client.internal_query(mpn_list)

    return {
        "count": len(results),
        "data": results
    }


@app.post("/internal-query/excel")
def internal_query_excel(request: InternalQueryRequest):
    """
    Consulta InternalQuery y devuelve un archivo Excel.
    """
    client = get_client()
    results = client.internal_query(request.mpns)

    df = pd.DataFrame(results)

    output = BytesIO()

    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="InternalQuery")

    output.seek(0)

    headers = {
        "Content-Disposition": "attachment; filename=ems_internal_query_results.xlsx"
    }

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers
    )


@app.post("/ampl-by-material")
def ampl_by_material(request: AmplRequest):
    """
    Consulta SAP AMPL por número de componente interno (BMATN).
    Devuelve los MfgPartNumbers activos con su conteo, y separa bloqueados/eliminados.
    """
    items = fetch_ampl_from_sap(request.internal_part_number)
    result = process_ampl_results(items)
    return {
        "internal_part_number": request.internal_part_number.strip().upper(),
        **result
    }


@app.get("/ampl-by-material")
def ampl_by_material_get(
    bmatn: str = Query(..., description="Número de componente interno. Ejemplo: EC03018")
):
    """
    Consulta rápida AMPL por query string.
    """
    items = fetch_ampl_from_sap(bmatn)
    result = process_ampl_results(items)
    return {
        "internal_part_number": bmatn.strip().upper(),
        **result
    }


@app.post("/ampl-by-material/excel")
def ampl_by_material_excel(request: AmplRequest):
    """
    Consulta SAP AMPL y devuelve un Excel con tres hojas: Activos, Bloqueados, Eliminados.
    """
    items = fetch_ampl_from_sap(request.internal_part_number)
    result = process_ampl_results(items)

    output = BytesIO()

    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df_active = pd.DataFrame(result["active"])
        df_active.to_excel(writer, index=False, sheet_name="Activos")

        if result["blocked"]:
            df_blocked = pd.DataFrame(result["blocked"])
            df_blocked.to_excel(writer, index=False, sheet_name="Bloqueados")

        if result["deleted"]:
            df_deleted = pd.DataFrame(result["deleted"])
            df_deleted.to_excel(writer, index=False, sheet_name="Eliminados")

    output.seek(0)

    filename = f"ampl_{request.internal_part_number.strip().upper()}.xlsx"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers
    )


# ──────────────────────────────────────────────────────────────────────────────
# Nexar market prices
# ──────────────────────────────────────────────────────────────────────────────

def _fetch_oauth_token_with(client_id: str, client_secret: str, cache: Dict[str, Any]) -> str:
    """Obtiene un token OAuth usando las credenciales dadas y lo guarda en el cache indicado."""
    resp = requests.post(
        NEXAR_TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    cache["token"] = data["access_token"]
    cache["expires_at"] = time.time() + data.get("expires_in", 3600)
    return cache["token"]


def _search_text_for_nexar_creds(text: str) -> tuple:
    """Busca clientId/clientSecret de Nexar en texto (JSON, UTF-8 o UTF-16 decodificado)."""
    uuid_pat = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    secret_pat = r'[A-Za-z0-9_\-\.~]{16,}'
    patterns = [
        (rf'"clientId"\s*:\s*"({uuid_pat})".*?"clientSecret"\s*:\s*"({secret_pat})"', 1, 2),
        (rf'"clientSecret"\s*:\s*"({secret_pat})".*?"clientId"\s*:\s*"({uuid_pat})"', 2, 1),
        (rf'clientId\s*[:=]\s*["`]({uuid_pat})["`].{{0,400}}?clientSecret\s*[:=]\s*["`]({secret_pat})["`]', 1, 2),
        (rf'clientSecret\s*[:=]\s*["`]({secret_pat})["`].{{0,400}}?clientId\s*[:=]\s*["`]({uuid_pat})["`]', 2, 1),
    ]
    for pattern, cid_group, csec_group in patterns:
        m = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
        if m:
            return m.group(cid_group), m.group(csec_group)
    return None, None


EMS_NEXAR_TOKEN_URL = "https://www.ems.keint.com/materials/comp-search/api/NexarToken"


def _fetch_nexar_token_from_ems() -> str:
    """
    Obtiene un token Nexar directamente del endpoint de EMS (api/NexarToken).
    Usa las cookies de EMS ya configuradas — sin configuración adicional.
    El token se cachea en _ems_nexar_token_cache con su expiración real.
    """
    try:
        client = get_client()
    except HTTPException:
        raise HTTPException(
            status_code=500,
            detail="Cookies de EMS no configuradas. Son necesarias para obtener el token Nexar automáticamente."
        )
    try:
        resp = client.session.get(EMS_NEXAR_TOKEN_URL, verify=EMS_VERIFY_SSL, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error obteniendo token Nexar desde EMS: {e}")
    except ValueError:
        raise HTTPException(status_code=502, detail="EMS devolvió una respuesta inválida en api/NexarToken")

    token = data.get("access_token") or data.get("token") or data.get("accessToken")
    if not token:
        raise HTTPException(
            status_code=502,
            detail=f"EMS api/NexarToken no devolvió access_token. Respuesta: {str(data)[:300]}"
        )
    expires_in = data.get("expires_in", 3600)
    _ems_nexar_token_cache["token"] = token
    _ems_nexar_token_cache["expires_at"] = time.time() + expires_in
    return token


def get_nexar_token() -> str:
    # Modo 1: token directo en .env
    if NEXAR_TOKEN_STATIC:
        return NEXAR_TOKEN_STATIC

    # Modo 2: OAuth con credenciales propias configuradas en .env
    if NEXAR_CLIENT_ID and NEXAR_CLIENT_SECRET:
        if _nexar_token_cache["token"] and time.time() < _nexar_token_cache["expires_at"] - 60:
            return _nexar_token_cache["token"]
        try:
            return _fetch_oauth_token_with(NEXAR_CLIENT_ID, NEXAR_CLIENT_SECRET, _nexar_token_cache)
        except requests.exceptions.RequestException as e:
            raise HTTPException(status_code=502, detail=f"Error obteniendo token Nexar: {str(e)}")

    # Modo 3 (automático): llama al endpoint api/NexarToken de EMS con las cookies ya configuradas
    if _ems_nexar_token_cache["token"] and time.time() < _ems_nexar_token_cache["expires_at"] - 60:
        return _ems_nexar_token_cache["token"]
    return _fetch_nexar_token_from_ems()


def _unit_price_for_qty(prices: List[Dict], qty: int) -> Optional[float]:
    """Precio unitario USD para la cantidad solicitada usando el tier más alto <= qty."""
    if not prices:
        return None
    sorted_p = sorted(prices, key=lambda p: p.get("quantity", 0))
    applicable = [p for p in sorted_p if p.get("quantity", 0) <= qty]
    source = applicable[-1] if applicable else sorted_p[0]
    return source.get("convertedPrice")


def _call_nexar(token: str, queries: list) -> dict:
    resp = requests.post(
        NEXAR_GRAPHQL_URL,
        json={
            "query": _NEXAR_QUERY,
            "variables": {"queries": queries},
            "operationName": "MultiMatchSearch",
        },
        headers={"Content-Type": "application/json", "token": token},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


@app.post("/market-prices")
def market_prices(request: NexarRequest):
    """
    Consulta Nexar (api.nexar.com) para obtener precios de mercado de los MPNs dados.
    Devuelve los proveedores ordenados por precio unitario para la cantidad solicitada.
    """
    if not request.mpns:
        raise HTTPException(status_code=400, detail="Lista de MPNs vacía.")

    token = get_nexar_token()
    queries = [{"mpn": mpn, "start": 0, "limit": 50} for mpn in request.mpns[:50]]

    try:
        data = _call_nexar(token, queries)
    except requests.exceptions.HTTPError as e:
        # Si devuelve 401 y usamos OAuth, invalida caché y reintenta una vez
        if e.response is not None and e.response.status_code == 401 and not NEXAR_TOKEN_STATIC:
            # Invalida caché correspondiente y reintenta
            if NEXAR_CLIENT_ID and NEXAR_CLIENT_SECRET:
                _nexar_token_cache["token"] = None
                _nexar_token_cache["expires_at"] = 0.0
            else:
                _ems_nexar_token_cache["token"] = None
                _ems_nexar_token_cache["expires_at"] = 0.0
            try:
                token = get_nexar_token()
                data = _call_nexar(token, queries)
            except requests.exceptions.RequestException as e2:
                raise HTTPException(status_code=502, detail=f"Error consultando Nexar: {str(e2)}")
        else:
            raise HTTPException(status_code=502, detail=f"Error consultando Nexar: {str(e)}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Timeout consultando Nexar.")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error consultando Nexar: {str(e)}")

    matches = (data.get("data") or {}).get("supMultiMatch", [])
    offers: List[Dict[str, Any]] = []

    for match in matches:
        for part in (match.get("parts") or []):
            mpn = part.get("mpn", "")
            manufacturer = (part.get("manufacturer") or {}).get("name", "")
            description = part.get("shortDescription", "")

            for seller in (part.get("sellers") or []):
                seller_name = (seller.get("company") or {}).get("name", "")

                for offer in (seller.get("offers") or []):
                    prices = offer.get("prices") or []
                    inventory = offer.get("inventoryLevel", 0)
                    moq = offer.get("moq") or 1
                    click_url = offer.get("clickUrl", "")
                    packaging = offer.get("packaging") or ""

                    if not prices:
                        continue

                    unit_price = _unit_price_for_qty(prices, request.quantity)
                    if unit_price is None:
                        continue

                    offers.append({
                        "mpn": mpn,
                        "manufacturer": manufacturer,
                        "description": description,
                        "seller": seller_name,
                        "unit_price_usd": round(unit_price, 6),
                        "total_price_usd": round(unit_price * request.quantity, 2),
                        "inventory": inventory,
                        "moq": moq,
                        "can_fulfill": request.quantity >= moq,
                        "packaging": packaging,
                        "click_url": click_url,
                    })

    in_stock = sorted(
        [o for o in offers if o["can_fulfill"] and o["inventory"] > 0],
        key=lambda x: x["unit_price_usd"]
    )
    fulfillable_no_stock = sorted(
        [o for o in offers if o["can_fulfill"] and o["inventory"] == 0],
        key=lambda x: x["unit_price_usd"]
    )
    non_fulfillable = sorted(
        [o for o in offers if not o["can_fulfill"]],
        key=lambda x: x["unit_price_usd"]
    )
    sorted_offers = in_stock + fulfillable_no_stock + non_fulfillable

    best_offer = (
        in_stock[0] if in_stock
        else fulfillable_no_stock[0] if fulfillable_no_stock
        else sorted_offers[0] if sorted_offers
        else None
    )

    return {
        "quantity": request.quantity,
        "total_offers": len(sorted_offers),
        "best_offer": best_offer,
        "offers": sorted_offers,
    }