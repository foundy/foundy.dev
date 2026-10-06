# foundy.dev 리뉴얼 최종 계획 (v2)

> 2026-10-06 · Claude 초안 → Codex(codex-cli 0.160.1) 검토 → 취합 → 사용자 결정 반영.
> 원본: `docs/redesign-plan.draft.md`(초안), `docs/redesign-plan.codex-review.md`(검토 원문)

---

## 0. 확정된 결정

| 항목 | 결정 |
|---|---|
| 성격 | 특정 방문자를 겨냥하지 않는 **개인 포트폴리오** |
| 첫 번째로 보여줄 능력 | **그래픽/셰이더** |
| 대표작 | ① **히어로 셰이더**(사이트 자체의 GL 작업) ② **카드 인터랙션 연구**(v1 → v20) |
| 언어 | 영문 단일 |
| Inspect | 누구나 이해하는 해설 + 개발자용 상세 수치는 펼쳐서 보기 |
| 테스트 | iPhone Safari, Mac Chrome / Safari / Firefox |
| 출시일 | 없음. 단계별 통과 기준을 만족하면 배포(1단계 후 중간 배포 가능) |
| 히어로 스택 (스파이크 후 확정) | **raw WebGL2 + 소형 GLSL**(핑퐁 FBO). three/TSL은 참고 구현(`src/spike/three.ts`)으로만 보존, 프로덕션 페이지에서 import 금지. §5의 "three WebGPURenderer + TSL" 기본안은 폐기 |
| 히어로 look (스파이크 후 확정) | **ink**(종이 위 검은 잉크 번짐). riso/refract는 출시하지 않음 |
| 모바일 히어로 입력 (확정) | **히어로 위 세로 스크롤 허용**(`touch-action: pan-y`). 가로 드래그 또는 롱프레스(약 300ms 정지 후 이동)가 잉크에 힘을 줌. 데스크톱은 호버 이동 = 약한 힘, 버튼 누른 드래그 = 강한 힘 |

## 1. 한 줄 요약

**"만지고, 해부해 보는 포트폴리오."**
첫 화면은 foundy가 직접 만든 **셰이더 작품**이다. 방문자가 만지면 반응하고, **Inspect**를 켜면 그 이미지가 어떤 단계(형태 → 노이즈 → 흐름 → 합성)로 만들어지는지 한 겹씩 벗겨져 보인다. 같은 Inspect가 카드 인터랙션에서는 방문자의 제스처가 어떻게 판정됐는지와 그 설계를 왜 그렇게 했는지를 보여준다.

## 2. 리서치 요약 (2026)

| 관찰 | 계획에 반영 |
|---|---|
| 수상작 공통: 뚜렷한 아트 디렉션 · 서사가 있는 모션 · 중급 모바일에서 끊김 없음 (By-Kin, Mat Voyce, Iventions, Minh Pham, fromanother) | 효과 개수보다 **하나의 시각 언어**를 끝까지 다듬기 |
| fromanother: 셰이더 자체가 아이덴티티. Minh Pham: GL이 콘텐츠를 압도하지 않음 | 히어로 셰이더 = 아이덴티티. 아래 섹션에서는 GL을 절제 |
| 다크+네온, 글래스모피즘, 3D 틸트 카드, 커스텀 커서만 있는 사이트, 파티클로 흩어지는 이름 = 이미 흔함 | 의도적으로 피함 |
| Three.js WebGPURenderer + TSL 프로덕션 사용 가능, WebGL2 폴백 존재 (단 기능·성능 동등은 보장 안 됨) | TSL로 작성하고 **양쪽 백엔드를 모두 검증** |
| CSS scroll-driven: Chrome·Safari 지원, Firefox 플래그 / **교차 문서 View Transition: Chrome 126+, Safari 18.2+, Firefox 미지원** | 점진적 향상. 미지원은 일반 이동으로 폴백 |
| GSAP 전 플러그인 무료 | 필요한 것만 선택 사용 |

