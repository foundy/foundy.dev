# 실기기 체크리스트 (iPhone Safari 등)

(스파이크 페이지 안내) 스파이크 페이지는 어디에도 링크되어 있지 않고 `noindex`입니다. 배포 전이라면 아래 중 하나로 열어 보세요.

- 같은 Wi-Fi의 Mac에서 `npm run build && npx astro preview --host --port 4401` 실행 후 `http://<Mac의 LAN IP>:4401/spike/...`
- 또는 PR 브랜치를 임시 배포한 주소(있다면)에서 `/spike/...`

아래 `BASE`는 위 주소(예: `http://192.168.0.10:4401`)입니다. 모든 URL에 `hud=1`이 들어 있어 화면 좌하단에
백엔드, 프레임 시간(중앙값/p95/최대), 긴 프레임 수, SDF 베이크/초기화/첫 프레임 시간이 표시됩니다.
스크린샷(HUD가 보이게)을 남기면 가장 좋습니다.

## 0. 프로덕션 히어로 (Phase 3, 이걸 먼저 봐 주세요)

스파이크 페이지(아래 1~5절)는 참고용으로 남아 있고, **실제 확인 대상은 홈(`/`)의 히어로**입니다. 스택은 raw WebGL2, look은 ink로 확정됐습니다.

### 열기 (LAN)

```bash
npm run dev -- --host            # Network: http://<Mac의 LAN IP>:4321/ 이 출력됩니다
# 프레임/발열 수치를 볼 때는 개발 서버 대신 빌드본을 권장(개발 서버는 HMR/툴바 오버헤드가 있음):
npm run build && npm run preview -- --host --port 4401
```

아래 `BASE`는 위 주소(예: `http://192.168.0.10:4321`)입니다. iPhone과 Mac이 같은 Wi-Fi여야 합니다.

| # | URL | 보려는 것 |
|---|---|---|
| P1 | `BASE/` | 기본 동작: 정지 포스터가 먼저 보이고, 잠시 뒤 캔버스로 부드럽게 넘어간다 |
| P2 | `BASE/?hud=1` | 같은 화면 + 좌하단 HUD(tier, 캔버스/시뮬레이션 해상도, 프레임 p50/p90/p95, 준비 시간, 컨텍스트 로스트 횟수, GPU 문자열). **스크린샷 부탁드립니다** |
| P3 | `BASE/?hud=1&tier=low` / `tier=mid` / `tier=high` | 등급 고정(자동 조절 끔). 어느 등급까지 60fps가 유지되는지 비교 |
| P4 | `BASE/?hud=1&stage=sdf` / `warp` / `flow` / `composite` | 단계별 단독 출력(Inspect 예고편). `flow`는 문지르면 속도장 화살표가 보인다 |
| P5 | `BASE/?gl=none` | GL 끄기(정지 포스터만). 정지 포스터가 "작품"으로 충분한지 |
| P6 | `BASE/?gl=webgl2` | GL 강제(Save-Data와 유휴 대기를 무시). 기본 경로와 같은 렌더러 |
| P7 | `BASE/?hud=1&t=3` | 셰이더 시계 고정(스크린샷 비교용) |

### 입력 규칙 (확정 사항, 이게 의도대로 느껴지는지 확인)

- **세로로 쓸면 페이지가 스크롤된다.** 히어로 위여도 그렇다(`touch-action: pan-y`).
- **가로로 쓸면 잉크가 밀린다.**
- **글자 위에서 약 0.3초 꾹 누른 뒤 움직이면** 어느 방향이든 잉크가 밀리고, 그동안 페이지는 스크롤되지 않는다(롱프레스).
- 데스크톱: 마우스를 올려 움직이면 약하게, 버튼을 누르고 끌면 강하게 밀린다.
- 놓은 뒤 약 1~3초 안에 잉크가 "foundy"로 부드럽게 돌아오고, 약 6.5초 뒤 렌더 루프가 완전히 잠든다(HUD가 `idle`).

### iPhone에서 특히 볼 것

1. HUD의 `frame ms p50/p90/p95` (문지르는 동안), `tier`가 바뀌었는지(`tier changes`), `ctx lost`가 0인지.
2. **롱프레스 후 이동 시 페이지가 같이 스크롤되지 않는가.** 이건 Playwright(Chromium)로만 검증했고 iOS Safari는 못 봤습니다. 스크롤이 같이 되거나 길게 누를 때 확대경/메뉴가 뜨면 알려 주세요.
3. 가로 드래그가 화면 가장자리에서 Safari 뒤로가기 제스처와 충돌하지 않는지.
4. 포스터 -> 캔버스 전환에서 글자가 튀거나 한 번 깜빡이지 않는지(특히 첫 로드).
5. 라이트/다크 전환(설정 > 디스플레이)을 페이지가 열려 있는 채로 해 봤을 때 잉크 색이 따라 바뀌는지.
6. 저전력 모드, "동작 줄이기"(켜면 캔버스가 아예 만들어지지 않고 정지 포스터만 보여야 함), 가로/세로 회전, 탭 전환 후 복귀.
7. 3분 연속 문지른 뒤 발열/프레임 저하(`p95`), 그리고 HUD `canvas` 크기(DPR 상한 1.5 적용 여부).

