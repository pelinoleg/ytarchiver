"""Hardware sensor readings for the dashboard — CPU + disk temperature.

CPU temp comes free from the kernel thermal zone (readable inside the
container — same kernel, no privileges). Disk temp needs ``smartctl`` against
the raw block device, which requires the device be passed into the container
plus the SYS_RAWIO capability (see docker-compose). Both are best-effort: if a
reading isn't available the field is simply ``None`` and the UI hides it.

Readings are cached briefly so polling the endpoint doesn't spin up smartctl
(and the disk) on every request.
"""
from __future__ import annotations

import logging
import re
import subprocess
import time
from pathlib import Path

from config import settings

log = logging.getLogger(__name__)

_TTL = 60.0  # seconds — cache window so we don't poke the drive every poll
_cache: dict[str, float | None] = {}
_cached_at = 0.0

_THERMAL_ZONE = Path("/sys/class/thermal/thermal_zone0/temp")
# USB SAT bridges (e.g. the Samsung T7) print a bare "Temperature:  44 Celsius".
_PLAIN_RE = re.compile(r"Temperature:\s+(\d+)\s+Celsius", re.IGNORECASE)


def _cpu_temp() -> float | None:
    try:
        return round(int(_THERMAL_ZONE.read_text().strip()) / 1000.0, 1)
    except (OSError, ValueError):
        return None


def _disk_temp() -> float | None:
    dev = settings.disk_device.strip()
    if not dev:
        return None
    try:
        out = subprocess.run(
            ["smartctl", "-A", dev],
            capture_output=True, text=True, timeout=15,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    # Path 1: the plain "Temperature: N Celsius" line (USB SSDs, NVMe).
    m = _PLAIN_RE.search(out)
    if m:
        return float(m.group(1))
    # Path 2: a classic SMART attribute table row — RAW_VALUE is column 10.
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 10 and parts[0].isdigit() and "Temperature" in line:
            try:
                return float(parts[9])
            except ValueError:
                continue
    return None


def read_sensors() -> dict[str, float | None]:
    """``{"cpu_temp": °C|None, "disk_temp": °C|None}`` — cached for ``_TTL``s."""
    global _cached_at
    now = time.monotonic()
    if not _cache or now - _cached_at > _TTL:
        _cache.clear()
        _cache["cpu_temp"] = _cpu_temp()
        _cache["disk_temp"] = _disk_temp()
        _cached_at = now
    return dict(_cache)
