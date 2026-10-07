# 실기기 체크리스트 (iPhone Safari)

최종 브랜치(Phase 7) 기준으로 **한 번에 끝까지** 돌 수 있게 정리한 목록입니다. 스파이크 페이지(`/spike/*`)는 이제 `npm run dev`에서만 열리고 프로덕션 빌드에는 들어가지 않습니다. 옛 스파이크 측정 절차는 `docs/spike/hero-spike.md`에 남아 있습니다.

## 0. 여는 법

```bash
npm run dev -- --host
# 출력의 "Network: http://<Mac의 LAN IP>:4321/" 를 iPhone Safari에서 연다 (같은 Wi-Fi)
```

- 프레임/발열 수치는 개발 서버(HMR, 번들 안 된 모듈) 대신 **빌드본**으로 보는 것이 정확합니다.
  `npm run build && npm run preview -- --host --port 4401` → `http://<Mac의 LAN IP>:4401/`
- 아래 `BASE`는 위 주소입니다. 모든 항목은 위에서 아래로 순서대로 진행하면 됩니다.
- 숫자를 바꿔 보고 싶으면 "어디서 조정" 열의 파일을 고치고 새로고침하면 됩니다(개발 서버는 저장 즉시 반영).
- 되돌리기 쉬운 순서: 먼저 **보기만** 하고(1~4), 그다음 **상수를 바꿔 보기**(조정 열).

기록 양식(항목마다 한 줄이면 충분):

```
기기/iOS/Safari 버전, 저전력 모드 on/off:
항목 번호: OK / 이상함 — 한 줄 설명 (가능하면 스크린샷)
```

## 1. 히어로 (홈 `BASE/`)

| # | 확인 | 무엇을 볼지 | 어디서 조정 |
|---|---|---|---|
| H1 | `BASE/` 첫 로드 | 정지 포스터가 먼저 보이고, 잠시 뒤 캔버스로 한 번에 부드럽게 넘어간다. 글자가 튀거나 깜빡이지 않는다 | `src/gl/boot.ts` `FADE_MS`(400), FCP 이후에 GL을 시작하는 대기 |
| H2 | **세로 스크롤 vs 잉크** | 히어로 위에서 세로로 쓸면 **페이지가 스크롤**된다. 가로로 쓸면 **잉크가 밀린다**. 글자 위에서 약 0.3초 꾹 누른 뒤 움직이면 어느 방향이든 잉크가 밀리고 그동안 스크롤되지 않는다 | `src/gl/hero/input.ts` `HOLD_MS`(300), `SLOP`(9), `src/components/HeroPoster.astro`의 `touch-action: pan-y` |
| H3 | 길게 누를 때 | iOS 확대경/텍스트 선택 메뉴/콜아웃이 뜨지 않는다 (뜨면 알려 주세요) | `HeroPoster.astro`의 `-webkit-touch-callout`, `user-select` |
| H4 | **HUD 프레임 시간** `BASE/?hud=1` | 문지르는 동안 `frame ms p50/p90/p95`, `tier`, `tier changes`, `ctx lost`(0이어야 함). 스크린샷 부탁드립니다 | `src/lib/core/quality.ts`(등급 전환 기준), `src/gl/hero/pipeline.ts` `TIER_SPECS`(해상도/DPR 상한) |
| H5 | 등급 고정 비교 `?hud=1&tier=low` / `mid` / `high` | 어느 등급까지 60 fps가 유지되는지. 자동 조절이 그보다 보수적이면 알려 주세요 | 위와 같음 |
| H6 | **발열(3분)** | 3분 연속 문지른 뒤 기기가 뜨거워지는지, HUD `p95`가 올라가는지 | `TIER_SPECS`의 `dpr`(mid 1.5, high 2), 시뮬 해상도 |
| H7 | **가장자리 스와이프(뒤로가기) 충돌** | 화면 왼쪽 끝에서 오른쪽으로 쓸 때 Safari 뒤로가기와 잉크 입력이 충돌하지 않는다 | (입력 경계는 `input.ts`; 필요하면 가장자리 20px 무시를 추가) |
| H8 | **크로스페이드** | 첫 로드에서 포스터 → 캔버스 전환 중 글자 위치가 어긋나지 않는다 (SVG 포스터와 SDF가 같은 외곽선) | `scripts/bake-sdf.mjs`, `HeroPoster.astro` |
| H9 | 라이트/다크 전환 | 페이지를 연 채로 설정 > 디스플레이에서 바꾸면 잉크 색이 따라 바뀐다 | `src/gl/hero/theme.ts` |
| H10 | 동작 줄이기 | 켜고 새로고침: 캔버스가 만들어지지 않고 정지 포스터만 보인다. Inspect를 켜면 정지 이미지 단계 해설이 나온다 | `src/gl/boot.ts` (reduced-motion 분기) |
| H11 | 회전/탭 전환/저전력 모드 | 가로↔세로 회전 후 캔버스가 깨지지 않는다. 다른 탭에 갔다 오면 이어서 돈다. 저전력 모드에서 프레임이 심하게 무너지지 않는다 | `src/gl/hero/index.ts`(resize/visibility) |
| H12 | GL 끄기 `BASE/?gl=none` | 정지 포스터만으로 "작품"이 되는지 (인상 평가) | — |

