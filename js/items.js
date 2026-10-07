// The products as objects. Out of its card, a product is a physics body and a picture, and it is always in one MODE:
//   held   in the hand (hand.js)               free   flying after a throw or the Add arc
//   pull   the magnet has it: over the rim      cart   in the pile
//   out    taken off the order, fading          home   flying back onto its card (a throw that missed)
//   merge  melting into one like it (×2)        pack   going into the bag at checkout
// Here: making and dropping them, the magnet's field and catch, the landing, the pile's limits and its scale, the
// world's per-step behaviour for every mode, and drawing them where their bodies are.
import { Body } from './physics.js';
import { Spring } from './spring.js';
import { $, calm, clamp, smoothstep, spring } from './util.js';
import { PRODUCTS } from './catalogue.js';
import { shop, caps, pile } from './state.js';
import { tray, room, lidAt, thud, buck } from './basket.js';
import { cards, artBox, restockNow, restockLater } from './shelf.js';
import { changed } from './readouts.js';
import { wake } from './loop.js';

const stage = $('.stage');
export const LIFT = 1.06;                  // a product in the hand is lifted a little: shown 6 % bigger
const PACKING = 0.62;                      // how much of the basket's room a real pile fills
const MIN_PILE_SCALE = 0.72;               // a full basket never shrinks its contents more than this
const CATCH_AT = 0.55;                     // the field's strength at which the magnet takes something
const MISS_AFTER = 0.6;                    // s: a throw that is not caught by then goes back to its card
const OUT_FADE = 0.55, MERGE_TIME = 0.26, PACK_TIME = 0.42;
const LID_PUSH = 30, LID_PUSH_MAX = 420;   // 1/s, px/s: how firmly the soft lid presses down what rises over it
const TIP_SPIN = 2.5;                      // rad/s: a tall thing standing up under the lid is tipped over
const LID_BUDGET = 1.2;                    // s: how long after a landing the lid presses (then the pile may sleep)
const LID_OVER = 25;                       // basket px: a settled pile that still rises this far over the lid shrinks
const SHRINK_STEP = 0.95;

// ---- one product as an object ----------------------------------------------------------------------------------------
export function makeItem(pi, x, y) {
  const p = PRODUCTS[pi], { w, h, r } = p.shape, S = shop.scale;
  const circle = w === h && r * 2 === w;
  const body = new Body({ x, y, hx: circle ? 0 : (w / 2 - r) * S, hy: circle ? 0 : (h / 2 - r) * S, r: r * S, ...p.material });
  const el = document.createElement('div');
  el.className = 'item is-ghost';
  const W = p.dw * S, H = p.dh * S;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  el.innerHTML = `<img src="${p.img}" alt="" draggable="false"><span class="units"></span>`;
  stage.append(el);
  const it = {
    pi, p, body, el, badge: $('.units', el), units: 1, mode: 'new', t0: shop.world.time, counted: false,
    W, H, half: { x: w / 2 * S, y: h / 2 * S }, area: w * h * S * S,
    vis: new Spring(1, spring(380, 22)),   // its drawn scale (grows off the card, lifts in the hand, pops on a merge)
    alpha: 1, shown: { tf: '', alpha: 1 }, card: null, bodyScale: 1,
  };
  body.item = it;
  shop.world.add(body);
  shop.items.push(it);
  return it;
}
export function dropItem(it) {
  shop.world.remove(it.body);
  it.el.remove();
  const k = shop.items.indexOf(it); if (k >= 0) shop.items.splice(k, 1);
}
export function setMode(it, mode) {
  const leftPile = it.mode === 'cart' && mode !== 'cart';
  it.mode = mode; it.t0 = shop.world.time;
  const b = it.body;
  b.kinematic = mode === 'home' || mode === 'merge' || mode === 'pack';
  b.collides = !(b.kinematic || mode === 'out');
  b.gravityScale = 1;
  b.wake();
  if (mode !== 'cart' && it.bodyScale !== 1) { b.resize(1); it.bodyScale = 1; }   // only the pile is scaled
  it.el.classList.toggle('is-ghost', mode !== 'cart');                 // only what is in the pile can be picked up again
  it.el.classList.toggle('is-held', mode === 'held');
  it.el.classList.toggle('is-in', mode === 'cart' || mode === 'pack' || mode === 'merge');   // behind the basket's front
  if (leftPile) { shop.pileCap = 1; fitPile(); }
}
const setUnits = (it, n) => { it.units = n; it.badge.textContent = n > 1 ? '×' + n : ''; };

