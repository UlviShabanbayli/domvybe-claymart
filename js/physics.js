// A small 2D rigid-body engine, written from scratch for the basket.
//
// Every body is a ROUNDED BOX: an inner box (half-width hx, half-height hy) with a skin of radius r around it.
// A circle is the same thing with no inner box (hx = hy = 0). That one shape covers a carton, a bottle, a loaf and a
// lemon, and two of them can always be tested against each other the same way.
//
// One step of the world, 120 times a second whatever the screen does (a fixed step keeps it the same on every machine):
//   1. gravity and the app's own forces change each body's velocity
//   2. every pair of bodies that might touch is tested: where they touch, how deep, which way to push (a "manifold")
//   3. the contacts are solved a few times over with impulses: push apart, no sinking in, friction along the surface,
//      a little bounce. Each contact starts from the push it needed last step ("warm starting"), which is what lets
//      a pile stand still instead of shivering
//   4. positions move by the new velocities
//   5. bodies that have been still for a moment go to sleep and stop costing anything until something hits them
// Units are CSS pixels, seconds and radians. Nothing here reads the clock or Math.random: the same inputs give the
// same pile, every time (the seeded RNG below is for the app's small variations).

const SLOP = 0.6;          // px of overlap we leave alone (pushing it out exactly makes stacks shiver)
const BIAS = 0.2;          // how much of the remaining overlap is pushed out per step
const MAX_PUSH = 420;      // px/s, the fastest an overlap is pushed out
const SPECULATIVE = 5;     // px: contacts are found a little before they touch, so fast throws never tunnel
const BOUNCE_FROM = 150;   // px/s: slower hits than this never bounce (a resting pile must not buzz)
const MAX_SPEED = 4200;    // px/s
// a body is still when its centre and its surface (spin × its size) both move slower than SLEEP_SPEED, for SLEEP_AFTER s.
// Judging the spin by the surface keeps a small, thin body (a bottle in a phone's basket) from buzzing awake forever
const SLEEP_SPEED = 14, SLEEP_AFTER = 0.45;
const pairKey = (a, b) => (a.id < b.id ? a.id * 4096 + b.id : b.id * 4096 + a.id);

// a seeded random number generator (mulberry32): the same seed gives the same numbers
export class RNG {
  constructor(seed = 1) { this.s = seed >>> 0; }
  next() {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
}

let nextId = 1;
export class Body {
  constructor({ x = 0, y = 0, angle = 0, hx = 0, hy = 0, r = 10, density = 0.001, friction = 0.6, restitution = 0.2,
    isStatic = false, linearDamping = 0.04, angularDamping = 0.4 } = {}) {
    this.id = nextId++;
    this.x = x; this.y = y; this.angle = angle;
    this.vx = 0; this.vy = 0; this.w = 0;
    this.density = density; this.friction = friction; this.restitution = restitution;
    this.linearDamping = linearDamping; this.angularDamping = angularDamping;
    this.isStatic = isStatic;
    this.gravityScale = 1;
    this.collides = true;      // false: passes through everything (a body flying home, or out of the basket)
    this.kinematic = false;    // true: the app moves it by hand; the world neither pushes nor moves it
    this.awake = true; this.still = 0;
    this.base = { hx, hy, r };  // its shape at scale 1 (resize() scales from this)
    this.setShape(hx, hy, r);
  }

  setShape(hx, hy, r) {
    this.hx = hx; this.hy = hy; this.r = r;
    this.circle = hx === 0 && hy === 0;
    this.bound = Math.hypot(hx, hy) + r;   // radius of a circle that holds the whole shape (the cheap first test)
    if (this.isStatic) { this.mass = this.invMass = this.inertia = this.invI = 0; return; }
    const w = 2 * (hx + r), h = 2 * (hy + r);
    const area = this.circle ? Math.PI * r * r : w * h - (4 - Math.PI) * r * r;
    this.mass = area * this.density;
    this.inertia = this.circle ? this.mass * r * r / 2 : this.mass * (w * w + h * h) / 12;
    this.invMass = 1 / this.mass; this.invI = 1 / this.inertia;
  }

  // the same shape, scaled from its size at scale 1
  resize(scale) { const b = this.base; this.setShape(b.hx * scale, b.hy * scale, b.r * scale); this.wake(); }

