"""
extract_ems_cookies.py
----------------------
Obtains EMS ASP.NET Core session cookies fully automatically using two
complementary strategies:

  Strategy 1 — Headless browser (Playwright + system Edge):
      Launches a hidden Edge window, navigates to EMS. Azure AD redirects
      to login.microsoftonline.com; Chromium uses the current Windows
      credentials (Kerberos / NTLM) via --auth-server-whitelist to complete
      the OIDC flow silently. No user interaction required on domain-joined
      machines. Works while Edge is open or closed.

  Strategy 2 — Edge SQLite fallback:
      If the headless approach yields no cookies, reads them directly from
      Edge's encrypted cookie database. Works only when Edge is fully closed
      (otherwise the file is locked). Decrypts using DPAPI + AES-256-GCM.

The two strategies are complementary:
  • Edge open   → Strategy 1 succeeds (SSO), Strategy 2 fails (locked)
  • Edge closed → Strategy 1 may fail (no existing session), Strategy 2 succeeds

If both fail, existing .env cookies are preserved as-is.

Called automatically by launch.ps1 on every startup.
"""

import os
import sys
import shutil
import sqlite3
import tempfile
import warnings
from pathlib import Path
from dotenv import set_key, dotenv_values, load_dotenv

# ── Bootstrap ─────────────────────────────────────────────────────────────────
ENV_PATH = Path(__file__).parent / ".env"
load_dotenv(ENV_PATH, override=False)

# ── Configuration ─────────────────────────────────────────────────────────────
EMS_URL        = "https://www.ems.keint.com/materials/comp-search/"
EMS_HOSTNAME   = "www.ems.keint.com"
EMS_VERIFY_SSL = os.getenv("EMS_VERIFY_SSL", "true").lower() not in ("false", "0", "no")
TIMEOUT_MS     = 30_000

COOKIE_MAP: dict[str, str] = {
    ".AspNetCore.Cookies":   "EMS_COOKIE_MAIN",
    ".AspNetCore.CookiesC1": "EMS_COOKIE_C1",
    ".AspNetCore.CookiesC2": "EMS_COOKIE_C2",
    ".AspNetCore.CookiesC3": "EMS_COOKIE_C3",
}

# Chromium flags that enable transparent Windows NTLM/Kerberos auth for Azure AD
_SSO_ARGS = [
    "--auth-server-whitelist=login.microsoftonline.com,*.microsoftonline.com",
    "--auth-negotiate-delegate-whitelist=login.microsoftonline.com,*.microsoftonline.com",
    "--disable-extensions",
    "--no-sandbox",
    "--disable-background-networking",
]

# Edge cookie database paths (several profile variants)
_EDGE_COOKIE_PATHS: list[Path] = [
    Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Edge/User Data/Default/Network/Cookies",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Edge/User Data/Default/Cookies",
    Path(os.environ.get("APPDATA",      "")) / "Microsoft/Edge/User Data/Default/Network/Cookies",
]

# ═══════════════════════════════════════════════════════════════════════════════
# Strategy 1 — Playwright headless browser (Azure AD SSO)
# ═══════════════════════════════════════════════════════════════════════════════

def extract_cookies_playwright() -> dict[str, str]:
    """
    Launch a headless Edge/Chromium instance with Windows SSO flags,
    navigate to EMS, and collect the resulting session cookies.
    """
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    with sync_playwright() as pw:
        browser = None

        # Prefer the system's installed Edge (no download needed).
        # Fall back to bundled Playwright Chromium if Edge is not found.
        for channel, label in [("msedge", "Edge"), (None, "Chromium")]:
            try:
                kwargs: dict = dict(headless=True, args=_SSO_ARGS)
                if channel:
                    kwargs["channel"] = channel
                browser = pw.chromium.launch(**kwargs)
                break
            except Exception:
                if channel is None:
                    raise  # both failed

        ctx = browser.new_context(ignore_https_errors=not EMS_VERIFY_SSL)
        page = ctx.new_page()

        print(f"  [{label}] Navigating to EMS (headless)...")
        try:
            page.goto(EMS_URL, wait_until="networkidle", timeout=TIMEOUT_MS)
        except PWTimeout:
            pass  # networkidle timeout is fine — page may have loaded
        except Exception as exc:
            browser.close()
            raise RuntimeError(str(exc)) from exc

        found = {c["name"]: c["value"] for c in ctx.cookies() if c["name"] in COOKIE_MAP}
        browser.close()
        return found


# ═══════════════════════════════════════════════════════════════════════════════
# Strategy 2 — Edge SQLite direct read (works when Edge is fully closed)
# ═══════════════════════════════════════════════════════════════════════════════

def _find_edge_cookie_db() -> Path | None:
    for p in _EDGE_COOKIE_PATHS:
        if p.exists():
            return p
    return None