## 2. Inspect (홈의 `Inspect` 버튼, 단축키 I는 데스크톱만)

| # | 확인 | 무엇을 볼지 | 어디서 조정 |
|---|---|---|---|
| I1 | **토글** | 헤더의 Inspect 버튼이 한 번 탭으로 켜지고 꺼진다 (`aria-pressed`). 켜면 패널이 아래에 붙고 페이지 레이아웃이 크게 흔들리지 않는다 | `src/components/InspectToggle.astro`, `src/lib/inspect/toggle.ts` |
| I2 | **스크러버(히어로)** | 슬라이더를 손가락으로 끌 때 SDF → Warp → Flow → Ink가 140ms 디핑으로 바뀐다. 끌면서도 잉크는 계속 만져진다 (Flow 단계에서 화살표) | `src/gl/hero/inspect.ts` `FADE_MS`(140) |
| I3 | 슬라이더 조작성 | 엄지로 정확히 단계에 맞출 수 있는지, 이전/다음 버튼이 충분히 큰지 | `src/styles/inspect.css`(`.inspect-step`, `.inspect-range`) |
| I4 | 해설 읽힘 | 비개발자도 단계 차이를 이해하는지, 문장 길이/톤 | `src/gl/hero/inspect.ts` `STAGES[].explain` |
| I5 | Details 펼침 | 개발자용 수치(tier, 시뮬 그리드, frame ms)가 4회/초 이하로 갱신되고 화면이 번쩍이지 않는다 | `src/lib/inspect/panel.ts` |
| I6 | **카드 Inspect (시트가 열린 상태)** | 시트 안 바에 있는 Inspect를 켜면 도크가 시트를 밀어 올리지 않고 시트가 줄어든다. 닫은 뒤에는 **프레임이 있는 작은 리플레이 무대**에 궤적/닫기선/속도 화살표가 그려지고 페이지 글자 위에 겹치지 않는다. 재생 버튼/스크러버로 방금 제스처를 다시 본다 | `src/lib/cards/inspect.ts`(`VEC_PX_PER_PXMS`, `stageBox`), `src/styles/cards.css` `.cards-overlay.is-stage` |

## 3. 카드와 시트 (홈의 작업 카드 2개)

