// The market's products: eight photoreal groceries (generated with Google Gemini, keyed off a green screen by
// tools/cutout.py). Each has its words, its price, the size of its picture as an object (dw = display width
// in px on a desk at product scale 1; the height follows the picture), and a SHAPE for the physics (the body's full
// width w, height h and the radius r of its rounded corners; a circle is w = h = 2r), a little inside the picture so
// things rest touching. category: its aisle (fruitveg, dairy, bakery). tint: the card's clay tile, rotating peach,
// mint, lilac, butter, sky.

const TINTS = {
  peach: ['#FDD6C2', '#F6B597'], mint: ['#DCF2E3', '#B5DCC2'], lilac: ['#ECE3F3', '#CDBCE0'],
  butter: ['#FDF1C9', '#F2D88E'], sky: ['#DDEDFA', '#B7D3EE'],
};
const TINT_ORDER = ['peach', 'mint', 'lilac', 'butter', 'sky'];

// how each kind of thing behaves when it lands: firm boxes, soft packs, round fruit that rolls a little
const firm = { density: 0.0012, friction: 0.7, restitution: 0.08 };
const soft = { density: 0.0008, friction: 0.85, restitution: 0.04 };
const round = { density: 0.001, friction: 0.55, restitution: 0.18 };

export const PRODUCTS = [
  { id: 'bread', category: 'bakery', name: 'Sourdough loaf', note: 'Baked at dawn, long-fermented', size: '800 g', price: 5.9, badge: 'Bestseller',
    img: 'img/bread.webp', iw: 800, ih: 681, dw: 104, shape: { w: 98, h: 80, r: 30 }, material: soft },
  { id: 'milk', category: 'dairy', name: 'Fresh milk', note: 'Whole, from one farm', size: '1 L', price: 2.49,
    img: 'img/milk.webp', iw: 353, ih: 800, dw: 52, shape: { w: 49, h: 114, r: 8 }, material: firm },
  { id: 'strawberries', category: 'fruitveg', name: 'Strawberries', note: 'Picked this morning', size: '400 g', price: 4.5, badge: 'In season',
    img: 'img/strawberries.webp', iw: 800, ih: 738, dw: 98, shape: { w: 93, h: 86, r: 12 }, material: firm },
  { id: 'avocado', category: 'fruitveg', name: 'Ripe avocados', note: 'Hass, ready to eat today', size: '2 pack', price: 3.2,
    img: 'img/avocado.webp', iw: 800, ih: 715, dw: 100, shape: { w: 92, h: 82, r: 30 }, material: round },
  { id: 'juice', category: 'fruitveg', name: 'Orange juice', note: 'Pressed oranges, nothing added', size: '750 ml', price: 3.8,
    img: 'img/juice.webp', iw: 307, ih: 800, dw: 46, shape: { w: 42, h: 116, r: 12 }, material: firm },
  { id: 'eggs', category: 'dairy', name: 'Free-range eggs', note: 'Large, from happy hens', size: '6 eggs', price: 3.6,
    img: 'img/eggs.webp', iw: 701, ih: 800, dw: 88, shape: { w: 84, h: 94, r: 10 }, material: soft },
  { id: 'lemons', category: 'fruitveg', name: 'Lemons', note: 'Unwaxed, leaf on', size: '3 pack', price: 2.2, badge: 'New harvest',
    img: 'img/lemons.webp', iw: 800, ih: 706, dw: 96, shape: { w: 86, h: 74, r: 30 }, material: round },
  { id: 'cheese', category: 'dairy', name: 'Aged cheese', note: 'Alpine wedge, 12 months', size: '250 g', price: 7.9,
    img: 'img/cheese.webp', iw: 757, ih: 725, dw: 90, shape: { w: 84, h: 80, r: 10 }, material: firm },
];

PRODUCTS.forEach((p, i) => {
  [p.tint, p.tint2] = TINTS[TINT_ORDER[i % TINT_ORDER.length]];
  p.dh = p.dw * p.ih / p.iw;
});

const byId = new Map(PRODUCTS.map((p, i) => [p.id, i]));
// a product's index from its id ('milk') or its index
export const indexOf = (key) => (typeof key === 'number' ? key : byId.get(key));
