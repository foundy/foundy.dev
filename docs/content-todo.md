# 콘텐츠 TODO: 공개 전에 실제 정보로 바꿔야 하는 것

사이트의 모든 "사람에 관한 정보"와 "측정/실험 수치"는 아직 **mock**입니다. 화면에서는 `MOCK` 배지(섹션) 또는 숫자 바로 뒤의 작은 `mock` 표식(`<span class="mock-tag">`)으로 표시되어 있어서, 표식이 붙은 것은 사실처럼 읽히지 않습니다. 이 문서는 그 목록과, 바꾸려면 어떤 실제 정보가 필요한지입니다. 새 사실은 지어내지 않았습니다. 확인되지 않은 것은 그대로 mock으로 남겼습니다. (줄 번호는 Phase 7 시점 기준)

모두 교체한 뒤: `src/data/site.ts`의 `export const mock = true`를 `false`로, `src/content/work/*.md` frontmatter의 `mock: true`를 제거하고, 이 문서의 항목을 지웁니다. 표식은 `grep -rn "mock-tag\|\[mock\]" src`로 찾을 수 있습니다.

## A. 사람/연락처 정보 (`src/data/site.ts`)

| 위치 | 현재 값 | 필요한 실제 정보 |
|---|---|---|
| `site.ts:12-14` `role`, `tagline`, `description` | "Frontend developer working on graphics, shaders and interaction." | 본인이 쓰고 싶은 한 줄 소개 |
| `site.ts:16` `availability` | "Open to select projects" | 실제 구직/의뢰 상태 |
| `site.ts:17` `location` | "Seoul, KR (UTC+9)" | 공개해도 되는 지역/시간대 |
| `site.ts:29-41` `about.lede`, `paragraphs`, `skills` | 일반적인 소개 문단과 기술 목록 | 본인의 소개, 실제 사용 기술 |
| `site.ts:44-50` `now.updatedAt`, `now.items` | "Building / Reading / Testing / Writing" 항목 | 현재 하고 있는 일 (갱신 날짜 포함) |
| `site.ts:54` `contact.email` | `hello@example.com` (가짜 주소) | **실제 이메일** |
| `site.ts:56-60` `contact.socials` | GitHub는 실제(`github.com/foundy`), LinkedIn/Bluesky/Read.cv는 `example` 자리표시 | 쓰는 계정만 남기고 실제 URL/핸들로 교체, 안 쓰는 것은 삭제 |

홈의 About/Contact 섹션 머리에는 `Mock content` 배지가, 모든 페이지 푸터에는 "Placeholder content" 문구가 붙어 있습니다(`mock = true`일 때).

## B. Hero Shader 케이스 스터디 (`src/content/work/hero-shader.md`)

| 위치 | 현재 문장/수치 | 필요한 실제 정보 |
|---|---|---|
| `:37` | "Three octaves ... cost 40 percent more per frame at 1080p" (`mock` 표식) | 2옥타브 vs 3옥타브의 실제 프레임 비용 측정값 (GPU/해상도 포함) |
| `:68` | First frame after chunk load: 예산 120 ms / **84 ms** (`mock`) | 실기기 측정값 (`?hud=1`의 `ready`/첫 프레임) |
| `:69` | Frame time, default tier, mid-range phone: 8 ms / **6.2 ms** (`mock`) | iPhone 실측 p50/p95 (`docs/device-checklist.md` H4) |
| `:70` | Shader compile, cold: 250 ms / **190 ms** (`mock`) | 실측 컴파일 시간 |
| `:35-41` 본문 | "I tried drawing the letters analytically ...", "Particles ... most common move" 등 시행착오 서술 | 실제로 시도한 것과 이유. 표식은 없지만 **본인 경험과 맞는지 본인이 확인해야 하는 서술**입니다 |
| `:66-67` 표의 "Render-blocking JS 0 / 0", "GL chunk gzipped 15 KB / 8.2 KB" | 실제 빌드 값(`node scripts/hero/sizes.mjs`) | mock 아님. 빌드가 바뀌면 다시 확인 |

