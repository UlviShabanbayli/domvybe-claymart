// The order as numbers: how many of each product, in what order the lines appeared, and what it all costs.
// Two counts per product: `ordered` includes units still flying in; `inBasket` is only what has landed (what the page
// shows, and what is paid). Money is kept in whole cents so $33.59 is always $33.59.
export const DELIVERY_FEE = 3.99;
export const FREE_DELIVERY_FROM = 25;
const toCents = (v) => Math.round(v * 100);
const fromCents = (c) => c / 100;

export class Order {
  constructor(products) {
    this.products = products;
    this.ordered = products.map(() => 0);
    this.inBasket = products.map(() => 0);
    this.sequence = [];               // product indexes, in the order their lines first appeared
  }

  get count() { return this.inBasket.reduce((a, n) => a + n, 0); }
  get subtotal() { return fromCents(this.inBasket.reduce((a, n, i) => a + n * toCents(this.products[i].price), 0)); }
  get freeDelivery() { return this.subtotal >= FREE_DELIVERY_FROM; }
  // an empty basket is not delivered, so it costs nothing
  get delivery() { return this.count === 0 || this.freeDelivery ? 0 : DELIVERY_FEE; }
  get total() { return fromCents(toCents(this.subtotal) + toCents(this.delivery)); }
  get toFreeDelivery() { return fromCents(Math.max(0, toCents(FREE_DELIVERY_FROM) - toCents(this.subtotal))); }

  land(pi, n = 1) {
    if (!this.sequence.includes(pi)) this.sequence.push(pi);
    this.inBasket[pi] += n;
  }

  // the lines of the order, in the order they arrived
  lines() {
    return this.sequence.filter((pi) => this.inBasket[pi] > 0).map((pi) => {
      const product = this.products[pi], qty = this.inBasket[pi];
      return { pi, product, qty, sum: fromCents(qty * toCents(product.price)) };
    });
  }

  clear() { this.ordered.fill(0); this.inBasket.fill(0); this.sequence.length = 0; }
}
