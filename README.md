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
│  └─ DesignTokens.swift               │
└──────────┬───────────────────────────┘
           │ GitHub Actions
           │ (.github/workflows/build-and-pr.yml)
           ▼
┌──────────────────────────────────────┐
│  iOS repo (DDD-13-iOS2-iOS)          │
│  · 고정 브랜치 design-tokens/auto-sync│
│  · PR 자동 생성/갱신                  │
└──────────────────────────────────────┘
```

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

## CI 자동화 (`.github/workflows/build-and-pr.yml`)

`tokens.json`(또는 빌드 관련 파일)이 `main`에 push되면 워크플로우가 자동 실행되어 다음을 수행한다.

1. `npm ci` → `npm run build` 로 산출물 생성
2. 타겟 iOS 레포([`DDD-Community/DDD-13-iOS2-iOS`](https://github.com/DDD-Community/DDD-13-iOS2-iOS))를 체크아웃
3. `build/ios/Colors.xcassets` 와 `build/ios/DesignTokens.swift` 를 다음 위치에 덮어쓰기:
   - `Projects/Shared/DesignSystem/Resources/ColorAssets.xcassets/`
   - `Projects/Shared/DesignSystem/Sources/Generated/DesignTokens.swift`
4. **고정 브랜치 `design-tokens/auto-sync`** 에 푸시하고 PR을 1개 유지
   (이미 PR이 열려 있으면 같은 PR에 커밋이 누적됨 — 디자이너의 연속 push가 PR 폭발로 이어지지 않음)

산출물은 이 레포에는 커밋되지 않는다 (`build/`는 `.gitignore`에 포함). 항상 빌드 결과는 타겟 iOS 레포에서만 보존된다.

### 사전 준비

워크플로우가 동작하려면 한 번 셋업이 필요하다.

1. **타겟 레포 정보 확인**: `.github/workflows/build-and-pr.yml` 의 `env` 블록에서 다음을 환경에 맞게 수정한다.
   - `TARGET_REPO` — 산출물을 받을 iOS 레포 (`<owner>/<repo>`)
   - `TARGET_BRANCH_BASE` — PR base 브랜치 (보통 `main` 또는 `develop`)
   - `ASSETS_DEST` / `SWIFT_DEST` — 타겟 레포 안의 파일 위치
2. **PAT 발급 및 등록**:
   - GitHub Settings → Developer settings → Personal access tokens 에서 PAT 생성
   - 권한: 타겟 레포의 `Contents: Read and write`, `Pull requests: Read and write` (fine-grained 기준)
   - 이 레포의 Settings → Secrets and variables → Actions 에서 `IOS_REPO_PAT` 라는 이름으로 등록
3. **수동 테스트**: Actions 탭 → "Build and sync to iOS repo" 워크플로우 → "Run workflow" 로 첫 실행 확인

PAT 대신 GitHub App 을 쓰는 게 운영 환경에서는 더 안전하다 (개인 계정에 의존하지 않고 조직 레벨에서 권한 관리). 셋업 단계에서는 PAT 로 시작하고, 안정화되면 GitHub App 으로 교체할 것을 권장.

### 트리거 조건

- `main` 브랜치에 다음 파일 중 하나가 변경되며 push될 때:
  - `tokens.json`
  - `style-dictionary.config.js`
  - `build.js`
  - `package.json`, `package-lock.json`
  - 워크플로우 파일 자체
- Actions 탭에서 수동 실행 (`workflow_dispatch`)

`concurrency: cancel-in-progress: true` 설정으로 디자이너가 짧은 간격으로 연속 push해도 마지막 한 번만 실행된다.

## 기술 스택

- [Style Dictionary 4.x](https://github.com/amzn/style-dictionary) (ESM 기반)
- [@tokens-studio/sd-transforms](https://github.com/tokens-studio/sd-transforms)
- [peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request) (GitHub Action)
