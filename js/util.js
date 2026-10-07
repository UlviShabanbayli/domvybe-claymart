// Small shared helpers: DOM lookup, numbers and money, the reduced-motion and layout switches, spring presets.
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const money = (v) => '$' + v.toFixed(2);
export const countText = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;

const query = new URLSearchParams(location.search);
// reduced motion: from the system, or ?reduce for tests
export const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || query.has('reduce');
// where the basket is (style.css, section 11, uses the same two queries):
//   docked  a phone or a tablet held upright: the basket docks at the bottom of the screen and throws go down
//   strip   a phone on its side: the basket is a narrow strip at the right, throws go right
// anything else: the basket panel at the right of the shelf
export const docked = matchMedia('(max-width: 1023px) and (orientation: portrait)');
export const strip = matchMedia('(orientation: landscape) and (max-height: 540px)');
// the basket's list is folded away (Details opens it as a sheet)
export const folded = () => docked.matches || strip.matches;

// springs: a bouncy one for things that land, a critically damped one for things that just arrive. Under reduced
// motion every spring is critically damped
export const spring = (stiffness, damping) => ({ stiffness, damping: calm ? 2 * Math.sqrt(stiffness) : damping });
export const critical = (stiffness) => ({ stiffness, damping: 2 * Math.sqrt(stiffness) });