  // move a static body (a wall that follows the basket on the screen)
  setPose(x, y, angle, hx, hy) { this.x = x; this.y = y; this.angle = angle; this.setShape(hx, hy, this.r); }

  wake() { if (!this.isStatic) { this.awake = true; this.still = 0; } }

  // the four corners of the inner box and its four outward normals, in the world
  poly() {
    const c = Math.cos(this.angle), s = Math.sin(this.angle), hx = this.hx, hy = this.hy;
    const lx = [-hx, hx, hx, -hx], ly = [-hy, -hy, hy, hy];
    const v = new Array(8), n = [s, -c, c, s, -s, c, -c, -s];   // the box's normals (0,-1) (1,0) (0,1) (-1,0), turned
    for (let i = 0; i < 4; i++) { v[2 * i] = this.x + c * lx[i] - s * ly[i]; v[2 * i + 1] = this.y + s * lx[i] + c * ly[i]; }
    return { v, n, r: this.r };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// contact tests. Each returns null or { nx, ny, points: [{ x, y, sep, id }] }: the normal points from a to b,
// sep < 0 is how deep they overlap (sep > 0: a near miss, kept so the solver can stop a fast body in time)
// ---------------------------------------------------------------------------------------------------------------
function circleCircle(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), rr = a.r + b.r;
  if (d > rr + SPECULATIVE) return null;
  const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : 1;
  const ax = a.x + nx * a.r, ay = a.y + ny * a.r, bx = b.x - nx * b.r, by = b.y - ny * b.r;
  return { nx, ny, points: [{ x: (ax + bx) / 2, y: (ay + by) / 2, sep: d - rr, id: 0 }] };
}

// a box (a) and a circle (b): the nearest point of the inner box to the circle's centre
function boxCircle(a, b) {
  const c = Math.cos(a.angle), s = Math.sin(a.angle), dx = b.x - a.x, dy = b.y - a.y;
  const lx = c * dx + s * dy, ly = -s * dx + c * dy;
  let qx = Math.max(-a.hx, Math.min(a.hx, lx)), qy = Math.max(-a.hy, Math.min(a.hy, ly));
  let nlx, nly, dist;
  if (qx !== lx || qy !== ly) {                               // the centre is outside the inner box
    const ex = lx - qx, ey = ly - qy; dist = Math.hypot(ex, ey); nlx = ex / dist; nly = ey / dist;
  } else {                                                    // deep inside: leave by the nearest side
    const px = a.hx - Math.abs(lx), py = a.hy - Math.abs(ly);
    if (px < py) { nlx = Math.sign(lx) || 1; nly = 0; qx = nlx * a.hx; dist = -px; }
    else { nlx = 0; nly = Math.sign(ly) || 1; qy = nly * a.hy; dist = -py; }
  }
  const sep = dist - a.r - b.r;
  if (sep > SPECULATIVE) return null;
  const nx = c * nlx - s * nly, ny = s * nlx + c * nly;
  const wx = a.x + c * qx - s * qy + nx * a.r, wy = a.y + s * qx + c * qy + ny * a.r;   // a's surface
  return { nx, ny, points: [{ x: wx + nx * sep / 2, y: wy + ny * sep / 2, sep, id: 0 }] };
}

// for each normal of p, how far the nearest corner of q lies out along it; the most separated normal wins
function maxSeparation(p, q) {
  let best = -Infinity, edge = 0;
  for (let i = 0; i < 4; i++) {
    const nx = p.n[2 * i], ny = p.n[2 * i + 1], vx = p.v[2 * i], vy = p.v[2 * i + 1];
    let m = Infinity;
    for (let j = 0; j < 4; j++) m = Math.min(m, nx * (q.v[2 * j] - vx) + ny * (q.v[2 * j + 1] - vy));
    if (m > best) { best = m; edge = i; }
  }
  return { sep: best, edge };
}

// the closest points of two segments p1-q1 and p2-q2; f1, f2 say where along each (exactly 0 or 1 at an end)
function segmentDistance(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y, rx = p1x - p2x, ry = p1y - p2y;
  const dd1 = d1x * d1x + d1y * d1y, dd2 = d2x * d2x + d2y * d2y, rd1 = rx * d1x + ry * d1y, rd2 = rx * d2x + ry * d2y;
  let f1 = 0, f2 = 0;
  const eps = 1e-9;
  if (dd1 < eps || dd2 < eps) {
    if (dd1 >= eps) f1 = Math.max(0, Math.min(1, -rd1 / dd1));
    else if (dd2 >= eps) f2 = Math.max(0, Math.min(1, rd2 / dd2));
  } else {
    const d12 = d1x * d2x + d1y * d2y, denom = dd1 * dd2 - d12 * d12;
    f1 = denom !== 0 ? Math.max(0, Math.min(1, (d12 * rd2 - rd1 * dd2) / denom)) : 0;
    f2 = (d12 * f1 + rd2) / dd2;
    if (f2 < 0) { f2 = 0; f1 = Math.max(0, Math.min(1, -rd1 / dd1)); }
    else if (f2 > 1) { f2 = 1; f1 = Math.max(0, Math.min(1, (d12 - rd1) / dd1)); }
  }
  const c1x = p1x + f1 * d1x, c1y = p1y + f1 * d1y, c2x = p2x + f2 * d2x, c2y = p2y + f2 * d2y;
  return { f1, f2, c1x, c1y, c2x, c2y, d2: (c2x - c1x) ** 2 + (c2y - c1y) ** 2 };
}

// two rounded boxes. The edge that separates them best becomes the "reference"; the other shape's edge that faces it
// most is the "incident" edge, cut to the reference edge's length. That gives up to two contact points, so a box
// lying flat on another rests on both corners and does not rock.
function boxBox(a, b) {
  const pa = a.poly(), pb = b.poly(), radius = a.r + b.r;
  const sa = maxSeparation(pa, pb); if (sa.sep > radius + SPECULATIVE) return null;
  const sb = maxSeparation(pb, pa); if (sb.sep > radius + SPECULATIVE) return null;
  let flip, edgeA = sa.edge, edgeB = sb.edge;
  if (sb.sep > sa.sep + 0.05) {                              // b's edge separates better: b is the reference
    flip = true;
    const nx = pb.n[2 * edgeB], ny = pb.n[2 * edgeB + 1];
    let m = Infinity; for (let i = 0; i < 4; i++) { const d = nx * pa.n[2 * i] + ny * pa.n[2 * i + 1]; if (d < m) { m = d; edgeA = i; } }
  } else {
    flip = false;
    const nx = pa.n[2 * edgeA], ny = pa.n[2 * edgeA + 1];
    let m = Infinity; for (let i = 0; i < 4; i++) { const d = nx * pb.n[2 * i] + ny * pb.n[2 * i + 1]; if (d < m) { m = d; edgeB = i; } }
  }
  if (Math.max(sa.sep, sb.sep) > 0.06) {
    // the inner boxes do not overlap: if the nearest features are two corners, the push is along the line between them
    const i11 = edgeA, i12 = (edgeA + 1) % 4, i21 = edgeB, i22 = (edgeB + 1) % 4;
    const s = segmentDistance(pa.v[2 * i11], pa.v[2 * i11 + 1], pa.v[2 * i12], pa.v[2 * i12 + 1],
      pb.v[2 * i21], pb.v[2 * i21 + 1], pb.v[2 * i22], pb.v[2 * i22 + 1]);
    const endA = s.f1 === 0 || s.f1 === 1, endB = s.f2 === 0 || s.f2 === 1;
    if (endA && endB) {
      const d = Math.sqrt(s.d2);
      if (d > radius + SPECULATIVE) return null;
      if (d >= 1e-6) {
        const nx = (s.c2x - s.c1x) / d, ny = (s.c2y - s.c1y) / d;
        const ax = s.c1x + nx * a.r, ay = s.c1y + ny * a.r, bx = s.c2x - nx * b.r, by = s.c2y - ny * b.r;
        const ia = s.f1 === 0 ? i11 : i12, ib = s.f2 === 0 ? i21 : i22;
        return { nx, ny, points: [{ x: (ax + bx) / 2, y: (ay + by) / 2, sep: d - radius, id: 64 + ia * 4 + ib }] };
      }
    }
  }
  return clip(pa, pb, edgeA, edgeB, flip, a.r, b.r);
}

function clip(pa, pb, edgeA, edgeB, flip, ra, rb) {
  const p1 = flip ? pb : pa, p2 = flip ? pa : pb, r1 = flip ? rb : ra, r2 = flip ? ra : rb;
  const i11 = flip ? edgeB : edgeA, i12 = (i11 + 1) % 4, i21 = flip ? edgeA : edgeB, i22 = (i21 + 1) % 4;
  const nx = p1.n[2 * i11], ny = p1.n[2 * i11 + 1];
  const v11x = p1.v[2 * i11], v11y = p1.v[2 * i11 + 1], v12x = p1.v[2 * i12], v12y = p1.v[2 * i12 + 1];
  const v21x = p2.v[2 * i21], v21y = p2.v[2 * i21 + 1], v22x = p2.v[2 * i22], v22y = p2.v[2 * i22 + 1];
  const tx = -ny, ty = nx;                                    // along the reference edge
  const lower1 = 0, upper1 = (v12x - v11x) * tx + (v12y - v11y) * ty;
  const upper2 = (v21x - v11x) * tx + (v21y - v11y) * ty, lower2 = (v22x - v11x) * tx + (v22y - v11y) * ty;
  let lx = v22x, ly = v22y, ux = v21x, uy = v21y;
  const span = upper2 - lower2;
  if (lower2 < lower1 && span > 1e-6) { const f = (lower1 - lower2) / span; lx = v22x + f * (v21x - v22x); ly = v22y + f * (v21y - v22y); }
  if (upper2 > upper1 && span > 1e-6) { const f = (upper1 - lower2) / span; ux = v22x + f * (v21x - v22x); uy = v22y + f * (v21y - v22y); }
  const sl = (lx - v11x) * nx + (ly - v11y) * ny, su = (ux - v11x) * nx + (uy - v11y) * ny;
  // the contact point sits halfway between the two rounded surfaces
  lx += 0.5 * (r1 - r2 - sl) * nx; ly += 0.5 * (r1 - r2 - sl) * ny;
  ux += 0.5 * (r1 - r2 - su) * nx; uy += 0.5 * (r1 - r2 - su) * ny;
  const radius = r1 + r2, points = [];
  const s = flip ? -1 : 1;
  if (sl - radius <= SPECULATIVE) points.push({ x: lx, y: ly, sep: sl - radius, id: flip ? 32 + i22 * 4 + i11 : i11 * 4 + i22 });
  if (su - radius <= SPECULATIVE) points.push({ x: ux, y: uy, sep: su - radius, id: flip ? 48 + i21 * 4 + i12 : 16 + i12 * 4 + i21 });
  return points.length ? { nx: nx * s, ny: ny * s, points } : null;
}

function collide(a, b) {
  if (a.circle && b.circle) return circleCircle(a, b);
  if (b.circle) return boxCircle(a, b);
  if (a.circle) { const m = boxCircle(b, a); if (m) { m.nx = -m.nx; m.ny = -m.ny; } return m; }
  return boxBox(a, b);
}

// ---------------------------------------------------------------------------------------------------------------
// the hand: a soft spring between a point on a body and the pointer. Grab a carton by its top and it hangs from there.
// ---------------------------------------------------------------------------------------------------------------
class Grab {
  constructor(body, wx, wy, { hz = 5.5, damping = 0.8, maxForce = 60000 } = {}) {
    this.body = body; this.hz = hz; this.damping = damping; this.maxForce = maxForce * body.mass;
    const c = Math.cos(body.angle), s = Math.sin(body.angle), dx = wx - body.x, dy = wy - body.y;
    this.lx = c * dx + s * dy; this.ly = -s * dx + c * dy;   // where it was grabbed, on the body
    this.tx = wx; this.ty = wy; this.px = 0; this.py = 0;
  }
  pre(h) {
    const b = this.body, m = b.mass, om = 2 * Math.PI * this.hz;
    const d = 2 * m * this.damping * om, k = m * om * om;
    let g = h * (d + h * k); g = g ? 1 / g : 0;
    this.gamma = g; this.beta = h * k * g;
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    this.rx = c * this.lx - s * this.ly; this.ry = s * this.lx + c * this.ly;
    const im = b.invMass, ii = b.invI, rx = this.rx, ry = this.ry;
    const k11 = im + ii * ry * ry + g, k12 = -ii * rx * ry, k22 = im + ii * rx * rx + g, det = k11 * k22 - k12 * k12;
    this.m11 = k22 / det; this.m12 = -k12 / det; this.m22 = k11 / det;
    this.cx = (b.x + rx - this.tx) * this.beta; this.cy = (b.y + ry - this.ty) * this.beta;
    this.maxImpulse = h * this.maxForce;
    b.vx += im * this.px; b.vy += im * this.py; b.w += ii * (rx * this.py - ry * this.px);   // warm start
    b.w *= 0.985;
  }
  solve() {
    const b = this.body, rx = this.rx, ry = this.ry;
    const vx = b.vx - b.w * ry + this.cx + this.gamma * this.px, vy = b.vy + b.w * rx + this.cy + this.gamma * this.py;
    let ix = -(this.m11 * vx + this.m12 * vy), iy = -(this.m12 * vx + this.m22 * vy);
    const ox = this.px, oy = this.py;
    this.px += ix; this.py += iy;
    const len = Math.hypot(this.px, this.py);
    if (len > this.maxImpulse) { this.px *= this.maxImpulse / len; this.py *= this.maxImpulse / len; }
    ix = this.px - ox; iy = this.py - oy;
    b.vx += b.invMass * ix; b.vy += b.invMass * iy; b.w += b.invI * (rx * iy - ry * ix);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the world
// ---------------------------------------------------------------------------------------------------------------
export class World {
  constructor({ gravity = 2600, iterations = 10, hz = 120 } = {}) {
    this.gravity = gravity; this.iterations = iterations; this.h = 1 / hz;
    this.bodies = []; this.grabs = [];
    this.arbiters = new Map();      // a contact between two bodies, kept from step to step (for warm starting)
    this.seen = new Set();          // the contacts found this step (reused, so a step allocates as little as it can)
    this.filter = () => true;       // the app says which pairs may touch
    this.beforeStep = null;         // the app's forces, run at the start of every step
    this.afterStep = null;
    this.impacts = [];              // hits harder than BOUNCE_FROM this step: { a, b, speed }
    this.time = 0;
    this.acc = 0;
  }
  add(b) { this.bodies.push(b); return b; }
  remove(b) {
    const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1);
    this.grabs = this.grabs.filter((g) => g.body !== b);
    for (const [k, arb] of this.arbiters) if (arb.a === b || arb.b === b) this.arbiters.delete(k);
  }
  grab(b, wx, wy, opts) { const g = new Grab(b, wx, wy, opts); this.grabs.push(g); b.wake(); return g; }
  release(g) { this.grabs = this.grabs.filter((x) => x !== g); }

  // is anything moving? (a world with every body asleep needs no steps at all)
  get active() {
    if (this.grabs.length) return true;
    for (const b of this.bodies) if (!b.isStatic && (b.awake || b.kinematic)) return true;
    return false;
  }

  // run as many fixed steps as the elapsed time holds (at most `max`, so a stalled tab does not explode)
  advance(dt, max = 4) {
    this.acc = Math.min(this.acc + dt, this.h * max);
    let n = 0;
    while (this.acc >= this.h - 1e-9) { this.step(); this.acc -= this.h; n++; }
    return n;
  }

  step() {
    const h = this.h, inv = 1 / h, bodies = this.bodies, seen = this.seen;
    this.impacts.length = 0;
    if (this.beforeStep) this.beforeStep(h);
    // 1. forces
    for (const b of bodies) {
      if (b.isStatic || b.kinematic || !b.awake) continue;
      b.vy += this.gravity * b.gravityScale * h;
      b.vx /= 1 + h * b.linearDamping; b.vy /= 1 + h * b.linearDamping; b.w /= 1 + h * b.angularDamping;
    }
    // 2. contacts (every pair; with a couple of dozen bodies that is cheaper than anything clever)
    seen.clear();
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!a.collides || a.kinematic) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (!b.collides || b.kinematic) continue;
        if ((a.isStatic || !a.awake) && (b.isStatic || !b.awake)) {   // both asleep (or fixed): keep what we knew
          const k = pairKey(a, b);
          if (this.arbiters.has(k)) seen.add(k);
          continue;
        }
        const reach = a.bound + b.bound + SPECULATIVE;
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > reach * reach) continue;
        if (!this.filter(a, b)) continue;
        const [p, q] = a.id < b.id ? [a, b] : [b, a];
        const m = collide(p, q);
        if (!m) continue;
        const key = pairKey(p, q);
        seen.add(key);
        const old = this.arbiters.get(key);
        for (const pt of m.points) {                         // keep last step's push for the same point
          const o = old && old.points.find((x) => x.id === pt.id);
          pt.pn = o ? o.pn : 0; pt.pt = o ? o.pt : 0; pt.fresh = !o;
        }
        this.arbiters.set(key, { a: p, b: q, nx: m.nx, ny: m.ny, points: m.points,
          friction: Math.sqrt(p.friction * q.friction), restitution: Math.max(p.restitution, q.restitution) });
      }
    }
    for (const k of this.arbiters.keys()) if (!seen.has(k)) this.arbiters.delete(k);

