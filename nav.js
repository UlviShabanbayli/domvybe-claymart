// ClayMart's header, every control doing its real job. It talks to the shop only through window.__checkout and the
// document events cart:change / cart:checkout (see ../HANDOFF.md), and checks for each piece before using it.
//
//   aisles   Market / Fruit & veg / Dairy / Bakery filter the shelf. The aisle lives in the URL (#dairy), so a reload,
//            Back and Forward restore it. ← → Home End move between them (one tab stop: roving tabindex).
//   search   the button (or ⌘K / Ctrl+K, or /) opens a clay field in the pill that filters as you type, by name and
//            description, ignoring case and accents, within the current aisle. Esc closes and clears it.
//   account  a clay popover (a bottom sheet on a phone) with the orders checked out on this device, each one with
//            Reorder; and Clear order history. Nothing in it is invented: no sign-in, no profile.
//   basket   opens the basket; its badge follows the order and squashes when the count changes.
//   logo     the whole market, back at the top.
// Tests and capture scripts get window.__nav.

const PHONE = matchMedia('(max-width: 760px)');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const calm = () => REDUCED.matches || new URLSearchParams(location.search).has('reduce');

const AISLES = [
  { id: 'market', label: 'Market' },
  { id: 'fruitveg', label: 'Fruit & veg' },
  { id: 'dairy', label: 'Dairy' },
  { id: 'bakery', label: 'Bakery' },
];
const HISTORY_KEY = 'claymart.orders.v1';
const HISTORY_MAX = 12;
const TYPE_DEBOUNCE_MS = 120;          // typing settles before the shelf re-sorts (each re-sort is a FLIP animation)
const SAY_DEBOUNCE_MS = 500;           // the screen reader hears the count once the typing pauses
const SHEET_CLOSE_DRAG = 90;           // px the account sheet is dragged down (or a flick) to close it
const FLICK = 700;                     // px/s
const EASE = 'cubic-bezier(.3,.9,.3,1)';
const OPEN_MS = 240, CLOSE_MS = 170, SHEET_MS = 340;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const html = document.documentElement;
const shop = () => window.__checkout || null;
const has = (name) => typeof shop()?.[name] === 'function';
const typing = (el) => !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
const money = (v) => '$' + Number(v || 0).toFixed(2);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();   // "Crème" → "creme"

// ---- the live region: one polite voice for the header ----------------------------------------------------------------
const voice = $('#nav-say');
let sayTimer = 0, saidOdd = false;
function say(text, later = false) {
  clearTimeout(sayTimer);
  const speak = () => { voice.textContent = text + ((saidOdd = !saidOdd) ? ' ' : ''); };   // a changed string re-reads
  if (later) sayTimer = setTimeout(speak, SAY_DEBOUNCE_MS); else speak();
}

// ===================================================================================================================
// THE FILTER: an aisle and a search, combined into one predicate for the shelf
// ===================================================================================================================
const filter = { aisle: 'market', query: '', shown: null };
const aisleLabel = (id) => AISLES.find((a) => a.id === id)?.label ?? 'Market';
const haystacks = new Map();           // product id → its folded words, built once
function words(p) {
  if (!haystacks.has(p.id)) haystacks.set(p.id, fold(`${p.name} ${p.note ?? ''} ${p.size ?? ''} ${aisleLabel(p.category)}`));
  return haystacks.get(p.id);
}
function predicate() {
  const terms = fold(filter.query).split(/\s+/).filter(Boolean);
  if (filter.aisle === 'market' && !terms.length) return null;
  return (p) => (filter.aisle === 'market' || p.category === filter.aisle) && terms.every((t) => words(p).includes(t));
}
// how many products a predicate keeps, when the shop does not say (setFilter's return value is preferred)
function countShown(fn) {
  const all = has('products') ? shop().products() : [];
  return fn ? all.filter(fn).length : all.length;
}
function applyFilter({ animate = true } = {}) {
  if (!has('setFilter')) return;
  const fn = predicate();
  const n = shop().setFilter(fn, { animate: animate && !calm() });
  filter.shown = typeof n === 'number' ? n : countShown(fn);
  renderResults();
}
function resultsText() {
  const n = filter.shown ?? 0, where = filter.aisle === 'market' ? 'the market' : aisleLabel(filter.aisle);
  const q = filter.query.trim();
  if (!q) return `${plural(n, 'product')} in ${where}.`;
  return n ? `${plural(n, 'product')} ${n === 1 ? 'matches' : 'match'} “${q}” in ${where}.` : `No match for “${q}” in ${where}.`;
}

