# Magnetic checkout — UI component

**[Live demo](https://domvybe.com/components/claymart/)** · [Step-by-step tutorial](https://domvybe.com/library/claymart/) · [Download the ZIP](https://github.com/UlviShabanbayli/domvybe-claymart/releases/latest/download/claymart-source.zip)

A clay grocery shop where you throw the product into the basket: grab it off its card, fling it, and the magnet over the basket catches it; the counter rolls and free delivery unlocks at $25.

Open `index.html` through any local static server (for example `python3 -m http.server`) and try it with a mouse,
a finger or the keyboard. Plain HTML, CSS and JavaScript; no build step, no libraries.

- `index.html` — the component and its stage
- `style.css` — the look (colours are variables at the top)
- `nav.css` — the header's styles: aisles, search, account, the basket button
- `nav.js` — the header: aisles, search (⌘K), the account with past orders, the basket button
- `js` — the shop, one ES module per job: physics.js (the engine), basket.js, items.js, hand.js (grab and throw), shelf.js, readouts.js (list, totals, rolling counter), order.js (delivery rule), checkout.js, sheet.js, loop.js, main.js
- `img` — the product cut-outs, the clay basket, magnet and coin (generated with Google Gemini, fictional products)

The products, the clay basket, the magnet and the coin are pictures generated with Google Gemini; the shop and its
products are made up. Your own products go in `js/catalogue.js` (name, note, size, price) with a cut-out in `img/`.

It respects `prefers-reduced-motion`. Made by Ulvi (Code with Ulvi) · domvybe.com

## Licence

MIT — see [LICENSE](LICENSE). Use it in your own projects, commercial ones included.
