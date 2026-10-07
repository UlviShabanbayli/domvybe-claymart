// The basket in numbers and words: the list (a line per product with − and +), subtotal, delivery and the rolling
// total, the free-delivery bar, the roller counter on the basket's front and the coin that flips beside it, the count,
// and what a screen reader hears. (The header's badge is nav.js's: it listens to cart:change.) Everything here changes on an event (changed(), which also tells the page:
// document event cart:change); the springs roll per frame.
import { Spring } from './spring.js';
import { $, calm, clamp, countText, money, spring } from './util.js';
import { PRODUCTS } from './catalogue.js';
import { shop } from './state.js';
import { DELIVERY_FEE, FREE_DELIVERY_FROM } from './order.js';
import { BASKET_Y, COUNTER_WINDOW } from './basket.js';
import { takeOne, dropOneIn } from './items.js';

const panel = $('.basket');
const el = {
  count: $('.b-count-n'), countWord: $('.b-count-w'),
  lines: $('.lines'), shipText: $('.ship-text'), shipFill: $('.ship-fill'),
  subtotal: $('.sum-sub'), fee: $('.sum-fee'), feeNow: $('.fee-now'), feeNote: $('.sum-note'), totalText: $('.sum-text'),
  checkout: $('.checkout'), say: $('#say'),
};

// ---- what a screen reader hears ------------------------------------------------------------------------------------------
let saidCount = 0;
export function announce(text) { el.say.textContent = text + (saidCount++ % 2 ? ' ' : ''); }   // a changed string, so a repeat is read again

// ---- the list --------------------------------------------------------------------------------------------------------------
const ICON = {
  minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
  remove: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
};
const rows = new Map();          // product index → its line
function row(pi) {
  if (rows.has(pi)) return rows.get(pi);
  const p = PRODUCTS[pi], li = document.createElement('li');
  li.className = 'line';
  li.style.setProperty('--tint', p.tint); li.style.setProperty('--tint2', p.tint2);
  li.innerHTML = `<span class="l-thumb"><img src="${p.img}" alt=""></span>
    <div class="l-text"><p class="l-name">${p.name}</p><p class="l-price"></p></div>
    <div class="stepper"><button class="minus" type="button"></button><span class="qty"></span><button class="plus" type="button" aria-label="Add one more ${p.name}">${ICON.plus}</button></div>`;
  const r = { li, minus: $('.minus', li), qty: $('.qty', li), price: $('.l-price', li), last: null, n: -1 };
  r.minus.addEventListener('click', () => takeOne(pi));
  $('.plus', li).addEventListener('click', () => dropOneIn(pi));
  rows.set(pi, r);
  return r;
}
function renderLines() {
  const focused = [...rows].find(([, r]) => r.li.contains(document.activeElement))?.[0];
  const lines = shop.order.lines(), keep = lines.map((l) => l.pi);
  for (const [pi, r] of rows) if (!keep.includes(pi) && r.li.isConnected) r.li.remove();
  lines.forEach(({ pi, product: p, qty }, k) => {
    const r = row(pi);
    if (r.n !== qty) {
      r.n = qty;
      r.qty.textContent = qty;
      r.price.textContent = `${money(p.price)}${qty > 1 ? ` · ${money(p.price * qty)}` : ''}`;
    }
    const last = qty === 1;                                   // − turns into × on the last one
    if (r.last !== last) {
      r.last = last;
      r.minus.classList.toggle('is-remove', last);
      r.minus.innerHTML = last ? ICON.remove : ICON.minus;
      r.minus.setAttribute('aria-label', last ? `Remove ${p.name} from basket` : `Remove one ${p.name}`);
    }
    if (el.lines.children[k] !== r.li) el.lines.insertBefore(r.li, el.lines.children[k] || null);
  });
  if (focused !== undefined && !keep.includes(focused)) {      // the focused line just went: focus the line before it
    const at = shop.order.sequence.indexOf(focused), before = keep.filter((pi) => shop.order.sequence.indexOf(pi) < at);
    (keep.length ? rows.get(before.at(-1) ?? keep[0]).minus : el.checkout).focus();
  }
}