// it is now part of the order: count it, and put a fresh copy back on the card
export function commit(it) {
  if (it.counted) return it;
  it.counted = true;
  shop.order.ordered[it.pi] += it.units;
  if (it.card && it.card.out === it) { it.card.out = null; restockLater(it.card, 0.25); }
  return it;
}

// ---- the pile's scale --------------------------------------------------------------------------------------------------
// The basket holds so much and no more: when what is in it needs more room than there is under the magnet and the
// handle, everything in it is shown (and is, as a body) a little smaller, so the pile always stays inside the basket
function fitPile() {
  const inPile = pile();
  const need = inPile.reduce((a, it) => a + it.area, 0) / PACKING;
  const s = need ? clamp(Math.sqrt(room() / need), MIN_PILE_SCALE, shop.pileCap) : 1;
  if (Math.abs(s - shop.pileScale) >= 0.004 || s === 1) shop.pileScale = s;
  let resized = false;
  for (const it of inPile) {
    if (it.bodyScale === shop.pileScale) continue;
    it.body.resize(shop.pileScale); it.bodyScale = shop.pileScale; it.vis.target = shop.pileScale;
    if (calm) it.vis.snap();
    resized = true;
  }
  if (resized) shop.world.wakeAll();
  shop.pileChecked = false;
}

// ---- the magnet ----------------------------------------------------------------------------------------------------------
// how hard it pulls on something at this point: nothing far away, all of it right over the mouth
function field(b) {
  const x = clamp(b.x, tray.inL + 24, tray.inR - 24);
  return 1 - smoothstep(tray.reach * 0.25, tray.reach, Math.hypot(b.x - x, b.y - tray.top));
}
// where something caught should go in: over the mouth, roughly above where it already is, a bit towards the middle
export function aimFor(it) {
  const x = clamp(it.body.x, tray.inL + it.half.x + 10, tray.inR - it.half.x - 10);
  return x + (tray.cx - x) * 0.3;
}
export function catchIt(it) {
  setMode(it, 'pull');
  it.aim = aimFor(it);
  ring(it.body.x, it.body.y, 0.6);
  return it;
}
// steer a velocity towards a point; s (0..1) is how much the magnet has hold of it
function steer(b, tx, ty, s, h, top = 2400) {
  const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1, sp = Math.min(top, 240 + d * 7);
  const k = 1 - Math.exp(-h * 16 * s);
  b.vx += (dx / d * sp - b.vx) * k; b.vy += (dy / d * sp - b.vy) * k;
  b.w *= 1 - Math.min(1, h * 2.5 * s);
}

// over the rim and in: it is in the basket now. The numbers change on landing, not before
export function land(it) {
  setMode(it, 'cart');
  const b = it.body;
  b.vy = Math.min(Math.max(b.vy, 240), 1000); b.vx *= 0.5;
  shop.order.land(it.pi, it.units);
  shop.landedAt = shop.world.time;
  ring(b.x, tray.top + 6, 1);
  buck(160);                                                     // the magnet lets go: it bucks a little
  changed('add', it.pi);
  makeRoom(it);
  fitPile();
}

// the pile has a limit: past it, an extra unit of something merges into one already there (its badge counts ×2, ×3)
function makeRoom(newest) {
  const { each, total } = caps();
  const same = pile().filter((x) => x.pi === newest.pi);
  if (same.length > each) return mergeInto(newest, same[0]);
  if (pile().length <= total) return;
  const groups = PRODUCTS.map((_, i) => pile().filter((x) => x.pi === i));
  const most = groups.reduce((a, g) => (g.length > a.length ? g : a), []);
  if (most.length > 1) mergeInto(most.at(-1), most[0]);
}
function mergeInto(src, dst) {
  setMode(src, 'merge');
  src.into = dst; src.from = { x: src.body.x, y: src.body.y };
  if (calm) finishMerge(src);
}
function finishMerge(src) {
  const dst = src.into;
  setUnits(dst, dst.units + src.units);
  if (!calm) dst.vis.velocity += 2.2;                            // the one it merged into gives a little pop
  dropItem(src);
}