// ---- the empty state, in the shelf's place --------------------------------------------------------------------------
const empty = $('#nav-empty-tpl').content.firstElementChild.cloneNode(true);
const shelf = $('#shelf');
shelf?.after(empty);
function renderResults() {
  const n = filter.shown ?? 0, q = filter.query.trim();
  searchCount.textContent = q ? `${n} of ${countShown(null) || n}` : '';
  const none = n === 0 && (q || filter.aisle !== 'market');
  if (none === !empty.hidden) { if (none) fillEmpty(); return; }
  empty.hidden = !none;
  if (none) {
    fillEmpty();
    if (!calm()) empty.animate([{ transform: 'scale(.9, .8)', opacity: 0 }, { transform: 'scale(1.03, 1.04)', opacity: 1, offset: 0.65 }, { transform: 'none', opacity: 1 }],
      { duration: 380, delay: 180, easing: 'ease-out', fill: 'backwards' });
  }
}
function fillEmpty() {
  const q = filter.query.trim();
  $('.ne-query', empty).textContent = q;
  $('.ne-title', empty).dataset.kind = q ? 'query' : 'aisle';
  $('.ne-where', empty).textContent = filter.aisle === 'market' ? 'in the market' : `in ${aisleLabel(filter.aisle)}`;
  $('.ne-clear', empty).textContent = q ? 'Clear search' : 'Show the whole market';
}
$('.ne-clear', empty).addEventListener('click', () => {
  if (filter.query) { setQuery(''); openSearch(); } else setAisle('market');
});

// ===================================================================================================================
// THE AISLES: tabs in the pill, a chip row under it on narrow screens
// ===================================================================================================================
const nav = $('.site .links');
const tabs = $$('.links a[data-aisle]');
const aisleFromUrl = () => {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return 'market';
  return AISLES.some((a) => a.id === h) ? h : null;      // another anchor (#shelf from the skip link) keeps the aisle
};
const urlFor = (id) => (id === 'market' ? location.pathname + location.search : `#${id}`);

function markAisle(id) {
  for (const t of tabs) {
    const on = t.dataset.aisle === id;
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    t.tabIndex = on ? 0 : -1;
  }
  const active = tabs.find((t) => t.dataset.aisle === id);
  // on the chip row, keep the chosen chip in view (scrolls the row only, never the page)
  if (active && nav.scrollWidth > nav.clientWidth + 1) {
    const left = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left, behavior: calm() ? 'auto' : 'smooth' });
  }
}
// choose an aisle; `push` adds a history entry (a click), false when the URL already says it (Back, Forward, load)
function setAisle(id, { push = true, animate = true } = {}) {
  if (!AISLES.some((a) => a.id === id)) id = 'market';
  markAisle(id);
  if (push && aisleFromUrl() !== id) history.pushState({ aisle: id }, '', urlFor(id));
  if (filter.aisle === id && filter.shown !== null) return;
  filter.aisle = id;
  applyFilter({ animate });
  say(resultsText());
}
function listenAisles() {
  for (const t of tabs) {
    t.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   // a new tab / window keeps the browser's way
      e.preventDefault();
      setAisle(t.dataset.aisle);
      squash(t, 0.94);
    });
    t.addEventListener('keydown', (e) => {
      if (e.key === ' ') { e.preventDefault(); t.click(); }            // a tab answers Space like a button
    });
  }
  // roving tabindex: arrows move the focus along the row, Enter / Space choose
  nav.addEventListener('keydown', (e) => {
    const k = tabs.indexOf(document.activeElement);
    if (k < 0) return;
    const to = { ArrowRight: k + 1, ArrowLeft: k - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    tabs.forEach((t) => { t.tabIndex = t === next ? 0 : -1; });
    next.focus();
  });
  // leaving the row: the tab stop goes back to the chosen aisle
  nav.addEventListener('focusout', (e) => { if (!nav.contains(e.relatedTarget)) markAisle(filter.aisle); });
  const fromUrl = () => { const id = aisleFromUrl(); if (id && id !== filter.aisle) setAisle(id, { push: false }); };
  addEventListener('popstate', fromUrl);
  addEventListener('hashchange', fromUrl);
}

// ===================================================================================================================
// SEARCH
// ===================================================================================================================
const search = $('#nav-search'), searchBtn = $('.nav-search-btn'), input = $('#nav-q'), searchCount = $('.nav-count');
let typeTimer = 0;
const searchOpen = () => !search.hidden;

