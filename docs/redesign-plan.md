# foundy.dev 리뉴얼 최종 계획 (v1)

> 2026-10-06 · Claude 초안 → Codex(codex-cli 0.160.1) 검토 → 취합.
> 원본: `docs/redesign-plan.draft.md`(초안), `docs/redesign-plan.codex-review.md`(검토 원문)

---

## 1. 한 줄 요약

**"만져보고, 해부해 보는 포트폴리오."**
방문자가 foundy가 만든 인터랙션을 직접 조작하고, 그 순간 **Inspect 레이어**로 자신의 제스처가 어떻게 해석됐는지(속도, 궤적, 판정 근거)와 그 설계를 왜 그렇게 했는지(구버전과 비교)를 확인한다. 화려한 GL은 이 경험을 돕는 조연이다.

## 2. 리서치 요약 (2026)

| 관찰 | 계획에 반영 |
|---|---|
| 수상작 공통: 뚜렷한 아트 디렉션 · 서사가 있는 모션 · 중급 모바일에서 끊김 없음 (By-Kin, Mat Voyce, Iventions, Minh Pham, fromanother) | 효과 개수보다 **하나의 조작 방식**을 끝까지 다듬기 |
| Minh Pham: Three.js가 콘텐츠를 **보조**. fromanother: 셰이더 자체가 아이덴티티 | GL은 컨셉에 기여할 때만 (히어로는 검증 후 도입) |
| 다크+네온, 글래스모피즘, 3D 틸트 카드, 커스텀 커서만 있는 사이트, 파티클 이름 = 이미 흔함 | 의도적으로 피함 |
| Three.js WebGPURenderer + TSL 프로덕션 사용 가능, WebGL2 폴백 존재 (단 기능·성능 동등은 보장 안 됨) | 히어로는 WebGL2 소형 셰이더 또는 SVG부터 검토 |
| CSS scroll-driven: Chrome·Safari 지원, Firefox 플래그 / **교차 문서 View Transition: Chrome 126+, Safari 18.2+, Firefox 미지원** | 점진적 향상. 미지원은 일반 이동으로 폴백 |
| GSAP 전 플러그인 무료 | 필요한 것만 선택 사용 |

## 3. 컨셉 & 아트 디렉션

- **핵심 자산:** `public/prototypes/`의 카드 덱 → 히어로 확장 → 풀다운 닫기 연구(v1 → v20.0.13, 40여 회 반복). "한 인터랙션을 40번 고친 사람"이라는 서사가 가장 강한 차별점.
- **Inspect = 계측 대시보드가 아니라 "설계 해설".** FPS·바운딩 박스 나열 대신, 선택한 인터랙션의 **원인 → 판정 → 결과**를 보여준다.
  - 예: "손을 뗀 순간 속도 1.8px/ms + 이동 92px → 닫기. v12에서는 거리만 봐서 짧고 빠른 스와이프가 취소됐다."
- **톤:** 라이트 에디토리얼(종이/잉크) + Inspect 시 블루프린트 라인. 단, 색이 아니라 **조작 방식과 편집 관점**이 정체성. 가변 산세리프 1 + 모노 1.
- **아이덴티티 타이포:** "foundy" 워드마크를 소수 부품(SVG 마스크/패스)으로 설계 → Inspect 시 조립 구조가 드러남. GL 없이도 성립.

## 4. 정보 구조

1. **Hero** — 워드마크 + 한 문장 포지셔닝. 첫 화면에서 바로 만질 수 있는 작은 조작 요소(카드 한 장이 살짝 고개를 내미는 식).
2. **Work** — 카드 덱. 탭/드래그로 **프리뷰 시트**(같은 문서, 드래그로 닫기) → "전체 케이스 스터디" 링크로 **정적 상세 페이지** 이동(교차 문서 View Transition).
3. **Lab** — 40개 파일 목록이 아니라 **핵심 결정 4개**로 편집. 같은 기록 입력을 구버전/개선버전에 재생해 비교. 설계 변수 1개(감쇠 or 닫기 임계값)를 직접 조절.
4. **About / Now / Contact** — 짧은 소개, 현재 포커스(status.json 갱신), 이메일 복사 마이크로인터랙션.
5. (P2) ⌘K 커맨드 팔레트, Now 연결 그래프, 사운드.

**케이스 스터디 형식:** 문제 → 내 책임 → 선택과 대안 → 실제 동작(실행 가능한 데모) → 결과와 한계.
대표작 2개를 깊게. 후보: ① 카드 인터랙션 연구 자체 ② AI 워크플로(Claude Code 개발 환경 / Discord 원격 에이전트) — 단 "도구 사용법"이 아니라 **프론트엔드/시스템 설계 판단** 중심으로. 회사 작업은 공개 범위·익명화 먼저 확정.

