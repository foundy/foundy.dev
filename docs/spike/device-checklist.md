# 실기기 체크리스트 (iPhone Safari 등)

스파이크 페이지는 어디에도 링크되어 있지 않고 `noindex`입니다. 배포 전이라면 아래 중 하나로 열어 보세요.

- 같은 Wi-Fi의 Mac에서 `npm run build && npx astro preview --host --port 4401` 실행 후 `http://<Mac의 LAN IP>:4401/spike/...`
- 또는 PR 브랜치를 임시 배포한 주소(있다면)에서 `/spike/...`

아래 `BASE`는 위 주소(예: `http://192.168.0.10:4401`)입니다. 모든 URL에 `hud=1`이 들어 있어 화면 좌하단에
백엔드, 프레임 시간(중앙값/p95/최대), 긴 프레임 수, SDF 베이크/초기화/첫 프레임 시간이 표시됩니다.
스크린샷(HUD가 보이게)을 남기면 가장 좋습니다.

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
- [ ] 캔버스 위에서 세로 스크롤이 필요하면 불편한지(스파이크는 `touch-action: none`이라 캔버스 위에서는 스크롤이 막힘. 정식 구현에서는 처리 필요)

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
