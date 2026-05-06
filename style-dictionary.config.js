import fs from 'node:fs';
import path from 'node:path';
import StyleDictionary from 'style-dictionary';

// ──────────────────────────────────────────────────────────────────────────────
// 1. Load tokens.json and split Tokens Studio sets
// ──────────────────────────────────────────────────────────────────────────────
const tokensFile = JSON.parse(
  fs.readFileSync(new URL('./tokens.json', import.meta.url), 'utf-8'),
);

const CORE_SET = 'primitives/ coreTokens';
const LIGHT_SET = 'primitives/colorLight';
const DARK_SET = 'primitives/colorDark';

const core = tokensFile[CORE_SET];
const light = tokensFile[LIGHT_SET];
const dark = tokensFile[DARK_SET];

if (!core || !light || !dark) {
  throw new Error(
    `tokens.json is missing one of the required sets: "${CORE_SET}", "${LIGHT_SET}", "${DARK_SET}"`,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. Custom transforms
// ──────────────────────────────────────────────────────────────────────────────

// Numeric, non-color types that we surface as CGFloat constants
const SWIFT_TOKEN_TYPES = new Set([
  'spacing',
  'sizing',
  'borderRadius',
  'borderWidth',
  'fontSizes',
  'lineHeights',
]);

// Use the leaf segment as token name (e.g. spacing50, borderRadius250)
StyleDictionary.registerTransform({
  name: 'name/leaf',
  type: 'name',
  transform: (token) => token.path[token.path.length - 1],
});

// Wrap raw numeric values in `CGFloat(...)` for Swift output.
// Note: SD v4's built-in `size/swift/remToCGFloat` only matches type==='dimension'/'fontSize'
// and multiplies by basePxFontSize (16) — neither fits our pixel-valued Tokens Studio types.
StyleDictionary.registerTransform({
  name: 'value/swift/cgfloat',
  type: 'value',
  filter: (token) => SWIFT_TOKEN_TYPES.has(token.type),
  transform: (token) => {
    const num = parseFloat(token.value);
    if (Number.isNaN(num)) {
      throw new Error(
        `Cannot convert non-numeric value to CGFloat for token "${token.path.join('.')}": ${token.value}`,
      );
    }
    return `CGFloat(${num})`;
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Asset Catalog generation
// ──────────────────────────────────────────────────────────────────────────────

function pascalCase(segment) {
  return segment
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function colorsetName(segments) {
  // Drop synthetic grouping segments so that
  //   color.orange.500            → Orange500
  //   color.orangeAlpha.100       → OrangeAlpha100
  //   color.static.white          → White
  //   color.static.whiteAlpha.100 → WhiteAlpha100
  return segments
    .filter((s) => s !== 'color' && s !== 'static')
    .map(pascalCase)
    .join('');
}

function hexToComponents(hex, tokenPath) {
  const h = String(hex).trim().replace(/^#/, '');
  let r;
  let g;
  let b;
  let a;
  if (h.length === 6) {
    [r, g, b, a] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6), 'FF'];
  } else if (h.length === 8) {
    [r, g, b, a] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6), h.slice(6, 8)];
  } else if (h.length === 3) {
    [r, g, b, a] = [h[0] + h[0], h[1] + h[1], h[2] + h[2], 'FF'];
  } else {
    throw new Error(
      `Invalid hex color "${hex}" at token "${tokenPath.join('.')}"`,
    );
  }

  const alphaFloat = (parseInt(a, 16) / 255).toFixed(3);
  return {
    red: `0x${r.toUpperCase()}`,
    green: `0x${g.toUpperCase()}`,
    blue: `0x${b.toUpperCase()}`,
    alpha: alphaFloat,
  };
}

function findDarkValue(lightPath, darkColors) {
  // Direct match
  let cur = darkColors;
  for (const seg of lightPath) {
    if (cur && typeof cur === 'object' && seg in cur) {
      cur = cur[seg];
    } else {
      cur = undefined;
      break;
    }
  }
  if (cur && typeof cur === 'object' && 'value' in cur && cur.type === 'color') {
    return cur.value;
  }

  // Light's "*Alpha" group is named "*DarkAlpha" in dark set
  const [first, ...rest] = lightPath;
  if (first && first.endsWith('Alpha') && !first.endsWith('DarkAlpha')) {
    const altGroup = first.replace(/Alpha$/, 'DarkAlpha');
    let alt = darkColors[altGroup];
    for (const seg of rest) {
      if (alt && typeof alt === 'object' && seg in alt) {
        alt = alt[seg];
      } else {
        alt = undefined;
        break;
      }
    }
    if (alt && typeof alt === 'object' && 'value' in alt && alt.type === 'color') {
      return alt.value;
    }
  }
  return null;
}

function writeColorsets(lightColorTree, darkColorTree, xcassetsDir) {
  let written = 0;

  function walk(node, currentPath) {
    if (!node || typeof node !== 'object') return;

    if ('value' in node && node.type === 'color') {
      const lightHex = node.value;
      // static.* never has a dark counterpart; treat as universal asset
      const isStatic = currentPath[0] === 'static';
      const darkHex = isStatic ? null : findDarkValue(currentPath, darkColorTree);

      const name = colorsetName(['color', ...currentPath]);
      if (!name) {
        throw new Error(
          `Could not derive colorset name for path: color.${currentPath.join('.')}`,
        );
      }

      const colorsetDir = path.join(xcassetsDir, `${name}.colorset`);
      fs.mkdirSync(colorsetDir, { recursive: true });

      const lightComponents = hexToComponents(lightHex, ['color', ...currentPath]);
      const colors = [];
      if (darkHex) {
        const darkComponents = hexToComponents(darkHex, ['color', ...currentPath]);
        colors.push({
          idiom: 'universal',
          appearances: [{ appearance: 'luminosity', value: 'light' }],
          color: { 'color-space': 'srgb', components: lightComponents },
        });
        colors.push({
          idiom: 'universal',
          appearances: [{ appearance: 'luminosity', value: 'dark' }],
          color: { 'color-space': 'srgb', components: darkComponents },
        });
      } else {
        colors.push({
          idiom: 'universal',
          color: { 'color-space': 'srgb', components: lightComponents },
        });
      }

      fs.writeFileSync(
        path.join(colorsetDir, 'Contents.json'),
        `${JSON.stringify({ info: { version: 1, author: 'xcode' }, colors }, null, 2)}\n`,
      );
      written += 1;
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      walk(child, [...currentPath, key]);
    }
  }

  walk(lightColorTree, []);
  return written;
}

StyleDictionary.registerFormat({
  name: 'ios/colorAssetCatalog',
  format: ({ file, platform }) => {
    const xcassetsDir = path.join(
      platform.buildPath ?? '',
      path.dirname(file.destination),
    );
    fs.mkdirSync(xcassetsDir, { recursive: true });
    const count = writeColorsets(light.color, dark.color, xcassetsDir);
    console.log(`  ✔ Wrote ${count} .colorset entries → ${xcassetsDir}`);
    return `${JSON.stringify({ info: { version: 1, author: 'xcode' } }, null, 2)}\n`;
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Configuration
// ──────────────────────────────────────────────────────────────────────────────

export default {
  tokens: { core },
  platforms: {
    iosAssets: {
      transforms: [],
      buildPath: 'build/ios/',
      files: [
        {
          destination: 'Colors.xcassets/Contents.json',
          format: 'ios/colorAssetCatalog',
        },
      ],
    },
    iosSwift: {
      transforms: ['name/leaf', 'value/swift/cgfloat'],
      buildPath: 'build/ios/',
      files: [
        {
          destination: 'DesignTokens.swift',
          format: 'ios-swift/class.swift',
          options: {
            className: 'DesignTokens',
            import: 'UIKit',
          },
          filter: (token) => SWIFT_TOKEN_TYPES.has(token.type),
        },
      ],
    },
  },
};
