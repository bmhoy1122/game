# 만든 게임들

정적 HTML 게임 모음. 폴더 하나가 게임 하나다.

```
/                     허브(게임 목록)  → https://<사이트>.netlify.app/
├─ index.html
├─ CLAUDE.md          ← 작업 전에 읽는 문서
├─ netlify.toml
├─ docs/art-guide.md
├─ tools/smoke.js
└─ evening-night/     게임 하나       → https://<사이트>.netlify.app/evening-night/
   ├─ index.html
   └─ art/            hero / mob / prop 스프라이트
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

`netlify.toml` 에 같은 내용이 있어서 보통 자동으로 잡힌다.
`main` 이 배포 대상. 실험은 다른 브랜치에서 하고 Branch deploys 로 확인 후 머지.

## 로컬 확인

```bash
node tools/smoke.js            # 로직 회귀 테스트
python3 -m http.server 8000    # http://localhost:8000/evening-night/
```

`index.html` 을 더블클릭해 열면 `file://` 이라 그림이 안 뜬다(게임은 돌아간다).
