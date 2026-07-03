/* M3U Playlist Cleaner - Frontend */

const state = {
  jobId: null,
  channels: [],
  deletedIds: new Set(),
  selectedIds: new Set(),
  currentFilter: 'all',
  checking: false,
  eventSource: null,
  hlsInstance: null,
  mode: 'url',
  loadedSource: null,
};

const STATUS_LABELS = {
  pending: 'Pending',
  online: 'Online',
  reachable: 'Reachable',
  timeout: 'Timeout',
  offline: 'Offline',
  skipped: 'Skipped',
};

const STATUS_CLASSES = {
  pending: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  online: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  reachable: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  timeout: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  offline: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  skipped: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
};

const STATUS_DOT = {
  pending: 'bg-slate-400',
  online: 'bg-emerald-500',
  reachable: 'bg-sky-500',
  timeout: 'bg-amber-500',
  offline: 'bg-red-500',
  skipped: 'bg-purple-500',
};

const FILTER_MAP = {
  all: () => true,
  working: (ch) => ['online', 'reachable'].includes(ch.status),
  issues: (ch) => ['timeout', 'offline'].includes(ch.status),
  online: (ch) => ch.status === 'online',
  reachable: (ch) => ch.status === 'reachable',
  timeout: (ch) => ch.status === 'timeout',
  offline: (ch) => ch.status === 'offline',
};

// DOM refs
const fileInput = document.getElementById('file-input');
const timeoutSelect = document.getElementById('timeout-select');
const concurrentSelect = document.getElementById('concurrent-select');
const skipNonHttp = document.getElementById('skip-non-http');
const urlInput = document.getElementById('url-input');
const urlWrap = document.getElementById('url-wrap');
const fileWrap = document.getElementById('file-wrap');
const sourceToggle = document.getElementById('source-toggle');
const checkBtn = document.getElementById('check-btn');
const uploadError = document.getElementById('upload-error');
const fileInfo = document.getElementById('file-info');
const resultsSection = document.getElementById('results-section');
const channelTbody = document.getElementById('channel-tbody');
const selectAll = document.getElementById('select-all');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
const cleanBtn = document.getElementById('clean-btn');
const downloadBtn = document.getElementById('download-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const progressPercent = document.getElementById('progress-percent');
const emptyFilter = document.getElementById('empty-filter');
const playerModal = document.getElementById('player-modal');
const playerVideo = document.getElementById('player-video');
const playerTitle = document.getElementById('player-title');
const playerUrl = document.getElementById('player-url');
const playerClose = document.getElementById('player-close');
const playerBackdrop = document.getElementById('player-backdrop');

// --- Source mode toggle ---
sourceToggle.addEventListener('click', (e) => {
  const tab = e.target.closest('.source-tab');
  if (!tab) return;
  setMode(tab.dataset.mode);
});

function setMode(mode) {
  state.mode = mode;
  uploadError.classList.add('hidden');

  document.querySelectorAll('.source-tab').forEach((btn) => {
    if (btn.dataset.mode === mode) {
      btn.className = 'source-tab px-3.5 py-1 text-xs font-semibold rounded-lg bg-white text-brand-700 shadow-sm';
    } else {
      btn.className = 'source-tab px-3.5 py-1 text-xs font-semibold rounded-lg text-slate-500 hover:text-slate-800 transition-colors';
    }
  });

  if (mode === 'url') {
    urlWrap.classList.remove('hidden');
    fileWrap.classList.add('hidden');
  } else {
    fileWrap.classList.remove('hidden');
    urlWrap.classList.add('hidden');
  }
  updateCheckAvailability();
}

function updateCheckAvailability() {
  if (state.checking) return;
  if (state.mode === 'url') {
    checkBtn.disabled = urlInput.value.trim() === '';
  } else {
    checkBtn.disabled = !fileInput.files[0];
  }
}

urlInput.addEventListener('input', updateCheckAvailability);
fileInput.addEventListener('change', updateCheckAvailability);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    startCheck();
  }
});

setMode('url');