def _get_local_state_key() -> bytes | None:
    """Extract and DPAPI-decrypt the AES-256 master key from Edge's Local State."""
    try:
        import base64, json
        import win32crypt  # type: ignore[import]

        ls = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Edge/User Data/Local State"
        if not ls.exists():
            return None
        with open(ls, "r", encoding="utf-8") as f:
            state = json.load(f)
        raw = base64.b64decode(state["os_crypt"]["encrypted_key"])[5:]  # strip "DPAPI" prefix
        _, key = win32crypt.CryptUnprotectData(raw, None, None, None, 0)
        return key
    except Exception:
        return None


def _decrypt_cookie(encrypted_value: bytes) -> str | None:
    if not encrypted_value:
        return None
    # v10/v11/v20 → AES-256-GCM with DPAPI-protected key
    if encrypted_value[:3] in (b"v10", b"v11", b"v20"):
        try:
            from Crypto.Cipher import AES  # pycryptodome
            key = _get_local_state_key()
            if key is None:
                return None
            iv         = encrypted_value[3:15]
            ciphertext = encrypted_value[15:-16]
            tag        = encrypted_value[-16:]
            return AES.new(key, AES.MODE_GCM, nonce=iv).decrypt_and_verify(ciphertext, tag).decode("utf-8", errors="replace")
        except Exception:
            return None
    # Legacy DPAPI-only scheme
    try:
        import win32crypt  # type: ignore[import]
        _, plaintext = win32crypt.CryptUnprotectData(encrypted_value, None, None, None, 0)
        return plaintext.decode("utf-8", errors="replace")
    except Exception:
        return None


def extract_cookies_sqlite() -> dict[str, str]:
    """
    Read EMS cookies directly from Edge's SQLite database.
    Raises RuntimeError with a clear user-facing message when Edge is open
    (file is locked).
    """
    db_path = _find_edge_cookie_db()
    if db_path is None:
        raise RuntimeError("Edge cookie database not found. Install Edge and visit EMS once.")

    tmp = Path(tempfile.mktemp(suffix=".db"))
    try:
        shutil.copy2(db_path, tmp)
    except (OSError, PermissionError) as exc:
        code = getattr(exc, "winerror", 0) or getattr(exc, "errno", 0)
        if code in (13, 32):
            raise RuntimeError(
                "Edge is open — database is locked.\n"
                "  Close all Edge windows and relaunch to refresh cookies.\n"
                "  Existing .env cookies will be kept in the meantime."
            ) from exc
        raise

    try:
        conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
        rows = conn.execute(
            "SELECT name, encrypted_value FROM cookies WHERE host_key LIKE ?",
            (f"%{EMS_HOSTNAME}%",),
        ).fetchall()
        conn.close()
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass

    return {
        name: dec
        for name, enc in rows
        if name in COOKIE_MAP and (dec := _decrypt_cookie(enc))
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Shared helpers
# ═══════════════════════════════════════════════════════════════════════════════

def write_to_env(cookies: dict[str, str]) -> None:
    ENV_PATH.touch(exist_ok=True)
    for cookie_name, env_key in COOKIE_MAP.items():
        value = cookies.get(cookie_name)
        if value:
            set_key(str(ENV_PATH), env_key, value, quote_mode="always")
    print(f"  [OK] .env updated — {len(cookies)} cookie(s) written")


# ═══════════════════════════════════════════════════════════════════════════════
# Entry point — cascading fallback
# ═══════════════════════════════════════════════════════════════════════════════

def main() -> int:
    print("\nObtaining EMS session cookies automatically...")

    # ── Strategy 1: Playwright headless browser ────────────────────────────
    playwright_available = True
    try:
        import playwright  # noqa: F401
    except ImportError:
        playwright_available = False
        print("  [SKIP] Playwright not installed, skipping headless browser approach.")

    if playwright_available:
        try:
            cookies = extract_cookies_playwright()
            if cookies:
                write_to_env(cookies)
                print("  [OK] Session obtained via headless browser (Azure AD SSO)\n")
                return 0
            print("  [WARN] Headless browser: no cookies returned (SSO may need manual login).")
        except Exception as exc:
            print(f"  [WARN] Headless browser failed: {exc}")

    # ── Strategy 2: Edge SQLite direct read ───────────────────────────────
    print("  Trying Edge cookie database fallback...")
    try:
        cookies = extract_cookies_sqlite()
        if cookies:
            write_to_env(cookies)
            print("  [OK] Session read from Edge cookie database\n")
            return 0
        print("  [WARN] No EMS cookies found in Edge database. Visit EMS in Edge first.")
    except RuntimeError as exc:
        print(f"  [WARN] {exc}")
    except Exception as exc:
        print(f"  [WARN] SQLite fallback failed: {exc}")

    # ── Last resort: keep whatever is in .env ─────────────────────────────
    loaded = dotenv_values(ENV_PATH)
    has_existing = any(loaded.get(v) for v in COOKIE_MAP.values())
    if has_existing:
        print("  [INFO] Keeping existing .env cookies (may expire if older than ~24h).\n")
        return 0

    print(
        "\n  [ERR] No EMS cookies available.\n"
        "  To fix: open Edge, visit https://www.ems.keint.com, log in, then relaunch.\n"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