// ---- taking things out, putting one more in ---------------------------------------------------------------------------
// let go of something outside the basket: it flies off where you threw it, fades, and comes off the order
export function flingOut(it, v) {
  shop.order.inBasket[it.pi] -= it.units; shop.order.ordered[it.pi] -= it.units;
  setMode(it, 'out');
  const b = it.body;
  if (calm) dropItem(it);
  else { b.vx = v.x; b.vy = Math.min(v.y, -260); b.w += clamp(v.x / 300, -9, 9); }
  shop.world.wakeAll();
  changed('remove', it.pi, it.units);
}
// − in the list: one unit fewer. From a merged one, its badge counts down; otherwise one pops out of the pile
export function takeOne(pi) {
  if (shop.phase !== 'shop' || shop.order.inBasket[pi] <= 0) return;
  const mine = pile().filter((x) => x.pi === pi).sort((a, b) => b.units - a.units || a.body.y - b.body.y);
  const it = mine[0];
  if (!it) return;
  shop.order.inBasket[pi]--; shop.order.ordered[pi]--;
  if (it.units > 1) {
    setUnits(it, it.units - 1);
    if (!calm) { it.body.vy -= 300; it.vis.velocity -= 1.5; }
    shop.world.wakeIsland(it.body);
  } else {
    setMode(it, 'out');
    if (calm) dropItem(it);
    else { const b = it.body; b.vy = -720; b.vx = (b.x < tray.cx ? -1 : 1) * 160; b.w = shop.rng.range(-5, 5); }
    shop.world.wakeAll();
  }
  changed('remove', pi, 1);
  wake();                                  // the list's − can be pressed while the frame loop sleeps
}
// + in the list: one more, dropped in from just above the basket
export function dropOneIn(pi) {
  if (shop.phase !== 'shop') return;
  const it = makeItem(pi, tray.cx + shop.rng.range(-0.25, 0.25) * tray.w, tray.top - 90 * shop.scale);
  commit(it);
  if (calm) return placeCalm(it);
  it.body.angle = shop.rng.range(-0.5, 0.5); it.body.w = shop.rng.range(-3, 3);
  catchIt(it);
  wake();                                  // the list's + can be pressed while the frame loop sleeps
}

// reduced motion: no flight at all. It is put straight into its resting place, settled by the physics in one go
export function placeCalm(it) {
  const b = it.body;
  const top = pile().reduce((m, x) => Math.min(m, x.body.y - x.half.y), tray.floor);
  b.x = aimFor(it); b.y = Math.max(tray.top - 120, Math.min(top, tray.floor) - it.half.y - 2);
  b.vx = b.vy = b.w = 0; b.angle = 0;
  it.vis.value = it.vis.target = 1;
  land(it);
  b.vx = b.vy = 0;
  it.vis.snap();
  shop.world.settle(360, () => pile().map((x) => x.body));
  return it;
}

// once the pile has gone to sleep: does anything still rise clearly over the lid (no room was left below it)? Then the
// whole pile is shown a little smaller and the lid presses again, until it fits (or the pile is as small as it gets)
export function checkPileFits() {
  if (shop.pileChecked || shop.world.active) return;
  shop.pileChecked = true;
  const k = tray.w / 640, over = pile().some((it) => {
    const b = it.body, c = Math.abs(Math.cos(b.angle)), s = Math.abs(Math.sin(b.angle));
    return lidAt(b.x) - (b.y - (s * b.hx + c * b.hy + b.r)) > LID_OVER * k;
  });
  if (!over || shop.pileScale <= MIN_PILE_SCALE) return;
  shop.pileCap = Math.max(MIN_PILE_SCALE, shop.pileScale * SHRINK_STEP);
  shop.landedAt = shop.world.time;
  fitPile();
}

// the soft lid: whatever in the pile rises over it is pressed straight down (never sideways, so nothing wedges), and a
// tall thing standing up is tipped over, towards the middle of the basket. It presses for a moment after each landing
// only: a pile with nowhere to go must still be allowed to sleep
function underLid(it, h) {
  const b = it.body, c = Math.abs(Math.cos(b.angle)), s = Math.abs(Math.sin(b.angle));
  const over = lidAt(b.x) - (b.y - (s * b.hx + c * b.hy + b.r));
  if (over <= 0 || !b.awake || shop.world.time - shop.landedAt > LID_BUDGET) return;
  b.vy = Math.max(b.vy, Math.min(LID_PUSH_MAX, over * LID_PUSH));
  if (b.hy > b.hx && c > 0.8 && Math.abs(b.w) < TIP_SPIN) b.w += (b.x < tray.cx ? 1 : -1) * TIP_SPIN * 0.2;
}

