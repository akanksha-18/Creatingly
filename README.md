# HTML Tag Analyzer

A browser-based tool that fetches any public URL, parses its HTML safely, and displays every tag sorted by frequency in a high-performance virtual scrolling list.

Built entirely with **vanilla HTML, CSS, and JavaScript** — zero frameworks, zero dependencies, zero build tools.

---

## What It Does

You paste a URL. The app fetches that webpage through a CORS proxy, parses the full DOM safely using `DOMParser`, counts every HTML element tag, sorts them highest-first, and shows them in a scrollable ranked list. A live search filter lets you find any tag instantly.

---

## Features

- **CORS proxy waterfall** — tries two proxy servers automatically, silent fallback if one fails
- **Safe HTML parsing** — `DOMParser` sandboxes fetched HTML so scripts never execute (XSS-safe)
- **True virtual scrolling** — only ~15 rows in the DOM at any time, handles 10,000+ tags at 60fps
- **Live search filter** — instant filtering as you type, no re-fetch, no re-render of full list
- **Stat cards** — unique tags, total elements, and top tag shown after every fetch
- **Error recovery** — Try Again button if all proxies fail

---

## Project Structure

```
project/
├── index.html     # Page structure, stat cards, URL input, viewport div
├── style.css      # Dark theme, CSS custom properties, virtual list layout
└── script.js      # All application logic
```

---

## How It Works

### 1. Fetch — CORS Proxy Waterfall

Browsers block JavaScript from reading responses from other domains (Same-Origin Policy). The app routes requests through free CORS proxy servers which fetch the target page and return it with the correct headers.

```js
const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];
```

Each proxy is tried with a **10-second timeout** via `AbortSignal.timeout`. If proxy 1 fails for any reason — timeout, HTTP error, empty body — the code waits 500ms and tries proxy 2. The user sees a status message but never has to intervene.

### 2. Parse — countTags()

The raw HTML string is passed to `countTags()` which uses `DOMParser` to build a real document. Scripts inside the fetched HTML **never execute** — it is a completely sandboxed context.

```js
function countTags(html) {
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const freq = Object.create(null); // null prototype — no inherited keys
  const iter = document.createNodeIterator(doc.documentElement, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = iter.nextNode())) {
    const name = node.nodeName.toLowerCase();
    freq[name] = (freq[name] || 0) + 1;
  }
  return freq;
}
```

`Object.create(null)` is used instead of `{}` because a normal object inherits prototype keys like `toString` and `constructor`. If a page has a custom element named `constructor`, `freq["constructor"]++` on a normal object would corrupt the prototype. A null-prototype object has zero inherited keys.

`createNodeIterator` is used instead of `querySelectorAll('*')` because the iterator is lazy — it yields one element at a time rather than building a full array of every element in memory at once.

### 3. Sort + Build Rows

The frequency object is converted to an array, sorted descending by count, and mapped to row objects.

```js
const rows = Object.entries(freq)
  .sort((a, b) => b[1] - a[1])
  .map(([tag, count], i) => ({ rank: i + 1, tag, count, pct: 0 }));

const topCount = rows[0].count;
rows.forEach(r => r.pct = Math.round((r.count / topCount) * 100));
```

`pct` is the percentage relative to the most frequent tag. The top tag always shows a 100% bar. All others are proportional. This is used as the CSS `width` of each bar fill element.

### 4. State Design — allRows vs shown

Two arrays manage display state:

```js
let allRows = []; // master data — written once, never changed
let shown   = []; // what the scroller reads — just a reference
```

`allRows` is the complete sorted list. It is written once after the fetch and never touched again.

`shown` is simply a reference that points to an array. Normally it points at `allRows`. When the user searches, it is reassigned to a filtered subset. Reassigning a reference is instant regardless of list size.

```js
// search
shown = allRows.filter(r => r.tag.includes(query));

// clear search
shown = allRows; // full list back instantly — zero work
```

### 5. Virtual Scrolling

Virtual scrolling keeps the DOM node count constant at ~15 rows regardless of how many rows exist in `shown`. The key is `ROW_H = 44` — every row is exactly 44 pixels tall, which allows O(1) math to calculate which rows are visible.

**Two invisible helper elements:**

- `spacer` — a 1px wide div whose height is set to `shown.length × 44px`. This makes the scrollbar look correct as if all rows are in the DOM.
- `rowsEl` — the div that holds the actual ~15 rendered rows. It is positioned using `translateY` to slide to the right place.

