// The basket panel as a place to go: openBasket() is what the header's basket button does. Where the panel shows its
// list (a desk, a tablet on its side) it pulses and its first control takes focus; where the list is folded away (the
// docked basket of a phone or an upright tablet, the strip of a phone on its side) the basket opens as a sheet over the
// page, with the list, closed by its Hide button, a tap on the scrim, a drag down, or Esc.
// It also keeps --dock-h (the docked basket's real height) up to date, so the shelf can always scroll clear of it.
import { $, calm, docked, folded, strip } from './util.js';
import { firstControl } from './readouts.js';
import { keepAwake } from './loop.js';

const SHEET_MS = 360;                  // the sheet opening / closing
const SHEET_CLOSE_DRAG = 90;           // px dragged down (or a fast flick) that closes it
const FLICK = 700;                     // px/s
const EASE = 'cubic-bezier(.3,.9,.3,1)';
const html = document.documentElement;
const panel = $('.basket'), scrim = $('.scrim'), toggle = $('.b-toggle'), toggleText = $('.b-toggle-text'), head = $('.b-head');

const sheetOpen = () => panel.classList.contains('is-open');

// open or close the sheet: its height changes once, then it slides from where it was (transform only)
function setSheet(open) {
  if (open === sheetOpen()) return;
  const before = panel.getBoundingClientRect().top;
  panel.classList.toggle('is-open', open);
  scrim.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggleText.textContent = open ? 'Hide' : 'Details';
  const dy = before - panel.getBoundingClientRect().top;
  if (!calm) {
    panel.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: SHEET_MS, easing: EASE });
    if (open) scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SHEET_MS });
  }
  keepAwake(SHEET_MS + 60);            // the tray moves with the panel: the pile follows it frame by frame
}

export function openBasket() {
  if (folded()) setSheet(true);
  else {
    if (!calm) panel.animate([{ transform: 'none' }, { transform: 'scale(1.025)', offset: 0.35 }, { transform: 'scale(.995)', offset: 0.7 }, { transform: 'none' }], { duration: 520, easing: 'ease-out' });
    keepAwake(560);
  }
  firstControl().focus({ preventScroll: true });
}

// drag the open sheet down by its head to close it
function listenDrag() {
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (!sheetOpen() || e.target.closest('button') || e.button !== 0) return;
    drag = { id: e.pointerId, y: e.clientY, dy: 0, at: performance.now(), v: 0 };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = Math.max(0, e.clientY - drag.y), now = performance.now();
    drag.v = (dy - drag.dy) / Math.max(1, now - drag.at) * 1000; drag.dy = dy; drag.at = now;
    panel.style.transform = `translateY(${dy}px)`;
    keepAwake(100);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { dy, v } = drag;
    drag = null;
    panel.style.transform = '';
    if (dy > SHEET_CLOSE_DRAG || v > FLICK) setSheet(false);
    else if (dy > 0 && !calm) { panel.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: EASE }); keepAwake(300); }
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
}

export function listen() {
  toggle.addEventListener('click', () => setSheet(!sheetOpen()));
  scrim.addEventListener('click', () => setSheet(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen()) { setSheet(false); toggle.focus(); } });
  const unfold = () => { if (!folded()) setSheet(false); };
  docked.addEventListener('change', unfold);
  strip.addEventListener('change', unfold);
  new ResizeObserver(() => {
    if (docked.matches && !sheetOpen() && panel.dataset.state !== 'done') html.style.setProperty('--dock-h', `${Math.round(panel.offsetHeight)}px`);
  }).observe(panel);
  listenDrag();
}
