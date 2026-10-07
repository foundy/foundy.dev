# 카드 연구 노트 (legacy v1 → v20에서 뽑은 UX 교훈)

> Phase 5에서 `src/lib/{motion,cards}/`를 새로 쓰면서 `legacy-v1` 태그의 프로토타입(`public/prototypes/card-deck-v*.html`)에서 **동작 의도만** 읽어 옮긴 메모. 코드는 이식하지 않았다(프로토타입 후반부는 iframe 안에 iframe을 겹치고, 부모가 `setInterval(300ms)` + `MutationObserver`로 DOM을 계속 덧칠하는 구조). Phase 6 Lab이 "구 규칙 vs 신 규칙" 비교를 만들 때 참고한다.

## 버전 흐름 (파일명으로 본 서사)

| 구간 | 무엇이 바뀌었나 |
|---|---|
| v1–v7 | 덱 + 상세 화면. 카드와 상세가 각자의 DOM |
| v8–v10 | **App Store식 shared hero**: 카드가 그대로 커져서 상세의 hero가 된다 (v9: hero scale) |
| v11–v14 | 세로 상세, **pull-down으로 바로 닫기**. v13 상태 버그, v14 "no gap"(당길 때 아래로 빈틈) 수정 |
| v15–v17 | 상세를 레이아웃 애니메이션이 아니라 **transform**으로. v17에서 App Store 흐름으로 통합 |
| v18.x | Pointer 제스처 정리. 더블탭 줌 차단(v18.0.1), 빠른 버튼(.2), UI 텍스트 선택 차단(.3), **닫을 때 높이 버그**(.4), **close hero first**(.5) |
| v19.x | 카드를 body 레이어로 "승격(promoted)"해서 덱의 스택/클립에서 분리 |
| v20.0.x | 이미지, 제스처 닫기 수정(.3), 덱 프레임 닫기(.4–.5), pull-down 탭 오작동(.6), **safe tap scrim**(.7), hero only close(.9–.10), **repeatable hero close**(.11), 닫는 중 타이틀 CSS(.12), reveal 부드럽게(.13) |

## 교훈 → 이번 구현에서의 대응

1. **Hero를 키워서 상세로 (shared element).** 카드와 상세가 다른 두 요소면 어딘가에서 튄다. → 카드의 그림과 타이틀을 시트의 같은 요소로 FLIP(transform만). 상세 페이지로 넘어갈 땐 같은 `view-transition-name`을 시트 쪽으로 옮겨서 이어 붙인다(`pageswap`).
2. **닫을 때는 hero가 먼저 카드로 돌아가고 본문은 그동안 사라진다 (v18.0.5 close hero first).** 본문까지 같이 줄이면 텍스트가 일그러지고 hero가 늦게 도착한다. → 본문/바(`opacity`)는 진행도 0.4 이하에서 이미 0, 그림과 타이틀이 카드 자리로 이동.
3. **닫기 직전 사각형을 한 번만 재고 고정한다 (v20.0.9–.11 hero only close, repeatable).** 프로토타입은 닫는 순간 hero를 클론하고 카드의 `getBoundingClientRect()`를 px로 박아서(`width/height/translate3d`) 이후 레이아웃 변화(스크롤, 리사이즈, 본문 제거)에 영향받지 않게 했다. 그리고 "다시 열었다 닫아도" 같은 동작이 나오도록 매번 새로 클론. → `measure()`는 전환이 시작될 때 1회만 읽고 프레임마다 읽지 않는다. 닫기 시작 시 현재 자세(당겨진 위치/축소)를 `Ts0`로 얼리고 거기서 카드까지 보간한다. 닫는 도중 다시 열기(반전)도 같은 값에서 이어진다.
4. **당겨서 닫기는 스크롤 최상단에서만 (v20.0.3).** 프로토타입은 `touchstart` 시점에 `scrollTop>0`이면 무시, `dy>0 && scrollTop<=0`일 때만 `touchmove`를 `preventDefault`. 풀다운 진행도는 `dy/170`, 축소는 `1 - p*0.09`, 닫힘 판정은 **`dy > 110` 고정 거리**(속도 무시 = v1~v11의 약점). → 같은 조건을 Pointer Events로: 눌렀을 때와 판정 시점 둘 다 `scrollTop<=0`, 아래로, 세로 우세일 때만 claim. claim 후 첫 cancelable `touchmove`에서 `preventDefault`(안 하면 브라우저가 스크롤을 가져가고 `pointercancel`이 온다). 판정은 거리가 아니라 **투영 거리**(`decision.ts`).
5. **탭과 드래그를 안전하게 가른다 (v20.0.6 pulldown tap fixes).** 당긴 뒤 손을 뗄 때 클릭이 링크/버튼에 새는 문제. → 슬롭(마우스 8px / 터치 10px) 전에는 탭, 넘으면 드래그. claim된 드래그가 끝나면 이어지는 `click`을 한 번 삼킨다. 마우스는 텍스트/링크/버튼 위에서 시작한 드래그를 가져가지 않는다(텍스트 선택 보존).
6. **Scrim은 안전하게 (v20.0.7 safe tap scrim).** 보이지 않는 scrim이 탭을 먹거나(`.scrim:not(.visible){pointer-events:none}`로 막음), 여는 탭의 고스트 클릭이 곧바로 scrim을 눌러 닫는 문제. → scrim 탭은 열린 지 260 ms 안에는 무시. 닫히는 중에도 scrim은 입력을 받지만 상태 기계가 중복 close를 무시한다.
7. **`transform-origin`을 상황마다 바꾸지 않는다 (v20.0.7).** 프로토타입은 승격 카드 `top left`, 당기는 중 `center top`으로 계속 덧씌웠다. → 패널은 항상 `0 0`, 당김(축소)은 계산으로 위치를 보정.
8. **한 transform은 한 소유자.** 덧칠 방식(CSS 전환 + 주입된 인라인 transform + 클래스 토글)이 버그의 대부분이었다. → 패널의 `transform`은 스프링 루프만 쓴다. 정지 상태에서는 인라인 값을 지워 평범한 레이아웃으로 돌린다.
9. **`user-scalable=no` / 더블탭 줌 차단은 계승하지 않는다 (v18.0.1).** 확대는 접근성 요건. → 시트 안은 `touch-action: pan-y`, 뷰포트는 확대 허용.
10. **짧고 빠른 플릭을 놓치지 않는다.** v1~v11은 거리만 봤다(case study의 "31% missed closes"). → `projected = distance + velocity × 80 ms`가 시트 높이의 35%를 넘으면 닫는다.

## Phase 6 Lab에 넘기는 것

- 같은 입력(`Recording`)을 다른 판정 함수에 재생하면 된다. 구 규칙 = `{tau: 0, fraction: 0.38, minDistance: 0}`(거리만), 현 규칙 = 기본값. `decideClose(input, params)`와 `replay(recording)`이 이미 그 형태다 (`src/lib/cards/decision.ts`, `src/lib/motion/recorder.ts`).
- 조절 변수 후보: `TAU_MS`(투영 시간), `CLOSE_FRACTION`, 속도 윈도우(`VELOCITY_WINDOW_MS`), 고무줄 상수(`RUBBER_PX`).
- 프로토타입의 다른 판정값(참고): 가로 스와이프 덱 전환 `dx/150`, 닫기 `dy>110`, 풀다운 스케일 `0.09`, 닫기 reveal 전환 170 ms `cubic-bezier(.22,1,.36,1)`.
