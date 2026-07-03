"""Flask application for M3U Playlist Cleaner."""

from __future__ import annotations

import json
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any
from urllib.parse import urlparse

import requests
from flask import Flask, Response, jsonify, render_template, request, send_file
from io import BytesIO

from checker import build_m3u, check_channel, parse_m3u
from merger import build_merged_m3u, merge_playlists

app = Flask(__name__)

JOBS: dict[str, dict[str, Any]] = {}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/merge")
def merge_page():
    return render_template("merge.html")


@app.route("/merge", methods=["POST"])
def merge_action():
    files = request.files.getlist("files")
    files = [f for f in files if f and f.filename]

    if len(files) < 2:
        return jsonify({"error": "Please upload at least 2 playlists to merge"}), 400

    playlists: list[tuple[str, str]] = []
    for file in files:
        if not file.filename.lower().endswith((".m3u", ".m3u8")):
            return jsonify({"error": f"{file.filename} is not a .m3u/.m3u8 file"}), 400
        try:
            content = file.read().decode("utf-8", errors="replace")
        except Exception:
            return jsonify({"error": f"Could not read {file.filename}"}), 400
        playlists.append((file.filename, content))

    result = merge_playlists(playlists)
    channels = result["channels"]

    m3u_text = build_merged_m3u(channels)

    preview = [
        {
            "name": ch["display"],
            "group": ch["attrs"].get("group-title", ""),
            "logo": ch["attrs"].get("tvg-logo", ""),
            "url": ch["url"],
        }
        for ch in channels
    ]

    return jsonify(
        {
            "stats": result["stats"],
            "channels": preview,
            "m3u": m3u_text,
        }
    )


@app.route("/upload", methods=["POST"])
def upload():
    url = (request.form.get("url") or "").strip()

    if url:
        content, filename, error = _fetch_playlist_from_url(url)
        if error:
            return jsonify({"error": error}), 400
    else:
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        file = request.files["file"]
        if not file or not file.filename:
            return jsonify({"error": "No file selected"}), 400

        if not file.filename.lower().endswith((".m3u", ".m3u8")):
            return jsonify({"error": "Please upload a .m3u or .m3u8 file"}), 400

        try:
            content = file.read().decode("utf-8", errors="replace")
        except Exception:
            return jsonify({"error": "Could not read file"}), 400
        filename = file.filename

    channels = parse_m3u(content)
    if not channels:
        return jsonify({"error": "No channels found in playlist"}), 400

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "channels": channels,
        "filename": filename,
    }

    return jsonify(
        {
            "job_id": job_id,
            "filename": filename,
            "channels": channels,
            "total": len(channels),
        }
    )


def _fetch_playlist_from_url(url: str) -> tuple[str, str, str | None]:
    """Fetch a remote playlist. Returns (content, filename, error)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return "", "", "URL must start with http:// or https://"

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }
    try:
        resp = requests.get(url, timeout=20, headers=headers, allow_redirects=True)
        resp.raise_for_status()
    except requests.Timeout:
        return "", "", "Timed out while fetching the URL"
    except requests.RequestException as exc:
        return "", "", f"Could not fetch URL: {exc}"

    content = resp.text
    if "#EXTM3U" not in content and "#EXTINF" not in content:
        return "", "", "The URL did not return a valid M3U playlist"

    name = parsed.path.rsplit("/", 1)[-1] or "playlist"
    if not name.lower().endswith((".m3u", ".m3u8")):
        name = f"{name}.m3u" if name else "playlist.m3u"

    return content, name, None


@app.route("/check/<job_id>")
def check_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    timeout = request.args.get("timeout", 8, type=int)
    concurrent = request.args.get("concurrent", 5, type=int)
    skip_non_http = request.args.get("skip_non_http", "true").lower() == "true"

    timeout = max(5, min(timeout, 20))
    concurrent = max(3, min(concurrent, 10))
    if concurrent not in (3, 5, 10):
        concurrent = 5

    channels = job["channels"]
    total = len(channels)

    def generate():
        completed = 0

        with ThreadPoolExecutor(max_workers=concurrent) as executor:
            future_map = {
                executor.submit(check_channel, ch, timeout, skip_non_http): ch
                for ch in channels
            }

            for future in as_completed(future_map):
                channel = future_map[future]
                try:
                    result = future.result()
                except Exception:
                    result = {"status": "offline", "http_code": None}

                channel["status"] = result["status"]
                channel["http_code"] = result["http_code"]
                completed += 1

                payload = {
                    "id": channel["id"],
                    "status": channel["status"],
                    "http_code": channel["http_code"],
                    "completed": completed,
                    "total": total,
                }
                yield f"data: {json.dumps(payload)}\n\n"

        yield "event: done\ndata: {}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.route("/recheck/<job_id>", methods=["POST"])
def recheck(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    data = request.get_json(silent=True) or {}
    channel_id = data.get("id")
    timeout = data.get("timeout", 8)
    skip_non_http = data.get("skip_non_http", True)

    channel = next((c for c in job["channels"] if c["id"] == channel_id), None)
    if not channel:
        return jsonify({"error": "Channel not found"}), 404

    result = check_channel(channel, int(timeout), bool(skip_non_http))
    channel["status"] = result["status"]
    channel["http_code"] = result["http_code"]

    return jsonify(
        {
            "id": channel["id"],
            "status": channel["status"],
            "http_code": channel["http_code"],
        }
    )


@app.route("/download/<job_id>", methods=["POST"])
def download(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    data = request.get_json(silent=True) or {}
    keep_ids = data.get("keep_ids", [])

    if not keep_ids:
        return jsonify({"error": "No channels selected to keep"}), 400

    m3u_content = build_m3u(job["channels"], keep_ids)
    buffer = BytesIO(m3u_content.encode("utf-8"))
    buffer.seek(0)

    original = job.get("filename", "playlist.m3u")
    base = original.rsplit(".", 1)[0] if "." in original else original
    download_name = f"{base}_cleaned.m3u"

    return send_file(
        buffer,
        mimetype="application/vnd.apple.mpegurl",
        as_attachment=True,
        download_name=download_name,
    )


if __name__ == "__main__":
    app.run(debug=True, threaded=True, host="0.0.0.0", port=5000)