## 3. 컨셉 & 아트 디렉션

- **해부 가능한 이미지.** 셰이더 히어로는 처음부터 "단계별로 분리해서 보여줄 수 있는 구조"로 설계한다. 각 단계는 독립된 노드/패스로, Inspect가 그 사이를 스크럽할 수 있다.
  - 예: `SDF wordmark → domain warp noise → flow field advection → ink/paper composite`
  - Inspect 해설 예: "Each stroke is pushed by a velocity field. Your cursor adds force here — this is that field."
- **카드 연구 = 집요함의 증거.** 한 인터랙션을 40번 넘게 고친 기록. Inspect는 방문자가 방금 한 제스처를 재생하고, 판정 근거를 보여준다.
  - 예: "Release velocity 1.8px/ms + 92px travel → close. In v12 only distance counted, so short fast flicks were cancelled."
- **톤:** 라이트 에디토리얼(종이/잉크) 바탕 + Inspect 시 블루프린트 라인. 셰이더의 재질감(잉크 번짐, 종이 결)이 사이트 전체의 시각 언어. 가변 산세리프 1 + 모노 1.
- **폴백도 작품이어야 함:** GL을 쓸 수 없는 환경에서는 같은 워드마크를 SVG + 사전 렌더 이미지/영상으로 보여주고, Inspect는 각 단계의 정지 이미지로 해설을 유지한다.

## 4. 정보 구조

1. **Hero** — 셰이더 작품 + 워드마크 + 한 문장 포지셔닝. 커서/터치로 흐름장에 힘을 가함. Inspect 진입점이 처음부터 보임.
2. **Work** — 대표작 2개.
   - *Hero Shader*: 파이프라인, 시행착오, 성능 예산, 폴백 전략.
   - *Card Interaction Study*: 카드 덱 + **프리뷰 시트**(같은 문서, 드래그로 닫기) → 전체 케이스 스터디 정적 페이지(교차 문서 View Transition).
3. **Lab** — 카드 연구의 **핵심 결정 4개**. 같은 기록 입력을 구버전/개선버전에 재생해 비교. 설계 변수 1개 조절. (여력 시 작은 셰이더 스케치 추가)
4. **About / Now / Contact** — 짧은 소개, 현재 포커스(status.json 갱신), 이메일 복사 마이크로인터랙션.
5. (P2) ⌘K 커맨드 팔레트, AI 워크플로 노트(Claude Code 환경, Discord 원격 에이전트)를 짧은 글로, 사운드.

**케이스 스터디 형식:** 문제 → 선택과 대안 → 실제 동작(실행 가능한 데모) → 결과와 한계.

## 5. 기술 스택 (결정)

| 영역 | 결정 | 이유 |
|---|---|---|
| 사이트 기반 | **Astro (정적 출력) + vanilla TS 스크립트** | 정적 페이지·콘텐츠·메타/OG를 맡기고, 인터랙션/GL 코드는 직접 소유 |
| GL | **three `WebGPURenderer` + TSL**, WebGL2 폴백, 셰이더 청크는 지연 로드 | 그래픽이 핵심 능력이 되어 GL을 정식 범위로 승격. TSL 노드 구조가 Inspect의 단계 분리와 자연스럽게 맞음. compute 사용 시 WebGL2 경로에서 동작·성능을 실측 |
| 대안(스파이크에서 판단) | three 번들 비용이 과하면 raw WebGL2 + 소형 GLSL 파이프라인 | Codex 지적: 렌더러 폴백이 동등성을 보장하지 않음 |
| 내비게이션 | 정적 상세 URL + 교차 문서 View Transition, Firefox는 일반 이동 | SPA 폴백 이중 관리 회피 |
| 드래그 상세 | 홈 내부 **프리뷰 시트**로 한정 | "드래그로 중단 가능한 상세"와 "문서 이동"의 상태 모델 분리 |
| 제스처/스프링 | **자체 모듈**(시간 기반 물리, Pointer Events, 속도 추정, 기록/재생) — 프로토타입 로직을 참고해 재작성 | 프로토타입은 iframe 주입·MutationObserver·300ms 반복 주입 구조라 이식 불가 |
| 시퀀스 | 간단 전환은 CSS/WAAPI, 복합 시퀀스만 GSAP | 같은 transform을 두 엔진이 쓰지 않도록 소유권 분리 |
| 스크롤 | 네이티브. **Lenis 제외** | 필요가 증명되면 도입 |
| 배포 | GitHub Pages 워크플로 유지(Astro `dist`) | |

