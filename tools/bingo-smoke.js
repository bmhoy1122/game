#!/usr/bin/env node
/* 커플 빙고 규칙을 브라우저도 서버도 없이 돌려본다.
 *   node tools/bingo-smoke.js
 * netlify/lib/bingo-core.mjs 를 그대로 불러서 메모리 저장소를 끼운다.
 */
const path = require('path');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
};

function memStore() {
  const m = new Map();
  return {
    async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
    _map: m,
  };
}

(async () => {
  const core = await import(path.join(__dirname, '..', 'netlify/lib/bingo-core.mjs'));
  const { handle, lineCount, validBoard, WIN_LINES, CELLS, LINES } = core;
  const store = memStore();
  const call = (body, now) => handle(body, store, now);

  try {
    check('5×5 의 줄은 12개다 (가로5 세로5 대각2)', LINES.length === 12);
    check('칸은 25개다', CELLS === 25);

    // 판 검사
    const ok25 = [...Array(25)].map((_, i) => i + 1);
    check('정상 판은 통과한다', validBoard(ok25));
    check('숫자가 겹치면 거른다', !validBoard([...ok25.slice(0, 24), 1]));
    check('칸 수가 모자라면 거른다', !validBoard(ok25.slice(0, 24)));
    check('1~25 밖이면 거른다', !validBoard([...ok25.slice(0, 24), 26]));

    // 줄 세기
    check('첫 줄이 다 나오면 1줄', lineCount(ok25, [1, 2, 3, 4, 5]) === 1);
    check('대각까지 겹치면 여러 줄', lineCount(ok25, [1, 2, 3, 4, 5, 7, 13, 19, 25]) === 2,
      '가로1 + 대각1');
    check('하나 비면 줄이 아니다', lineCount(ok25, [1, 2, 3, 4]) === 0);

    // 방 만들기 / 들어가기
    const a = await call({ action: 'create', name: '민호' });
    check('방이 만들어진다', a.status === 200 && /^\d{4}$/.test(a.body.code), '코드 ' + a.body.code);
    const code = a.body.code, tA = a.body.token;
    check('만든 사람은 0번, 아직 대기', a.body.you === 0 && a.body.phase === 'wait');

    const nope = await call({ action: 'join', code: '0000' });
    check('없는 방은 못 들어간다', nope.status === 404);

    const b = await call({ action: 'join', code, name: '지유' });
    const tB = b.body.token;
    check('둘째가 들어온다', b.status === 200 && b.body.you === 1);
    check('상대 이름이 보인다', b.body.opponent.name === '민호');

    const third = await call({ action: 'join', code, name: '난입' });
    check('세 번째는 막는다', third.status === 409);

    const stranger = await call({ action: 'state', code, token: 'xxx' });
    check('남의 방은 못 본다', stranger.status === 403);

    // 준비 → 시작
    const boardA = ok25;                                  // 1..25 순서대로
    const boardB = [...ok25].reverse();                   // 25..1 거꾸로
    let r = await call({ action: 'ready', code, token: tA, board: boardA });
    check('한 명만 준비하면 아직 대기', r.body.phase === 'wait' && r.body.ready === true);
    check('상대 판은 안 보여준다', r.body.opponent.board === undefined);

    const badReady = await call({ action: 'ready', code, token: tB, board: [1, 2, 3] });
    check('이상한 판은 거절한다', badReady.status === 400);

    r = await call({ action: 'ready', code, token: tB, board: boardB });
    check('둘 다 준비하면 시작한다', r.body.phase === 'play');
    check('선공이 정해진다', r.body.turn === 0 || r.body.turn === 1);

    // 차례 지키기
    const turn = r.body.turn;
    const tokens = [tA, tB];
    const wrong = await call({ action: 'call', code, token: tokens[1 - turn], n: 1 });
    check('남의 차례에는 못 부른다', wrong.status === 409, wrong.body.error);

    r = await call({ action: 'call', code, token: tokens[turn], n: 1 });
    check('내 차례에는 부를 수 있다', r.status === 200 && r.body.called.length === 1);
    check('부르면 차례가 넘어간다', r.body.turn === 1 - turn);

    const dup = await call({ action: 'call', code, token: tokens[1 - turn], n: 1 });
    check('같은 숫자는 두 번 못 부른다', dup.status === 409);

    const oob = await call({ action: 'call', code, token: tokens[1 - turn], n: 99 });
    check('없는 숫자는 못 부른다 (400)', oob.status === 400, oob.body.error);

    // 둘 다 같은 숫자가 체크된다 (같은 called 목록을 본다)
    const sA = await call({ action: 'state', code, token: tA });
    const sB = await call({ action: 'state', code, token: tB });
    check('두 사람이 같은 숫자 목록을 본다', JSON.stringify(sA.body.called) === JSON.stringify(sB.body.called));
    check('각자 자기 판만 받는다',
      sA.body.board[0] === boardA[0] && sB.body.board[0] === boardB[0]);

    // 끝까지 가서 승패가 나는지 — 1,2,3,4,5 를 부르면 A 는 1줄
    let cur = r.body.turn, guard = 0;
    const seq = [2, 3, 4, 5];
    for (const n of seq) {
      const res = await call({ action: 'call', code, token: tokens[cur], n });
      if (res.status !== 200) { check('연속 호출 실패: ' + n, false, res.body.error); break; }
      cur = res.body.turn;
      if (res.body.phase === 'done') break;
      if (++guard > 30) break;
    }
    const mid = (await call({ action: 'state', code, token: tA })).body;
    check('가로 한 줄이 완성되면 1줄로 센다', mid.lines[0] >= 1, '내 줄 ' + mid.lines[0]);

    // 승리까지 몰아보기 — 남은 숫자를 번갈아 부른다
    let now = (await call({ action: 'state', code, token: tA })).body;
    guard = 0;
    while (now.phase === 'play' && guard++ < 40) {
      const t = tokens[now.turn];
      const next = [...Array(25)].map((_, i) => i + 1).find((n) => !now.called.includes(n));
      if (next === undefined) break;
      now = (await call({ action: 'call', code, token: t, n: next })).body;
    }
    check('언젠가는 끝난다', now.phase === 'done', now.called.length + '번 불러서 끝');
    check('승자가 정해진다', now.winner === 0 || now.winner === 1 || now.winner === 'draw',
      '승자 ' + now.winner);
    check(`${WIN_LINES}줄 이상 만든 사람이 있다`,
      now.winner === 'draw' || now.lines[now.winner] >= WIN_LINES,
      '줄 ' + JSON.stringify(now.lines));

    const lateCall = await call({ action: 'call', code, token: tokens[0], n: 1 });
    check('끝난 뒤에는 못 부른다', lateCall.status === 409);

    // 다시 하기
    r = await call({ action: 'restart', code, token: tA });
    check('다시 하면 판이 비워진다',
      r.body.phase === 'wait' && r.body.called.length === 0 && r.body.board === null);
    check('판 수가 올라간다', r.body.round === 2);

    // 새로고침 복구
    const again = await call({ action: 'state', code, token: tB });
    check('토큰이 있으면 돌아올 수 있다', again.status === 200 && again.body.you === 1);

    // 한쪽만 이기는 경우도 확실히 — 1~15 를 부르면 A 는 가로 3줄, B 는 0줄이 되는 판
    const c2 = (await call({ action: 'create', name: 'A' })).body;
    const t2A = c2.token;
    const t2B = (await call({ action: 'join', code: c2.code, name: 'B' })).body.token;
    const winA = [...Array(25)].map((_, i) => i + 1);
    const loseB = [1, 2, 3, 4, 16, 5, 6, 7, 8, 17, 9, 10, 11, 12, 18, 13, 14, 15, 19, 20, 21, 22, 23, 24, 25];
    await call({ action: 'ready', code: c2.code, token: t2A, board: winA });
    let g = (await call({ action: 'ready', code: c2.code, token: t2B, board: loseB })).body;
    const tk2 = [t2A, t2B];
    for (let n = 1; n <= 15 && g.phase === 'play'; n++) {
      g = (await call({ action: 'call', code: c2.code, token: tk2[g.turn], n })).body;
    }
    check('가로 3줄이 완성되는 순간 끝난다', g.phase === 'done' && g.called.length === 15,
      g.called.length + '번째에 종료');
    check('3줄 만든 A 가 이긴다', g.winner === 0, '줄 ' + JSON.stringify(g.lines));
    const seenByB = (await call({ action: 'state', code: c2.code, token: t2B })).body;
    check('진 사람도 같은 결과를 본다', seenByB.winner === 0 && seenByB.phase === 'done');

    // 오래된 방은 없는 것으로 친다
    const old = await call({ action: 'state', code, token: tA }, Date.now() + 13 * 3600 * 1000);
    check('12시간 지난 방은 사라진다', old.status === 404);
  } catch (e) {
    failures++;
    console.log('FAIL  런타임 예외:', e.message);
    console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  }

  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
