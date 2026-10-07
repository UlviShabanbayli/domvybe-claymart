// The shop's shared state: the physics world, the products out of their cards, the order, the hand and the phase.
// Every module reads and changes this one object; nothing else is shared between them.
import { World, RNG } from './physics.js';
import { Order } from './order.js';
import { PRODUCTS } from './catalogue.js';
import { docked } from './util.js';

// how many of one product may lie in the pile before an extra unit merges into one already there (×2, ×3 …), and how
// many objects the pile holds in all
const PILE_CAPS = { panel: { each: 2, total: 10 }, docked: { each: 2, total: 6 } };

export const shop = {
  world: new World({ gravity: 2600, iterations: 10, hz: 120 }),
  rng: new RNG(40),
  order: new Order(PRODUCTS),
  items: [],              // every product out of its card: flying, held or in the pile
  hold: null,             // what the hand is holding (hand.js)
  phase: 'shop',          // shop → paying → packing → receipt (one frame) → done
  phaseAt: 0,             // world time the phase began
  scale: 0,               // how big the products are as objects (against their dw): it follows the basket (basket.js)
  landedAt: -Infinity,    // world time of the last landing
  pileCap: 1,             // the most the pile may be shown at (lowered when a settled pile still rises over the lid)
  pileChecked: true,      // the settled pile has been checked against the lid
  pileScale: 1,           // the pile's own scale: a full basket shrinks its contents a little so they stay inside it
};

export const caps = () => (docked.matches ? PILE_CAPS.docked : PILE_CAPS.panel);
export const pile = () => shop.items.filter((it) => it.mode === 'cart');
