// Checkout: the button fills while it "pays", the pile drops into the bag one by one, and a clay receipt shows the
// lines, subtotal, delivery and total. The page hears about every finished order (document event cart:checkout).
import { $, calm, clamp, countText, money, smoothstep } from './util.js';
import { shop } from './state.js';
import { DELIVERY_FEE } from './order.js';
import { buck, showFrontRig } from './basket.js';
import { cards } from './shelf.js';
import { dropItem, setMode } from './items.js';
import { announce, changed } from './readouts.js';
import { wake } from './loop.js';

const PAY_TIME = 0.9, PACK_STAGGER = 0.055, PACK_LIMIT = 2.5;   // s

const panel = $('.basket'), button = $('.checkout'), label = $('.co-label'), bar = $('.co-bar i'), done = $('.done');
const receipt = {
  no: $('.done-no'), lines: $('.done-lines'), subtotal: $('.done-sub'), fee: $('.done-fee'), total: $('.done-total'),
  ring: $('.dc-ring'), tick: $('.dc-tick'),
};
let paid = null;                  // the order being paid / just paid
// a big change spread over the next frames, one step per frame, so no single frame does all the layout at once
const nextFrames = (...steps) => { const run = () => { steps.shift()?.(); if (steps.length) requestAnimationFrame(run); }; requestAnimationFrame(run); };

export function checkout() {
  if (shop.phase !== 'shop') return false;
  if (!shop.order.count) { announce('Your basket is empty. Add something first.'); return false; }
  if (shop.hold) return false;
  const { order } = shop;
  paid = { count: order.count, subtotal: order.subtotal, delivery: order.delivery, total: order.total,
    items: order.lines().map(({ product, qty, sum }) => ({ id: product.id, name: product.name, price: product.price, qty, sum })) };
  shop.phase = 'paying'; shop.phaseAt = shop.world.time;
  button.setAttribute('aria-busy', 'true');
  label.textContent = 'Paying…';
  announce(`Paying ${money(paid.total)}…`);
  buck(-300, -160);                                             // the magnet heaves, the basket hops
  if (calm) finishOrder();
  wake();
  return true;
}

function startPacking() {
  shop.phase = 'packing'; shop.phaseAt = shop.world.time;
  const going = shop.items.filter((x) => x.mode !== 'out' && x.mode !== 'home').sort((a, b) => a.body.y - b.body.y);
  going.forEach((it, k) => {
    it.from = { x: it.body.x, y: it.body.y, a: it.body.angle, s: it.vis.value };
    setMode(it, 'pack');
    it.delay = k * PACK_STAGGER;
  });
  for (const c of cards) if (c.out) { c.out = null; c.stock.target = 1; }
}

// the order is packed. Frame 1: the panel makes room (on a phone it becomes a sheet) and the pile goes; frame 2: the
// receipt is written, laid out while still invisible; frame 3: it appears (no layout, a visibility flip) and the tick
// starts drawing; frame 4: it takes focus and the page hears about the order. No single frame does all the layout
function finishOrder() {
  shop.phase = 'receipt';
  for (const it of [...shop.items]) dropItem(it);
  panel.dataset.state = 'done';
  showFrontRig(false);
  const no = 'CM-' + (24817 + Math.round(paid.subtotal * 7) + paid.count * 31);
  nextFrames(() => {
    receipt.no.textContent = no;
    receipt.lines.innerHTML = paid.items.map((l) => `<li><span>${l.name}${l.qty > 1 ? ' ×' + l.qty : ''}</span><span>${money(l.sum)}</span></li>`).join('');
    receipt.subtotal.textContent = money(paid.subtotal);
    receipt.fee.innerHTML = paid.delivery ? money(paid.delivery) : `<s>${money(DELIVERY_FEE)}</s> Free`;
    receipt.total.textContent = money(paid.total);
  }, () => {
    done.classList.add('is-shown');
    shop.phase = 'done'; shop.phaseAt = shop.world.time;
    wake();
  }, () => {
    done.focus({ preventScroll: true });
    announce(`Order ${no} confirmed. ${countText(paid.count)}, ${money(paid.total)}${paid.delivery ? '' : ', free delivery'}. Arriving tomorrow morning.`);
    const { items, count, subtotal, delivery, total } = paid;
    document.dispatchEvent(new CustomEvent('cart:checkout', { detail: { no, items, count, subtotal, delivery, total, date: new Date().toISOString() } }));
  });
}

// a new basket: the numbers and the list are reset now (under the receipt, if it is up); next frame the receipt goes
// and the shelf grows its products back; the frame after, `then` (e.g. focus the shelf)
export function newBasket(then = null) {
  const fromReceipt = done.classList.contains('is-shown');
  shop.phase = 'shop';
  shop.order.clear();
  for (const it of [...shop.items]) dropItem(it);
  if (shop.hold) { shop.world.release(shop.hold.grab); shop.hold = null; }
  shop.pileScale = 1; shop.pileCap = 1;
  button.removeAttribute('aria-busy');
  label.textContent = 'Checkout';
  bar.style.transform = 'scaleX(0)';
  changed('reset');
  const reveal = () => {
    done.classList.remove('is-shown');
    panel.dataset.state = 'empty';
    showFrontRig(true);
    for (const c of cards) { c.out = null; c.stock.target = 1; }   // every card grows its product back
    announce('Your basket is empty.');
    wake();
  };
  if (!fromReceipt) { reveal(); then?.(); return; }
  panel.dataset.state = 'done';                                   // the receipt stays up for this frame
  nextFrames(reveal, () => then?.());
}

// one frame of checkout's timeline; returns whether it is still moving
export function stepCheckout() {
  const t = shop.world.time - shop.phaseAt;
  if (shop.phase === 'paying') {
    const k = clamp(t / PAY_TIME, 0, 1);
    bar.style.transform = `scaleX(${(1 - (1 - k) ** 3).toFixed(4)})`;
    if (k >= 1) startPacking();
    return true;
  }
  if (shop.phase === 'packing') {
    if (!shop.items.length || t > PACK_LIMIT) finishOrder();
    return true;
  }
  if (shop.phase === 'done' && t < 0.8) {                      // the receipt's tick draws itself
    receipt.ring.style.strokeDashoffset = (183 * (1 - smoothstep(0, 0.55, t))).toFixed(2);
    receipt.tick.style.strokeDashoffset = (44 * (1 - smoothstep(0.35, 0.7, t))).toFixed(2);
    return true;
  }
  return false;
}

export function listen() {
  button.addEventListener('click', checkout);
  $('.again').addEventListener('click', () => newBasket(() => $('#shelf').focus({ preventScroll: true })));
}
