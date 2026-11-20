let last = 0;
export function uid() {
  const now = Date.now();
  last = now > last ? now : last + 1;
  return last;
}