// ---- every step: what the world does to each product, by its mode -----------------------------------------------------
const MODES = {
  held(it, h) {
    // in the hand, near the basket: the magnet already tugs at it, so it leans in towards the mouth
    if (shop.hold?.fromCart) return;
    const b = it.body, s = field(b);
    if (s <= 0) return;
    const dx = aimFor(it) - b.x, dy = tray.top - b.y, d = Math.hypot(dx, dy) || 1;
    b.vx += dx / d * s * 2200 * h; b.vy += dy / d * s * 2200 * h;
  },
  free(it, h, age) {
    const b = it.body;
    let s = field(b);
    if (it.bound) s = Math.max(s, clamp((age - it.flight * 0.55) / (it.flight * 0.45), 0, 1));
    if (s > 0) { steer(b, aimFor(it), tray.top - it.half.y - 10, s, h); b.gravityScale = (it.bound ? 0.62 : 1) * (1 - s); }
    if (s > CATCH_AT) { commit(it); catchIt(it); return; }
    const gone = b.y > innerHeight + 200 || b.x < -200 || b.x > innerWidth + 200;
    if (!it.bound && (age > MISS_AFTER || gone)) goHome(it);
  },
  pull(it, h, age) {
    const b = it.body;
    b.gravityScale = 0;
    const over = Math.abs(b.x - it.aim) < Math.max(14, it.half.x * 0.6);
    steer(b, it.aim, over ? tray.top + it.half.y + 30 : tray.top - it.half.y - 16, 1, h);
    if ((over && b.y > tray.top - it.half.y * 0.25) || age > 1.4) land(it);
  },
  cart(it, h) {
    // a last guard: anything that ever ends up outside the basket is put back in at the top
    const b = it.body;
    if (b.y > tray.floor + 40 || b.x < tray.inL - 6 || b.x > tray.inR + 6 || b.y < tray.top - 300) {
      b.x = aimFor(it); b.y = tray.top - it.half.y - 40; b.vx = b.vy = b.w = 0; shop.world.wakeAll();
    }
    if (b.circle) b.w *= 1 - h * 1.2;                            // a little rolling resistance
    underLid(it, h);
  },
  out(it, h, age) {
    it.alpha = clamp(1 - age / OUT_FADE, 0, 1);
    if (age > OUT_FADE) { if (it.card && it.card.out === it) restockNow(it.card); dropItem(it); }
  },
  home(it, h, age) {
    const b = it.body, a = artBox(it.card), k = 1 - Math.exp(-h * 13);
    if (!a) { setMode(it, 'out'); return; }                       // its card left the shelf (a filter): it just fades
    b.x += (a.x - b.x) * k; b.y += (a.y - b.y) * k;
    b.angle += (Math.round(b.angle / (2 * Math.PI)) * 2 * Math.PI - b.angle) * k;
    it.vis.target = a.scale;
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.8 || age > 1.2) arriveHome(it);
  },
  merge(it, h, age) {
    const t = clamp(age / MERGE_TIME, 0, 1), e = t * t, b = it.body, d = it.into.body;
    b.x = it.from.x + (d.x - it.from.x) * e; b.y = it.from.y + (d.y - it.from.y) * e;
    it.vis.target = it.vis.value = 1 - 0.7 * e; it.alpha = 1 - e * e;
    if (t >= 1) finishMerge(it);
  },
  pack(it, h, age) {
    const t = clamp((age - it.delay) / PACK_TIME, 0, 1), e = t * t * t, b = it.body;
    b.x = it.from.x + (tray.cx - it.from.x) * e; b.y = it.from.y + (tray.floor - 10 - it.from.y) * e;
    b.angle = it.from.a * (1 - e);
    it.vis.value = it.vis.target = it.from.s * (1 - 0.65 * e); it.alpha = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
    if (t >= 1) dropItem(it);
  },
};
shop.world.beforeStep = (h) => {
  for (const it of [...shop.items]) MODES[it.mode]?.(it, h, shop.world.time - it.t0);
};
// the basket gives under every landing in the pile: the harder and heavier, the deeper
shop.world.afterStep = () => {
  for (const hit of shop.world.impacts) {
    const it = (hit.a.item?.mode === 'cart' && hit.a.item) || (hit.b.item?.mode === 'cart' && hit.b.item);
    if (!it) continue;
    const other = it.body === hit.a ? hit.b : hit.a;
    if (other.wall === 'floor' || other.item?.mode === 'cart') thud(hit.speed, it.body.mass);
  }
};

