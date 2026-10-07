// ClayMart — the magnetic market. A shop whose basket hangs under a magnet. Grab a product off the shelf and throw it
// (or press Add) and it becomes a real object: it flies with gravity, the magnet pulls it in when it comes near, and it
// lands in a pile with weight — it slides, stacks, settles, and the clay basket gives a little under it. Fling something
// back out to take it off the order. The pile is the picture; the list under it is the same basket in words, with − and
// + for every line, so nothing here needs a drag: keyboards, screen readers and reduced motion get the whole shop.
//
// The modules, in the order a product meets them:
//   catalogue.js  the products                    order.js     the order in numbers: subtotal, delivery, total
//   shelf.js      the cards, restock, the filter    hand.js      grabbing, throwing, the Add arc
//   physics.js    the rigid-body engine             basket.js    the basket on the screen: walls, lid, dip, magnet
//   items.js      products as objects: modes, the magnet's catch, the pile
//   readouts.js   the list, the rolling total, the counter    checkout.js  paying and the receipt
//   sheet.js      openBasket(), the basket sheet              loop.js      the frame loop (idle when nothing moves)
// This file wires them together and gives the header (nav.js) and scripts (tests, reel capture) window.__checkout.
// The page hears about the basket through document events: cart:change { count, subtotal, delivery, total } on every
// change, cart:checkout { no, items, count, subtotal, delivery, total, date } on every order, cart:ready once.
import { $ } from './util.js';
import { PRODUCTS, indexOf } from './catalogue.js';
import { shop } from './state.js';
import { measure, onBasketMove, tray } from './basket.js';
import { cards, measureCards, onShelfLayout, onShelf, productInfo, setFilter } from './shelf.js';
import { flingOut, takeOne, dropOneIn } from './items.js';
import { listen as listenHand, takeFromCard, takeFromPile, moveHold, releaseHold, addFromCard } from './hand.js';
import { changed } from './readouts.js';
import { listen as listenCheckout, checkout, newBasket } from './checkout.js';
import { listen as listenSheet, openBasket } from './sheet.js';
import { wake, frameTimes } from './loop.js';

// ---- start ---------------------------------------------------------------------------------------------------------------
listenHand();
listenCheckout();
listenSheet();
onBasketMove(wake);
measure();
measureCards();
changed('reset');
wake();

// every picture decoded before anything flies (no decode on the first throw); once the font is in, the cards have
// their final places: measure them again
const ready = Promise.all([
  ...[...document.images].map((img) => img.decode().catch(() => {})),
  ...PRODUCTS.map((p) => { const img = new Image(); img.src = p.img; return img.decode().catch(() => {}); }),
  document.fonts.ready,
]).then(() => { measureCards(); wake(); });

// layout changes move the cards and the basket: measure again, and let the frame loop carry the pile along (or, when
// the basket changed size, rebuild it at the new size)
onShelfLayout(wake);
addEventListener('resize', () => { measureCards(); wake(); });

// the touch circle, for screen recordings of the shop: a soft ring under the finger or the pressed mouse
const touch = $('.touch');
let pressed = false;
const showTouch = (e) => { touch.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; touch.classList.add('is-on'); };
addEventListener('pointerdown', (e) => { pressed = true; showTouch(e); });
addEventListener('pointermove', (e) => { if (pressed) showTouch(e); });
addEventListener('pointerup', () => { pressed = false; touch.classList.remove('is-on'); });

// ---- for scripts (reel capture, tests). Products by id ('milk') or index; points and speeds in client px ------------------
const inPile = (k) => shop.items.find((x) => x.pi === indexOf(k) && x.mode === 'cart');
window.__checkout = {
  ready,
  products: () => PRODUCTS.map((p, i) => ({ i, ...productInfo(p) })),
  add: (k) => { const it = addFromCard(indexOf(k)); return it ? it.body.id : null; },   // the Add button's path
  addOne: (k) => dropOneIn(indexOf(k)),                                                 // + in the list
  remove: (k) => takeOne(indexOf(k)),                                                   // − in the list
  fling: (k, vx = -900, vy = -1100) => {                                                // throw one out of the basket
    const it = inPile(k);
    if (it) { flingOut(it, { x: vx, y: vy }); wake(); }
    return !!it;
  },
  // the scripted hand: grab(id) takes one off its card (or from: 'basket' picks one out of the pile), move(x, y)
  // carries it, release() throws it with the hand's own speed, release(vx, vy) with that speed
  grab: (k, x, y, from = 'card') => {
    if (shop.hold) releaseHold({ x: 0, y: 0 });
    if (from === 'basket') { const it = inPile(k); return !!it && takeFromPile(it, x, y); }
    return !!takeFromCard(cards[indexOf(k)], x, y);
  },
  move: (x, y) => moveHold(x, y),
  release: (vx, vy) => !!releaseHold(vx === undefined ? null : { x: vx, y: vy }),
  checkout,
  reset: () => newBasket(),
  // throw several products in, one after another (a reorder): each from its card, or from `from` (a point), or, when
  // its card is filtered off the shelf, from just above the basket
  addMany: (ids, { from = null, stagger = 140 } = {}) => {
    if (shop.phase === 'done' || shop.phase === 'receipt') newBasket();
    if (shop.phase !== 'shop') return 0;
    const list = ids.map(indexOf).filter((pi) => PRODUCTS[pi]);
    list.forEach((pi, k) => setTimeout(() => {
      addFromCard(pi, from ?? (onShelf(cards[pi]) ? null : { x: tray.cx, y: tray.top - 160 }));
    }, k * stagger));
    return list.length;
  },
  openBasket,
  // show only the products fn(product) says yes to (product: { id, name, note, size, category, price }), or all
  // (null); returns how many are shown
  setFilter,
  // everything in the pile asleep and checked against the lid (no throw, merge or checkout under way)
  settled: () => shop.items.every((x) => x.mode === 'cart' && !x.body.awake) && shop.pileChecked && !['paying', 'packing', 'receipt'].includes(shop.phase),
  state: () => {
    const { order } = shop;
    return {
      phase: shop.phase, count: order.count,
      subtotal: order.subtotal, delivery: order.delivery, total: order.total, totalText: $('.sum-text').textContent,
      freeDelivery: order.freeDelivery, shown: order.inBasket.slice(), pileScale: +shop.pileScale.toFixed(3),
      lines: order.lines().map((l) => ({ id: l.product.id, qty: l.qty, sum: l.sum })),
      items: shop.items.map((x) => ({ id: x.p.id, mode: x.mode, units: x.units, x: +x.body.x.toFixed(1), y: +x.body.y.toFixed(1),
        angle: +x.body.angle.toFixed(3), awake: x.body.awake,
        inside: x.mode === 'cart' && x.body.x > tray.inL && x.body.x < tray.inR && x.body.y < tray.floor && x.body.y > tray.top - 260 })),
      tray: { left: tray.inL, right: tray.inR, top: tray.top, floor: tray.floor, cx: tray.cx },
    };
  },
  frameTimes: () => frameTimes.slice(),
  world: shop.world,
};
document.dispatchEvent(new CustomEvent('cart:ready'));
