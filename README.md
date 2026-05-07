# Design Tokens

Tokens Studio(Figma)에서 정의한 디자인 토큰을 Style Dictionary로 변환해 iOS 에셋을 생성하는 레포입니다.

## 전체 흐름

```
┌──────────────────────┐
│  Tokens Studio       │
│  (Figma plugin)      │
└──────────┬───────────┘
           │ push (tokens.json)
           ▼
┌──────────────────────┐
│  design-tokens repo  │ ← 이 레포
│  (Style Dictionary)  │
└──────────┬───────────┘
           │ npm run build
           ▼
┌──────────────────────────────────────┐
│  build/ios/                          │
│  ├─ Colors.xcassets (라이트/다크)    │
│  └─ DesignTokens.swift (CGFloat)     │
└──────────┬───────────────────────────┘
           │ (예정: 자동 PR)
           ▼
┌──────────────────────┐
│  iOS repo            │
└──────────────────────┘
```

현재 단계: 로컬에서 빌드 가능한 인프라까지 구축. iOS 레포 자동 PR은 후속 작업.

## 로컬 빌드

요구 사항: Node.js 18+

```bash
npm install
npm run build
```

빌드를 깨끗이 다시 하고 싶다면:

```bash
npm run clean && npm run build
```

## 빌드 산출물

| 경로 | 설명 |
| --- | --- |
| `build/ios/Colors.xcassets/` | 색상 토큰의 Asset Catalog. 라이트/다크가 매칭되는 색상은 두 외양을 함께 포함하고, `static.*`처럼 매칭이 없는 색상은 universal asset으로 출력. |
| `build/ios/DesignTokens.swift` | primitiveCore의 비색상 토큰 전체를 `DesignTokens.<name>` 정적 상수로 출력. spacing / sizing / borderRadius / borderWidth / fontSizes / lineHeights / letterSpacing은 `CGFloat`, fontFamilies는 `String`, fontWeights는 `UIFont.Weight`, boxShadow는 동일 파일 상단의 `DesignTokenShadow` 구조체로 출력. |

## 토큰 셋 구조 (`tokens.json`)

| Set | 용도 |
| --- | --- |
| `primitives/ coreTokens` | 비색상 토큰 (spacing, sizing, borderRadius, borderWidth, typography, boxShadow) |
| `primitives/colorLight` | 라이트 모드 색상 (`color.<group>.<step>`) |
| `primitives/colorDark` | 다크 모드 색상. `*Alpha` 그룹은 다크 셋에서 `*DarkAlpha` 이름을 사용한다. |

## 토큰 추가/수정 가이드

토큰 이름은 Style Dictionary 변환과 Swift 식별자 양쪽 모두에서 안전해야 하므로 다음 규칙을 따른다.

- **영문/숫자만** 사용한다. 한글, 한자 등은 금지.
- **숫자로 시작 금지**. 항상 영문으로 시작한다. (예: `spacing50` ✅, `50spacing` ❌)
- **특수문자/공백 금지**. `-`, `_`, 공백, 슬래시 등은 사용하지 않는다.
- **단위는 숫자 문자열만**. `value: "8"` ✅ / `value: "8px"` ❌. 단위는 변환 단계에서 부여된다.
- **라이트/다크는 동일한 키 경로**를 유지한다. 다크에 동일 키가 없으면 자동으로 universal asset으로 출력되며, 라이트/다크 자동 전환이 적용되지 않는다.
  - 예외: `color.static.*`은 라이트/다크 공통(universal)이며 다크에 키를 만들 필요 없음.
  - 예외: `*Alpha` 그룹은 다크 셋에서 `*DarkAlpha`로 매칭된다.

## Swift 출력 형식

`DesignTokens.swift`로 내려갈 때 토큰 type 별로 다음 형식이 적용된다.

| Tokens Studio type | Swift 표현 | 비고 |
| --- | --- | --- |
| `spacing`, `sizing`, `borderRadius`, `borderWidth`, `fontSizes`, `lineHeights` | `CGFloat(N)` | 토큰 값을 그대로 사용 |
| `fontFamilies` | `"Pretendard"` (`String`) | `UIFont(name:size:)`의 첫 인자에 그대로 전달 |
| `fontWeights` | `UIFont.Weight.<constant>` | `Regular → .regular`, `Medium → .medium`, `Semibold → .semibold`, `Bold → .bold` (전체 매핑은 `style-dictionary.config.js`의 `FONT_WEIGHT_MAP`) |
| `letterSpacing` | `CGFloat(em-fraction)` | `"-0.1%"` → `CGFloat(-0.001)`. 사용처에서 `kern = fontSize * value`로 환산 |
| `boxShadow` | `DesignTokenShadow(...)` | 동일 파일 상단의 `public struct DesignTokenShadow { offsetX, offsetY, blur, spread, color }`를 사용 |

`DesignTokenShadow`를 `CALayer`에 적용하는 예:

```swift
let s = DesignTokens.boxShadow100
view.layer.shadowOffset = CGSize(width: s.offsetX, height: s.offsetY)
view.layer.shadowRadius = s.blur / 2
view.layer.shadowColor = s.color.cgColor
view.layer.shadowOpacity = 1
```

## 기술 스택

- [Style Dictionary 4.x](https://github.com/amzn/style-dictionary) (ESM 기반)
- [@tokens-studio/sd-transforms](https://github.com/tokens-studio/sd-transforms)
