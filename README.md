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
│  ├─ Colors+Generated.swift           │
│  ├─ Spacing+Generated.swift          │
│  ├─ Sizing+Generated.swift           │
│  ├─ BorderRadius+Generated.swift     │
│  ├─ BorderWidth+Generated.swift      │
│  ├─ Typography+Generated.swift       │
│  └─ BoxShadow+Generated.swift        │
└──────────┬───────────────────────────┘
           │ GitHub Actions
           │ (.github/workflows/build-and-pr.yml)
           ▼
┌──────────────────────────────────────────────────┐
│  iOS repo (DDD-13-iOS2-iOS)                      │
│  · 브랜치 feature/design-tokens-sync-<timestamp> │
│    → develop 으로 PR 생성 (push마다 신규)         │
└──────────────────────────────────────────────────┘
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

iOS 팀의 디렉토리 컨벤션에 맞춰 **카테고리별로 분리된 7개 Swift 파일 + 1개 Asset Catalog**로 출력한다.

| 산출물 | 빌드 위치 | iOS 레포 배치 (워크플로우 자동 복사) |
| --- | --- | --- |
| Color (xcassets) | `build/ios/Colors.xcassets/` | `Projects/Shared/DesignSystem/Resources/Colors.xcassets/` |
| Color (Swift accessor) | `build/ios/Colors+Generated.swift` | `Projects/Shared/DesignSystem/Sources/Color/Generated/Colors+Generated.swift` |
| Typography | `build/ios/Typography+Generated.swift` | `Projects/Shared/DesignSystem/Sources/CustomFont/Generated/Typography+Generated.swift` |
| Spacing | `build/ios/Spacing+Generated.swift` | `Projects/Shared/DesignSystem/Sources/Spacing/Generated/Spacing+Generated.swift` |
| Sizing | `build/ios/Sizing+Generated.swift` | `Projects/Shared/DesignSystem/Sources/Sizing/Generated/Sizing+Generated.swift` |
| BorderRadius | `build/ios/BorderRadius+Generated.swift` | `Projects/Shared/DesignSystem/Sources/BorderRadius/Generated/BorderRadius+Generated.swift` |
| BorderWidth | `build/ios/BorderWidth+Generated.swift` | `Projects/Shared/DesignSystem/Sources/BorderWidth/Generated/BorderWidth+Generated.swift` |
| BoxShadow | `build/ios/BoxShadow+Generated.swift` | _(미배포 — 빌드만 됨)_ |

배제된 토큰:
- **fontFamilies (`"Pretendard"`)**: 기존 `PretendardFontFamily.swift`가 수동으로 관리하므로 Typography 출력에 미포함.
- **boxShadow**: iOS팀 배치표에 미명시. 빌드는 되나 워크플로우 복사 단계에서 제외. 필요 시 워크플로우 한 줄 추가로 활성화 가능.

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

카테고리별로 분리된 파일마다 자체 네임스페이스(또는 확장)를 선언한다.

| 파일 | Swift 진입점 | 표현 |
| --- | --- | --- |
| `Colors+Generated.swift` | `extension ShapeStyle where Self == Color` | `.orange500` 등 dot syntax로 SwiftUI에서 사용. 내부는 `Color("Orange500", bundle: designSystemBundle)` (xcassets 참조) |
| `Spacing+Generated.swift` | `enum Spacing` | `Spacing.spacing500: CGFloat` |
| `Sizing+Generated.swift` | `enum Sizing` | `Sizing.sizing400: CGFloat` |
| `BorderRadius+Generated.swift` | `enum BorderRadius` | `BorderRadius.borderRadius250: CGFloat`, `BorderRadius.borderRadiusFull: CGFloat` |
| `BorderWidth+Generated.swift` | `enum BorderWidth` | `BorderWidth.borderWidth100: CGFloat` |
| `Typography+Generated.swift` | `enum Typography` | `Typography.typographyWeight400: UIFont.Weight`, `Typography.typographySize400: CGFloat`, `Typography.typographyLineHeight400: CGFloat`, `Typography.typographyLetterSpacing100: CGFloat` (em-fraction) |
| `BoxShadow+Generated.swift` | `enum BoxShadow` + `struct DesignTokenShadow` | `BoxShadow.boxShadow100`은 `DesignTokenShadow` 인스턴스 |

`letterSpacing` 사용 예 (em-fraction → kern):

```swift
let kern = Typography.typographySize400 * Typography.typographyLetterSpacing100
```

`BoxShadow`를 `CALayer`에 적용 예:

```swift
let s = BoxShadow.boxShadow100
view.layer.shadowOffset = CGSize(width: s.offsetX, height: s.offsetY)
view.layer.shadowRadius = s.blur / 2
view.layer.shadowColor = s.color.cgColor
view.layer.shadowOpacity = 1
```

## CI 자동화 (`.github/workflows/build-and-pr.yml`)

`tokens.json`(또는 빌드 관련 파일)이 `main`에 push되면 워크플로우가 자동 실행되어 다음을 수행한다.

1. `npm ci` → `npm run build` 로 산출물 생성
2. 타겟 iOS 레포([`DDD-Community/DDD-13-iOS2-iOS`](https://github.com/DDD-Community/DDD-13-iOS2-iOS))를 체크아웃
3. `build/ios/` 산출물을 타겟 레포의 `Projects/Shared/DesignSystem/` 베이스 아래 정해진 위치로 덮어쓰기 ("빌드 산출물" 표 참조). `BoxShadow+Generated.swift`는 배포 단계에서 제외된다.
4. **워크플로우 실행마다 신규 브랜치** `feature/design-tokens-sync-<YYYYMMDD-HHMMSS>` (UTC) 를 생성해 `develop` 으로 가는 PR을 연다. PR이 머지되면 브랜치는 자동 삭제(`delete-branch: true`)된다.
   - `concurrency: cancel-in-progress: true` 설정으로 디자이너가 짧은 간격으로 연속 push해도 마지막 한 번만 PR이 만들어진다 (직전 run이 취소되면 그 run의 브랜치/PR은 생성되지 않음).

산출물은 이 레포에는 커밋되지 않는다 (`build/`는 `.gitignore`에 포함). 항상 빌드 결과는 타겟 iOS 레포에서만 보존된다.

### 사전 준비

워크플로우가 동작하려면 한 번 셋업이 필요하다.

1. **타겟 레포 정보 확인**: `.github/workflows/build-and-pr.yml` 의 `env` 블록 + "Replace generated artifacts" step 의 `copy` 호출들이 타겟 레포 디렉토리 구조와 일치하는지 확인.
   - `TARGET_REPO` — 산출물을 받을 iOS 레포 (`<owner>/<repo>`)
   - `TARGET_BRANCH_BASE` — PR base 브랜치 (보통 `main` 또는 `develop`)
   - `IOS_BASE` — 타겟 레포의 DesignSystem 베이스 경로
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
