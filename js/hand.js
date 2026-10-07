// Picking things up and throwing them. Press a product's picture and it comes off its card into your hand: a soft
// spring holds it where you pressed, so it trails the pointer and swings from that point. Let go and it flies with the
// hand's own speed; let go over the basket and the magnet pulls it straight in; let go of something from the pile
// outside the basket and it is taken off the order. The Add button throws for you, in an arc.
import { calm, clamp, docked } from './util.js';
import { shop } from './state.js';
import { tray, overBasket, inColumn } from './basket.js';
import { cards, artBox, emptyCard, restockLater } from './shelf.js';
import { makeItem, setMode, commit, catchIt, aimFor, flingOut, placeCalm, goHome, LIFT } from './items.js';
import { wake } from './loop.js';

const SAMPLE_WINDOW = 80;          // ms: the hand's speed is measured over its last 80 ms (a hand that stopped does not throw)
const MAX_THROW = 3200;            // px/s
const THROW_FROM = 420;            // px/s: slower than this is a drop, not a throw
const HEADING = Math.cos(40 * Math.PI / 180);   // a throw within 40° of the basket's mouth is meant for it
const ADD_GRAVITY = 0.62;          // the Add arc flies under a lighter gravity
const ADD_HOP = -320;              // px/s: the arc always hops up a little first, even when the basket is below

// ---- the hand -------------------------------------------------------------------------------------------------------------
// press on a product's picture: it comes off the card into your hand
export function takeFromCard(card, x, y) {
  if (shop.phase !== 'shop' || shop.hold || card.out || card.el.hidden) return null;
  const a = artBox(card);
  if (!a) return null;
  const it = makeItem(card.i, a.x, a.y);
  it.card = card;
  it.vis.value = a.scale; it.vis.target = calm ? 1 : LIFT;     // it grows from the card's size to its own, lifted
  card.out = it;
  emptyCard(card);                                              // the card is empty while it is in the hand
  beginHold(it, x ?? a.x, y ?? a.y, false);
  return it;
}
// press on something in the pile: pick it back up (to move it, or to fling it out)
export function takeFromPile(it, x, y) {
  if (shop.phase !== 'shop' || shop.hold || it.mode !== 'cart') return false;
  it.vis.target = calm ? 1 : LIFT;
  beginHold(it, x ?? it.body.x, y ?? it.body.y, true);
  shop.world.wakeIsland(it.body);
  return true;
}

// the hand holds it where you pressed (on the object), with a soft spring
function beginHold(it, x, y, fromCart) {
  setMode(it, 'held');
  const b = it.body;
  const gx = clamp(x, b.x - it.half.x * 0.85, b.x + it.half.x * 0.85), gy = clamp(y, b.y - it.half.y * 0.85, b.y + it.half.y * 0.85);
  const grab = shop.world.grab(b, gx, gy, { hz: calm ? 9 : 5.5, damping: calm ? 1 : 0.7 });
  shop.hold = { it, grab, fromCart, x, y, ox: x - gx, oy: y - gy, samples: [{ x, y, at: performance.now() }] };
  grab.tx = x - shop.hold.ox; grab.ty = y - shop.hold.oy;
  wake();
}
export function moveHold(x, y) {
  const hold = shop.hold;
  if (!hold) return;
  hold.x = x; hold.y = y;
  hold.grab.tx = x - hold.ox; hold.grab.ty = y - hold.oy;
  const now = performance.now();
  hold.samples.push({ x, y, at: now });
  while (hold.samples.length > 2 && now - hold.samples[0].at > 150) hold.samples.shift();
}

// how fast the hand was moving, from the last 80 ms only (performance.now(), not event times)
function handSpeed() {
  const now = performance.now(), s = shop.hold.samples.filter((p) => now - p.at <= SAMPLE_WINDOW);
  if (s.length < 2) return { x: 0, y: 0 };
  const dt = Math.max(16, s.at(-1).at - s[0].at) / 1000;
  const v = { x: (s.at(-1).x - s[0].x) / dt, y: (s.at(-1).y - s[0].y) / dt }, sp = Math.hypot(v.x, v.y);
  return sp > MAX_THROW ? { x: v.x * MAX_THROW / sp, y: v.y * MAX_THROW / sp } : v;
}
// where the hand is over the basket, it counts as "in" (a desk is generous by 28 px)
const handOver = (x, y, fromCart) => overBasket(x, y, fromCart || docked.matches ? 0 : 28);

