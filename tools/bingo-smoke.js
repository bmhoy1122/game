#!/usr/bin/env node
/* 커플 빙고 규칙을 브라우저도 서버도 없이 돌려본다.
 *   node tools/bingo-smoke.js
 * netlify/lib/bingo-core.mjs 를 그대로 불러서 메모리 저장소를 끼운다.
 * 저장소에 무작위 지연을 넣어서 두 요청이 실제로 엇갈리게 만든다.
 */
const path = require('path');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
};
const jitter = () => new Promise((r) => setTimeout(r, Math.random() * 4));
function memStore() {
  const m = new Map();
  return {
    async get(k) { await jitter(); const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async set(k, v) { await jitter(); m.set(k, JSON.stringify(v)); },
  };
}

(async () => {
  const core = await import(path.join(__dirname, '..', 'netlify/lib/bingo-core.mjs'));
  const { handle, lineCount, validBoard, WIN_LINES, CELLS, LINES } = core;
  const store = memStore();
  const call = (body, now) => handle(body, store, now);
  const ok25 = [...Array(25)].map((_, i) => i + 1);

  // 방을 열고 선을 정한 뒤 두 판까지 깐 상태를 만든다. 0번이 선공.
  async function newGame(boardA, boardB) {
    const a = (await call({ action: 'create', name: 'A', pick: 'rps' })).body;
    const b = (await call({ action: 'join', code: a.code, name: 'B' })).body;
    const tk = [a.token, b.token];
    await call({ action: 'throw', code: a.code, token: tk[0], value: 'r' });
    await call({ action: 'throw', code: a.code, token: tk[1], value: 's' });
    await Promise.all([
      call({ action: 'ready', code: a.code, token: tk[0], board: boardA }),
      call({ action: 'ready', code: a.code, token: tk[1], board: boardB }),
    ]);
    return { code: a.code, tk };
  }

  try {
    check('5×5 의 줄은 12개다 (가로5 세로5 대각2)', LINES.length === 12);
    check('칸은 25개다', CELLS === 25);
    check('정상 판은 통과한다', validBoard(ok25));
    check('숫자가 겹치면 거른다', !validBoard([...ok25.slice(0, 24), 1]));
    check('칸 수가 모자라면 거른다', !validBoard(ok25.slice(0, 24)));
    check('1~25 밖이면 거른다', !validBoard([...ok25.slice(0, 24), 26]));
    check('첫 줄이 다 나오면 1줄', lineCount(ok25, [1, 2, 3, 4, 5]) === 1);
    check('대각까지 겹치면 여러 줄', lineCount(ok25, [1, 2, 3, 4, 5, 7, 13, 19, 25]) === 2, '가로1 + 대각1');
    check('하나 비면 줄이 아니다', lineCount(ok25, [1, 2, 3, 4]) === 0);

    // 방 만들기 / 들어가기
    const a = await call({ action: 'create', name: '민호', pick: 'mjb' });
    check('방이 만들어진다', a.status === 200 && /^\d{4}$/.test(a.body.code), '코드 ' + a.body.code);
    const code = a.body.code, tA = a.body.token;
    check('만든 사람은 0번, 아직 대기', a.body.you === 0 && a.body.phase === 'wait');
    check('없는 방은 못 들어간다', (await call({ action: 'join', code: '0000' })).status === 404);
    const b = await call({ action: 'join', code, name: '지유' });
    const tB = b.body.token;
    check('둘째가 들어온다', b.status === 200 && b.body.you === 1);
    check('상대 이름이 보인다', b.body.opponent.name === '민호');
    check('세 번째는 막는다', (await call({ action: 'join', code, name: '난입' })).status === 409);
    check('남의 방은 못 본다', (await call({ action: 'state', code, token: 'xxx' })).status === 403);

    // 선 정하기 (묵찌빠로 만든 방)
    check('들어오면 선 정하기부터', b.body.phase === 'pick' && b.body.pick.kind === 'mjb');
    check('선 정하기 전엔 판을 못 낸다', (await call({ action: 'ready', code, token: tA, board: ok25 })).status === 409);
    await call({ action: 'throw', code, token: tA, value: 'r' });
    let r = (await call({ action: 'throw', code, token: tB, value: 'p' })).body;   // 지유가 공격
    check('묵찌빠: 첫 판 이긴 지유가 공격', r.phase === 'pick' && r.pick.attacker === 1);
    await call({ action: 'throw', code, token: tA, value: 's' });
    r = (await call({ action: 'throw', code, token: tB, value: 's' })).body;        // 같은 손 → 공격 승
    check('묵찌빠: 공격이 같은 손이면 지유 선공', r.phase === 'setup' && r.first === 1);

    // 판 깔기 — 둘이 동시에 준비해도 안 묻힌다
    const boardA = ok25, boardB = [...ok25].reverse();
    check('이상한 판은 거절한다', (await call({ action: 'ready', code, token: tB, board: [1, 2, 3] })).status === 400);
    r = (await call({ action: 'ready', code, token: tA, board: boardA })).body;
    check('한 명만 준비하면 아직 판 깔기', r.phase === 'setup' && r.ready === true);
    check('상대 판은 안 보여준다', !('board' in r.opponent) && !JSON.stringify(r).includes(JSON.stringify(boardB)));
    check('준비한 판은 못 바꾼다', (await call({ action: 'ready', code, token: tA, board: boardB })).status === 409);
    r = (await call({ action: 'ready', code, token: tB, board: boardB })).body;
    check('둘 다 준비하면 시작한다', r.phase === 'play');
    check('선 정하기에서 이긴 쪽 차례로 시작', r.turn === 1 && r.yourTurn === true);

    let lost = 0;
    for (let i = 0; i < 12; i++) {
      const g = await newGame(ok25, [...ok25].reverse());
      const s = (await call({ action: 'state', code: g.code, token: g.tk[0] })).body;
      if (s.phase !== 'play') lost++;
    }
    check('둘이 동시에 준비를 눌러도 한쪽이 묻히지 않는다', lost === 0, `12번 중 ${lost}번 유실`);

    // 차례 지키기 (지유=1번이 선공)
    const tokens = [tA, tB];
    const wrong = await call({ action: 'call', code, token: tokens[0], n: 1 });
    check('남의 차례에는 못 부른다', wrong.status === 409, wrong.body.error);
    r = (await call({ action: 'call', code, token: tokens[1], n: 1 })).body;
    check('내 차례에는 부를 수 있다', r.called.length === 1);
    check('부르면 차례가 넘어간다', r.turn === 0);
    check('같은 숫자는 두 번 못 부른다', (await call({ action: 'call', code, token: tokens[0], n: 1 })).status === 409);
    const oob = await call({ action: 'call', code, token: tokens[0], n: 99 });
    check('없는 숫자는 못 부른다 (400)', oob.status === 400, oob.body.error);

    const sA = (await call({ action: 'state', code, token: tA })).body;
    const sB = (await call({ action: 'state', code, token: tB })).body;
    check('두 사람이 같은 숫자 목록을 본다', JSON.stringify(sA.called) === JSON.stringify(sB.called));
    check('각자 자기 판만 받는다', sA.board[0] === boardA[0] && sB.board[0] === boardB[0]);

    // 끝까지 — 남은 숫자를 번갈아 부른다
    let now = sA, guard = 0;
    while (now.phase === 'play' && guard++ < 40) {
      const next = ok25.find((n) => !now.called.includes(n));
      now = (await call({ action: 'call', code, token: tokens[now.turn], n: next })).body;
    }
    check('언젠가는 끝난다', now.phase === 'done', now.called.length + '번 불러서 끝');
    check('승자가 정해진다', now.winner === 0 || now.winner === 1 || now.winner === 'draw', '승자 ' + now.winner);
    check(`${WIN_LINES}줄 이상 만든 사람이 있다`,
      now.winner === 'draw' || now.lines[now.winner] >= WIN_LINES, '줄 ' + JSON.stringify(now.lines));
    check('끝난 뒤에는 못 부른다', (await call({ action: 'call', code, token: tokens[0], n: 25 })).status === 409);

    // 한쪽만 이기는 경우 — 1~15 를 부르면 A 는 가로 3줄, B 는 0줄
    const loseB = [1, 2, 3, 4, 16, 5, 6, 7, 8, 17, 9, 10, 11, 12, 18, 13, 14, 15, 19, 20, 21, 22, 23, 24, 25];
    const g = await newGame(ok25, loseB);
    let gs = (await call({ action: 'state', code: g.code, token: g.tk[0] })).body;
    for (let n = 1; n <= 15 && gs.phase === 'play'; n++) {
      gs = (await call({ action: 'call', code: g.code, token: g.tk[gs.turn], n })).body;
    }
    check('가로 3줄이 완성되는 순간 끝난다', gs.phase === 'done' && gs.called.length === 15, gs.called.length + '번째');
    check('3줄 만든 A 가 이긴다', gs.winner === 0, '줄 ' + JSON.stringify(gs.lines));
    const seenByB = (await call({ action: 'state', code: g.code, token: g.tk[1] })).body;
    check('진 사람도 같은 결과를 본다', seenByB.winner === 0 && seenByB.phase === 'done');

    // 다시 하기 — 둘이 동시에 눌러도 판은 하나만, 선 정하기부터 다시
    const [x, y] = await Promise.all([
      call({ action: 'restart', code, token: tA, round: 1 }),
      call({ action: 'restart', code, token: tB, round: 1 }),
    ]);
    check('둘이 동시에 다시 해도 판은 하나만 올라간다', x.body.round === 2 && y.body.round === 2);
    check('다시 하면 선 정하기부터', x.body.phase === 'pick' && x.body.called.length === 0 && x.body.board === null);
    check('지난 판의 손은 안 남는다', x.body.pick.rounds.length === 0 && x.body.pick.mineNow === null);
    check('토큰이 있으면 돌아올 수 있다', (await call({ action: 'join', code, token: tB })).body.you === 1);
    check('12시간 지난 방은 사라진다',
      (await call({ action: 'state', code, token: tA }, Date.now() + 13 * 3600 * 1000)).status === 404);
  } catch (e) {
    failures++;
    console.log('FAIL  런타임 예외:', e.message);
    console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  }
  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
