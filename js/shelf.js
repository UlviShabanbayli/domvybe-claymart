// The shelf: a card per product (a tinted clay tile with the product on it, its words, its price, an Add pill), the
// shelf restocking itself after something is taken, and the filter (the header's aisles and search decide what
// matches): the cards that leave squash out where they were, the rest slide to their new places (FLIP: first, last,
// invert, play), the ones that come back pop in.
import { Spring } from './spring.js';
import { $, calm, clamp, critical, money } from './util.js';
import { PRODUCTS } from './catalogue.js';
import { shop } from './state.js';

const PIC_MIN = 0.55;                 // the picture's scale on its card when the card is empty (it grows back from it)
const FLIP_MS = 420, LEAVE_MS = 300, ENTER_MS = 380;
const EASE_SLIDE = 'cubic-bezier(.3,.9,.3,1)';

const shelfEl = $('#shelf'), template = $('#card');

export const cards = PRODUCTS.map((p, i) => {
  const el = template.content.firstElementChild.cloneNode(true);
  el.dataset.id = p.id;
  el.style.setProperty('--tint', p.tint);
  el.style.setProperty('--tint2', p.tint2);
  const img = $('.pic img', el);
  img.src = p.img; img.width = p.iw; img.height = p.ih; img.alt = p.name;
  img.style.setProperty('--dw', p.dw);
  $('.name', el).textContent = p.name;
  $('.note', el).textContent = `${p.note} · ${p.size}`;
  $('.price', el).textContent = money(p.price);
  $('.tag', el).textContent = p.badge || '';
  const add = $('.add', el);
  add.setAttribute('aria-label', `Add ${p.name} to basket, ${money(p.price)}`);
  shelfEl.append(el);
  return {
    p, i, el, art: $('.art', el), img, pic: $('.pic', el), add,
    stock: new Spring(1, critical(320)),   // the picture on the card: 0 gone, 1 there
    shownStock: 1, restockAt: -1,
    out: null,                             // the item that is out of this card, in the hand or in the air
    box: null,                             // where its picture is (page px, untransformed; see measureCards)
  };
});

// ---- where each card's picture is ----------------------------------------------------------------------------------
// Measured once per layout change (load, resize, a filter) and kept in page px, so the frame loop never reads layout:
// the bottom middle of the picture, and its size before the stock scale
let scroll = { x: scrollX, y: scrollY };
addEventListener('scroll', () => { scroll = { x: scrollX, y: scrollY }; }, { passive: true });
export function measureCards() {
  scroll = { x: scrollX, y: scrollY };
  for (const c of cards) {
    if (c.el.hidden) { c.box = null; continue; }
    const a = c.art.getBoundingClientRect();
    c.box = { x: a.left + c.pic.offsetLeft + scroll.x, bottom: a.top + c.pic.offsetTop + c.pic.offsetHeight + scroll.y,
      w: c.pic.offsetWidth, h: c.pic.offsetHeight };
  }
}
// the picture's middle on the screen, and how big it is shown there against its size as an object
export function artBox(card) {
  const b = card.box, k = PIC_MIN + (1 - PIC_MIN) * clamp(card.shownStock, 0, 1.2);
  if (!b) return null;
  return { x: b.x - scroll.x, y: b.bottom - scroll.y - b.h * k / 2, scale: b.w * k / (card.p.dw * shop.scale) };
}
export const onShelf = (card) => !card.el.hidden;

// ---- restocking ------------------------------------------------------------------------------------------------------
export function emptyCard(card) { card.stock.value = card.stock.target = 0; }
export function restockLater(card, delay) { card.restockAt = shop.world.time + delay; }
export function restockNow(card) { card.out = null; card.stock.value = card.stock.target = 1; }

