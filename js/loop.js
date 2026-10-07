// The frame loop. It runs only while something moves (a body awake, a spring rolling, a timeline playing, the hand
// holding something) and stops when everything is at rest; every input wakes it again. One frame: read where the
// basket is (before anything is written), run the world in fixed steps, then write every transform.
import { clamp } from './util.js';
import { shop } from './state.js';
import { measure, drawRig, rigResting } from './basket.js';
import { stepCards } from './shelf.js';
import { drawItems, magnetPull, rescalePile, checkPileFits } from './items.js';
import { showDropHint } from './hand.js';
import { stepReadouts } from './readouts.js';
import { stepCheckout } from './checkout.js';

const MAX_DT = 0.05;                 // s: a frame after a stall moves the world at most this far
const TIMING_KEEP = 900;             // frames of script timing kept for the test API
let running = false, last = 0, awakeUntil = 0;
export const frameTimes = [];

export function wake() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}
// keep running for a while even if nothing in the shop moves (the basket panel is sliding, the tray moves with it)
export function keepAwake(ms) { awakeUntil = Math.max(awakeUntil, performance.now() + ms); wake(); }

function frame(now) {
  const dt = clamp((now - last) / 1000, 0, MAX_DT);
  last = now;
  const t0 = performance.now();
  if (measure(now < awakeUntil)) rescalePile();      // reads layout only when the basket moved or is moving
  shop.world.advance(dt);
  checkPileFits();                                      // a pile that just fell asleep: does it fit under the lid?
  let moving = shop.world.active || !!shop.hold;
  moving = stepCheckout() || moving;
  moving = stepCards(dt) || moving;
  showDropHint();
  const pull = magnetPull();
  const dip = drawRig(dt, pull);
  moving = drawItems(dt, dip) || moving;
  moving = stepReadouts(dt) || moving;
  moving = moving || pull > 0 || !rigResting() || shop.items.some((it) => it.mode !== 'cart') || now < awakeUntil;
  frameTimes.push(performance.now() - t0);
  if (frameTimes.length > TIMING_KEEP) frameTimes.shift();
  running = moving;
  if (running) requestAnimationFrame(frame);
}
