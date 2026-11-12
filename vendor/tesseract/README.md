# Tesseract.js (receipt scanning)

**The one third-party tool in My Budget.** The design rules say no outside tools, with a single
written exception: on-device text reading for receipt scanning. It is not used for animation, it only
loads when the scanner is opened, and receipt photos never leave the phone.

Downloaded from the official npm registry on 2026-11-12 and checked before copying:

| File | Package | Version | Licence |
|---|---|---|---|
| `tesseract.min.js`, `worker.min.js` | `tesseract.js` | 7.0.0 | Apache-2.0 (`LICENSE-tesseract.js.md`) |
| `core/tesseract-core-simd-lstm.wasm.js`, `core/tesseract-core-lstm.wasm.js` | `tesseract.js-core` | 7.0.0 | Apache-2.0 (`LICENSE-tesseract.js-core.txt`) |
| `lang/eng.traineddata.gz` (from `4.0.0_best_int/`) | `@tesseract.js-data/eng` | 1.0.0 | MIT |

Only the two engine builds a phone needs are kept: SIMD (modern phones) and a plain fallback.
The app picks between them itself (`js/scan.js`), so the "relaxed SIMD" build isn't needed.

To update: download the same packages at matching versions (`tesseract.js` X needs `tesseract.js-core` X),
copy the same files here, and test a scan.
