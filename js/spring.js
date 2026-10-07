// A spring, written from scratch: a mass on a spring with a damper.
//   acceleration = stiffness × (target − value) − damping × velocity
// It is stepped in small fixed slices (1/240 s), so it moves the same on a 60 Hz and a 120 Hz screen.
// Changing the target never moves the value: an interrupted animation just bends towards the new target.
const SLICE = 1 / 240;

export class Spring {
  constructor(value = 0, { stiffness = 170, damping = 26 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  step(dt) {
    for (let t = dt; t > 0; t -= SLICE) {
      const h = Math.min(SLICE, t);
      const acceleration = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
      this.velocity += acceleration * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  resting(epsilon = 0.01) {
    return Math.abs(this.target - this.value) < epsilon && Math.abs(this.velocity) < epsilon * 10;
  }

  // jump to the target and stop (reduced motion, or a spring nobody will see move)
  snap() { this.value = this.target; this.velocity = 0; return this; }
}
