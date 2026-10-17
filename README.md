# 만든 게임들

정적 HTML 게임 모음. 폴더 하나가 게임 하나다.

| 폴더 | 게임 | 서버 |
|---|---|---|
| `evening-night/` | 어쩐지 좋은 기분이 드는 밤 — 세 살 아이와 같이 하는 횡스크롤 | 없음 |
| `couple-bingo/` | 커플 빙고 — 번갈아 숫자를 불러 3줄 먼저 | `/api/bingo` |
| `couple-balance/` | 이심전심 — 둘이 동시에 고르고 같이 공개, 일치율 | `/api/balance` |
| `couple-baseball/` | 숫자야구 — 숨긴 숫자 세 개를 번갈아 맞히기 | `/api/baseball` |

```
/                       허브(게임 목록)  → https://<사이트>.netlify.app/
├─ index.html
├─ CLAUDE.md            ← 작업 전에 읽는 문서
├─ netlify.toml
├─ package.json         넷리파이 함수가 쓰는 의존성 하나뿐 (사이트는 빌드 없음)
├─ docs/art-guide.md
├─ netlify/
│  ├─ functions/        함수 껍데기 — 파일 하나가 함수 하나 (bingo · balance · baseball)
│  └─ lib/              규칙과 공용 코드 (import 없는 *-core.mjs, room-kit.mjs, blob-handler.mjs)
├─ tools/
│  ├─ smoke.js          밤 게임 로직 테스트
│  ├─ sheet.py          받은 그림을 스프라이트 시트에 붙이는 도구
│  ├─ bingo-smoke.js    커플 빙고 규칙 테스트
│  ├─ balance-smoke.js  이심전심 규칙 테스트
│  ├─ baseball-smoke.js 숫자야구 규칙 테스트
│  └─ couple-dev.js     커플 게임 셋을 로컬에서 돌리는 서버 (방 상태는 메모리)
├─ evening-night/       index.html + art/
├─ couple-bingo/        index.html
├─ couple-balance/      index.html
└─ couple-baseball/     index.html
```

## 게임 추가

1. 새 폴더 + 그 안에 `index.html`
2. 루트 `index.html` 에 카드 한 장 복사해 붙이고 `href` 수정
3. `git push` → 넷리파이가 자동 배포

둘이 각자 폰으로 하는 게임이면 `netlify/lib/room-kit.mjs` 위에 올린다.
`balance-core.mjs` 가 제일 짧은 예다. `setup` · `actions` · `view` · `finished` 넷만 쓰면 된다.

## 넷리파이 설정

| 항목 | 값 |
|---|---|
| Build command | (비움) |
| Publish directory | `.` |
| Functions directory | `netlify/functions` |

`netlify.toml` 에 같은 내용이 있어서 보통 자동으로 잡힌다.
`main` 이 배포 대상. 실험은 다른 브랜치에서 하고 Branch deploys 로 확인 후 머지.

**빌드 명령은 여전히 없다.** `package.json` 이 있어서 넷리파이가 함수용 의존성
(`@netlify/blobs` 하나)만 설치한다. 정적 파일은 그대로 올라간다.

## 커플 게임 — 서버가 필요한 부분

각자 폰에서 네 자리 방 코드로 만난다. 떨어져 있어도 된다. 방 상태는 넷리파이 함수가
Netlify Blobs 에 들고 있고, 클라이언트는 1.4초마다 **읽기만** 한다.

Blobs 에는 트랜잭션이 없어서 둘이 같은 문서를 동시에 쓰면 한쪽이 묻힌다.
그래서 이심전심 · 숫자야구는 공용 방(`room-kit.mjs`)을 쓰고, 둘이 같은 순간에
누르는 행동(고르기 · 비밀 숫자 정하기)은 **각자 자기 문서에만** 쓴다.
같은 조건에서 공용 문서 하나로 하면 50번 중 46번 한쪽이 사라졌다.

상대의 비밀(빙고 판 · 이심전심 답 · 야구 숫자)은 공개할 때가 되기 전엔
**서버가 응답에 아예 안 넣는다.** 화면에서 숨기는 게 아니다.

넷리파이에 올라간 주소로 열어야 한다. `file://` 이나 `python3 -m http.server` 로 열면
`/api/...` 가 없어서 "서버를 찾지 못했어요" 가 뜬다. 로컬에서는 아래 개발 서버를 쓴다.

## 로컬 확인

```bash
node tools/smoke.js            # 밤 게임 로직 회귀 테스트
node tools/bingo-smoke.js      # 커플 빙고 규칙
node tools/balance-smoke.js    # 이심전심 규칙
node tools/baseball-smoke.js   # 숫자야구 규칙     ← 셋 다 npm install 없이 돈다
node tools/couple-dev.js       # 커플 게임 셋을 끝까지 돌려보는 서버 (8787)
python3 -m http.server 8000    # http://localhost:8000/evening-night/
```

`couple-dev.js` 는 넷리파이 함수와 **같은 규칙 파일**을 쓰고 저장소만 메모리로 바꿔 끼운다.
브라우저 두 개(또는 폰 + 노트북)로 같은 주소를 열면 실제로 한 판 할 수 있다.

`index.html` 을 더블클릭해 열면 `file://` 이라 그림이 안 뜬다(밤 게임은 돌아간다).