## 5. 기술 스택 (결정)

| 영역 | 결정 | 이유 |
|---|---|---|
| 사이트 기반 | **Astro (정적 출력) + vanilla TS 스크립트** | 정적 페이지·콘텐츠 컬렉션·메타/OG를 맡기고, 인터랙션 코드는 프레임워크 없이 직접 소유. Vite MPA는 `[slug]` 생성 빌드를 직접 짜야 함 |
| 내비게이션 | 정적 상세 URL + 교차 문서 View Transition, 미지원은 일반 이동 | SPA 폴백 이중 관리(히스토리·스크롤·포커스) 회피 |
| 드래그 상세 | 홈 내부 **프리뷰 시트**로 한정(같은 문서, URL 해시 동기화 정도) | "드래그로 중단 가능한 상세"와 "문서 이동"의 상태 모델을 분리 |
| 제스처/스프링 | **자체 모듈**(시간 기반 물리, Pointer Events, 속도 추정) — 프로토타입 *로직을 참고해 상태 모델부터 재작성* | 프로토타입은 iframe 주입·MutationObserver·300ms 반복 주입 구조라 그대로 이식 불가 |
| 시퀀스 | 간단 전환은 CSS/WAAPI, 복합 시퀀스만 GSAP | 같은 transform을 두 엔진이 쓰지 않도록 소유권 분리 |
| 스크롤 | 네이티브 스크롤. **Lenis 제외**(필요 증명 시 도입) | |
| GL | P1 히어로 실험에서 결정: SVG/WebGL2 소형 셰이더 우선, compute가 작품의 핵심일 때만 WebGPU/TSL | 폴백 방문자도 핵심 경험 유지 |
| 배포 | GitHub Pages 워크플로 유지(`dist` 경로만 Astro에 맞춤) | |

### 아키텍처 스케치
```
src/
  content/work/*.md          # 케이스 스터디 (콘텐츠 컬렉션)
  pages/index.astro
  pages/work/[slug].astro
  pages/lab.astro
  lib/motion/  spring.ts gesture.ts velocity.ts recorder.ts   # 시간 기반, 기록/재생 가능
  lib/inspect/ overlay.ts probes.ts explain.ts               # 설계 해설 레이어
  lib/core/    clock.ts (공유 시간, 업데이트 순서) quality.ts (품질 등급)
  components/  CardDeck, PreviewSheet, InspectToggle, Wordmark ...
```
- **제스처 기록기(recorder)** 가 핵심 인프라: 방문자의 제스처를 기록 → Inspect에서 재생 → Lab에서 구/신 버전에 동일 입력 재생. 한 모듈이 세 기능을 지탱.
- DOM 읽기/쓰기 분리, 화면 밖 일시정지, 프레임 수가 아닌 경과 시간 기반 업데이트.
- 렌더 백엔드(WebGPU/WebGL2/없음)와 품질 등급(high/mid/low)을 분리. 초기 벤치 없이 보수적으로 시작 → 실제 프레임 시간 관찰로 조절. `prefers-reduced-motion`은 성능 판정과 별개인 **사용자 선호**로 취급.

## 6. 품질 기준

**성능**
- LCP < 2.0s(모바일 4G), CLS 0, **INP ≤ 200ms**
- 첫 화면 총 전송량·컴파일·GPU 초기화 비용을 따로 측정 (초기 JS 수치만으로 판단 금지)
- 평균 FPS 대신 **지정 기기의 프레임 시간 분포/긴 프레임**: 카드 최초 열기, 빠른 반복 열고닫기, 수 분 사용 후 발열
- Inspect 자체 오버헤드 측정

**접근성**
- viewport 확대 금지 제거(프로토타입의 `user-scalable=no` 계승 금지)
- 시트: 명시적 닫기 버튼, Escape, 포커스 복원, 배경 `inert`, 스크롤 복원. 풀다운은 시트 스크롤 최상단에서만, 텍스트 선택·링크 탭·브라우저 제스처와 충돌 금지
- Inspect: `I` 단축키는 입력 중 비활성, 모바일엔 보이는 토글. 고빈도 로그는 스크린리더에 낭독 안 함. reduced-motion에서도 해설·비교 기능 유지
- 모든 콘텐츠는 모션/GL 없이 DOM으로 읽힘. 대비 AA