### 아키텍처 스케치
```
src/
  content/work/*.md               # hero-shader, card-study
  pages/index.astro  pages/work/[slug].astro  pages/lab.astro
  gl/
    renderer.ts                   # 백엔드 선택(WebGPU/WebGL2/none), 품질 등급, 화면 밖 정지
    hero/stages/*.ts              # sdf, warp, flow, composite — 각 단계가 독립 출력 가능
    hero/index.ts
  lib/motion/  spring.ts gesture.ts velocity.ts recorder.ts
  lib/inspect/ overlay.ts stages.ts explain.ts   # GL 단계 스크럽 + 제스처 재생 공통 UI
  lib/core/    clock.ts (공유 시간, 업데이트 순서)  quality.ts
  components/  Wordmark, CardDeck, PreviewSheet, InspectToggle ...
```
- **Inspect 공통 인터페이스:** GL 단계(`stages`)와 제스처 기록(`recorder`) 둘 다 "시간축/단계축을 스크럽하고 해설을 붙이는" 같은 UI로 노출.
- 렌더 백엔드와 품질 등급(high/mid/low)을 분리. 초기 벤치 없이 보수적으로 시작 → 실제 프레임 시간으로 해상도/반복 횟수 조절. `prefers-reduced-motion`은 사용자 선호로 별도 처리(셰이더는 정지 또는 매우 느린 흐름).
- DOM 읽기/쓰기 분리, 시간 기반 업데이트, 화면 밖·탭 비활성 시 렌더 정지.

## 6. 품질 기준

**성능**
- LCP < 2.0s, CLS 0, **INP ≤ 200ms**. LCP 요소는 GL 캔버스가 아닌 워드마크/텍스트.
- GL은 첫 페인트를 막지 않음: 정적 포스터 → 셰이더 준비 후 크로스페이드.
- 첫 화면 총 전송량, 셰이더 컴파일 시간, GPU 초기화 시간을 따로 측정.
- 지정 기기에서 프레임 시간 분포/긴 프레임: 히어로 상호작용, 카드 최초 열기, 빠른 반복 열고닫기, 수 분 사용 후 발열(iPhone).
- Inspect 자체 오버헤드 측정.

**접근성**
- 확대 금지 제거(프로토타입의 `user-scalable=no` 계승 금지).
- 시트: 명시적 닫기 버튼, Escape, 포커스 복원, 배경 `inert`, 스크롤 복원. 풀다운은 시트 스크롤 최상단에서만.
- Inspect: `I` 단축키는 입력 중 비활성, 모바일엔 보이는 토글. 고빈도 수치는 스크린리더에 낭독 안 함. reduced-motion에서도 해설·비교 유지.
- 캔버스는 장식(`aria-hidden`), 모든 콘텐츠는 DOM. 대비 AA.

**테스트 매트릭스**

| 기기 | 확인 |
|---|---|
| iPhone Safari | WebGPU 경로, 터치 제스처, 발열, 시트 풀다운 |
| Mac Chrome | WebGPU 경로, 기준 성능 |
| Mac Safari | WebGPU 경로, View Transition |
| Mac Firefox | **WebGL2 폴백 경로**, View Transition 미지원 폴백 |
| 강제 폴백 | 쿼리 플래그(`?gl=webgl2`, `?gl=none`)로 각 경로를 수동 검증 |

