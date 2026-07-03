"""Merge multiple M3U playlists with de-duplication and smart naming."""

from __future__ import annotations

import re
from collections import OrderedDict, defaultdict
from typing import Any

_ATTR_RE = re.compile(r'([A-Za-z0-9_-]+)="([^"]*)"')
_DURATION_RE = re.compile(r"\s*(-?\d+(?:\.\d+)?)")

# Preferred attribute order when rebuilding EXTINF lines.
_ATTR_ORDER = ["tvg-id", "tvg-name", "tvg-logo", "tvg-shift", "tvg-chno", "group-title"]

# Generic/placeholder names that should lose to more descriptive ones.
_GENERIC_NAMES = {"", "unknown", "unknown channel", "no name", "channel", "n/a", "-"}


def parse_extinf(extinf: str) -> tuple[str, "OrderedDict[str, str]", str]:
    """Parse an #EXTINF line into (duration, attrs, display_name)."""
    body = extinf[len("#EXTINF:"):] if extinf.upper().startswith("#EXTINF:") else extinf

    comma_idx = body.rfind(",")
    if comma_idx != -1:
        attr_part = body[:comma_idx]
        display = body[comma_idx + 1:].strip()
    else:
        attr_part = body
        display = ""

    duration_match = _DURATION_RE.match(attr_part)
    duration = duration_match.group(1) if duration_match else "-1"

    attrs: "OrderedDict[str, str]" = OrderedDict()
    for key, value in _ATTR_RE.findall(attr_part):
        attrs[key.lower()] = value

    return duration, attrs, display


def parse_playlist(text: str, source: str = "") -> list[dict[str, Any]]:
    """Parse playlist text into channel dicts with full attribute info."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    channels: list[dict[str, Any]] = []

    pending_extinf: str | None = None
    pending_group: str | None = None

    for raw in lines:
        line = raw.strip()
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

        duration, attrs, display = ("-1", OrderedDict(), "")
        if pending_extinf is not None:
            duration, attrs, display = parse_extinf(pending_extinf)

        if pending_group and "group-title" not in attrs:
            attrs["group-title"] = pending_group

        if not display:
            display = attrs.get("tvg-name", "") or "Unknown Channel"

        channels.append(
            {
                "duration": duration,
                "attrs": attrs,
                "display": display,
                "url": line,
                "source": source,
            }
        )
        pending_extinf = None
        pending_group = None

    return channels


def _info_score(channel: dict[str, Any]) -> int:
    """Higher score = more useful metadata."""
    score = 0
    for value in channel["attrs"].values():
        if value and value.strip():
            score += len(value.strip())
    if channel["display"].strip():
        score += len(channel["display"].strip())
    return score


def _pick_best_name(names: list[str]) -> str:
    """Pick the most meaningful display name from candidates."""
    cleaned = [n.strip() for n in names if n and n.strip()]
    if not cleaned:
        return "Unknown Channel"

    non_generic = [n for n in cleaned if n.lower() not in _GENERIC_NAMES]
    pool = non_generic or cleaned

    # Prefer the longest (most descriptive) name.
    return max(pool, key=len)


def _merge_same_url(channels: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge channels that share the same URL, keeping the richest info."""
    merged_attrs: "OrderedDict[str, str]" = OrderedDict()

    # Iterate richest-first so the best values seed the map.
    for channel in sorted(channels, key=_info_score, reverse=True):
        for key, value in channel["attrs"].items():
            if not value or not value.strip():
                continue
            existing = merged_attrs.get(key, "")
            if len(value.strip()) > len(existing.strip()):
                merged_attrs[key] = value

    display = _pick_best_name([c["display"] for c in channels])
    duration = channels[0]["duration"]

    return {
        "duration": duration,
        "attrs": merged_attrs,
        "display": display,
        "url": channels[0]["url"],
    }


def merge_playlists(playlists: list[tuple[str, str]]) -> dict[str, Any]:
    """
    Merge playlists.

    playlists: list of (filename, text).
    Returns dict with merged channel list and stats.
    """
    all_channels: list[dict[str, Any]] = []
    for filename, text in playlists:
        all_channels.extend(parse_playlist(text, source=filename))

    total_input = len(all_channels)

    # 1) Group by URL (normalized) preserving first-seen order.
    url_groups: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()
    for channel in all_channels:
        key = channel["url"].strip()
        url_groups.setdefault(key, []).append(channel)

    merged: list[dict[str, Any]] = []
    duplicates_removed = 0
    for group in url_groups.values():
        if len(group) > 1:
            duplicates_removed += len(group) - 1
        merged.append(_merge_same_url(group))

    # 2) Rename same-name channels that have different URLs.
    name_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for channel in merged:
        name_groups[channel["display"].strip().lower()].append(channel)

    renamed = 0
    for group in name_groups.values():
        if len(group) > 1:
            for idx, channel in enumerate(group, start=1):
                base = channel["display"].strip()
                channel["display"] = f"{base} {idx}"
                if "tvg-name" in channel["attrs"] and channel["attrs"]["tvg-name"].strip():
                    channel["attrs"]["tvg-name"] = channel["display"]
                renamed += 1

    stats = {
        "files": len(playlists),
        "total_input": total_input,
        "total_output": len(merged),
        "duplicates_removed": duplicates_removed,
        "renamed": renamed,
    }

    return {"channels": merged, "stats": stats}


def build_extinf(channel: dict[str, Any]) -> str:
    """Rebuild an #EXTINF line from a merged channel."""
    attrs: "OrderedDict[str, str]" = channel["attrs"]

    ordered_keys = [k for k in _ATTR_ORDER if k in attrs]
    ordered_keys += [k for k in attrs if k not in _ATTR_ORDER]

    attr_str = " ".join(f'{k}="{attrs[k]}"' for k in ordered_keys if attrs[k] != "")
    line = f"#EXTINF:{channel['duration']}"
    if attr_str:
        line += f" {attr_str}"
    line += f",{channel['display']}"
    return line


def build_merged_m3u(channels: list[dict[str, Any]]) -> str:
    """Build merged playlist text."""
    lines = ["#EXTM3U"]
    for channel in channels:
        lines.append(build_extinf(channel))
        lines.append(channel["url"])
    return "\n".join(lines) + "\n"
