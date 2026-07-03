/* Merge M3U - Frontend */

const mState = {
  channels: [],
  m3u: '',
};

const filesInput = document.getElementById('merge-files');
const fileListEl = document.getElementById('file-list');
const mergeBtn = document.getElementById('merge-btn');
const mergeError = document.getElementById('merge-error');
const resultsEl = document.getElementById('merge-results');
const tbody = document.getElementById('merge-tbody');
const searchInput = document.getElementById('merge-search');
const downloadBtn = document.getElementById('merge-download');
const emptyEl = document.getElementById('merge-empty');

filesInput.addEventListener('change', () => {
  mergeError.classList.add('hidden');
  renderFileChips();
  mergeBtn.disabled = filesInput.files.length < 2;
});

function renderFileChips() {
  fileListEl.innerHTML = '';
  Array.from(filesInput.files).forEach((f) => {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 text-xs font-semibold bg-brand-50 text-brand-700 ring-1 ring-brand-100 rounded-full';
    chip.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><span></span>`;
    chip.querySelector('span').textContent = f.name;
    fileListEl.appendChild(chip);
  });
  if (filesInput.files.length === 1) {
    mergeError.textContent = 'Select at least 2 files to merge.';
    mergeError.classList.remove('hidden');
  }
}

mergeBtn.addEventListener('click', async () => {
  if (filesInput.files.length < 2) return;

  const formData = new FormData();
  Array.from(filesInput.files).forEach((f) => formData.append('files', f));

  mergeBtn.disabled = true;
  mergeBtn.textContent = 'Merging...';
  mergeError.classList.add('hidden');

  try {
    const res = await fetch('/merge', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Merge failed');

    mState.channels = data.channels;
    mState.m3u = data.m3u;

    document.getElementById('m-files').textContent = data.stats.files;
    document.getElementById('m-input').textContent = data.stats.total_input;
    document.getElementById('m-output').textContent = data.stats.total_output;
    document.getElementById('m-dupes').textContent = data.stats.duplicates_removed;
    document.getElementById('m-renamed').textContent = data.stats.renamed;

    resultsEl.classList.remove('hidden');
    renderRows();
  } catch (err) {
    mergeError.textContent = err.message;
    mergeError.classList.remove('hidden');
  } finally {
    mergeBtn.disabled = false;
    mergeBtn.textContent = 'Merge';
  }
});

searchInput.addEventListener('input', renderRows);

function renderRows() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? mState.channels.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q)
      )
    : mState.channels;

  tbody.innerHTML = '';
  if (filtered.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  filtered.forEach((ch, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors';
    const logo = ch.logo
      ? `<img src="${escapeHtml(ch.logo)}" alt="" class="w-9 h-9 object-contain rounded-lg ring-1 ring-slate-200 bg-white" onerror="this.style.display='none'">`
      : '<div class="w-9 h-9 rounded-lg bg-slate-100 ring-1 ring-slate-200"></div>';
    const group = ch.group
      ? `<span class="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-medium">${escapeHtml(ch.group)}</span>`
      : '<span class="text-slate-300">—</span>';
    tr.innerHTML = `
      <td class="px-4 py-3 text-slate-400 font-medium">${idx + 1}</td>
      <td class="px-4 py-3">${logo}</td>
      <td class="px-4 py-3">
        <div class="font-semibold text-slate-900">${escapeHtml(ch.name)}</div>
        <div class="text-xs text-slate-400 truncate max-w-md" title="${escapeHtml(ch.url)}">${escapeHtml(ch.url)}</div>
      </td>
      <td class="px-4 py-3">${group}</td>
    `;
    tbody.appendChild(tr);
  });
}

downloadBtn.addEventListener('click', () => {
  if (!mState.m3u) return;
  const blob = new Blob([mState.m3u], { type: 'application/vnd.apple.mpegurl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'merged.m3u';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}