// step a spring-driven readout { spring, shown } and write it only when its rounded value changes; a spring that has
// come to rest snaps onto its target, so a resting readout costs nothing. Returns whether it is still moving
function settle(r, dt, write) {
  let moving = false;
  if (r.spring.resting(0.0005)) r.spring.snap(); else { r.spring.step(dt); moving = true; }
  const v = Math.round(r.spring.value * 1000) / 1000;
  if (v !== r.shown) { r.shown = v; write(v); }
  return moving;
}

// ---- the rolling total: one column per digit, each a strip 0–9 that a spring rolls to the right number ----------------------
class Odometer {
  constructor(host, intDigits = 4) {
    this.host = host; this.text = '';
    const proto = money(0).replace(/^\$\d+/, '$' + '0'.repeat(intDigits));   // "$0000.00"
    this.cols = [...proto].map((ch) => {
      const span = document.createElement('span');
      if (!/\d/.test(ch)) { span.className = 'sym'; span.textContent = ch; host.append(span); return { el: span }; }
      span.className = 'col d';
      const strip = document.createElement('span');
      strip.className = 'strip';
      strip.innerHTML = '0123456789'.split('').map((d) => `<span>${d}</span>`).join('');
      span.append(strip); host.append(span);
      return { el: span, strip, spring: new Spring(0, spring(210, 21)), shown: null, on: true };
    });
  }
  set(value) {
    const text = money(Math.min(value, 9999.99));
    if (text === this.text) return;
    this.text = text;
    // digits are right-aligned under the "$": column k shows text[k - pad]; the leading columns it does not reach hide
    const pad = this.cols.length - text.length;
    this.cols.forEach((c, k) => {
      if (!c.spring) return;
      const i = k - pad, on = i >= 1;
      if (c.on !== on) { c.on = on; c.el.hidden = !on; }
      c.spring.target = on ? +text[i] : 0;
      if (calm || !on) c.spring.snap();
    });
  }
  step(dt) {
    let moving = false;
    for (const c of this.cols) if (c.spring && c.on) moving = settle(c, dt, (v) => { c.strip.style.transform = `translateY(${-v}em)`; }) || moving;
    return moving;
  }
}
const odometer = new Odometer($('.odo'));
odometer.set(0);

// ---- the counter on the basket's front: four clay rollers (dollars, cents) in its window, warped onto it in perspective -----
// the projective transform that maps a w × h box onto the quad q (TL TR BR BL), as a CSS matrix3d
function quadMatrix(w, h, q) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]], A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for (let c = 0; c < 8; c++) {                     // Gauss–Jordan with partial pivoting
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; }
  }
  const H = B.map((b, i) => b / A[i][i]);
  return `matrix3d(${H[0]},${H[3]},0,${H[6]},${H[1]},${H[4]},0,${H[7]},0,0,1,0,${H[2]},${H[5]},0,1)`;
}
const COUNTER_W = 220, COUNTER_H = 150, ROLLER_CELL = 126;      // px in the counter's own box
const counterEl = $('.counter'), coin = $('.coin img');
counterEl.style.transform = quadMatrix(COUNTER_W, COUNTER_H, COUNTER_WINDOW.map(([x, y]) => [x, y + BASKET_Y]));
const rollers = (() => {
  const face = $('.counter__face', counterEl);
  face.innerHTML = '<div class="roller roller--sign"><div class="roller__strip"><div class="roller__cell">$</div></div></div>';
  return Array.from({ length: 4 }, (_, i) => {
    if (i === 2) face.insertAdjacentHTML('beforeend', '<i class="roller-dot"></i>');
    const r = document.createElement('div');
    r.className = 'roller' + (i >= 2 ? ' roller--alt' : '');
    r.innerHTML = `<div class="roller__strip">${'0123456789'.split('').map((d) => `<div class="roller__cell">${d}</div>`).join('')}</div>`;
    face.append(r);
    return { el: r, strip: r.firstElementChild, spring: new Spring(0, spring(200, 17)), shown: null };
  });
})();
let counterCents = 0;
function setCounter(value) {
  const cents = Math.min(9999, Math.round(value * 100));
  if (cents === counterCents) return;
  const up = cents > counterCents;
  counterCents = cents;
  String(cents).padStart(4, '0').split('').forEach((ch, i) => {
    const r = rollers[i], d = +ch, cur = ((Math.round(r.spring.target) % 10) + 10) % 10;
    r.spring.target += up ? (d - cur + 10) % 10 : -((cur - d + 10) % 10);   // an odometer only rolls one way per change
    if (calm) r.spring.snap();
  });
  rollers[0].el.style.opacity = cents < 1000 ? '.5' : '1';
  if (!calm) coin.animate([
    { transform: 'translateY(0) rotateY(24deg)' }, { transform: 'translateY(-26px) rotateY(204deg)', offset: 0.45 }, { transform: 'translateY(0) rotateY(384deg)' },
  ], { duration: 820, easing: 'cubic-bezier(.3,.9,.4,1)' });
}
function stepCounter(dt) {
  let moving = false;
  for (const r of rollers) {
    moving = settle(r, dt, (v) => { r.strip.style.transform = `translateY(${(-(((v % 10) + 10) % 10) * ROLLER_CELL).toFixed(1)}px)`; }) || moving;
  }
  return moving;
}