function openSearch() {
  if (searchOpen()) { input.focus(); input.select(); return; }
  closeAccount({ refocus: false });
  // the field starts right after the logo (measured once, on open)
  const brand = $('.site .brand');
  search.style.setProperty('--search-left', `${brand.offsetLeft + brand.offsetWidth + 14}px`);
  search.hidden = false;
  html.classList.add('nav-searching');
  searchBtn.setAttribute('aria-expanded', 'true');
  if (!calm()) search.animate([{ transform: 'scaleX(.4)', opacity: 0 }, { transform: 'scaleX(1.02)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
    { duration: OPEN_MS, easing: EASE });
  input.focus();
}
function closeSearch({ refocus = true } = {}) {
  if (!searchOpen()) return;
  clearTimeout(typeTimer);
  search.hidden = true;
  html.classList.remove('nav-searching');
  searchBtn.setAttribute('aria-expanded', 'false');
  if (input.value || filter.query) setQuery('');
  if (refocus) searchBtn.focus();
}
// set the query now (typing goes through the debounce in listenSearch)
function setQuery(q) {
  clearTimeout(typeTimer);
  input.value = q;
  if (filter.query === q) return;
  filter.query = q;
  applyFilter();
  say(resultsText(), true);
}
function listenSearch() {
  searchBtn.addEventListener('click', openSearch);
  $('.nav-search-close').addEventListener('click', () => closeSearch());
  input.addEventListener('input', () => {
    clearTimeout(typeTimer);
    typeTimer = setTimeout(() => setQuery(input.value), TYPE_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    setQuery(input.value);
    if (PHONE.matches) { input.blur(); return; }        // the keyboard goes away; the results stay
    $('.shelf .card:not([hidden]) .add')?.focus();      // a desk: straight to the first result's Add
  });
  // a click elsewhere folds an empty field away (a field with words stays: it is still filtering)
  document.addEventListener('pointerdown', (e) => {
    if (searchOpen() && !input.value && !search.contains(e.target) && !searchBtn.contains(e.target)) closeSearch({ refocus: false });
  });
}

// ===================================================================================================================
// THE ACCOUNT: what this device remembers
// ===================================================================================================================
const account = $('#nav-account'), accountBtn = $('.nav-account-btn'), ordersEl = $('.na-orders'), clearBtn = $('.na-clear');
const scrim = $('.nav-scrim');
const accountOpen = () => !account.hidden && !account.dataset.closing;

const store = {
  read() { try { const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } },
  write(list) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* storage blocked: kept for this visit */ } },
  clear() { try { localStorage.removeItem(HISTORY_KEY); } catch { /* storage blocked */ } },
};
let memory = store.read();             // the list in use (survives this visit even if storage is blocked)
const orders = () => memory.slice();

// cart:checkout → one remembered order (only what the event says: no invented fields)
function remember(d) {
  const items = (Array.isArray(d?.items) ? d.items : [])
    .map((l) => ({ id: String(l.id), name: String(l.name ?? l.id), qty: Math.max(1, Number(l.qty ?? l.count ?? 1) | 0), price: Number(l.price) || 0 }))
    .filter((l) => l.id);
  if (!items.length) return;
  const order = { no: d.no ? String(d.no) : null, date: d.date || new Date().toISOString(), items,
    count: Number(d.count) || items.reduce((a, l) => a + l.qty, 0), subtotal: Number(d.subtotal) || 0, delivery: Number(d.delivery) || 0, total: Number(d.total) || 0 };
  memory = [order, ...memory].slice(0, HISTORY_MAX);
  store.write(memory);
  if (!account.hidden) renderOrders();
}
function forget() { memory = []; store.clear(); renderOrders(); }

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? '' : d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
function orderItem(o, k) {
  const li = $('#nav-order-tpl').content.firstElementChild.cloneNode(true);
  const what = o.items.map((l) => `${l.name}${l.qty > 1 ? ' ×' + l.qty : ''}`).join(', ');
  $('.ao-no', li).textContent = o.no || `Order ${memory.length - k}`;
  $('.ao-when', li).textContent = when(o.date);
  $('.ao-when', li).dateTime = o.date;
  $('.ao-what', li).textContent = what;
  $('.ao-count', li).textContent = plural(o.count, 'item');
  $('.ao-fee', li).textContent = o.delivery ? `incl. ${money(o.delivery)} delivery` : 'free delivery';
  $('.ao-total', li).textContent = money(o.total);
  const again = $('.ao-again', li);
  again.setAttribute('aria-label', `Reorder ${o.no || ''} ${what}`.replace(/\s+/g, ' '));
  if (!has('addMany')) { again.disabled = true; again.title = 'Reorder is not available on this page'; }
  again.addEventListener('click', () => reorder(o));
  return li;
}
function renderOrders() {
  const list = orders();
  account.dataset.empty = String(!list.length);
  clearBtn.disabled = !list.length;
  ordersEl.replaceChildren(...list.map(orderItem));
}
function reorder(o) {
  const ids = o.items.flatMap((l) => Array(l.qty).fill(l.id));
  closeAccount();
  if (!has('addMany')) return;
  shop().addMany(ids);
  say(`Adding ${plural(ids.length, 'item')} from ${o.no || 'your past order'} to your basket.`);
}

// focusable things inside the account, for the trap
const focusables = () => $$('button:not(:disabled), [href], input, [tabindex]:not([tabindex="-1"])', account).filter((el) => !el.closest('[hidden]'));
const sheetMode = () => PHONE.matches;

function openAccount() {
  if (accountOpen()) return;
  closeSearch({ refocus: false });
  account.getAnimations().forEach((a) => a.cancel());
  delete account.dataset.closing;
  renderOrders();
  account.hidden = false;
  accountBtn.setAttribute('aria-expanded', 'true');
  html.classList.add('nav-account-open');
  if (sheetMode()) scrim.hidden = false;
  if (!calm()) {
    if (sheetMode()) {
      account.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: SHEET_MS, easing: EASE });
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SHEET_MS });
    } else {
      account.animate([{ transform: 'translateY(-10px) scale(.94, .9)', opacity: 0 }, { transform: 'scale(1.01, 1.02)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
        { duration: OPEN_MS, easing: EASE });
    }
  }
  (focusables().find((el) => el.classList.contains('ao-again')) || $('.na-close')).focus({ preventScroll: true });
}
// close: refocus the account button unless the person already went somewhere else (a click outside)
function closeAccount({ refocus = true } = {}) {
  if (!accountOpen()) return;
  accountBtn.setAttribute('aria-expanded', 'false');
  const done = () => {
    delete account.dataset.closing;
    account.hidden = true;
    account.style.transform = '';
    scrim.hidden = true;
    html.classList.remove('nav-account-open');
  };
  if (refocus) accountBtn.focus({ preventScroll: true });
  if (calm()) { done(); return; }
  account.dataset.closing = '1';
  const from = account.style.transform || 'none';
  const out = sheetMode()
    ? account.animate([{ transform: from }, { transform: 'translateY(100%)' }], { duration: CLOSE_MS + 60, easing: 'ease-in' })
    : account.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-6px) scale(.96)', opacity: 0 }], { duration: CLOSE_MS, easing: 'ease-in' });
  if (!scrim.hidden) scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS + 60, fill: 'forwards' });
  out.finished.then(done, () => {});
}
function trapFocus(e) {
  if (e.key !== 'Tab' || !accountOpen()) return;
  const list = focusables();
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && (document.activeElement === first || !account.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !account.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
}
// the phone sheet: drag it down by its head to close it
function listenSheetDrag() {
  const head = $('.na-head');
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (!sheetMode() || e.target.closest('button') || e.button !== 0) return;
    drag = { id: e.pointerId, y: e.clientY, dy: 0, at: performance.now(), v: 0 };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = Math.max(0, e.clientY - drag.y), now = performance.now();
    drag.v = ((dy - drag.dy) / Math.max(1, now - drag.at)) * 1000; drag.dy = dy; drag.at = now;
    account.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { dy, v } = drag;
    drag = null;
    if (dy > SHEET_CLOSE_DRAG || v > FLICK) { closeAccount(); return; }
    account.style.transform = '';
    if (dy > 0 && !calm()) account.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 240, easing: EASE });
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
}
function listenAccount() {
  accountBtn.addEventListener('click', () => (accountOpen() ? closeAccount() : openAccount()));
  $('.na-close').addEventListener('click', () => closeAccount());
  scrim.addEventListener('click', () => closeAccount());
  clearBtn.addEventListener('click', () => { forget(); say('Order history cleared.'); $('.na-close').focus(); });
  account.addEventListener('keydown', trapFocus);
  document.addEventListener('pointerdown', (e) => {
    if (accountOpen() && !sheetMode() && !account.contains(e.target) && !accountBtn.contains(e.target)) closeAccount({ refocus: false });
  });
  document.addEventListener('cart:checkout', (e) => remember(e.detail));
  // the sheet and the popover are different shapes: a screen change closes either cleanly
  PHONE.addEventListener('change', () => closeAccount({ refocus: false }));
  // another tab checked out: the list follows
  addEventListener('storage', (e) => { if (e.key === HISTORY_KEY || e.key === null) { memory = store.read(); if (!account.hidden) renderOrders(); } });
  listenSheetDrag();
}

