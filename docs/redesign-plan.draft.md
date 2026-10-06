# foundy.dev 리뉴얼 계획 (초안 v0)

## 0. 현황
- Vite 7 + vanilla TS, GitHub Pages(main push → 배포). 컨텐츠: `public/data/status.json`, `projects.json`(AI 워크플로 프로젝트 5개).
- `public/prototypes/`에 App Store식 카드 덱 → 히어로 확장/풀다운 닫기 제스처 프로토타입 v1~v20.0.13 (40여 개 HTML) 축적. 이 자체가 "인터랙션을 집요하게 다듬는 개발자"라는 증거 → 버리지 말고 Lab 소재로 승격.

## 1. 리서치 요약 (2026)
- 수상작 공통 3요소: 뚜렷한 아트 디렉션 / 의도된(서사적) 모션 / 중급 모바일 60fps. "프레임 드랍하는 아름다움은 입상 못함".
- 예시: Minh Pham(Three.js가 콘텐츠를 보조), Mat Voyce(키네틱 타이포, GSAP 타임라인), By-Kin(연속된 하나의 표면 같은 전환), Iventions(스포트라이트 설치미술식 프로젝트 공개), fromanother(셰이더=아이덴티티), Bruno Simon(게임형).
- 기술: Three.js WebGPURenderer + TSL이 프로덕션 가능(WebGL2 자동 폴백), compute shader로 파티클 10~100x. CSS scroll-driven animation 3대 브라우저 중 Firefox는 플래그 → JS 폴백 필요. View Transitions(동일/교차 문서) 3대 브라우저 지원. GSAP 전 플러그인 무료.
- 흔해진 것(피할 것): 다크+네온+글래스모피즘, 3D 틸트 카드, 커스텀 커서만 있는 사이트, 무의미한 preloader, 스크롤 하이재킹.

## 2. 컨셉: "Inspectable Interface" — 스스로를 해부해 보여주는 포트폴리오
프론트엔드 개발자의 차별점은 "예쁜 결과물"이 아니라 "그걸 어떻게 만들었는가". 사이트 전체가 하나의 정교한 인터랙티브 오브젝트이면서, 언제든 **Inspect 모드**(키 `I` / 토글)로 전환하면 디자인 표면이 벗겨지고 엔지니어링 레이어(스프링 커브, 바운딩 박스, 셰이더 노드 그래프, FPS/프레임타임, 이벤트 스트림)가 실시간으로 드러남. 쉽게 볼 수 없는 지점은 이 "두 겹(Surface / Blueprint)" 구조.

톤: 라이트 기반의 에디토리얼(종이/잉크) + Blueprint 모드는 청사진 블루 라인. 네온 다크 클리셰 회피. 타이포 중심(가변 폰트 1개 + 모노 1개).

## 3. 정보 구조
1. **Hero** — 이름 "foundy"를 GPGPU 파티클/SDF 잉크로 렌더. 커서는 유체 힘(fluid), 스크롤 시 글자가 흩어져 다음 섹션의 그리드로 재조립.
2. **Work (Selected Projects)** — 기존 카드 덱 연구를 정식 컴포넌트로: 카드 → 공유 요소 전환으로 케이스 스터디 확장, 풀다운 제스처로 닫기(모바일 네이티브급 물리). 케이스 스터디는 별도 URL(교차 문서 View Transition + SPA 폴백).
3. **Lab** — 인터랙션 실험 아카이브. 프로토타입 v1→v20 진화를 타임라인 스크러버로 재생("한 인터랙션을 20번 고친 기록").
4. **Now / Status** — status.json 기반 현재 포커스, AI 워크플로(Claude Code, Discord 원격 에이전트 등)를 노드 그래프로 시각화(projects.json의 connections 활용).
5. **About + Contact** — 짧은 텍스트, 이메일 복사 마이크로인터랙션.
6. **Command Palette (⌘K)** — 섹션 이동, 테마/모드 전환, Inspect 토글, 사운드 on/off.

## 4. 시그니처 인터랙션 (우선순위)
- P0 Hero 잉크 파티클(TSL compute, WebGL2 폴백, 저사양은 정적 SVG 텍스트)
- P0 Work 카드 → 케이스 스터디 공유요소 전환 + 제스처 닫기
- P0 Inspect 모드 (DOM 오버레이 + 애니메이션 런타임 계측)
- P1 섹션 간 "하나의 표면" 전환 (파티클 재조립)
- P1 Lab 타임라인 스크러버
- P2 미세 사운드(Web Audio, 기본 off), 햅틱(navigator.vibrate)

## 5. 기술 스택
- 유지: Vite + TypeScript(프레임워크 없이) — 번들 최소, 런타임 완전 통제. 단, 케이스 스터디 정적 HTML을 위해 Vite MPA 구성.
- three (WebGPURenderer + TSL, WebGL2 폴백), GSAP(+ScrollTrigger, Flip, SplitText), Lenis(옵션, 네이티브 스크롤 유지 전제), 자체 스프링 물리 모듈(프로토타입에서 추출).
- 콘텐츠: `content/*.md` 또는 JSON → 빌드 시 HTML 생성.
- 배포: 기존 GitHub Pages 워크플로 유지.

## 6. 아키텍처
```
src/
  core/      (ticker 단일 rAF, store, router+view transitions, device tier 감지)
  gl/        (renderer, scenes/hero, passes, tsl nodes)
  motion/    (spring, gesture(pointer events), timeline helpers)
  inspect/   (overlay, probes, fps graph)
  sections/  (hero, work, lab, now, about)
  ui/        (cmdk, cursor, toast)
pages/work/[slug].html
```
- 단일 rAF 티커가 GL/GSAP/스프링을 모두 구동 → Inspect 모드가 이를 계측.
- 디바이스 티어: high(WebGPU) / mid(WebGL2, DPR≤1.5) / low(정적) — GPU 벤치 + `deviceMemory` + `prefers-reduced-motion`.

## 7. 품질 기준
- LCP < 2.0s(모바일 4G), 초기 JS < 120KB gz(three는 지연 로드), CLS 0, 중급 Android 55fps+.
- 접근성: 모든 컨텐츠는 GL 없이 DOM으로 존재(GL은 장식), 키보드 탐색, reduced-motion 시 모션 대체, 포커스 링, 명도 대비 AA.
- SEO/OG: 페이지별 OG 이미지.

## 8. 단계별 로드맵
- Phase 0 (1일): 초기화 — 기존 코드/프로토타입은 `archive/legacy` 브랜치 또는 태그로 보존, main 정리, 디자인 토큰/폰트 결정.
- Phase 1 (3~4일): 코어(티커, 라우터, 티어 감지) + 정적 마크업 전 섹션 + 타이포/레이아웃. 이 상태로도 완성된 사이트.
- Phase 2 (4~5일): Hero GL + 스크롤 재조립.
- Phase 3 (4일): Work 카드/케이스 스터디 전환 + 제스처.
- Phase 4 (3일): Inspect 모드, ⌘K.
- Phase 5 (2일): Lab, Now 그래프.
- Phase 6 (2일): 성능/접근성 패스, 실기기 QA, 배포.

## 9. 리스크
- 범위 과다 → Phase 1 결과만으로도 배포 가능하게 설계.
- WebGPU 브라우저 편차 → 폴백 매트릭스 + 실기기 테스트.
- 프로젝트 콘텐츠 부족(현재 AI 워크플로 5개) → 케이스 스터디 2~3개만 깊게.