// set a property only when it changes (a text or an attribute written again is still a style and layout invalidation)
const written = new WeakMap();
function write(target, key, value) {
  const seen = written.get(target) || written.set(target, {}).get(target);
  if (seen[key] === value) return;
  seen[key] = value;
  target[key] = value;
}

// ---- the free-delivery bar ----------------------------------------------------------------------------------
const ship = { spring: new Spring(0, spring(160, 20)), shown: null };
let freeShown = false;

// something came in or went out (kind 'add' | 'remove' | 'reset'): every number, the list, the words
export function changed(kind, pi = -1, n = 1) {
  const { order } = shop, count = order.count, sub = order.subtotal, total = order.total, free = order.freeDelivery;
  write(panel.dataset, 'state', count ? 'full' : 'empty');
  write(panel.dataset, 'fee', !count ? 'none' : free ? 'free' : 'paid');
  write(el.count, 'textContent', String(count));
  write(el.countWord, 'textContent', count === 1 ? 'item' : 'items');
  write(el.subtotal, 'textContent', money(sub));
  write(el.feeNow, 'textContent', !count ? '—' : free ? 'Free' : money(DELIVERY_FEE));
  write(el.feeNote, 'textContent', !count ? '' : free ? ' · free delivery' : ` · +${money(DELIVERY_FEE)} delivery`);
  odometer.set(total);
  setCounter(total);
  write(el.totalText, 'textContent', money(total));
  ship.spring.target = clamp(sub / FREE_DELIVERY_FROM, 0, 1);
  if (calm) ship.spring.snap();
  write(el.shipText, 'innerHTML', free
    ? '<span class="ok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Free delivery unlocked</span>'
    : count ? `<b>${money(order.toFreeDelivery)}</b> away from free delivery` : `Free delivery from <b>${money(FREE_DELIVERY_FROM)}</b>`);
  write(el.checkout, 'ariaDisabled', String(!count));
  renderLines();
  const flipped = free !== freeShown;
  freeShown = free;
  if (flipped && !calm) el.fee.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.35 }, { transform: 'scale(.96)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 480, easing: 'ease-out' });
  document.dispatchEvent(new CustomEvent('cart:change', { detail: { count, subtotal: sub, delivery: order.delivery, total, kind, id: PRODUCTS[pi]?.id ?? null } }));
  const p = PRODUCTS[pi];
  if (!p) return;
  const what = n > 1 ? `${n} × ${p.name}` : p.name;
  const fee = !flipped ? '' : free ? ' Free delivery unlocked.' : count ? ` Delivery ${money(DELIVERY_FEE)} added back.` : '';
  announce(`${what} ${kind === 'add' ? 'added to' : 'removed from'} your basket. ${countText(count)}, ${money(total)}.${fee}`);
}

// one frame of every rolling number; returns whether anything is still moving
export function stepReadouts(dt) {
  let moving = odometer.step(dt);
  moving = stepCounter(dt) || moving;
  moving = settle(ship, dt, (v) => { el.shipFill.style.transform = `scaleX(${clamp(v, 0, 1)})`; }) || moving;
  return moving;
}

// the bag button jumps to the list: its first control
export const firstControl = () => el.lines.querySelector('button') || el.checkout;