참고: 스택 표기와 Renderer 문단은 실제 구현(raw WebGL2 + GLSL, three.js TSL은 참고 구현만 보존)에 맞게 이미 바로잡았습니다. 이전에는 three.js TSL/WebGPU로 적혀 있었습니다.

## C. Card Interaction Study 케이스 스터디 (`src/content/work/card-study.md`)

| 위치 | 현재 문장/수치 | 필요한 실제 정보 |
|---|---|---|
| `:28` | "roughly two attempts per number that did not survive" (`mock`) | 실제 시도 횟수 (legacy 프로토타입 기록) |
| `:30` | "close if velocity exceeds 1.2 px/ms or if travel exceeds 38 percent" (`mock`) | 구 규칙의 실제 값. **현재 사이트 구현은 `distance + velocity × 80 ms > 35%`라서 문장과 다릅니다**(레거시는 고정 `dy > 110`이었음: `docs/card-study-notes.md`) |
| `:32` | "decaying ratio, down to about 0.35" (`mock`) | 실제 저항 곡선. 현재 구현은 위로 당길 때 `RUBBER_PX = 56` 점근선 |
| `:56` | v1: "31% of intended closes missed" (`mock`) | 실제 측정 여부와 값. 없으면 질적 서술로 |
| `:58` | v12: "Missed closes down to 4%" (`mock`) | 위와 같음 |
| `:57`, `:59-60` | v6, v18, v20의 효과(수치 없는 질적 서술) | 확인 필요(표식 없음) |
| `:64` | "eight people ... roughly a third to about one in twenty-five" (`mock`) | 실제 테스트를 했다면 인원/조건/결과, 안 했다면 문단 삭제 |
| `:70` | "Eight testers" (`mock`) | 위와 같음 |
| frontmatter `facts` (`:11-12`) | "40+ across v1 to v20", "Projected travel past 35% of the sheet" | 앞의 것은 레거시 기록(v1–v20)과 일치하는지 확인, 뒤의 것은 구현값(사실) |

## D. Lab (`src/data/lab/decisions.ts`, `src/lib/lab/rules.ts`, `src/pages/lab.astro`)

| 위치 | 현재 문장/수치 | 필요한 실제 정보 |
|---|---|---|
| `decisions.ts:32` | "The case study counted 31% missed closes." (`mock`) | C의 v1 수치와 같은 출처가 필요 |
| `decisions.ts:41` / `rules.ts:34` | 구 규칙의 닫기선 **38%** (`OLD_PARAMS`, 화면에 `mock` 배지) | 레거시 프로토타입의 실제 거리 판정(고정 110 px 등)을 재현 |
| `decisions.ts:56` / `rules.ts:36` | 구 스프링 강성 **170** (화면에 `mock` 배지) | 레거시 닫기 모션의 실제 값 |
| `decisions.ts:73` / `rules.ts:214,395` | 고스트 클릭 도착 시간 **120 ms** ("typical, not measured") | 실기기에서 측정한 고스트 클릭 지연 |
| `decisions.ts:89` / `rules.ts:122` | 구 스냅 시간 **220 ms** | 레거시의 실제 복귀 시간 |
| `decisions.ts:100` `tauNote.why` | "holds for roughly 55 to 125 ms" (`mock`) | 합성 녹화 4개가 아닌 **실제 녹화**로 다시 계산 (`scripts/lab/make-recordings.mjs`는 합성기) |
| `lab.astro:45` | 프리셋 제스처 4종이 "synthesised" (`mock`) | iPhone에서 실제로 녹화한 제스처로 교체하면 문장 삭제 |
| 차트/배지의 모든 px, ms 값 | 합성 녹화에서 계산된 값 | 위 녹화를 교체하면 자동으로 갱신 |

## E. 확인하면 좋은 것 (mock은 아니지만 사람이 봐야 함)

- 영문 카피 톤 전체(홈, Inspect 해설 `src/gl/hero/inspect.ts`, 카드 Inspect `src/lib/cards/inspect.ts`, Lab 문구).
- OG 이미지(`public/og/*.png`)는 제목/요약/연도만 사용합니다. 카피를 바꾸면 `node scripts/og.mjs`로 다시 생성하고 커밋합니다.
