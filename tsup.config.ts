import { defineConfig } from 'tsup'

/**
 * Single named build for the ESM-only package. `npm run build` emits exactly
 * the three published entry points plus their declarations and sourcemaps:
 *
 *   dist/index.js             + dist/index.d.ts            (runeframe)
 *   dist/experimental/index.js + dist/experimental/index.d.ts
 *                                                          (runeframe/experimental)
 *   dist/windows-input.js     + dist/windows-input.d.ts    (runeframe/windows-input)
 *
 * The windows entry is a separate chunk graph: the root entry must never
 * eagerly import the Windows transport. `splitting: false` keeps the output
 * to exactly these files (no shared `chunk-*.js`), which is what the packed
 * consumer check asserts.
 *
 * This build is JS+DTS-only and works on any platform: the native helper is
 * not compiled here. `npm run build:native-windows` produces the AOT
 * executables and `npm run stage:native-windows` validates and copies them
 * into `dist/binaries/win-<rid>/`.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'experimental/index': 'src/experimental/index.ts',
    'windows-input': 'src/input/transports/windows/index.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
})