// ===================================================================================================================
// THE BASKET BUTTON AND ITS BADGE
// ===================================================================================================================
const bag = $('.bag-btn'), badge = $('.bag-count');
let badgeCount = 0;
function squash(el, k = 0.92) {
  if (calm()) return;
  el.animate([{ transform: 'none' }, { transform: `scale(${2 - k}, ${k})`, offset: 0.3 }, { transform: `scale(${k + 0.03}, ${2 - k - 0.03})`, offset: 0.6 }, { transform: 'none' }],
    { duration: 360, easing: 'ease-out' });
}
function setBadge(count, total, { bump = true } = {}) {
  count = Math.max(0, Number(count) | 0);
  const changed = count !== badgeCount;
  badgeCount = count;
  badge.textContent = count;
  badge.classList.toggle('is-zero', !count);
  bag.setAttribute('aria-label', count ? `Basket, ${plural(count, 'item')}${total ? ', ' + money(total) : ''}` : 'Basket, empty');
  if (!changed || !bump || calm()) return;
  // the badge squashes like a lump of clay dropped on the table, the button gives a little
  badge.animate([
    { transform: 'scale(1)' }, { transform: 'scale(1.42, .68)', offset: 0.22 }, { transform: 'scale(.86, 1.18)', offset: 0.5 },
    { transform: 'scale(1.06, .95)', offset: 0.75 }, { transform: 'scale(1)' },
  ], { duration: 460, easing: 'ease-out' });
  squash(bag, 0.95);
}
function openBasket() {
  if (has('openBasket')) { shop().openBasket(); return; }
  const panel = $('.basket');          // fallback: bring the panel into view
  panel?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'nearest' });
}
function listenBasket() {
  bag.addEventListener('click', () => { closeAccount({ refocus: false }); openBasket(); });
  document.addEventListener('cart:change', (e) => setBadge(e.detail?.count, e.detail?.total));
}

