"""Folder-driven WireGuard exit pool.

Drop ``*.conf`` WireGuard files into ``settings.wireguard_configs_dir`` and this
supervisor brings up one gluetun tunnel per file (via the Docker socket), each
fronted by an HTTP proxy, then exposes the **healthy** ones as proxies that
yt-dlp rotates through (see ``ytdlp_service``). Stale / broken configs never go
healthy, so they're simply skipped — with no working tunnels the app downloads
directly. Everything here is best-effort: any failure is swallowed and leaves
downloads working on the direct connection.

Requires (wired in docker-compose):
  • the Docker socket mounted into the backend (/var/run/docker.sock),
  • the configs folder mounted (WIREGUARD_CONFIGS_DIR),
  • VPN_DOCKER_NETWORK = the compose network so the backend can reach the
    spawned ``wgvpn-*`` containers by name.
"""
from __future__ import annotations

import glob
import hashlib
import ipaddress
import logging
import os
import re
import socket
import threading
import time

from config import settings

log = logging.getLogger(__name__)

_GLUETUN_IMAGE = "qmcgaw/gluetun"
_LABEL = "es.pelin.ytarchiver.vpn"   # marks the containers we own
_PROXY_PORT = 8888
_POLL_SECONDS = 180
_QUARANTINE_AFTER = 300              # secs a tunnel may stay unhealthy before parking
_RETRY_EVERY = 1800                  # secs a parked config waits before another attempt

_lock = threading.Lock()
_proxies: list[str] = []             # current HEALTHY proxy URLs
# Per-config health bookkeeping so we don't run dead tunnels 24/7:
#   {name: {"unhealthy_since": float|None, "retry_after": float}}
_state: dict[str, dict] = {}
_stop = threading.Event()


def current_proxies() -> list[str]:
    """Healthy gluetun proxy URLs discovered from the configs folder."""
    with _lock:
        return list(_proxies)


def _set_proxies(lst: list[str]) -> None:
    global _proxies
    with _lock:
        _proxies = lst


# ── config parsing ───────────────────────────────────────────────────────────

def _parse_conf(path: str) -> dict | None:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            txt = fh.read()
    except OSError:
        return None

    def grab(key: str) -> str | None:
        m = re.search(rf"(?im)^\s*{key}\s*=\s*(.+?)\s*$", txt)
        return m.group(1).strip() if m else None

    priv, pub = grab("PrivateKey"), grab("PublicKey")
    addr, endpoint, psk = grab("Address"), grab("Endpoint"), grab("PresharedKey")
    if not (priv and pub and addr and endpoint):
        return None

    host, _, port = endpoint.rpartition(":")
    port = port or "51820"
    try:
        ipaddress.ip_address(host)
        ip = host
    except ValueError:
        try:
            ip = socket.gethostbyname(host)   # gluetun wants an IP, resolve hostnames
        except OSError:
            return None

    addresses = ",".join(a.strip() for a in addr.split(",") if a.strip())
    return {"private": priv, "public": pub, "psk": psk,
            "addresses": addresses, "endpoint_ip": ip, "endpoint_port": port}