Android는 실기기 테스트에서 빠지므로 품질 등급의 보수적 기본값과 프레임 시간 기반 자동 조절로 대응.

## 7. 로드맵 (날짜 없음, 통과 기준 기반)

| 단계 | 예상 | 작업 | 통과 기준 |
|---|---|---|---|
| 0 | 1~2일 | 기존 코드·프로토타입을 `legacy` 태그로 보존, main 초기화, Astro 셋업 | 빈 사이트가 Pages에 배포됨 |
| 1 | 4~6일 | 타이포/토큰, 정적 페이지 전체, 영문 카피, 상세 URL, OG, 히어로 정적 포스터 | **모션·GL 없이도 완성된 사이트** → 중간 배포 |
| 2 | 2~3일 | **히어로 스파이크**: TSL vs raw WebGL2, 단계 구조, 4개 테스트 환경 측정 | 스택 확정 + 성능 예산 수치 확보 |
| 3 | 6~9일 | 히어로 셰이더 정식 구현 + 품질 등급 + 폴백 | 4개 환경에서 끊김 없음, 폴백이 작품으로 성립 |
| 4 | 3~4일 | Inspect 공통 UI + 히어로 단계 해부 | 비개발자도 단계 차이를 이해 |
| 5 | 5~8일 | 카드 덱 + 프리뷰 시트 + 제스처 기록기 + 카드 Inspect | 빠른 반복 입력·취소·키보드·모바일 스크롤 안정 |
| 6 | 3~5일 | Lab: 핵심 결정 4개, 구/신 비교, 변수 1개 조절 | 비교만으로 판단 차이가 이해됨 |
| 7 | 상시 + 3~5일 | 케이스 스터디 2편 작성, 실기기 QA, 접근성, 성능, OG | 직접 진입·뒤로가기·확대·모션 축소·GPU 실패 경로 통과 |
| P2 | 이후 | ⌘K, AI 워크플로 노트, 셰이더 스케치, 사운드(기본 off) | — |

**3단계 완료 노트 (구현 끝, 실기기 확인 대기).** raw WebGL2 ink 히어로를 `src/gl/`에 정식 구현했다. SDF는 `npm run bake:sdf`로 빌드타임 베이크(`public/gl/wordmark-sdf.png`, 커밋됨), 포스터 SVG는 같은 외곽선을 `<path>`로 그려 포스터↔캔버스가 모든 브라우저에서 정렬된다(정지 상태 평균 절대 차이 약 3/255). 홈의 렌더 블로킹 JS는 0, 초기 스크립트 1.6 KB gz, 히어로 청크 8.2 KB gz(지연 로드, 목표 15 KB). 품질 등급은 프레임 시간 기반 자동 조절, `?gl=none|webgl2` `?hud=1` `?stage=` `?tier=` 플래그 유지. Chromium/WebKit/Firefox 자동 검증(`scripts/hero/verify.mjs`) 통과. **남은 것:** iPhone Safari 실기기 확인(`docs/spike/device-checklist.md` 0절), 그 결과로 §6의 모바일 프레임/발열 기준 확정, 케이스 스터디의 mock 수치 교체. 상세 수치와 한계는 PR 본문 참고.