// let go: with the hand's speed, or with a given one (the test API, a cancelled pointer)
export function releaseHold(given) {
  const hold = shop.hold;
  if (!hold) return null;
  const { it, fromCart } = hold, b = it.body;
  const v = given || handSpeed();
  shop.world.release(hold.grab);
  const over = handOver(hold.x, hold.y, fromCart);
  shop.hold = null;
  it.vis.target = 1;
  b.vx = v.x; b.vy = v.y;
  wake();
  if (fromCart) {
    if (!over) { flingOut(it, v); return it; }                 // let go outside the basket: it is taken off the order
    if (calm) b.vx = b.vy = b.w = 0;
    setMode(it, inColumn(b) && b.y > tray.top ? 'cart' : 'pull');
    if (it.mode === 'pull') it.aim = aimFor(it);
    else it.vis.target = shop.pileScale;
    return it;
  }
  if (calm) { if (over) placeCalm(commit(it)); else goHome(it); return it; }
  if (over) { catchIt(commit(it)); return it; }                // let go over the basket: it is pulled straight in
  if (Math.hypot(v.x, v.y) > THROW_FROM) {                     // thrown: it flies, and if it comes near, the magnet takes it
    setMode(it, 'free');
    it.bound = heading(b, v);
    if (it.bound) commit(it);
    it.flight = 0.5;
    b.w += clamp(v.x / 600, -6, 6);
    return it;
  }
  goHome(it);                                                  // let go anywhere else: back onto its card
  return it;
}
function heading(b, v) {
  const dx = tray.cx - b.x, dy = tray.top - b.y, d = Math.hypot(dx, dy), s = Math.hypot(v.x, v.y);
  return s > 0 && (dx * v.x + dy * v.y) / (d * s) > HEADING;
}

// the words under the basket while something is held over it: "Let go to add", or (for something lifted out of the
// pile and carried off the panel) "Let go to remove"
const panel = document.querySelector('.basket');
let hintShown = '';
export function showDropHint() {
  const h = shop.hold;
  const hint = !h ? '' : h.fromCart ? (overBasket(h.x, h.y) ? '' : 'out') : handOver(h.x, h.y, false) ? 'add' : '';
  if (hint === hintShown) return;
  hintShown = hint;
  if (hint) panel.dataset.over = hint; else delete panel.dataset.over;
}

// ---- pointers ------------------------------------------------------------------------------------------------------------
function capture(e, el) {
  shop.hold.id = e.pointerId; shop.hold.el = el;
  el.setPointerCapture(e.pointerId);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}
function onMove(e) { if (shop.hold && e.pointerId === shop.hold.id) moveHold(e.clientX, e.clientY); }
function onUp(e) {
  if (!shop.hold || e.pointerId !== shop.hold.id) return;
  const el = shop.hold.el;
  el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
  releaseHold(e.type === 'pointercancel' ? { x: 0, y: 0 } : null);
}
export function listen() {
  for (const card of cards) {
    card.art.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (takeFromCard(card, e.clientX, e.clientY)) capture(e, card.art);
    });
    card.add.addEventListener('click', () => addFromCard(card.i));
  }
  // the pile: one listener on the stage for every item in it
  document.querySelector('.stage').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.item');
    const it = el && shop.items.find((x) => x.el === el);
    if (!it || e.button !== 0) return;
    e.preventDefault();
    if (takeFromPile(it, e.clientX, e.clientY)) capture(e, it.el);
  });
}

// ---- the Add button: a copy jumps off the card (or off `from`, a point) and flies in an arc to the basket -------------------
// The arc would land in the mouth under a lighter gravity; near the end the magnet takes over and pulls it in for real
export function addFromCard(pi, from = null) {
  if (shop.phase !== 'shop') return null;
  const card = cards[pi];
  const art = from ? null : artBox(card);
  const a = from ? { x: from.x, y: from.y, scale: 0.6 } : art && card.out ? { ...art, scale: 1 } : art;
  if (!a) return null;
  const it = makeItem(pi, a.x, a.y);
  it.vis.value = a.scale; it.vis.target = 1;
  commit(it);
  if (!from && !card.out) { emptyCard(card); restockLater(card, 0.22); }   // the shelf restocks itself
  wake();
  if (calm) return placeCalm(it);
  launch(it, tray.cx + shop.rng.range(-0.24, 0.24) * tray.w, tray.top - it.half.y - 30);
  return it;
}
function launch(it, tx, ty) {
  const b = it.body, g = shop.world.gravity * ADD_GRAVITY, dx = tx - b.x, dy = ty - b.y;
  let t = clamp(0.42 + Math.hypot(dx, dy) / 2600, 0.5, 0.85);
  let vy = (dy - 0.5 * g * t * t) / t;
  if (vy > ADD_HOP) { t = (-ADD_HOP + Math.sqrt(ADD_HOP * ADD_HOP + 2 * g * dy)) / g; vy = ADD_HOP; }
  setMode(it, 'free');
  b.gravityScale = ADD_GRAVITY;
  b.vx = dx / t; b.vy = vy; b.w = shop.rng.range(3.5, 7) * (dx > 0 ? 1 : -1);
  it.bound = true; it.flight = t;
}
