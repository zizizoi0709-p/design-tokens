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

// Numeric Tokens Studio types that map directly to `CGFloat` literals.
const NUMERIC_TYPES = new Set([
  'spacing',
  'sizing',
  'borderRadius',
  'borderWidth',
  'fontSizes',
  'lineHeights',
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

// Numeric primitives → bare number literal. Type annotation `: CGFloat = N`
// is added at the format level so that `2` is read as `CGFloat(2)` via Swift's
// integer/float literal coercion.
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
    return String(num);
  },
});

// fontWeights ("Regular"/"Medium"/...) → `.<constant>`.
// Used with `: UIFont.Weight = .regular` annotation at the format level.
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
    return `.${mapped}`;
  },
});

// letterSpacing ("X%") → bare em-fraction literal (e.g. `-0.001`).
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
    return String(em);
  },
});

// boxShadow object → multi-line `DesignTokenShadow(...)` constructor literal.
// Field types (CGFloat) are declared on the struct, so call sites can pass bare
// numeric literals without `CGFloat(...)` wrapping.
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
      `        offsetX: ${num(v.x)},`,
      `        offsetY: ${num(v.y)},`,
      `        blur: ${num(v.blur)},`,
      `        spread: ${num(v.spread)},`,
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

// Generic file header for auto-generated Swift files.
function fileHeader(destination) {
  return [
    '//',
    `// ${destination}`,
    '//',
    '// Auto-generated by Style Dictionary. Do not edit directly.',
    '//',
    '',
  ];
}

// Build a SwiftUI `extension ShapeStyle where Self == Color` whose properties
// reference the generated Asset Catalog (`Colors.xcassets`). The bundle is
// resolved via a private `BundleToken` so the file works regardless of how
// `Bundle.module` ends up being exposed by Tuist.
StyleDictionary.registerFormat({
  name: 'ios-swift/colorAccessor',
  format: ({ file }) => {
    const familyTitle = (key) => {
      if (key === 'static') return 'Static';
      const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    };

    const entries = []; // { family, swiftName, assetName }
    (function walk(node, currentPath) {
      if (!node || typeof node !== 'object') return;
      if ('value' in node && node.type === 'color') {
        const assetName = colorsetName(['color', ...currentPath]);
        const swiftName = assetName.charAt(0).toLowerCase() + assetName.slice(1);
        const family = currentPath[0];
        entries.push({ family, swiftName, assetName });
        return;
      }
      for (const [key, child] of Object.entries(node)) {
        walk(child, [...currentPath, key]);
      }
    })(light.color, []);

    const lines = [
      ...fileHeader(file.destination),
      'import SwiftUI',
      '',
      'private final class DesignSystemBundleToken {}',
      'private let designSystemBundle = Bundle(for: DesignSystemBundleToken.self)',
      '',
      'public extension ShapeStyle where Self == Color {',
    ];

    let currentFamily = null;
    for (const e of entries) {
      if (e.family !== currentFamily) {
        if (currentFamily !== null) lines.push('');
        lines.push(`    // MARK: - ${familyTitle(e.family)}`);
        currentFamily = e.family;
      }
      lines.push(
        `    static var ${e.swiftName}: Color { Color("${e.assetName}", bundle: designSystemBundle) }`,
      );
    }

    lines.push('}', '');
    return lines.join('\n');
  },
});

// Generic "category enum" format. Emits:
//
//     import {importStatement}
//     {preamble?}
//     public enum {namespace} {
//         // MARK: - {section.title}
//         public static let foo: {swiftType} = ...
//         ...
//     }
//
// Used for every non-color generated file. Sections are configured per-file via
// `options.sections`. `swiftType` of `null` means "let the RHS reveal the type"
// (used for boxShadow whose RHS is `DesignTokenShadow(...)`).
StyleDictionary.registerFormat({
  name: 'ios-swift/sectionedEnum',
  format: ({ dictionary, file, options }) => {
    const {
      namespace,
      sections,
      preamble = null,
      importStatement = 'UIKit',
    } = options;

    if (!namespace || !Array.isArray(sections) || sections.length === 0) {
      throw new Error(
        `ios-swift/sectionedEnum requires options.namespace and options.sections`,
      );
    }

    const grouped = {};
    for (const token of dictionary.allTokens) {
      (grouped[token.type] ??= []).push(token);
    }

    const lines = [
      ...fileHeader(file.destination),
      `import ${importStatement}`,
      '',
    ];
    if (preamble) {
      lines.push(...preamble.split('\n'), '');
    }
    lines.push(`public enum ${namespace} {`);

    const showSectionHeaders = sections.length > 1;
    let firstSection = true;
    for (const { type, title, swiftType } of sections) {
      const tokens = grouped[type];
      if (!tokens || tokens.length === 0) continue;
      if (!firstSection) lines.push('');
      firstSection = false;
      if (showSectionHeaders) {
        lines.push(`    // MARK: - ${title}`);
      }
      tokens.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const t of tokens) {
        const lhs = swiftType
          ? `public static let ${t.name}: ${swiftType}`
          : `public static let ${t.name}`;
        lines.push(`    ${lhs} = ${t.value}`);
      }
    }

    lines.push('}', '');
    return lines.join('\n');
  },
});

