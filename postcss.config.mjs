/**
 * https://github.com/tailwindlabs/tailwindcss/issues/13844
 * 
 * Tailwind v4 generates chained fallback CSS variables (e.g. `var(--tw-backdrop-blur,) var(...) ...`)
 * for `backdrop-filter` and `-webkit-backdrop-filter`.
 * On certain macOS / WebKit engines (e.g., older Safari / WKWebView), `-webkit-backdrop-filter` fails
 * to parse or render whenever runtime CSS variables `var(...)` are present.
 *
 * Solution:
 * Statically evaluate all `--tw-backdrop-*` properties into concrete literal values (e.g. `blur(24px)`)
 * at build time, completely eliminating runtime `var()` variable chains from `( -webkit- )backdrop-filter`.
 *
 * Trade-off:
 * If multiple standalone `backdrop-*` classes are declared on the same DOM element (e.g., `backdrop-blur-md backdrop-brightness-50`),
 * the later class will overwrite the earlier one via standard CSS cascade rather than dynamically composing at runtime.
 * To compose multiple backdrop filters, combine them via `@apply` in a single CSS rule or use arbitrary values like
 * `[backdrop-filter:blur(...)_brightness(...)]`.
 */
const BLUR_MAP = {
  '--blur-xs': '4px',
  '--blur-sm': '8px',
  '--blur-md': '12px',
  '--blur-lg': '16px',
  '--blur-xl': '24px',
  '--blur-2xl': '40px',
  '--blur-3xl': '64px',
  '--blur': '8px',
};

function resolveVars(val, varMap) {
  if (!val) return val;
  return val.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (match, varName, fallback) => {
    if (varMap && varMap[varName]) return varMap[varName];
    if (BLUR_MAP[varName]) return BLUR_MAP[varName];
    if (fallback) return fallback.trim();
    return match;
  });
}

const fixBackdropFilter = () => {
  let collectedVars = {};
  return {
    postcssPlugin: 'postcss-fix-backdrop-filter',
    Once(root) {
      collectedVars = { ...BLUR_MAP };
      root.walkDecls((d) => {
        if (d.prop.startsWith('--')) {
          collectedVars[d.prop] = d.value;
        }
      });
    },
    Declaration(decl) {
      if (decl.prop === '-webkit-backdrop-filter' || decl.prop === 'backdrop-filter') {
        const parent = decl.parent;
        if (!parent) return;

        const activeFilters = [];
        parent.walkDecls((d) => {
          if (
            d.prop.startsWith('--tw-backdrop-') &&
            d.value &&
            d.value.trim() &&
            d.value.trim() !== 'initial'
          ) {
            const cleanVal = d.value.replace(/!important/g, '').trim();
            const resolved = resolveVars(cleanVal, collectedVars);
            if (resolved) {
              activeFilters.push(resolved);
            }
          }
        });

        if (activeFilters.length > 0) {
          decl.value = activeFilters.join(' ');
        } else if (decl.value.includes('var(--tw-backdrop-')) {
          decl.value = 'none';
        }
      }
    },
  };
};
fixBackdropFilter.postcss = true;

import tailwindcss from '@tailwindcss/postcss';

const config = {
  plugins: [
    tailwindcss(),
    fixBackdropFilter(),
  ],
};

export default config;
