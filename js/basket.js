// The basket on the screen. Its picture is a rig of 816 × 900 "basket px" (the basket itself 816 × 790, 110 px down,
// under the magnet), scaled into the panel's tray. Its BACK is in the panel; its FRONT (front walls, the handle's right
// leg, the coin, the roller counter and the magnet) is drawn on the stage over the pile, so what is in the basket is
// inside it. Here: where it is on the screen, the physics walls that hold the pile (the physics lives in screen px, so
// the walls follow the basket), and how the rig moves: the basket dips under a landing, the magnet leans and glows.
import { Body } from './physics.js';
import { Spring } from './spring.js';
import { $, calm, clamp, spring } from './util.js';
import { shop } from './state.js';

const RIG_W = 816;
export const BASKET_Y = 110;                                      // the basket's top in the rig
// measured on the basket's picture (basket px)
const RIM = [[74, 344], [388, 444], [601, 383], [754, 322]];     // the inside line of the front rim (basket-front's cut)
const DEPTH = 64;                                                 // the floor, under the rim line
const WALL_L = 92, WALL_R = 732;                                  // the inside walls
const MOUTH = 352;                                                // the mouth's middle height
// the pile's ceiling: under the magnet's tips and inside the handle's frame, so a full basket never covers either. It
// is soft (items.js pushes down whatever rises over it) rather than a wall: a rigid lid wedges a carton against the
// side wall, a soft one lets the pile find its own way under it
const LID = [[92, 225], [180, 222], [260, 214], [330, 210], [400, 200], [480, 210], [560, 244], [640, 250], [732, 226]];
export const COUNTER_WINDOW = [[478, 562], [681, 514], [679, 610], [480, 698]];   // the counter's blank, TL TR BR BL

// the products and the magnet's reach are sized by the basket, so a pile looks the same in a big basket and a small one
// (at 1440 × 900 the basket is shown at k = 0.4265: products at 0.74 of their dw, the magnet reaching 320 px)
const PRODUCT_PER_K = 0.74 / 0.4265;
const REACH_PER_K = 750;
const SLAB = 120;                 // px: how thick every wall is
const ABOVE_RIM = 320;            // px: how high above the rim the pile's walls reach
const MAGNET_REST = 25;           // degrees the magnet hangs at
const MAGNET_LEAN = -7;           // degrees more while it pulls

const panelEl = $('.basket'), trayEl = $('.tray');
const backRig = $('.rig--back'), frontRig = $('.rig--front'), magnetSwing = $('.magnet__swing', frontRig);

// the basket on the screen (all screen px). tray: the mouth and the walls; rig: where the picture is and its scale k
// (basket px → screen px); panel: the whole basket panel's box (what counts as "over the basket")
export const tray = { inL: 0, inR: 0, cx: 0, w: 0, top: 0, floor: 0, reach: 0 };
const rig = { left: 0, top: 0, width: 0, k: 1 };
export const panel = { left: 0, top: 0, right: 0, bottom: 0 };
let measured = false;
// the basket only moves when the layout changes (a resize, the panel's contents, the sheet sliding, the panel's pulse):
// it is measured then, never on an ordinary frame, so a frame in flight reads no layout at all
let dirty = true, onMove = () => {};
export function onBasketMove(fn) { onMove = fn; }   // main.js: wake the frame loop
function remeasure() { dirty = true; onMove(); }
const watch = new ResizeObserver(remeasure);
[panelEl, trayEl, $('.b-head'), $('.b-lines'), $('.b-foot')].forEach((el) => watch.observe(el));
addEventListener('resize', remeasure);
document.fonts.ready.then(remeasure);

const toScreen = (bx, by) => ({ x: rig.left + bx * rig.k, y: rig.top + (by + BASKET_Y) * rig.k });
export const inColumn = (b) => b.x > tray.inL && b.x < tray.inR && b.y < tray.floor;
export const overBasket = (x, y, grow = 0) =>
  x > panel.left - grow && x < panel.right + grow && y > panel.top - grow && y < panel.bottom + grow;

// the height of a polyline at x (basket px)
function lineAt(points, x) {
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (x <= x1 || i === points.length - 1) return y0 + (y1 - y0) * clamp((x - x0) / (x1 - x0), 0, 1);
  }
  return points[0][1];
}
// the room between the floor and the lid, in basket px² (the pile's capacity; it scales with k²)
const ROOM = (() => {
  let area = 0;
  for (let x = WALL_L; x < WALL_R; x += 2) area += 2 * Math.max(0, lineAt(RIM, x) + DEPTH - lineAt(LID, x));
  return area;
})();
export const room = () => ROOM * rig.k * rig.k;
// the lid's height on the screen at screen x
export const lidAt = (x) => toScreen(0, lineAt(LID, (x - rig.left) / rig.k)).y;

// ---- the walls ----------------------------------------------------------------------------------------------------
// the floor follows the rim (three slabs); two side walls up to the mouth guide what is coming in; the pile has its own
// side walls, one piece each from high above the rim down past the floor (two pieces would leave a seam a carton's
// corner can catch on and buzz). Only the pile touches those (see filter below), so anything may fly in over the rim
const walls = { floor: [], side: [], pile: [] };
function wall(kind) {
  const b = new Body({ hx: 1, hy: 1, r: 1, isStatic: true, friction: 0.7, restitution: 0.1 });
  b.wall = kind;
  return shop.world.add(b);
}
for (let i = 1; i < RIM.length; i++) walls.floor.push(wall('floor'));
walls.side.push(wall('side'), wall('side'));
walls.pile.push(wall('pile'), wall('pile'));