**테스트 기기 (확정 필요):** 예) iPhone(Safari 최신), 중급 Android(Chrome), MacBook Chrome/Safari/Firefox

## 7. 로드맵

| 단계 | 기간 | 작업 | 통과 기준 |
|---|---|---|---|
| 0 | 2~3일 | 기존 코드·프로토타입을 `legacy` 태그/브랜치로 보존, main 초기화, 오픈 질문 확정, 대표작 2개 자료 수집 | 두 케이스의 역할·증거·핵심 문장 준비 |
| 1 | 4~6일 | Astro 셋업, 타이포/토큰, 정적 페이지 전체, 실제 콘텐츠, 상세 URL, OG | **모션 없이도 읽고 이해하고 연락 가능** → 이 시점에 배포 가능 |
| 2 | 5~8일 | 카드 덱 + 프리뷰 시트 + 제스처 기록기 + 그 인터랙션의 Inspect 1개 끝까지 | 빠른 반복 입력·취소·키보드·모바일 스크롤 안정 |
| 3 | 3~5일 | Lab: 핵심 결정 4개 편집, 동일 입력 구/신 비교, 변수 1개 조절 | 비교만으로 판단 차이가 이해됨 |
| 4 | 2~3일 (실험) | 히어로 후보(SVG 워드마크 조립 vs WebGL2 잉크) 프로토 | 컨셉 기여 + 기기 성능 확인 시에만 정식 구현 |
| 5 | 상시 + 3~5일 | 실기기 QA, 접근성, 성능, SEO/OG, 배포 | 직접 진입·뒤로가기·확대·모션 축소·GPU 실패 경로 통과 |
| P2 | 이후 | ⌘K, Now 그래프, 섹션 간 연결 전환, 사운드(기본 off), 햅틱 | — |

**총 예상: 콘텐츠 준비 후 4~6주.** 범위가 밀리면 가장 먼저 뺄 순서: P2 전체 → 히어로 GL → Lab 변수 조절.

## 8. 초안 대비 주요 변경 (Codex 검토 반영)

| 초안 | 최종 | 근거 |
|---|---|---|
| P0 3개(GL 히어로, 카드, 범용 Inspect) | P0 = 콘텐츠 2개 + 카드 1개 + 그 Inspect | 각각이 독립 프로젝트 규모 |
| Inspect = FPS·바운딩박스·노드그래프 | Inspect = 원인→판정→결과 설계 해설 + 방문자 제스처 재생 | 정보량보다 이해 |
| Vite MPA + SPA 폴백 | Astro 정적 + 교차 문서 VT, 드래그는 프리뷰 시트로 분리 | 이중 상태 모델 회피, `[slug]` 빌드 누락 |
| WebGPU/TSL 기본 | 히어로 실험 후 결정, SVG/WebGL2 우선 | 폴백 동등성 미보장, "10~100x"는 근거 아님 |
| Lenis, 단일 rAF 강제 | Lenis 제외, 공유 시간+업데이트 순서 | 필요 증명 전 도입 금지 |
| 프로토타입 "추출" | 로직 참고해 재작성 | iframe 주입 구조 |
| 3주 | 4~6주 | 모바일 예외·콘텐츠·AD 반복 |
| 성능 = 55fps/120KB | + INP, 프레임 분포, 전체 전송량, Inspect 오버헤드 | 평균은 끊김을 숨김 |

**Claude가 Codex와 다르게 판단한 점:** Codex는 첫 릴리스에서 드래그 상세를 미루라고 했지만, 카드 제스처는 이 사이트의 핵심 자산이므로 **홈 내부 프리뷰 시트**라는 좁은 범위로 P0에 남겼다. 정식 케이스 스터디는 정적 페이지로 분리해 Codex가 지적한 이중 상태 모델 문제를 피한다.

## 9. 착수 전 확정할 오픈 질문

1. 1순위 방문자: 채용 담당자 / FE 리드 / 의뢰인 / 어워드 심사자?
2. 성공 행동: 연락 / 이력서 / 코드 확인 / 실험 탐색?
3. 첫 30초에 증명할 능력: 인터랙션 설계 / 제품 구현 / 그래픽 / AI 워크플로?
4. 대표작 2개의 공개 가능한 결과·본인 기여가 있는가? (없으면 카드 연구를 대표작 1로)
5. 회사 작업 공개 범위·익명화 방식
6. Inspect 대상: 일반 방문자용 해설(추천) vs 개발자용 계측
7. 테스트 기기·브라우저 목록
8. 목표 출시일
9. 언어: 영문 단일 / 한·영 병기?

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