// --- Load playlist (file or url) ---
async function loadPlaylist() {
  const formData = new FormData();
  let sourceKey;

  if (state.mode === 'url') {
    const url = urlInput.value.trim();
    if (!url) {
      showUploadError('Please enter a playlist URL.');
      return false;
    }
    formData.append('url', url);
    sourceKey = `url:${url}`;
  } else {
    const file = fileInput.files[0];
    if (!file) {
      showUploadError('Please select a file.');
      return false;
    }
    formData.append('file', file);
    sourceKey = `file:${file.name}:${file.size}:${file.lastModified}`;
  }

  if (state.jobId && state.loadedSource === sourceKey) {
    return true;
  }

  uploadError.classList.add('hidden');
  checkBtn.disabled = true;
  checkBtn.textContent = state.mode === 'url' ? 'Fetching...' : 'Uploading...';

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Load failed');

    state.jobId = data.job_id;
    state.channels = data.channels;
    state.loadedSource = sourceKey;
    state.deletedIds.clear();
    state.selectedIds.clear();
    state.currentFilter = 'all';

    fileInfo.textContent = `${data.filename} — ${data.total} channels loaded`;
    fileInfo.classList.remove('hidden');
    resultsSection.classList.remove('hidden');

    resetStats();
    renderTable();
    setActiveFilter('all');
    return true;
  } catch (err) {
    showUploadError(err.message);
    return false;
  } finally {
    checkBtn.textContent = 'Check';
    updateCheckAvailability();
  }
}

function showUploadError(msg) {
  uploadError.textContent = msg;
  uploadError.classList.remove('hidden');
}

// --- Check (SSE) ---
checkBtn.addEventListener('click', startCheck);

async function startCheck() {
  if (state.checking) return;

  const loaded = await loadPlaylist();
  if (!loaded) return;

  runCheck();
}

function runCheck() {
  if (!state.jobId || state.checking) return;

  state.checking = true;
  checkBtn.disabled = true;
  checkBtn.textContent = 'Checking...';
  progressContainer.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressPercent.textContent = '0%';

  state.channels.forEach((ch) => {
    ch.status = 'pending';
    ch.http_code = null;
  });
  resetStats();
  renderTable();

  const params = new URLSearchParams({
    timeout: timeoutSelect.value,
    concurrent: concurrentSelect.value,
    skip_non_http: skipNonHttp.checked ? 'true' : 'false',
  });

  if (state.eventSource) state.eventSource.close();

  const es = new EventSource(`/check/${state.jobId}?${params}`);
  state.eventSource = es;

  es.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const channel = state.channels.find((c) => c.id === data.id);
    if (channel) {
      channel.status = data.status;
      channel.http_code = data.http_code;
      updateChannelRow(channel);
      updateStats();

      const pct = Math.round((data.completed / data.total) * 100);
      progressBar.style.width = `${pct}%`;
      progressPercent.textContent = `${pct}%`;
      progressLabel.textContent = `Checking channels... ${data.completed}/${data.total}`;
    }
  };

  es.addEventListener('done', () => {
    es.close();
    state.eventSource = null;
    state.checking = false;
    checkBtn.disabled = false;
    checkBtn.textContent = 'Recheck All';
    progressLabel.textContent = 'Check complete';
    progressBar.style.width = '100%';
    progressPercent.textContent = '100%';
  });

  es.onerror = () => {
    es.close();
    state.eventSource = null;
    state.checking = false;
    checkBtn.disabled = false;
    checkBtn.textContent = 'Check';
    progressLabel.textContent = 'Connection lost — try again';
  };
}

// --- Stats ---
function resetStats() {
  updateStats();
}

function updateStats() {
  const active = getActiveChannels();
  const counts = { total: active.length, online: 0, reachable: 0, timeout: 0, offline: 0, pending: 0 };

  active.forEach((ch) => {
    if (counts[ch.status] !== undefined) counts[ch.status]++;
  });

  document.getElementById('stat-total').textContent = counts.total;
  document.getElementById('stat-online').textContent = counts.online;
  document.getElementById('stat-reachable').textContent = counts.reachable;
  document.getElementById('stat-timeout').textContent = counts.timeout;
  document.getElementById('stat-offline').textContent = counts.offline;
  document.getElementById('stat-pending').textContent = counts.pending;
}

function getActiveChannels() {
  return state.channels.filter((ch) => !state.deletedIds.has(ch.id));
}

function getFilteredChannels() {
  const filterFn = FILTER_MAP[state.currentFilter] || FILTER_MAP.all;
  return getActiveChannels().filter(filterFn);
}