| # | 확인 | 무엇을 볼지 | 어디서 조정 |
|---|---|---|---|
| C1 | **열기 감각** | 카드 탭 → 카드가 시트로 커진다(FLIP). 끊기지 않고, 탭 직후 바로 반응한다. 빠르게 열고 닫기를 5번 반복해도 상태가 꼬이지 않는다 | `src/lib/cards/index.ts` `OPEN_CFG`(260, 0.86), `BLEND_CFG`, `QUICK_CFG` |
| C2 | **닫기 감각(풀다운)** | 시트 위쪽을 잡고 당긴다. 손가락을 따라오고, 놓으면 카드 자리로 날아간다 | `src/lib/cards/tuning.ts` `CLOSE_CFG`(300, 1) |
| C3 | **플릭 튜닝** | (a) 짧고 빠른 플릭 → 닫힌다 (b) 길게 천천히 당긴 뒤 놓기 → 닫힘/유지가 의도와 맞다 (c) 크게 당겼다가 되돌려 놓기 → 열린 채 유지. 어긋나면 아래 두 값을 조정 | `src/lib/cards/decision.ts` **`TAU_MS`(80)**, **`CLOSE_FRACTION`(0.35)**, `MIN_DISTANCE_PX`(16), `RUBBER_PX`(56). 속도 추정 창: `src/lib/motion/velocity.ts` `VELOCITY_WINDOW_MS`(90) |
| C4 | 스냅백 | 닫기선 미만으로 놓으면 손의 속도를 이어받아 자연스럽게 되돌아온다(약간의 바운스). 되돌아오는 중에 다시 잡아도 튀지 않는다 | `src/lib/cards/tuning.ts` `SNAP_CFG`(380, 0.78) |
| C5 | **시트 스크롤 ↔ 풀다운 경계** | 시트 본문을 스크롤하다가 맨 위에서 더 당길 때만 풀다운이 시작된다. 스크롤 중간에서는 절대 닫히지 않는다. 한 번의 터치로 스크롤→풀다운이 이어질 때 어색한 점프가 없다 | `src/lib/cards/index.ts`(claim 조건: scrollTop ≤ 0), `src/lib/motion/gesture.ts` `SLOP_TOUCH`(10) |
| C6 | **배경 스크롤 잠금** | 시트가 열려 있을 때 시트 밖/시트 가장자리를 쓸어도 뒤 페이지가 움직이지 않는다. 닫으면 원래 스크롤 위치로 돌아온다 | `src/lib/cards/index.ts`(배경 `inert`), `src/styles/global.css`(`scrollbar-gutter: stable`) |
| C7 | **주소창 높이 변화** | 시트를 열고 닫거나 스크롤할 때 Safari 주소창이 줄었다 늘었다 해도 시트가 어긋나지 않고 닫기선(시트 높이의 35%)이 틀어지지 않는다. **자동 테스트로는 못 보는 항목**(코드는 `visualViewport`를 쓰지 않음) | `src/lib/cards/index.ts` `measure()`, `src/styles/cards.css`(`--sheet-bottom`) |
| C8 | **탭 vs 드래그** | 시트의 링크/버튼 위에서 시작한 풀다운 끝에 링크가 눌리지 않는다. 시트를 연 직후 0.26초 안의 backdrop 탭은 무시된다 | `src/lib/motion/gesture.ts` `SLOP_*`, `tuning.ts` `SCRIM_GRACE_MS`(260) |
| C9 | **취소 경로** | 풀다운 도중 Safari가 제스처를 가져가는 경우(`pointercancel`: 가장자리 스와이프, 알림 센터) 시트가 열린 채 정상 복구되고 Inspect에 "Cancelled"로 나온다 | `src/lib/cards/index.ts`(pointercancel) |
| C10 | 닫기 수단 | 닫기 버튼, backdrop 탭, 브라우저 뒤로가기(제스처 포함), 모두 한 번에 닫히고 `#work/<slug>` 주소가 정리된다 | `index.ts`(pushState/popstate) |
| C11 | **상세 페이지로 이동(교차 문서 View Transition)** | 시트의 "Read the case study"를 누르면 카드의 그림/타이틀이 상세 페이지의 같은 요소로 이어진다 (iOS 18.2+). 뒤로 오면 홈 스크롤 위치가 유지된다. 미지원이면 일반 이동 | `src/styles/global.css`(`@view-transition`, `::view-transition-*`), `index.ts`의 `pageswap` 핸들러 |
| C12 | 직접 진입 | `BASE/#work/card-study`를 새 탭으로 열면 애니메이션 없이 시트가 열려 있다. `BASE/work/card-study/`는 정적 케이스 스터디 | `index.ts` |

## 4. Lab (`BASE/lab/`)

| # | 확인 | 무엇을 볼지 | 어디서 조정 |
|---|---|---|---|
| L1 | **Your turn(터치)** | 작은 폰 위에서 손가락으로 끌면 그 제스처가 녹화되어 구/신 규칙 양쪽에 재생된다. 페이지가 같이 스크롤되지 않는다(작은 폰 위에서) | `src/lib/lab/section.ts`(`bindPointerGesture`, 좌표 배율 `k`), `.lab-hit`의 `touch-action` |
| L2 | **단위 표기** | 숫자는 "phone px"(작은 폰을 390×720 화면으로 환산)이라고 안내문이 나온다. 직접 끈 거리와 표시 숫자의 비율이 이해되는지 | `src/lib/lab/copy.ts` |
| L3 | **세로로 쌓인 레이아웃** | 좁은 화면에서 두 폰이 위아래로 쌓이고, 재생/스크러버 바가 화면 위에 붙어 두 폰을 오가며 볼 때 계속 보인다. 차트 라벨이 서로 겹치지 않는다 | `src/styles/lab.css`(`.lab-bar` sticky) |
| L4 | τ 슬라이더 | 값을 바꾸면 표가 즉시 갱신되고 결과가 읽힌다. Reset이 80 ms로 돌린다 | `src/data/lab/decisions.ts` `tauNote`, `TAU_MS` |
| L5 | 동작 줄이기 | 켜면 재생 없이 최종 상태로 점프하고 궤적이 정적으로 그려진다 | `section.ts`(`mq`) |

## 5. 전체 확인 (마지막에 한 번)

- [ ] 줌: 핀치 확대가 막히지 않는다(`user-scalable=no` 없음). 확대 상태에서도 레이아웃이 깨지지 않는다
- [ ] 글자 크기 키우기(설정 > 디스플레이 > 텍스트 크기)에서 겹침/잘림이 없다
- [ ] 홈 → 케이스 스터디 → 뒤로 → Lab → 뒤로 흐름이 매끄럽다
- [ ] 콘텐츠: **mock 표식(`MOCK`)이 붙은 숫자/문장은 아직 실제 정보가 아닙니다.** `docs/content-todo.md`의 목록을 실제 내용으로 바꾸기 전에는 공개하지 않습니다