// back to the card it came from (a throw that was not taken)
export function goHome(it) {
  if (!it.card) return dropItem(it);
  setMode(it, 'home');
  if (calm) arriveHome(it);
}
function arriveHome(it) {
  restockNow(it.card);
  dropItem(it);
}

// the basket changed size (a new layout): the products are a different size as objects, so the pile is rebuilt at the
// new size and whatever was in the air goes back to its card
export function rescalePile() {
  const keep = pile().map((x) => ({ pi: x.pi, units: x.units }));
  for (const it of [...shop.items]) dropItem(it);
  for (const c of cards) if (c.out) restockNow(c);
  if (shop.hold) { shop.world.release(shop.hold.grab); shop.hold = null; }
  shop.pileScale = 1; shop.pileCap = 1;
  keep.forEach((k, n) => {
    const it = makeItem(k.pi, tray.inL + tray.w * ((n % 3) + 0.5) / 3, tray.top - 40 - Math.floor(n / 3) * 70 * shop.scale);
    setUnits(it, k.units); it.counted = true;
    setMode(it, 'cart');
  });
  fitPile();
  shop.world.settle(600, () => shop.items.map((x) => x.body));
}

// ---- the rings that mark a catch (a few, made once and reused) -----------------------------------------------------------
const RING_LIFE = 0.5;
const rings = Array.from({ length: 4 }, () => {
  const el = document.createElement('i');
  el.className = 'ring';
  stage.append(el);
  return { el, t: RING_LIFE, x: 0, y: 0, s: 0 };
});
function ring(x, y, strength) {
  if (calm) return;
  const r = rings.reduce((a, b) => (b.t > a.t ? b : a));     // the oldest one
  Object.assign(r, { x, y, s: strength, t: 0 });
}

// ---- drawing ------------------------------------------------------------------------------------------------------------
// every product where its body is (the pile rides the basket's dip); returns whether anything is still moving
export function drawItems(dt, dip) {
  let moving = false;
  for (const it of shop.items) {
    it.vis.step(dt);
    if (!it.vis.resting(0.001)) moving = true;
    const b = it.body, y = it.mode === 'cart' ? b.y + dip : b.y;
    const tf = `translate3d(${(b.x - it.W / 2).toFixed(2)}px,${(y - it.H / 2).toFixed(2)}px,0) rotate(${b.angle.toFixed(4)}rad) scale(${it.vis.value.toFixed(4)})`;
    if (tf !== it.shown.tf) {
      it.shown.tf = tf; it.el.style.transform = tf;
      if (it.units > 1) it.badge.style.transform = `rotate(${(-b.angle).toFixed(4)}rad)`;
    }
    if (it.alpha !== it.shown.alpha) { it.shown.alpha = it.alpha; it.el.style.opacity = it.alpha.toFixed(3); }
  }
  for (const r of rings) {
    if (r.t >= RING_LIFE) continue;
    moving = true;
    r.t = Math.min(RING_LIFE, r.t + dt);
    const e = 1 - (1 - r.t / RING_LIFE) ** 3;
    r.el.style.transform = `translate3d(${r.x}px, ${r.y}px, 0) scale(${(0.25 + 0.9 * e).toFixed(3)})`;
    r.el.style.opacity = ((1 - e) * 0.55 * r.s).toFixed(3);
  }
  return moving;
}

// how hard the magnet pulls on what is in the hand or in the air (for its glow and lean)
export function magnetPull() {
  let pull = 0;
  for (const it of shop.items) {
    if (it.mode === 'held' && !shop.hold?.fromCart) pull = Math.max(pull, 0.15 + 0.85 * field(it.body));
    else if (it.mode === 'free') pull = Math.max(pull, field(it.body));
    else if (it.mode === 'pull') pull = 1;
  }
  return pull;
}