// lay a slab along the line a → b, under it
function lay(body, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
  body.setPose((a.x + b.x) / 2 + nx * SLAB / 2, (a.y + b.y) / 2 + ny * SLAB / 2, Math.atan2(dy, dx), L / 2 + 12, SLAB / 2 - 1);
}
function placeWalls() {
  RIM.forEach((p, i) => { if (i) lay(walls.floor[i - 1], toScreen(RIM[i - 1][0], RIM[i - 1][1] + DEPTH), toScreen(p[0], p[1] + DEPTH)); });
  const top = tray.top - 30, half = SLAB / 2 - 1;
  [tray.inL - SLAB / 2, tray.inR + SLAB / 2].forEach((x, i) => {
    walls.side[i].setPose(x, (top + tray.floor) / 2, 0, half, (tray.floor - top) / 2 + SLAB);
    walls.pile[i].setPose(x, (top - ABOVE_RIM + tray.floor + SLAB) / 2, 0, half, (tray.floor + SLAB - top + ABOVE_RIM) / 2);
  });
}

// which pairs may touch. Items touch each other; the basket's walls only touch what is coming in over the rim or
// already in it, so a product thrown past the basket never bounces off its outside
shop.world.filter = (a, b) => {
  if (!a.isStatic && !b.isStatic) return true;
  const wallBody = a.isStatic ? a : b, body = wallBody === a ? b : a, it = body.item;
  if (!it) return false;
  if (wallBody.wall === 'pile') return it.mode === 'cart';
  if (wallBody.wall === 'floor' && it.mode === 'cart') return true;
  return (it.mode === 'pull' || it.mode === 'held') && inColumn(body);
};

// read where the basket is (at the start of a frame, before anything is written) and carry the pile along if it moved;
// only when something moved it (remeasure) or while it is moving (always). Returns true when the basket changed size
// for good (a new layout, not a pulse or a slide): the products must follow
export function measure(always = false) {
  if (!dirty && !always) return false;
  dirty = false;
  const r = trayEl.getBoundingClientRect(), p = panelEl.getBoundingClientRect();
  panel.left = p.left; panel.top = p.top; panel.right = p.right; panel.bottom = p.bottom;
  const scale = PRODUCT_PER_K * trayEl.offsetWidth / RIG_W;          // from the layout, so a passing transform never counts
  const rescaled = Math.abs(scale - shop.scale) > shop.scale * 0.01;
  if (rescaled) { shop.scale = scale; tray.reach = REACH_PER_K * trayEl.offsetWidth / RIG_W; }
  if (measured && r.left === rig.left && r.top === rig.top && r.width === rig.width) return rescaled;
  const old = measured ? { cx: tray.cx, floor: tray.floor, w: tray.w } : null;
  rig.left = r.left; rig.top = r.top; rig.width = r.width; rig.k = r.width / RIG_W;
  backRig.style.setProperty('--k', rig.k);
  tray.inL = toScreen(WALL_L, 0).x; tray.inR = toScreen(WALL_R, 0).x;
  tray.w = tray.inR - tray.inL; tray.cx = (tray.inL + tray.inR) / 2;
  tray.top = toScreen(0, MOUTH).y; tray.floor = toScreen(0, 444 + DEPTH).y;
  placeWalls();
  measured = true;
  if (old) {
    const dx = tray.cx - old.cx, dy = tray.floor - old.floor;
    for (const it of shop.items) if (it.mode === 'cart' || it.mode === 'pack') { it.body.x += dx; it.body.y += dy; }
    if (Math.abs(old.w - tray.w) > 0.5) shop.world.wakeAll();
  }
  return rescaled;
}

// ---- the rig's motion ---------------------------------------------------------------------------------------------
// the basket gives under every landing (dip, px); the magnet leans and jiggles on top of its 25° (lean, degrees)
export const dip = new Spring(0, spring(460, 15));
export const lean = new Spring(0, spring(240, 8));
export function thud(speed, mass) { if (!calm) dip.velocity += clamp(speed * mass / shop.scale / shop.scale * 0.012, 0, 120); }
export function buck(magnet, basket = 0) { if (!calm) { lean.velocity += magnet; dip.velocity += basket; } }

let pullShown = -1, dipShown = null, leanShown = null, rigShown = '';
// pull: how hard the magnet pulls right now (0..1): its tips glow, it leans in
export function drawRig(dt, pull) {
  lean.target = MAGNET_LEAN * pull;
  dip.step(dt); lean.step(dt);
  if (Math.abs(pull - pullShown) > 0.01) { pullShown = pull; frontRig.style.setProperty('--pull', pull.toFixed(3)); }
  const d = Math.round(dip.value * 100) / 100;
  const front = `translate3d(${rig.left.toFixed(2)}px, ${(rig.top + d).toFixed(2)}px, 0) scale(${rig.k.toFixed(5)})`;
  if (d !== dipShown) { dipShown = d; backRig.style.transform = `translateY(${d}px) scale(var(--k))`; }
  if (front !== rigShown) { rigShown = front; frontRig.style.transform = front; }
  const l = Math.round((MAGNET_REST + lean.value) * 100) / 100;
  if (l !== leanShown) { leanShown = l; magnetSwing.style.transform = `rotate(${l}deg)`; }
  return d;
}
export const rigResting = () => dip.resting(0.02) && lean.resting(0.02);
export function showFrontRig(shown) { frontRig.style.visibility = shown ? '' : 'hidden'; }
