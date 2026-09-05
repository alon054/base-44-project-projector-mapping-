// Test-only perturbations of text rendering, applied at the canvas-2D layer —
// where Pixi resolves and draws glyphs — so no engine source is touched.
//   PROBE_ALT_FONT  remap the generic `monospace` family
//   PROBE_SHIFT     translate glyphs by a whole pixel, changing nothing else
const mode = process.env.PROBE_MODE;
if (mode === 'font') {
  const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', {
    configurable: true, enumerable: d.enumerable,
    get() { return d.get.call(this); },
    set(v) { d.set.call(this, String(v).replace(/monospace/g, 'Courier New')); },
  });
} else if (mode === 'shift') {
  for (const fn of ['fillText', 'strokeText']) {
    const orig = CanvasRenderingContext2D.prototype[fn];
    CanvasRenderingContext2D.prototype[fn] = function (t, x, y, ...rest) {
      return orig.call(this, t, x + 1, y, ...rest);
    };
  }
}
if (process.env.PROBE_MODE === 'notext') {
  for (const fn of ['fillText', 'strokeText']) {
    CanvasRenderingContext2D.prototype[fn] = function () { return undefined; };
  }
}