보고 양식은 6절을 그대로 쓰되 URL 대신 P1~P4 번호를 적어 주세요.

## 1. 기본 3종 (같은 look = ink)

| # | URL | 보려는 것 |
|---|---|---|
| 1 | `BASE/spike/raw/?hud=1` | raw WebGL2 (백엔드는 항상 webgl2) |
| 2 | `BASE/spike/three/?hud=1` | three WebGPURenderer. iOS 26 Safari면 `backend=webgpu`가 기대값 |
| 3 | `BASE/spike/three/?hud=1&gl=webgl2` | three에서 WebGL2 백엔드 강제 |

각 페이지에서:

1. 캔버스 위에서 손가락으로 5초 정도 계속 문지른다(워드마크 위를 크게 왕복).
2. HUD의 `frame ms med / p95 / max`, `long >16.7 / >33`, `first frame`, `init`을 적는다.
3. 문지르기를 멈추고 1~2초 뒤 글자가 다시 "foundy"로 돌아오는지 본다(복원 속도, 번짐 잔상).
4. `backend=`가 기대와 다르면(예: webgpu가 아니라 webgl2) 그대로 적는다. HUD 아래쪽 줄의 GPU 문자열도 적는다.

## 2. 비주얼 3종 (raw 전용, 같은 기기에서 비교)

| look | URL |
|---|---|
| ink (잉크 번짐) | `BASE/spike/raw/?hud=1&look=ink` |
| refract (유리 굴절) | `BASE/spike/raw/?hud=1&look=refract` |
| riso (2색 오버프린트) | `BASE/spike/raw/?hud=1&look=riso` |

적을 것: 어느 look이 가장 foundy답게 느껴지는지(1순위), 터치했을 때 가장 만지고 싶은 것, 정지 상태에서 "foundy"가 즉시 읽히는지, 프레임 시간(위와 동일).

## 3. 단계별 화면 (파이프라인 해부)

`BASE/spike/raw/?hud=1&stage=sdf`, `...&stage=warp`, `...&stage=flow`, `...&stage=composite`
(`three`에도 같은 쿼리가 먹습니다.) 각 단계가 의도대로 보이는지만 확인해 주세요. `flow`는 문지르면 속도장 화살표가 보입니다.

## 4. 해상도/발열 압박 테스트

- `BASE/spike/raw/?hud=1&dpr=1` 과 `...&dpr=3` 비교(기본 상한은 1.5): dpr=3에서 프레임이 무너지면 상한 1.5가 타당하다는 근거가 됩니다.
- `BASE/spike/raw/?hud=1&bench=1` : 페이지 로드 후 4초간 프레임을 연속으로 GPU 완료까지 기다리며 돌립니다(상한 없는 GPU 비용). 끝나면 HUD에 `bench (gpu-inclusive)` 줄이 추가됩니다(선택 사항). 이 값이 작을수록 GPU 여유가 큽니다.
- 3분간 계속 문지른 뒤 기기 발열/프레임 저하가 있는지(HUD의 p95/max) 기록.

## 5. 동작 확인(체크박스)

- [ ] 다른 탭으로 갔다가 돌아오면 이어서 부드럽게 돌아온다(탭이 숨겨진 동안 멈춤)
- [ ] 페이지를 아래로 스크롤해 캔버스가 화면 밖으로 나가면 HUD 하단이 `paused`가 된다(HUD는 캔버스 안에 있어서 다시 올려야 보임)
- [ ] 설정 > 손쉬운 사용 > 동작 > "동작 줄이기" 켜고 새로고침: 움직임 없이 정지된 한 장면(`reduced motion: static frame`)
- [ ] 화면을 가로/세로로 돌려도 캔버스가 깨지지 않는다
- [ ] 캔버스 위 세로 스크롤(스파이크는 `touch-action: none`이라 막힘; 프로덕션 홈은 `pan-y`로 해결, 0절 참고)

## 6. 보고 양식 (복사해서 채워 주세요)

```
기기/OS/Safari 버전:
저전력 모드: on/off
URL: ...
backend:
GPU 줄:
frame ms med/p95/max:
long >16.7 / >33:
init / first frame:
인상(복원 속도, 번짐, 읽힘):
```
