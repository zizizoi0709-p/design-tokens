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

// Numeric Tokens Studio types that map directly to `CGFloat(N)` literals.
const NUMERIC_TYPES = new Set([
  'spacing',
  'sizing',
  'borderRadius',
  'borderWidth',
  'fontSizes',
  'lineHeights',
]);

// Full set of primitiveCore types surfaced into the Swift class.
const SWIFT_TOKEN_TYPES = new Set([
  ...NUMERIC_TYPES,
  'fontFamilies',
  'fontWeights',
  'letterSpacing',
  'boxShadow',
]);

// Tokens Studio fontWeight name → Apple `UIFont.Weight` constant.
const FONT_WEIGHT_MAP = {
  UltraLight: 'ultraLight',
  Thin: 'thin',
  Light: 'light',
  Regular: 'regular',
  Medium: 'medium',
  Semibold: 'semibold',
  Bold: 'bold',
  Heavy: 'heavy',
  Black: 'black',
};

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
  filter: (token) => NUMERIC_TYPES.has(token.type),
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

// fontFamilies → quoted Swift string literal (e.g. `"Pretendard"`).
StyleDictionary.registerTransform({
  name: 'value/swift/fontFamily',
  type: 'value',
  filter: (token) => token.type === 'fontFamilies',
  transform: (token) => `"${String(token.value).replace(/"/g, '\\"')}"`,
});

// fontWeights ("Regular"/"Medium"/...) → `UIFont.Weight.<constant>`.
StyleDictionary.registerTransform({
  name: 'value/swift/fontWeight',
  type: 'value',
  filter: (token) => token.type === 'fontWeights',
  transform: (token) => {
    const mapped = FONT_WEIGHT_MAP[token.value];
    if (!mapped) {
      throw new Error(
        `Unknown fontWeight at "${token.path.join('.')}": ${token.value}. ` +
          `Expected one of: ${Object.keys(FONT_WEIGHT_MAP).join(', ')}`,
      );
    }
    return `UIFont.Weight.${mapped}`;
  },
});

// letterSpacing ("X%") → `CGFloat(X/100)` (em fraction).
// Apply at usage site as `kern = fontSize * value`.
StyleDictionary.registerTransform({
  name: 'value/swift/letterSpacing',
  type: 'value',
  filter: (token) => token.type === 'letterSpacing',
  transform: (token) => {
    const raw = String(token.value).trim();
    const num = parseFloat(raw);
    if (Number.isNaN(num)) {
      throw new Error(
        `Cannot parse letterSpacing at "${token.path.join('.')}": ${token.value}`,
      );
    }
    const em = Number((num / 100).toFixed(4));
    return `CGFloat(${em})`;
  },
});

// boxShadow object → multi-line `DesignTokenShadow(...)` constructor literal.
// Continuation lines are indented to align under `let name = ` inside `DesignTokens`.
StyleDictionary.registerTransform({
  name: 'value/swift/boxShadow',
  type: 'value',
  filter: (token) => token.type === 'boxShadow',
  transform: (token) => {
    const v = token.value;
    if (!v || typeof v !== 'object') {
      throw new Error(
        `Expected object value for boxShadow at "${token.path.join('.')}"`,
      );
    }
    const rgba = hexToFloatRgba(v.color, token.path);
    const num = (s) => parseFloat(String(s).trim());
    return [
      'DesignTokenShadow(',
      `        offsetX: CGFloat(${num(v.x)}),`,
      `        offsetY: CGFloat(${num(v.y)}),`,
      `        blur: CGFloat(${num(v.blur)}),`,
      `        spread: CGFloat(${num(v.spread)}),`,
      `        color: UIColor(red: ${rgba.red}, green: ${rgba.green}, blue: ${rgba.blue}, alpha: ${rgba.alpha})`,
      '    )',
    ].join('\n');
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

// Same hex parsing as `hexToComponents`, but returns 0.0–1.0 floats suitable for
// `UIColor(red:green:blue:alpha:)` initializers.
function hexToFloatRgba(hex, tokenPath) {
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
      `Invalid hex color "${hex}" at token "${(tokenPath ?? []).join('.')}"`,
    );
  }
  const f = (hh) => Number((parseInt(hh, 16) / 255).toFixed(3));
  return { red: f(r), green: f(g), blue: f(b), alpha: f(a) };
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

// Custom Swift class output. Replaces `ios-swift/class.swift` so we can:
//   1. emit the `DesignTokenShadow` struct alongside the class in one file
//   2. group properties under `// MARK: -` sections by token type
//   3. interleave non-numeric Swift expressions (UIFont.Weight, UIColor, etc.)
const SWIFT_SECTIONS = [
  { type: 'spacing', title: 'Spacing' },
  { type: 'sizing', title: 'Sizing' },
  { type: 'borderRadius', title: 'Border Radius' },
  { type: 'borderWidth', title: 'Border Width' },
  { type: 'fontFamilies', title: 'Font Family' },
  { type: 'fontWeights', title: 'Font Weight' },
  { type: 'fontSizes', title: 'Font Size' },
  { type: 'lineHeights', title: 'Line Height' },
  { type: 'letterSpacing', title: 'Letter Spacing (em fraction)' },
  { type: 'boxShadow', title: 'Box Shadow' },
];

StyleDictionary.registerFormat({
  name: 'ios-swift/designTokensClass',
  format: ({ dictionary, file, options }) => {
    const className = options?.className ?? 'DesignTokens';

    const grouped = {};
    for (const token of dictionary.allTokens) {
      (grouped[token.type] ??= []).push(token);
    }

    const lines = [];
    lines.push('//');
    lines.push(`// ${file.destination}`);
    lines.push('//');
    lines.push('// Auto-generated by Style Dictionary. Do not edit directly.');
    lines.push('//');
    lines.push('');
    lines.push('import UIKit');
    lines.push('');
    lines.push('public struct DesignTokenShadow {');
    lines.push('    public let offsetX: CGFloat');
    lines.push('    public let offsetY: CGFloat');
    lines.push('    public let blur: CGFloat');
    lines.push('    public let spread: CGFloat');
    lines.push('    public let color: UIColor');
    lines.push('}');
    lines.push('');
    lines.push(`public class ${className} {`);

    let firstSection = true;
    for (const { type, title } of SWIFT_SECTIONS) {
      const tokens = grouped[type];
      if (!tokens || tokens.length === 0) continue;
      if (!firstSection) lines.push('');
      firstSection = false;
      lines.push(`    // MARK: - ${title}`);
      tokens.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const t of tokens) {
        lines.push(`    public static let ${t.name} = ${t.value}`);
      }
    }

    lines.push('}');
    lines.push('');
    return lines.join('\n');
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
      transforms: [
        'name/leaf',
        'value/swift/cgfloat',
        'value/swift/fontFamily',
        'value/swift/fontWeight',
        'value/swift/letterSpacing',
        'value/swift/boxShadow',
      ],
      buildPath: 'build/ios/',
      files: [
        {
          destination: 'DesignTokens.swift',
          format: 'ios-swift/designTokensClass',
          options: {
            className: 'DesignTokens',
          },
          filter: (token) => SWIFT_TOKEN_TYPES.has(token.type),
        },
      ],
    },
  },
};