// one frame: the picture grows back onto a card that was emptied. Returns whether anything is still moving
export function stepCards(dt) {
  let moving = false;
  for (const c of cards) {
    if (c.restockAt >= 0) {
      moving = true;
      if (shop.world.time >= c.restockAt) { c.restockAt = -1; if (!c.out) c.stock.target = 1; }
    }
    if (c.stock.resting(0.002) && c.stock.value === c.shownStock) continue;
    moving = true;
    c.stock.step(dt);
    c.shownStock = c.stock.value;
    const v = clamp(c.stock.value, 0, 1.2);
    c.pic.style.transform = `translate(-50%, 0) scale(${(PIC_MIN + (1 - PIC_MIN) * v).toFixed(4)})`;
    c.pic.style.opacity = clamp(v * 1.4, 0, 1).toFixed(3);
  }
  return moving;
}

// ---- the filter -----------------------------------------------------------------------------------------------------------
// The header decides what is shown (an aisle, a search); the shelf only animates it. A filter is a predicate on a
// product's public facts, or null for everything
export const productInfo = (p) => ({ id: p.id, name: p.name, note: p.note, size: p.size, category: p.category, price: p.price });
let wanted = () => true;

let onLayout = () => {};
export function onShelfLayout(fn) { onLayout = fn; }

// show the cards that match the filter: the ones that leave squash out where they were, the ones that come pop in,
// the rest slide to their new places
export function setFilter(fn, { animate = true } = {}) {
  wanted = fn ? (p) => !!fn(productInfo(p)) : () => true;
  for (const c of cards) c.el.getAnimations().forEach((a) => a.finish());
  const first = new Map(cards.filter(onShelf).map((c) => [c, c.el.getBoundingClientRect()]));
  const host = shelfEl.getBoundingClientRect();
  const leaving = [], entering = [];
  for (const c of cards) {
    const want = wanted(c.p);
    if (want && c.el.hidden) { c.el.hidden = false; entering.push(c); }
    else if (!want && !c.el.hidden) leaving.push(c);
  }
  if (leaving.some((c) => c.el.contains(document.activeElement))) shelfEl.focus({ preventScroll: true });
  // the leaving cards come out of the grid but stay where they were while they squash
  for (const c of leaving) {
    const r = first.get(c);
    Object.assign(c.el.style, { position: 'absolute', left: `${r.left - host.left}px`, top: `${r.top - host.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    c.el.inert = true;
  }
  // last: where everything is now (one layout, here)
  measureCards();
  onLayout();
  const finishLeave = (c) => { c.el.hidden = true; c.el.inert = false; c.el.removeAttribute('style'); restyle(c); c.box = null; };
  const count = cards.length - cards.filter((c) => c.el.hidden).length - leaving.length;
  if (calm || !animate) { leaving.forEach(finishLeave); return count; }
  for (const [c, r] of first) {
    if (leaving.includes(c)) continue;
    const now = c.el.getBoundingClientRect(), dx = r.left - now.left, dy = r.top - now.top;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) c.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: EASE_SLIDE });
  }
  for (const c of leaving) {
    c.el.animate([
      { transform: 'none', opacity: 1 },
      { transform: 'scale(1.06, .9)', opacity: 1, offset: 0.3 },
      { transform: 'translateY(30%) scale(.55, .15)', opacity: 0 },
    ], { duration: LEAVE_MS, easing: 'cubic-bezier(.5,0,.75,0)' }).finished.then(() => finishLeave(c), () => {});
  }
  entering.forEach((c, k) => c.el.animate([
    { transform: 'scale(.7, .5)', opacity: 0 },
    { transform: 'scale(1.04, 1.06)', opacity: 1, offset: 0.65 },
    { transform: 'none', opacity: 1 },
  ], { duration: ENTER_MS, delay: 60 + k * 30, easing: 'ease-out', fill: 'backwards' }));
  return count;
}
// a card that left gets its tint back (removeAttribute('style') cleared it with the position)
function restyle(c) { c.el.style.setProperty('--tint', c.p.tint); c.el.style.setProperty('--tint2', c.p.tint2); }
