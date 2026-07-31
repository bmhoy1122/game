# 만든 게임들

정적 HTML 게임 모음. 폴더 하나가 게임 하나다.

```
/                     허브(게임 목록)  → https://<사이트>.netlify.app/
├─ index.html
├─ netlify.toml
└─ evening-night/     게임 하나       → https://<사이트>.netlify.app/evening-night/
   ├─ index.html
   └─ art/            스프라이트 (hero / mob / prop)
```

## 게임 추가하는 법

1. 새 폴더를 만들고 그 안에 `index.html` 을 넣는다
2. 루트 `index.html` 에 카드 하나를 복사해 붙이고 `href` 를 새 폴더로 바꾼다
3. `git push` → 넷리파이가 알아서 배포한다

## 넷리파이 설정

깃허브 저장소를 연결한 뒤 아래 두 개만 맞추면 된다.

| 항목 | 값 |
|---|---|
| Build command | (비움) |
| Publish directory | `.` |

`netlify.toml` 이 이미 같은 내용을 담고 있어서 보통은 자동으로 잡힌다.

## 로컬에서 볼 때

그림을 별도 파일로 두었기 때문에 `index.html` 을 더블클릭해서 열면
브라우저가 `file://` 에서 이미지를 막는다. 간단한 서버를 띄우고 보자.

```bash
python3 -m http.server 8000
# http://localhost:8000/evening-night/
```

그림이 안 불러와져도 게임은 돌아간다. 도형으로 그린 임시 캐릭터로 대체된다.

## 브랜치

- `main` — 배포되는 버전
- 실험은 다른 브랜치에서. 넷리파이 Branch deploys 를 켜 두면
  `<브랜치>--<사이트>.netlify.app` 주소로 미리 볼 수 있다. 확인 후 `main` 에 머지.