    // 3. solve: prepare every contact, then sweep over them all a few times
    for (const arb of this.arbiters.values()) if (arb.a.awake || arb.b.awake) this.prepare(arb, inv); else arb.idle = true;
    for (const g of this.grabs) g.pre(h);
    for (let it = 0; it < this.iterations; it++) {
      for (const g of this.grabs) g.solve();
      for (const arb of this.arbiters.values()) if (!arb.idle) this.solve(arb);
    }
    // 4. move
    for (const b of bodies) {
      if (b.isStatic || b.kinematic || !b.awake) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
      b.x += b.vx * h; b.y += b.vy * h; b.angle += b.w * h;
    }
    // 5. sleep. Bodies that touch form an "island"; an island sleeps only when every body in it has been still for a
    // moment, and wakes as a whole (one body going to sleep under another would leave the top one hanging)
    let drowsy = false;
    for (const b of bodies) {
      if (b.isStatic || b.kinematic || !b.awake) continue;
      const held = b.canSleep === false || this.grabs.some((g) => g.body === b);
      if (!held && Math.hypot(b.vx, b.vy) < SLEEP_SPEED && Math.abs(b.w) * b.bound < SLEEP_SPEED) b.still += h; else b.still = 0;
      if (b.still > SLEEP_AFTER) drowsy = true;
    }
    if (drowsy) {
      for (const island of this.islands()) {
        if (island.every((b) => b.still > SLEEP_AFTER)) for (const b of island) { b.awake = false; b.vx = b.vy = b.w = 0; }
      }
    }
    this.time += h;
    if (this.afterStep) this.afterStep(h);
  }

  // the awake bodies, grouped by what touches what
  islands() {
    const live = this.bodies.filter((b) => !b.isStatic && !b.kinematic && b.awake);
    const parent = new Map(live.map((b) => [b, b]));
    const root = (b) => { while (parent.get(b) !== b) { parent.set(b, parent.get(parent.get(b))); b = parent.get(b); } return b; };
    for (const arb of this.arbiters.values()) {
      if (parent.has(arb.a) && parent.has(arb.b)) parent.set(root(arb.a), root(arb.b));
    }
    const groups = new Map();
    for (const b of live) { const r = root(b); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(b); }
    return groups.values();
  }

  // wake a body and everything resting on it or under it
  wakeIsland(b) {
    const stack = [b];
    while (stack.length) {
      const x = stack.pop();
      if (x.isStatic) continue;
      if (x.awake && x !== b) continue;
      x.wake();
      for (const arb of this.arbiters.values()) {
        const o = arb.a === x ? arb.b : arb.b === x ? arb.a : null;
        if (o && !o.isStatic && !o.awake) stack.push(o);
      }
    }
  }
  wakeAll() { for (const b of this.bodies) b.wake(); }

  prepare(arb, inv) {
    arb.idle = false;
    const { a, b, nx, ny } = arb;
    // a sleeping body is hit by an awake one: wake it if the hit is real
    if ((!a.isStatic && !a.awake) || (!b.isStatic && !b.awake)) {
      const sleeper = a.awake ? b : a, mover = a.awake ? a : b;
      if (!mover.isStatic) {
        const rel = Math.abs((mover.vx - sleeper.vx) * nx + (mover.vy - sleeper.vy) * ny) + Math.abs(mover.w) * mover.bound * 0.5;
        if (rel > 40 || arb.points.some((p) => p.sep < -2.5)) this.wakeIsland(sleeper);
      }
    }
    const imA = a.awake ? a.invMass : 0, iiA = a.awake ? a.invI : 0, imB = b.awake ? b.invMass : 0, iiB = b.awake ? b.invI : 0;
    arb.imA = imA; arb.iiA = iiA; arb.imB = imB; arb.iiB = iiB;
    const tx = ny, ty = -nx;
    for (const p of arb.points) {
      p.rax = p.x - a.x; p.ray = p.y - a.y; p.rbx = p.x - b.x; p.rby = p.y - b.y;
      const rnA = p.rax * ny - p.ray * nx, rnB = p.rbx * ny - p.rby * nx;
      const kn = imA + imB + iiA * rnA * rnA + iiB * rnB * rnB;
      p.mn = kn > 0 ? 1 / kn : 0;
      const rtA = p.rax * ty - p.ray * tx, rtB = p.rbx * ty - p.rby * tx;
      const kt = imA + imB + iiA * rtA * rtA + iiB * rtB * rtB;
      p.mt = kt > 0 ? 1 / kt : 0;
      // how fast they are closing right now (for the bounce and for the app's landing thud)
      const dvx = b.vx - b.w * p.rby - a.vx + a.w * p.ray, dvy = b.vy + b.w * p.rbx - a.vy - a.w * p.rax;
      const vn = dvx * nx + dvy * ny;
      p.bounce = vn < -BOUNCE_FROM && p.sep < 1 ? -arb.restitution * vn : 0;
      if (p.fresh && vn < -BOUNCE_FROM && p.sep < 2) this.impacts.push({ a, b, speed: -vn });
      p.target = p.sep > 0 ? -p.sep * inv : Math.max(p.bounce, Math.min(MAX_PUSH, BIAS * inv * Math.max(0, -p.sep - SLOP)));
      // warm start
      const px = p.pn * nx + p.pt * tx, py = p.pn * ny + p.pt * ty;
      a.vx -= imA * px; a.vy -= imA * py; a.w -= iiA * (p.rax * py - p.ray * px);
      b.vx += imB * px; b.vy += imB * py; b.w += iiB * (p.rbx * py - p.rby * px);
    }
  }

  solve(arb) {
    const { a, b, nx, ny, imA, iiA, imB, iiB } = arb;
    const tx = ny, ty = -nx;
    for (const p of arb.points) {
      // along the normal: no sinking in
      let dvx = b.vx - b.w * p.rby - a.vx + a.w * p.ray, dvy = b.vy + b.w * p.rbx - a.vy - a.w * p.rax;
      const vn = dvx * nx + dvy * ny;
      let dp = p.mn * (p.target - vn);
      const pn0 = p.pn; p.pn = Math.max(pn0 + dp, 0); dp = p.pn - pn0;
      let px = dp * nx, py = dp * ny;
      a.vx -= imA * px; a.vy -= imA * py; a.w -= iiA * (p.rax * py - p.ray * px);
      b.vx += imB * px; b.vy += imB * py; b.w += iiB * (p.rbx * py - p.rby * px);
      // along the surface: friction, never more than friction × the push
      dvx = b.vx - b.w * p.rby - a.vx + a.w * p.ray; dvy = b.vy + b.w * p.rbx - a.vy - a.w * p.rax;
      const vt = dvx * tx + dvy * ty;
      let dt = p.mt * -vt;
      const max = arb.friction * p.pn, pt0 = p.pt;
      p.pt = Math.max(-max, Math.min(max, pt0 + dt)); dt = p.pt - pt0;
      px = dt * tx; py = dt * ty;
      a.vx -= imA * px; a.vy -= imA * py; a.w -= iiA * (p.rax * py - p.ray * px);
      b.vx += imB * px; b.vy += imB * py; b.w += iiB * (p.rbx * py - p.rby * px);
    }
  }

  // run the world on its own (no drawing) until everything awake has gone to sleep: reduced motion uses it to put an
  // item straight into its resting place in the pile
  settle(maxSteps = 600, only = null) {
    for (let i = 0; i < maxSteps; i++) {
      this.step();
      const list = only ? only() : this.bodies;
      if (list.every((b) => b.isStatic || b.kinematic || !b.awake)) return i + 1;
    }
    return maxSteps;
  }
}
