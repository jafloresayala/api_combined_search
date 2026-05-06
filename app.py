import os
from collections import Counter
from typing import Any, Dict, List, Optional

import requests
import pandas as pd
import urllib3
from requests_negotiate_sspi import HttpNegotiateAuth

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
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


SAP_BASE_URL = os.getenv("SAP_GENERAL_API_BASE_URL", "http://nts5102/SapGeneralApi")


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

    return {
        "total_active": sum(x["count"] for x in active_list),
        "total_blocked": len(blocked),
        "total_deleted": len(deleted),
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