**4단계 완료 노트 (구현 끝, 실기기 확인 대기).** Inspect 공통 코어(`src/lib/inspect/`: `registerInspectable`, 전역 상태, 이벤트, 제네릭 stages 패널)와 히어로 단계 해부를 구현했다. 토글 버튼은 정적 HTML이고 Inspect 청크는 첫 활성화(클릭/`I`) 또는 버튼 hover/focus 시 prefetch로 지연 로드된다(청크 약 3.6 KB gz, 예산 10 KB). 슬라이더 4단계(SDF/Warp/Flow/Ink) + 이전/다음 + 쉬운 영문 해설(aria-live는 이 영역 하나) + 개발자용 Details(tier, 시뮬 그리드, DPR, frame ms, 텍스처 포맷, 포인터 힘; 4회/초 이하, 낭독 안 함). 단계 전환은 연속 블렌딩 대신 140 ms 디핑 크로스페이드(마지막 스크럽 우선), reduced-motion에서는 즉시. Flow 단계는 셰이더 내 화살표 격자가 속도장을 보여주며 잉크는 계속 인터랙티브. GL이 없거나 reduced-motion이면 사전 렌더 정지 이미지(`public/gl/stages/*.webp`, 라이트/다크 8장, 각 50 KB 이하)를 포스터 위에 교체한다. 자동 검증: `scripts/inspect/verify.mjs`(Chromium/WebKit/Firefox 각 77~81개 체크), 스크린샷 `docs/screenshots/phase-4/`. **남은 것:** 카피 톤·시각 취향·iPhone 실기기 확인, 연속 블렌딩(스크럽 float) 여부 결정.

**총 예상: 6~8주.** 범위를 줄여야 하면 빼는 순서: P2 → Lab 변수 조절 → 카드 Inspect(케이스 스터디 글로 대체).

## 8. 초안 대비 주요 변경

| 초안 | 최종 | 근거 |
|---|---|---|
| P0 3개 동시 | 단계별로 하나씩 끝까지 | Codex: 각각이 독립 프로젝트 규모 |
| Inspect = FPS·바운딩박스 나열 | 단계 스크럽 + 제스처 재생 + 해설 | Codex: 정보량보다 이해 / 사용자: 누구나 이해하는 해설 |
| Vite MPA + SPA 폴백 | Astro 정적 + 교차 문서 VT, 드래그는 프리뷰 시트로 분리 | Codex: 이중 상태 모델, `[slug]` 빌드 누락 |
| GL 히어로 P0 → (Codex) 검증 후 선택 | **스파이크 후 정식 P0, 두 번째 대표작** | 사용자: 핵심 능력 = 그래픽/셰이더 |
| WebGPU/TSL 기본 | TSL 우선, 스파이크에서 raw WebGL2와 비교 후 확정, 양쪽 백엔드 검증 | Codex: 폴백 동등성 미보장, "10~100x"는 근거 아님 |
| 파티클로 흩어지는 이름 | 단계로 분해 가능한 잉크/흐름 셰이더 | 흔한 표현 회피 |
| Lenis, 단일 rAF 강제 | Lenis 제외, 공유 시간 + 업데이트 순서 | Codex |
| 프로토타입 "추출" | 로직 참고해 재작성 | Codex: iframe 주입 구조 |
| 3주 | 6~8주(GL 승격 반영) | |

## 9. 남은 결정 (작업 중 확정)

- 히어로 셰이더의 시각 방향: 잉크/흐름 외 후보(굴절, 반응-확산 등)는 스파이크 1~2일 안에 2~3개 스케치로 비교.
- 워드마크 디자인(직접 제작 vs 서체 기반 SDF).
- `projects.json`의 AI 프로젝트들은 P2 노트로 이동 — 이의 없으면 이대로 진행.

## 참고

- [10 Best Award-Winning Websites of 2026 — Hon Tran](https://www.hontran.dev/blog/best-award-winning-websites-2026)
- [WebGL Website Examples 2026 — Hon Tran](https://www.hontran.dev/blog/webgl-website-examples)
- [Awwwards — Developer / Portfolio](https://www.awwwards.com/websites/developer/)
- [WebGPU + Three.js Migration Guide (2026) — Utsubo](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- [Three.js WebGPURenderer docs](https://threejs.org/docs/pages/WebGPURenderer.html)
- [MDN BCD — @view-transition](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/view-transition.json)
- [CSS scroll-driven animations cross-browser (2026)](https://www.buildmvpfast.com/blog/css-scroll-driven-animations-replace-js-2026)
- [GSAP becomes free — Webflow](https://webflow.com/blog/gsap-becomes-free)
- [Astro components](https://docs.astro.build/en/basics/astro-components/)
