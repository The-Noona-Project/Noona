# Moon

## CSS processing pipeline
- Vendor styles from `@textkernel/oneui` are loaded through the virtual module `virtual:oneui-styles.css`. The Vite plugin defined in `vite.config.js` reads the upstream CSS, strips invalid `@charset` declarations, and exposes it as a virtual file so Vite's CSS pipeline (and PostCSS plugins) can process the styles without esbuild warnings.
- PostCSS now runs before esbuild using `postcss-nested` and the custom plugins in `postcss/`. `charsetCleanup` removes any remaining `@charset` statements while `ampersandModifiers` rewrites Sass-style selectors (`&--withChevron`, `&--isSelected`, etc.) to `:is(&.--withChevron)` so nested selectors are spec-compliant once flattened.
- Because the virtual module also powers the global CSS imports in `src/main.jsx` and `src/test/setup.ts`, the transformation applies consistently to both Moon-authored CSS and the vendor styles injected via `css.preprocessorOptions.additionalData`.

## Dependencies
- `postcss-nested` is required for the selector rewrites and should remain in `devDependencies`.

Run `npm run build` after touching the CSS toolchain to ensure the warnings stay resolved.
