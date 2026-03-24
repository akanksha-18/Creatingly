const ROW_H  = 44;
const BUFFER = 5;

const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

let allRows = [];
let shown   = [];
let rowsEl  = null;
let spacer  = null;
let rafId   = 0;

const viewport    = document.getElementById('viewport');
const urlInput    = document.getElementById('urlInput');
const fetchBtn    = document.getElementById('fetchBtn');
const searchInput = document.getElementById('searchInput');
const resultCount = document.getElementById('resultCount');
const countVal    = document.getElementById('countVal');


const App = { fetch: fetchURL, filter: filterRows };


urlInput.addEventListener('input',   () => urlInput.value.trim() === '' && resetAll());
urlInput.addEventListener('keydown', e => e.key === 'Enter' && fetchURL());


function resetAll() {
  allRows = shown = [];
  ['valUnique','valTotal','valTop'].forEach(id => document.getElementById(id).textContent = '—');
  ['statUnique','statTotal','statTop'].forEach(id => document.getElementById(id).classList.remove('active'));
  searchInput.value = '';
  resultCount.style.display = 'none';
  destroyScroller();
  viewport.innerHTML = `
    <div class="status-zone">
      <div class="status-icon">⬡</div>
      <div class="status-text">Enter a URL above and click <strong>Analyze</strong> to inspect its HTML tags.</div>
    </div>`;
}


async function fetchURL() {
  let url = urlInput.value.trim();
  if (!url) { resetAll(); return; }

  const match = url.match(/[?&]url=([^&]+)/);
  if (match) url = decodeURIComponent(match[1]);

  // Add https:// if missing
  if (!url.startsWith('http')) url = 'https://' + url;
  urlInput.value = url;

  fetchBtn.disabled    = true;
  fetchBtn.textContent = 'Fetching…';
  searchInput.value = '';
  resultCount.style.display = 'none';
  destroyScroller();

  // Try each proxy
  let html = null;
  for (let i = 0; i < PROXIES.length; i++) {
    showStatus('⏳', `Trying proxy ${i + 1} of ${PROXIES.length}…`);
    try {
      const res = await fetch(PROXIES[i](url), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
      if (!html || html.trim().length < 10) throw new Error('Empty response');
      break;
    } catch {
      html = null;
      if (i < PROXIES.length - 1) await new Promise(r => setTimeout(r, 500));
    }
  }

  if (!html) {
    showError();
    fetchBtn.disabled    = false;
    fetchBtn.textContent = 'Analyze';
    return;
  }


  const freq = countTags(html);
  const rows = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count], i) => ({ rank: i + 1, tag, count, pct: 0 }));

  if (!rows.length) { showError('No HTML tags found.'); return; }

  const topCount = rows[0].count;
  rows.forEach(r => r.pct = Math.round((r.count / topCount) * 100));

  allRows = shown = rows;
  const total = rows.reduce((s, r) => s + r.count, 0);
  updateStats(rows.length, total, rows[0].tag);
  renderList();

  fetchBtn.disabled    = false;
  fetchBtn.textContent = 'Analyze';
}

// ─── COUNT TAGS ───────────────────────────────────────────
function countTags(html) {
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const freq = Object.create(null);
  const iter = document.createNodeIterator(doc.documentElement, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = iter.nextNode())) {
    const name = node.nodeName.toLowerCase();
    freq[name] = (freq[name] || 0) + 1;
  }
  return freq;
}

// ─── FILTER ───────────────────────────────────────────────
function filterRows(query) {
  if (!allRows.length) return;
  const q = query.trim().toLowerCase();
  shown = q ? allRows.filter(r => r.tag.includes(q)) : allRows;
  countVal.textContent = shown.length;
  resultCount.style.display = q ? 'flex' : 'none';
  if (spacer) {
    spacer.style.height = shown.length * ROW_H + 'px';
    viewport.scrollTop  = 0;
    draw();
  }
}

// ─── VIRTUAL SCROLLER ─────────────────────────────────────
function renderList() {
  viewport.innerHTML = '';

  spacer = document.createElement('div');
  Object.assign(spacer.style, { position:'absolute', top:0, left:0, width:'1px', pointerEvents:'none', height: allRows.length * ROW_H + 'px' });

  rowsEl = document.createElement('div');
  Object.assign(rowsEl.style, { position:'absolute', top:0, left:0, width:'100%' });

  viewport.append(spacer, rowsEl);
  viewport.addEventListener('scroll', onScroll, { passive: true });
  draw();
}

function destroyScroller() {
  viewport.removeEventListener('scroll', onScroll);
  cancelAnimationFrame(rafId);
  spacer = rowsEl = null;
}

function onScroll() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(draw);
}

function draw() {
  if (!rowsEl) return;
  const scrollTop  = viewport.scrollTop;
  const viewHeight = viewport.clientHeight;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const last  = Math.min(shown.length - 1, Math.ceil((scrollTop + viewHeight) / ROW_H) + BUFFER);

  const frag = document.createDocumentFragment();
  for (let i = first; i <= last; i++) frag.appendChild(makeRow(shown[i]));

  rowsEl.style.transform = `translateY(${first * ROW_H}px)`;
  rowsEl.replaceChildren(frag);
}

function makeRow({ rank, tag, count, pct }) {
  const div = document.createElement('div');
  div.className = 'tag-row';
  div.innerHTML = `
    <span class="row-rank">${rank}</span>
    <span class="row-tag">&lt;${tag}&gt;</span>
    <span class="row-count">${count.toLocaleString()}</span>
    <div class="bar-wrap">
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-pct">${pct}%</span>
    </div>`;
  return div;
}

// ─── STATS ────────────────────────────────────────────────
function updateStats(unique, total, topTag) {
  document.getElementById('valUnique').textContent = unique.toLocaleString();
  document.getElementById('valTotal').textContent  = total.toLocaleString();
  document.getElementById('valTop').textContent    = `<${topTag}>`;
  ['statUnique','statTotal','statTop'].forEach(id => document.getElementById(id).classList.add('active'));
}

// ─── STATUS / ERROR ───────────────────────────────────────
function showStatus(icon, msg) {
  viewport.innerHTML = `
    <div class="status-zone">
      <div class="status-icon">${icon}</div>
      <div class="status-text">${msg}</div>
    </div>`;
}

function showError(msg = 'All proxies failed.') {
  viewport.innerHTML = `
    <div class="status-zone">
      <div class="status-icon">⚠</div>
      <div class="error-msg">${msg}</div>
      <button onclick="fetchURL()"
        style="margin-top:1rem;padding:0.5rem 1.2rem;background:#7b5cf6;color:#fff;
               border:none;border-radius:8px;cursor:pointer;font-weight:700">
        🔄 Try Again
      </button>
    </div>`;
}