// --- Table rendering ---
function renderTable() {
  channelTbody.innerHTML = '';
  const filtered = getFilteredChannels();

  if (filtered.length === 0) {
    emptyFilter.classList.remove('hidden');
    return;
  }
  emptyFilter.classList.add('hidden');

  filtered.forEach((ch, idx) => {
    channelTbody.appendChild(createRow(ch, idx + 1));
  });

  updateSelectAllState();
  updateBulkDeleteBtn();
}

function createRow(channel, serial) {
  const tr = document.createElement('tr');
  tr.dataset.id = channel.id;
  tr.className = 'border-b border-slate-100 hover:bg-slate-50';

  const checked = state.selectedIds.has(channel.id) ? 'checked' : '';
  const statusClass = STATUS_CLASSES[channel.status] || STATUS_CLASSES.pending;
  const statusDot = STATUS_DOT[channel.status] || STATUS_DOT.pending;
  const statusLabel = STATUS_LABELS[channel.status] || channel.status;
  const codeLabel = channel.http_code ? ` ${channel.http_code}` : '';

  tr.innerHTML = `
    <td class="px-4 py-3">
      <input type="checkbox" class="row-checkbox rounded border-slate-300 text-brand-600 focus:ring-brand-500" data-id="${channel.id}" ${checked}>
    </td>
    <td class="px-4 py-3 text-slate-400 font-medium">${serial}</td>
    <td class="px-4 py-3">
      <span class="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs font-semibold ${statusClass}">
        <span class="w-1.5 h-1.5 rounded-full ${statusDot}"></span>${statusLabel}${codeLabel}
      </span>
    </td>
    <td class="px-4 py-3">
      <div class="font-semibold text-slate-900">${escapeHtml(channel.name)}</div>
      <div class="text-xs text-slate-400 truncate max-w-md" title="${escapeHtml(channel.url)}">${escapeHtml(channel.url)}</div>
    </td>
    <td class="px-4 py-3">
      <span class="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-medium">${escapeHtml(channel.group)}</span>
    </td>
    <td class="px-4 py-3">
      <div class="flex flex-wrap gap-1.5">
        <button class="action-play inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-brand-700 bg-brand-50 ring-1 ring-brand-100 hover:bg-brand-100 rounded-lg transition-colors" data-id="${channel.id}" title="Test in web player">Play</button>
        <button class="action-copy inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors" title="Copy URL">Copy</button>
        <button class="action-recheck inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors" data-id="${channel.id}" title="Recheck">Recheck</button>
      </div>
    </td>
  `;

  tr.querySelector('.row-checkbox').addEventListener('change', onRowCheckboxChange);
  tr.querySelector('.action-play').addEventListener('click', () => openPlayer(channel));
  tr.querySelector('.action-copy').addEventListener('click', () => copyUrl(channel.url));
  tr.querySelector('.action-recheck').addEventListener('click', () => recheckChannel(channel.id));

  return tr;
}

function updateChannelRow(channel) {
  const existing = channelTbody.querySelector(`tr[data-id="${channel.id}"]`);
  if (existing) {
    const filtered = getFilteredChannels();
    const idx = filtered.findIndex((c) => c.id === channel.id);
    if (idx === -1) {
      existing.remove();
      return;
    }
    const newRow = createRow(channel, idx + 1);
    existing.replaceWith(newRow);
  } else {
    renderTable();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Filters ---
document.getElementById('filter-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.filter-tab');
  if (!tab) return;
  setActiveFilter(tab.dataset.filter);
  renderTable();
});

function setActiveFilter(filter) {
  state.currentFilter = filter;
  document.querySelectorAll('.filter-tab').forEach((btn) => {
    if (btn.dataset.filter === filter) {
      btn.className = 'filter-tab px-4 py-2 text-sm font-semibold rounded-full bg-brand-600 text-white shadow-sm';
    } else {
      btn.className = 'filter-tab px-4 py-2 text-sm font-semibold rounded-full text-slate-600 hover:bg-slate-100';
    }
  });
}

// --- Selection & Bulk Delete ---
selectAll.addEventListener('change', () => {
  const filtered = getFilteredChannels();
  if (selectAll.checked) {
    filtered.forEach((ch) => state.selectedIds.add(ch.id));
  } else {
    filtered.forEach((ch) => state.selectedIds.delete(ch.id));
  }
  renderTable();
});