```js
function draw() {
  const scrollTop  = viewport.scrollTop;
  const viewHeight = viewport.clientHeight;

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const last  = Math.min(shown.length - 1, Math.ceil((scrollTop + viewHeight) / ROW_H) + BUFFER);

  const frag = document.createDocumentFragment();
  for (let i = first; i <= last; i++) frag.appendChild(makeRow(shown[i]));

  rowsEl.style.transform = `translateY(${first * ROW_H}px)`;
  rowsEl.replaceChildren(frag);
}
```

`translateY` is used instead of setting `top` because CSS transforms run on the GPU and do not trigger layout recalculation. `DocumentFragment` batches all DOM inserts so only one browser paint occurs per draw call.

### 6. requestAnimationFrame

The scroll event fires 20+ times per frame when scrolling fast. Calling `draw()` directly on each event would waste CPU on renders the user never sees.

```js
function onScroll() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(draw);
}
```

`cancelAnimationFrame` discards the previously scheduled draw. `requestAnimationFrame` schedules exactly one draw before the next screen repaint. Result: `draw()` runs at most once per frame — 60fps maximum, zero wasted renders.

### 7. Search Filter

```js
function filterRows(query) {
  if (!allRows.length) return;
  const q = query.trim().toLowerCase();
  shown = q ? allRows.filter(r => r.tag.includes(q)) : allRows;
  spacer.style.height = shown.length * ROW_H + 'px';
  viewport.scrollTop  = 0;
  draw();
}
```

One line reassigns `shown`. The spacer height updates for the new list size. Scroll resets to top. `draw()` renders the first visible window of the new filtered list — only ~15 rows. No full re-render happens.

---

## CSS Design System

The entire theme is built on CSS custom properties defined in `:root`. Changing the palette is a single-file edit.

```css
:root {
  --bg:      #0a0a0f;
  --accent:  #00ffcc;   /* teal — primary actions */
  --accent2: #ff3c6e;   /* pink — errors */
  --accent3: #7b5cf6;   /* purple — bars and highlights */
  --text:    #e8e8f0;
  --muted:   #6a6a8a;
  --row-h:   44px;      /* must match ROW_H in script.js */
}
```

The virtual viewport uses `position: relative; overflow-y: auto; height: 520px`. Both the spacer and rowsEl are `position: absolute` inside it. The scrollbar is styled with `scrollbar-width: thin` and custom colours.

---

## Security

| Risk | How it is handled |
|---|---|
| XSS from fetched HTML | `DOMParser` — scripts in fetched HTML never execute |
| Prototype pollution | `Object.create(null)` — zero inherited keys on frequency dict |
| Infinite hang on slow proxy | `AbortSignal.timeout(10000)` — auto-cancels after 10 seconds |

---

## Performance

| Technique | Benefit |
|---|---|
| Virtual scrolling | DOM nodes stay at ~15 regardless of list size |
| `requestAnimationFrame` | One draw per screen refresh, 60fps max |
| `DocumentFragment` | Single DOM write per draw — not N separate writes |
| `translateY` instead of `top` | GPU-accelerated, no layout recalculation |
| `createNodeIterator` | Lazy element walk — no large array allocation |
| Passive scroll listener | Browser scrolls immediately without waiting for JS |

---

## Running Locally

No build step. No install. Just open the file.

```bash
# clone or download the project
git clone https://github.com/your-username/html-tag-analyzer.git
cd html-tag-analyzer

# open in browser (any method works)
open index.html
# or
python -m http.server 3000
# then visit http://localhost:3000
```

---

## Usage

1. Paste any public URL into the input box
2. Click **Analyze** or press **Enter**
3. Wait for the proxy to fetch the page (status shown while loading)
4. Results appear sorted by tag frequency
5. Type in the search box to filter tags instantly
6. Clear the search to restore the full list

---

## Possible Improvements

- **Web Worker** — run `countTags()` in a background thread so the main UI thread never blocks on large pages
- **Backend proxy** — replace free public proxies with a self-hosted proxy for reliability
- **CSV / JSON export** — let users download the tag frequency data
- **Comparison mode** — analyze two URLs side by side
- **Attribute analysis** — show frequency of class, id, data-* attributes
- **Unit tests** — `countTags` and `filterRows` are pure functions with no side effects, making them easy to test

---

## Browser Support

Works in all modern browsers that support:
- `fetch` with `AbortSignal.timeout`
- `DOMParser`
- `createNodeIterator`
- `requestAnimationFrame`
- CSS custom properties
- `replaceChildren`

Chrome 92+, Firefox 90+, Safari 15+, Edge 92+

---

## License

MIT
