"""Network / VPN status for the header chip.

Reports whether the last real download went through (or hit a YouTube block),
and — when the folder-driven WireGuard pool has healthy tunnels — which exit
country is active, plus a button to rotate to another exit.
"""
from datetime import datetime, timezone

from fastapi import APIRouter

from services import ytdlp_service, vpn_supervisor

router = APIRouter()


def _iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None


def _status() -> dict:
    tunnels = vpn_supervisor.tunnels_info()
    oc = ytdlp_service.last_outcome()
    pref = ytdlp_service.preferred_net()
    vpn_on = bool(tunnels)

    active = next((t for t in tunnels if t["proxy"] == pref), None)
    if active is None and tunnels:
        active = tunnels[0]

    return {
        "vpn": vpn_on,
        "country": (active or {}).get("country") if vpn_on else None,
        "exit": (active or {}).get("name") if vpn_on else None,
        "tunnels": tunnels,
        "healthy_count": len(tunnels),
        "state": oc["state"],          # ok | blocked | unknown
        "reason": oc["reason"],        # captcha | bot wall | no formats | …
        "via": oc["via"],              # which exit the last download used
        "checked_at": _iso(oc["at"]),
    }


@router.get("")
def status():
    return _status()


@router.post("/rotate")
def rotate():
    ytdlp_service.rotate_exit()
    return _status()
