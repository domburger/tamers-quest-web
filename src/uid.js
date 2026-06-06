// Process-unique, strictly-increasing numeric id. The old `Date.now()`-as-id
// collided when two records (monsters, characters) were created in the same
// millisecond; here, calls within (or faster than) a millisecond just increment,
// so ids never collide and stay ordered + numeric. Safe-integer for millennia.
// (Server-side ids use engine/rng's randomSeed instead.)
let last = 0;
export function uid() {
  const now = Date.now();
  last = now > last ? now : last + 1;
  return last;
}