// ===================================================================================================================
// THE LOGO, THE KEYS
// ===================================================================================================================
function listenBrand() {
  $('.site .brand').addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    closeAccount({ refocus: false });
    closeSearch({ refocus: false });
    setAisle('market');
    scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' });
  });
}
function listenKeys() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) { e.preventDefault(); openSearch(); return; }
    if (e.key !== 'Escape') return;
    // the header's layers close first, one per press; the page's own Esc (the basket sheet) is not also triggered
    if (accountOpen()) { e.stopPropagation(); closeAccount(); }
    else if (searchOpen()) { e.stopPropagation(); closeSearch(); }
  });
}

// ===================================================================================================================
// START, once the shop is there
// ===================================================================================================================
function shopReady() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function look() {
      if (shop()) return resolve(Promise.resolve(shop().ready).catch(() => {}).then(() => shop()));
      if (performance.now() - t0 > 8000) return resolve(null);           // no shop: the header still opens and closes
      requestAnimationFrame(look);
    })();
  });
}

listenAisles(); listenSearch(); listenAccount(); listenBasket(); listenBrand(); listenKeys();
markAisle(aisleFromUrl() || 'market');
const ready = shopReady().then((s) => {
  if (s && has('state')) {
    const st = s.state();
    const n = st.count ?? (Array.isArray(st.items) ? st.items.reduce((a, l) => a + (Number(l.qty) || 0), 0) : 0);
    setBadge(n, st.total, { bump: false });
  }
  filter.aisle = aisleFromUrl() || 'market';
  applyFilter({ animate: false });
  html.classList.add('nav-ready');
  return !!s;
});

// ---- for tests and capture scripts ----------------------------------------------------------------------------------------
window.__nav = {
  ready,
  state: () => ({
    aisle: filter.aisle, query: filter.query, shown: filter.shown, searchOpen: searchOpen(), accountOpen: accountOpen(),
    sheet: accountOpen() && sheetMode(), badge: badgeCount, orders: memory.length, empty: !empty.hidden, url: location.hash,
  }),
  aisles: () => AISLES.map((a) => a.id),
  setAisle: (id) => setAisle(id),
  openSearch, closeSearch, search: (q) => { openSearch(); setQuery(q); return filter.shown; },
  openAccount, closeAccount, orders, clearOrders: forget,
};
