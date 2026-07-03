"""M3U parsing and URL health checking."""

from __future__ import annotations

import re
import uuid
from typing import Any
from urllib.parse import urlparse

import requests

HTTP_SCHEMES = {"http", "https"}
NON_HTTP_SCHEMES = {"rtmp", "rtsp", "udp", "rtp", "mms", "mmsh"}


def parse_m3u(text: str) -> list[dict[str, Any]]:
    """Parse M3U/M3U8 playlist text into channel dicts."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    channels: list[dict[str, Any]] = []
    pending_extinf: str | None = None
    pending_group: str | None = None

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue

        upper = line.upper()
        if upper == "#EXTM3U":
            continue

        if upper.startswith("#EXTGRP:"):
            pending_group = line.split(":", 1)[1].strip()
            continue

        if upper.startswith("#EXTINF:"):
            pending_extinf = line
            continue

        if line.startswith("#"):
            continue

        if pending_extinf is None:
            continue

        name = _extract_name(pending_extinf)
        group = _extract_group_title(pending_extinf) or pending_group or "Uncategorized"
        channel_id = str(uuid.uuid4())

        channels.append(
            {
                "id": channel_id,
                "name": name,
                "group": group,
                "url": line,
                "raw_extinf": pending_extinf,
                "status": "pending",
                "http_code": None,
            }
        )
        pending_extinf = None
        pending_group = None

    return channels


def _extract_name(extinf: str) -> str:
    tvg_match = re.search(r'tvg-name="([^"]*)"', extinf, re.IGNORECASE)
    if tvg_match and tvg_match.group(1).strip():
        return tvg_match.group(1).strip()

    comma_idx = extinf.rfind(",")
    if comma_idx != -1:
        return extinf[comma_idx + 1 :].strip()

    return "Unknown Channel"


def _extract_group_title(extinf: str) -> str | None:
    match = re.search(r'group-title="([^"]*)"', extinf, re.IGNORECASE)
    if match:
        value = match.group(1).strip()
        return value if value else None
    return None


def is_http_url(url: str) -> bool:
    scheme = urlparse(url.strip()).scheme.lower()
    return scheme in HTTP_SCHEMES


def is_non_http_stream(url: str) -> bool:
    scheme = urlparse(url.strip()).scheme.lower()
    return scheme in NON_HTTP_SCHEMES or (scheme and scheme not in HTTP_SCHEMES)


def check_url(url: str, timeout: int = 8) -> dict[str, Any]:
    """Check a single URL and return status classification."""
    url = url.strip()
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }

    try:
        response = requests.get(
            url,
            stream=True,
            timeout=(min(timeout, 5), timeout),
            allow_redirects=True,
            headers=headers,
        )
        try:
            for chunk in response.iter_content(chunk_size=1024):
                if chunk:
                    break
        finally:
            response.close()

        code = response.status_code
        if 200 <= code < 300:
            status = "online"
        else:
            status = "reachable"

        return {"status": status, "http_code": code}

    except requests.Timeout:
        return {"status": "timeout", "http_code": None}
    except requests.RequestException:
        return {"status": "offline", "http_code": None}


def check_channel(channel: dict[str, Any], timeout: int, skip_non_http: bool) -> dict[str, Any]:
    """Check one channel dict and return result fields."""
    url = channel["url"]

    if is_non_http_stream(url):
        if skip_non_http:
            return {"status": "skipped", "http_code": None}
        return {"status": "offline", "http_code": None}

    if not is_http_url(url):
        return {"status": "offline", "http_code": None}

    result = check_url(url, timeout)
    return result


def build_m3u(channels: list[dict[str, Any]], keep_ids: list[str]) -> str:
    """Rebuild M3U playlist from kept channel IDs."""
    keep_set = set(keep_ids)
    lines = ["#EXTM3U"]

    for channel in channels:
        if channel["id"] not in keep_set:
            continue
        lines.append(channel["raw_extinf"])
        lines.append(channel["url"])

    return "\n".join(lines) + "\n"
