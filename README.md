# 만든 게임들

정적 HTML 게임 모음. 폴더 하나가 게임 하나다.

```
/                     허브(게임 목록)  → https://<사이트>.netlify.app/
├─ index.html
├─ CLAUDE.md          ← 작업 전에 읽는 문서
├─ netlify.toml
├─ package.json       넷리파이 함수가 쓰는 의존성 하나뿐 (사이트는 빌드 없음)
├─ docs/art-guide.md
├─ tools/
│  ├─ smoke.js        「어쩐지 좋은 기분이 드는 밤」 로직 테스트
│  ├─ sheet.py        받은 그림을 스프라이트 시트에 붙이는 도구
│  ├─ bingo-smoke.js  커플 빙고 규칙 테스트
│  └─ bingo-dev.js    커플 빙고 로컬 서버 (방 상태는 메모리)
├─ netlify/functions/
│  ├─ bingo-core.mjs  커플 빙고 규칙 전부 (import 없음)
│  └─ bingo.mjs       넷리파이 껍데기 — Blobs 에 방을 저장한다
├─ evening-night/     게임 하나       → .../evening-night/
│  ├─ index.html
│  └─ art/            hero / mob / prop 스프라이트
└─ couple-bingo/      게임 하나       → .../couple-bingo/
   └─ index.html
```

## 게임 추가

1. 새 폴더 + 그 안에 `index.html`
2. 루트 `index.html` 에 카드 한 장 복사해 붙이고 `href` 수정
3. `git push` → 넷리파이가 자동 배포

## 넷리파이 설정

| 항목 | 값 |
|---|---|
| Build command | (비움) |
| Publish directory | `.` |
| Functions directory | `netlify/functions` |

`netlify.toml` 에 같은 내용이 있어서 보통 자동으로 잡힌다.
`main` 이 배포 대상. 실험은 다른 브랜치에서 하고 Branch deploys 로 확인 후 머지.

**빌드 명령은 여전히 없다.** 다만 `package.json` 이 생겨서, 넷리파이가 함수용 의존성
(`@netlify/blobs` 하나)만 설치한다. 정적 파일은 그대로 올라간다.

## 커플 빙고 — 서버가 필요한 부분

각자 폰에서 방 코드로 만나 번갈아 숫자를 부르는 1:1 빙고다. 떨어져 있어도 된다.

- 방 상태(누가 들어왔나 · 누구 차례 · 어떤 숫자가 나왔나 · 두 판)는 **넷리파이 함수**가
  Netlify Blobs 에 들고 있다. 엔드포인트는 `POST /api/bingo` 하나뿐이다.
- 판은 서버가 들고 있고 **상대 판은 응답에서 빼고 보낸다**. 상대에 대해 알려주는 건 줄 수까지다.
  그래야 서버가 줄을 직접 세서 승패를 판정할 수 있다.
- 클라이언트는 1.4초마다 상태를 **읽기만** 한다. 쓰기는 사용자가 뭘 눌렀을 때만.
  Blobs 에 트랜잭션이 없어서, 폴링이 쓰기를 하면 둘이 동시에 써서 한쪽이 묻힌다.
- 방은 12시간 지나면 없는 것으로 친다.

넷리파이에 올라간 주소로 열어야 한다. `file://` 이나 `python3 -m http.server` 로 열면
`/api/bingo` 가 없어서 "서버를 찾지 못했어요" 가 뜬다. 로컬에서 해보려면 아래 개발 서버를 쓴다.

## 로컬 확인

```bash
node tools/smoke.js            # 밤 게임 로직 회귀 테스트
node tools/bingo-smoke.js      # 커플 빙고 규칙 테스트 (npm install 없이 돈다)
node tools/bingo-dev.js        # 커플 빙고를 끝까지 돌려보는 서버 (8787)
python3 -m http.server 8000    # http://localhost:8000/evening-night/
```

`bingo-dev.js` 는 넷리파이 함수와 **같은 규칙 파일**을 쓰고 저장소만 메모리로 바꿔 끼운다.
브라우저 두 개(또는 폰 + 노트북)로 같은 주소를 열면 실제로 한 판 둘 수 있다.

`index.html` 을 더블클릭해 열면 `file://` 이라 그림이 안 뜬다(밤 게임은 돌아간다).
