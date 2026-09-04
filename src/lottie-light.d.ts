/**
 * `lottie-web`'s light canvas build.
 *
 * See `providers/bundled/LottieView.ts` for why that build and not the default
 * entry: the default one evaluates Lottie expressions with a direct `eval`, and
 * this app runs a hardened CSP with no 'unsafe-eval'. The package ships types
 * for the variant at `build/player/lottie_light_canvas.d.ts`, but not beside the
 * ESM file we import, so TypeScript cannot find them on its own.
 *
 * Pointed at the package's own `LottiePlayer` rather than left as `any`. That
 * matters: `loadAnimation`'s config is exactly where the `autoplay: false` and
 * `renderer: 'canvas'` decisions live that I-2 and the warp stage depend on,
 * and an untyped config would let either be dropped silently.
 *
 * A separate file rather than a block in `env.d.ts`, because that file has a
 * top-level `import` and is therefore a module — an ambient module declaration
 * inside it is read as an augmentation of an existing module and does not
 * declare a new one. This file has no top-level import, so it stays a script.
 */
declare module 'lottie-web/build/player/esm/lottie_light_canvas.min.js' {
  const lottie: import('lottie-web').LottiePlayer;
  export default lottie;
}