def _name_for(path: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", os.path.basename(path).lower()).strip("-")[:24]
    digest = hashlib.sha1(path.encode()).hexdigest()[:6]
    return f"wgvpn-{slug}-{digest}"


def _gluetun_env(conf: dict) -> dict:
    env = {
        "VPN_SERVICE_PROVIDER": "custom",
        "VPN_TYPE": "wireguard",
        "WIREGUARD_PRIVATE_KEY": conf["private"],
        "WIREGUARD_PUBLIC_KEY": conf["public"],
        "WIREGUARD_ADDRESSES": conf["addresses"],
        "VPN_ENDPOINT_IP": conf["endpoint_ip"],
        "VPN_ENDPOINT_PORT": conf["endpoint_port"],
        "HTTPPROXY": "on",
        "FIREWALL_OUTBOUND_SUBNETS": "172.16.0.0/12",
    }
    if conf.get("psk"):
        env["WIREGUARD_PRESHARED_KEY"] = conf["psk"]
    return env


# ── docker orchestration ─────────────────────────────────────────────────────

def _client():
    import docker  # lazy — keeps the SDK optional if the socket isn't mounted
    return docker.from_env()


def _safe_remove(container) -> None:
    try:
        container.remove(force=True)
    except Exception:
        pass


def _run_gluetun(client, name: str, conf: dict, network: str | None) -> None:
    try:
        try:
            client.images.get(_GLUETUN_IMAGE)
        except Exception:
            log.info("vpn: pulling %s", _GLUETUN_IMAGE)
            client.images.pull(_GLUETUN_IMAGE)
        client.containers.run(
            _GLUETUN_IMAGE,
            name=name,
            detach=True,
            restart_policy={"Name": "unless-stopped"},
            cap_add=["NET_ADMIN"],
            devices=["/dev/net/tun:/dev/net/tun:rwm"],
            environment=_gluetun_env(conf),
            labels={_LABEL: "1"},
            network=network,
        )
        log.info("vpn: started tunnel %s → %s", name, conf["endpoint_ip"])
    except Exception:
        log.exception("vpn: failed to start tunnel %s", name)


def reconcile() -> None:
    """Make the running ``wgvpn-*`` set match the configs folder, then refresh
    the healthy-proxy list. Never raises."""
    cfg_dir = settings.wireguard_configs_dir
    if not cfg_dir or not os.path.isdir(cfg_dir):
        _set_proxies([])
        return
    try:
        client = _client()
        files = sorted(glob.glob(os.path.join(cfg_dir, "*.conf")))
        desired: dict[str, dict] = {}
        for f in files:
            conf = _parse_conf(f)
            if conf:
                desired[_name_for(f)] = conf
            else:
                log.warning("vpn: skipping unparseable config %s", os.path.basename(f))

        existing = {c.name: c for c in
                    client.containers.list(all=True, filters={"label": _LABEL})}

        # Tear down (and forget) tunnels whose config file is gone.
        for name, cont in existing.items():
            if name not in desired:
                log.info("vpn: removing stale tunnel %s", name)
                _safe_remove(cont)
                _state.pop(name, None)

        network = settings.vpn_docker_network or None
        now = time.time()
        healthy: list[str] = []

        for name, conf in desired.items():
            st = _state.setdefault(name, {"unhealthy_since": None, "retry_after": 0.0})
            cont = existing.get(name)

            # Parked dead config — stay torn down until its retry window opens.
            if st["retry_after"] > now:
                if cont is not None:
                    _safe_remove(cont)
                continue

            # (Re)create if missing or not running.
            if cont is None or cont.status != "running":
                if cont is not None:
                    _safe_remove(cont)
                _run_gluetun(client, name, conf, network)
                st["unhealthy_since"] = now
                continue

            status = (cont.attrs.get("State", {}).get("Health") or {}).get("Status")
            if status == "healthy":
                st["unhealthy_since"] = None
                healthy.append(f"http://{name}:{_PROXY_PORT}")
            else:
                if st["unhealthy_since"] is None:
                    st["unhealthy_since"] = now
                # Persistently unhealthy → park it so it stops churning, retry later.
                if now - st["unhealthy_since"] >= _QUARANTINE_AFTER:
                    log.info("vpn: parking unhealthy tunnel %s for %ds", name, _RETRY_EVERY)
                    _safe_remove(cont)
                    st["unhealthy_since"] = None
                    st["retry_after"] = now + _RETRY_EVERY

        _set_proxies(healthy)
        parked = sum(1 for s in _state.values() if s["retry_after"] > now)
        log.info("vpn: %d config(s), %d healthy, %d parked", len(desired), len(healthy), parked)
    except Exception:
        # Docker socket missing, SDK absent, daemon hiccup … keep the last good
        # list rather than yanking working tunnels on a transient error.
        log.exception("vpn: reconcile failed (non-fatal) — downloads continue")


# ── lifecycle ────────────────────────────────────────────────────────────────

def start() -> None:
    """Launch the background reconcile loop (no-op when no folder configured)."""
    if not settings.wireguard_configs_dir:
        return
    _stop.clear()

    def _loop() -> None:
        while True:
            try:
                reconcile()
            except Exception:
                log.exception("vpn: supervisor loop error")
            if _stop.wait(_POLL_SECONDS):
                return

    threading.Thread(target=_loop, name="vpn-supervisor", daemon=True).start()
    log.info("vpn: supervisor watching %s", settings.wireguard_configs_dir)


def stop() -> None:
    _stop.set()