function onRowCheckboxChange(e) {
  const id = e.target.dataset.id;
  if (e.target.checked) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }
  updateSelectAllState();
  updateBulkDeleteBtn();
}

function updateSelectAllState() {
  const filtered = getFilteredChannels();
  selectAll.checked = filtered.length > 0 && filtered.every((ch) => state.selectedIds.has(ch.id));
  selectAll.indeterminate = filtered.some((ch) => state.selectedIds.has(ch.id)) && !selectAll.checked;
}

function updateBulkDeleteBtn() {
  bulkDeleteBtn.disabled = state.selectedIds.size === 0;
}

bulkDeleteBtn.addEventListener('click', () => {
  if (state.selectedIds.size === 0) return;
  if (!confirm(`Delete ${state.selectedIds.size} selected channel(s)?`)) return;

  state.selectedIds.forEach((id) => state.deletedIds.add(id));
  state.selectedIds.clear();
  updateStats();
  renderTable();
});

// Clean playlist: remove everything except Working (online + reachable)
cleanBtn.addEventListener('click', () => {
  const active = getActiveChannels();
  const toRemove = active.filter((ch) => ch.status !== 'online');

  if (toRemove.length === 0) {
    alert('Nothing to clean — all remaining channels are already Online.');
    return;
  }

  const hasUnchecked = active.some((ch) => ch.status === 'pending');
  const warn = hasUnchecked
    ? '\n\nWarning: some channels are still unchecked (Pending) and will be removed. Run Check first if you want them evaluated.'
    : '';

  if (!confirm(`Remove ${toRemove.length} non-working channel(s), keeping only Online?${warn}`)) return;

  toRemove.forEach((ch) => {
    state.deletedIds.add(ch.id);
    state.selectedIds.delete(ch.id);
  });
  updateStats();
  renderTable();
});

// --- Actions ---
async function copyUrl(url) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

async function recheckChannel(channelId) {
  const channel = state.channels.find((c) => c.id === channelId);
  if (!channel) return;

  const btn = channelTbody.querySelector(`tr[data-id="${channelId}"] .action-recheck`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '...';
  }

  try {
    const res = await fetch(`/recheck/${state.jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: channelId,
        timeout: parseInt(timeoutSelect.value, 10),
        skip_non_http: skipNonHttp.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    channel.status = data.status;
    channel.http_code = data.http_code;
    updateChannelRow(channel);
    updateStats();
  } catch (err) {
    alert('Recheck failed: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Recheck';
    }
  }
}

// --- Player ---
function openPlayer(channel) {
  destroyPlayer();
  playerTitle.textContent = channel.name;
  playerUrl.textContent = channel.url;
  playerModal.classList.remove('hidden');

  const url = channel.url;
  const isHls = url.includes('.m3u8') || url.includes('m3u8');

  if (isHls && window.Hls && Hls.isSupported()) {
    state.hlsInstance = new Hls();
    state.hlsInstance.loadSource(url);
    state.hlsInstance.attachMedia(playerVideo);
    state.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => playerVideo.play().catch(() => {}));
  } else if (isHls && playerVideo.canPlayType('application/vnd.apple.mpegurl')) {
    playerVideo.src = url;
    playerVideo.play().catch(() => {});
  } else {
    playerVideo.src = url;
    playerVideo.play().catch(() => {});
  }
}

function destroyPlayer() {
  if (state.hlsInstance) {
    state.hlsInstance.destroy();
    state.hlsInstance = null;
  }
  playerVideo.pause();
  playerVideo.removeAttribute('src');
  playerVideo.load();
}

function closePlayer() {
  destroyPlayer();
  playerModal.classList.add('hidden');
}

playerClose.addEventListener('click', closePlayer);
playerBackdrop.addEventListener('click', closePlayer);

// --- Download ---
downloadBtn.addEventListener('click', async () => {
  const keepIds = getActiveChannels().map((ch) => ch.id);
  if (keepIds.length === 0) {
    alert('No channels left to download.');
    return;
  }

  try {
    const res = await fetch(`/download/${state.jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep_ids: keepIds }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Download failed');
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'cleaned.m3u';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert('Download failed: ' + err.message);
  }
});