// Per-file section configurations (fed to ios-swift/sectionedEnum via options).
const SPACING_SECTIONS = [
  { type: 'spacing', title: 'Spacing', swiftType: 'CGFloat' },
];
const SIZING_SECTIONS = [
  { type: 'sizing', title: 'Sizing', swiftType: 'CGFloat' },
];
const BORDER_RADIUS_SECTIONS = [
  { type: 'borderRadius', title: 'Border Radius', swiftType: 'CGFloat' },
];
const BORDER_WIDTH_SECTIONS = [
  { type: 'borderWidth', title: 'Border Width', swiftType: 'CGFloat' },
];
// fontFamilies is excluded — iOS team manages it manually via
// PretendardFontFamily.swift. We only emit weight/size/lineHeight/letterSpacing.
const TYPOGRAPHY_SECTIONS = [
  { type: 'fontWeights', title: 'Font Weight', swiftType: 'UIFont.Weight' },
  { type: 'fontSizes', title: 'Font Size', swiftType: 'CGFloat' },
  { type: 'lineHeights', title: 'Line Height', swiftType: 'CGFloat' },
  { type: 'letterSpacing', title: 'Letter Spacing (em fraction)', swiftType: 'CGFloat' },
];
const BOX_SHADOW_SECTIONS = [
  { type: 'boxShadow', title: 'Box Shadow', swiftType: null },
];
const BOX_SHADOW_PREAMBLE = `public struct DesignTokenShadow {
    public let offsetX: CGFloat
    public let offsetY: CGFloat
    public let blur: CGFloat
    public let spread: CGFloat
    public let color: UIColor
}`;

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
        'value/swift/fontWeight',
        'value/swift/letterSpacing',
        'value/swift/boxShadow',
      ],
      buildPath: 'build/ios/',
      files: [
        // Color accessor — bridges xcassets to a SwiftUI ShapeStyle extension.
        // Format reads from the `light.color` closure (not the SD dictionary),
        // so we intentionally don't set a filter — SD just needs at least one
        // token in `allTokens` to actually emit the file.
        {
          destination: 'Colors+Generated.swift',
          format: 'ios-swift/colorAccessor',
        },
        // Numeric category files
        {
          destination: 'Spacing+Generated.swift',
          format: 'ios-swift/sectionedEnum',
          filter: (token) => token.type === 'spacing',
          options: {
            namespace: 'Spacing',
            sections: SPACING_SECTIONS,
            importStatement: 'CoreGraphics',
          },
        },
        {
          destination: 'Sizing+Generated.swift',
          format: 'ios-swift/sectionedEnum',
          filter: (token) => token.type === 'sizing',
          options: {
            namespace: 'Sizing',
            sections: SIZING_SECTIONS,
            importStatement: 'CoreGraphics',
          },
        },
        {
          destination: 'BorderRadius+Generated.swift',
          format: 'ios-swift/sectionedEnum',
          filter: (token) => token.type === 'borderRadius',
          options: {
            namespace: 'BorderRadius',
            sections: BORDER_RADIUS_SECTIONS,
            importStatement: 'CoreGraphics',
          },
        },
        {
          destination: 'BorderWidth+Generated.swift',
          format: 'ios-swift/sectionedEnum',
          filter: (token) => token.type === 'borderWidth',
          options: {
            namespace: 'BorderWidth',
            sections: BORDER_WIDTH_SECTIONS,
            importStatement: 'CoreGraphics',
          },
        },
        // Typography combines weight/size/lineHeight/letterSpacing.
        // fontFamilies는 iOS팀이 별도 관리(PretendardFontFamily.swift)하므로 미포함.
        {
          destination: 'Typography+Generated.swift',
          format: 'ios-swift/sectionedEnum',
          filter: (token) =>
            ['fontWeights', 'fontSizes', 'lineHeights', 'letterSpacing'].includes(
              token.type,
            ),
          options: {
            namespace: 'Typography',
            sections: TYPOGRAPHY_SECTIONS,
            importStatement: 'UIKit',
          },
        },
        // BoxShadow: 생성은 하지만 워크플로우에서는 iOS팀 매핑표에 없어
        // 배포 대상에서 제외된다 (build/ios 산출물에는 남음).
        {
          destination: 'BoxShadow+Generated.swift',
          format: 'ios-swift/sectionedEnum',
          filter: (token) => token.type === 'boxShadow',
          options: {
            namespace: 'BoxShadow',
            sections: BOX_SHADOW_SECTIONS,
            preamble: BOX_SHADOW_PREAMBLE,
            importStatement: 'UIKit',
          },
        },
      ],
    },
  },
};
