<div align="center">

# M3U Toolkit

**Clean, check, and merge IPTV playlists — right in your browser.**

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0+-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

<br>

[Features](#-features) · [Quick Start](#-quick-start) · [Cleaner](#-playlist-cleaner) · [Merge](#-merge-m3u) · [Status Guide](#-status-guide) · [Project Structure](#-project-structure)

</div>

---

## Overview

**M3U Toolkit** is a modern local web app for managing `.m3u` / `.m3u8` IPTV playlists. Upload a file or paste an online URL, check every stream link with live progress, remove dead channels, and download a cleaned playlist — or merge multiple playlists with smart de-duplication.

> Runs locally on your machine. No database. No account required.

---

## Features

<table>
<tr>
<td width="50%" valign="top">

### Playlist Cleaner
- Load from **URL** or **local file**
- Concurrent link checking with **live SSE progress**
- Configurable **timeout** (5 / 8 / 12 / 20 sec)
- **Concurrent** workers (3 / 5 / 10)
- Skip non-HTTP URLs (RTMP, RTSP)
- Real-time stats & filterable channel table
- **Clean Playlist** — keep only Online channels
- Bulk delete + download cleaned `.m3u`
- In-browser player (HLS via `hls.js`)

</td>
<td width="50%" valign="top">

### Merge M3U
- Combine **2+ playlists** at once
- **Same URL** → one entry, richest metadata wins
- **Same name, different URL** → auto-numbered  
  `Sony Max 1`, `Sony Max 2`, …
- Merges `group-title`, `tvg-logo`, `tvg-id`, etc.
- Preview table with search
- Download merged `.m3u`

</td>
</tr>
</table>

---

## Quick Start

### 1. Clone & install

```bash
git clone <your-repo-url>
cd m3u-playlist-cleaner
pip install -r requirements.txt
```

### 2. Run the app

```bash
python app.py
```

### 3. Open in browser

```
http://127.0.0.1:5000
```

<div align="center">

| Page | URL |
|------|-----|
| **Cleaner** | `http://127.0.0.1:5000/` |
| **Merge M3U** | `http://127.0.0.1:5000/merge` |

</div>

---

## Playlist Cleaner

### Load a playlist

| Mode | How |
|------|-----|
| **URL** *(default)* | Paste a direct link to an online `.m3u` / `.m3u8` playlist |
| **File** | Upload a local playlist from your computer |

### Check & clean

1. Set **Timeout**, **Concurrent**, and **Skip non-HTTP** options
2. Click **Check** — channels are verified in real time
3. Use filters: `All` · `Working` · `Issues` · `Online` · `Reachable` · `Timeout` · `Offline`
4. Remove bad channels:
   - **Delete Selected** — remove checked rows
   - **Clean Playlist** — remove everything except **Online**
5. Click **Download Cleaned** to save your new playlist

### Per-channel actions

| Action | Description |
|--------|-------------|
| **Play** | Test stream in built-in web player |
| **Copy** | Copy channel URL to clipboard |
| **Recheck** | Re-test a single channel |

---

## Merge M3U

Upload **two or more** playlist files and click **Merge**.

### Merge rules

```
┌─────────────────────────────────────────────────────────────┐
│  SAME LINK                                                  │
│  Keep one entry → best name, group, logo/icon combined      │
├─────────────────────────────────────────────────────────────┤
│  SAME NAME · DIFFERENT LINK                                 │
│  Keep all → numbered: Sony Max 1, Sony Max 2, Sony Max 3    │
└─────────────────────────────────────────────────────────────┘
```

When two channels share the same URL, the entry with **more metadata** is preferred (longer `group-title`, `tvg-logo`, `tvg-name`, etc.).

---

## Status Guide

| Badge | Status | Meaning |
|:-----:|--------|---------|
| 🟢 | **Online** | HTTP `2xx` — stream responds OK |
| 🔵 | **Reachable** | Server responded (`3xx` / `4xx` / `5xx`) |
| 🟡 | **Timeout** | Request timed out |
| 🔴 | **Offline** | Connection / DNS error |
| 🟣 | **Skipped** | Non-HTTP URL skipped (RTMP, RTSP, …) |
| ⚪ | **Pending** | Not checked yet |

---

## Tech Stack

```
┌──────────────┬────────────────────────────────────────────┐
│  Backend     │  Flask · requests · ThreadPoolExecutor     │
│  Live feed   │  Server-Sent Events (SSE)                  │
│  Frontend    │  Tailwind CSS (CDN) · Vanilla JS           │
│  Player      │  hls.js (CDN)                            │
│  Storage     │  In-memory (single-user local tool)      │
└──────────────┴────────────────────────────────────────────┘
```

---

## Project Structure

```
m3u-playlist-cleaner/
├── app.py                 # Flask routes (upload, check, merge, download)
├── checker.py             # M3U parsing & URL health checks
├── merger.py              # Multi-playlist merge logic
├── requirements.txt
├── README.md
├── .gitignore
├── templates/
│   ├── index.html         # Cleaner UI
│   └── merge.html         # Merge UI
└── static/
    └── js/
        ├── app.js         # Cleaner frontend
        └── merge.js       # Merge frontend
```

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/` | Cleaner page |
| `GET` | `/merge` | Merge page |
| `POST` | `/upload` | Load playlist (file or `url` form field) |
| `GET` | `/check/<job_id>` | SSE stream — check all channels |
| `POST` | `/recheck/<job_id>` | Re-check one channel |
| `POST` | `/download/<job_id>` | Download cleaned `.m3u` |
| `POST` | `/merge` | Merge multiple uploaded playlists |

---

## Requirements

- **Python** 3.10 or newer
- **pip**
- Internet access (for CDN assets & URL playlist fetching)

---

## Tips

- Run **Check** before **Clean Playlist** so Pending channels are not removed by mistake.
- For large playlists, start with **Concurrent: 5** and **Timeout: 8** — increase if your network is slow.
- URL mode fetches the playlist **server-side**, so CORS is not an issue.
- Merged playlists preserve original `#EXTINF` attributes where possible.

---

## Support the Developer

If **M3U Toolkit** saved you time, consider supporting its development. Every contribution keeps the project alive and motivates new features.

<div align="center">

<img src="assets/support-qr.png" alt="Support the developer - PhonePe / UPI QR code" width="240" />

**Scan to pay via any UPI app** (PhonePe, Google Pay, Paytm, BHIM)

Thank you for your support!

</div>

---

<div align="center">

**Made for IPTV playlist maintenance**

If this project helps you, give it a star.

</div>
