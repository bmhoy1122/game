#!/usr/bin/env node
/* 숫자야구 규칙을 브라우저도 서버도 없이 돌려본다.
 *   node tools/baseball-smoke.js
 * netlify/lib/baseball-core.mjs 를 그대로 불러서 메모리 저장소를 끼운다.
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
  const core = await import(path.join(__dirname, '..', 'netlify/lib/baseball-core.mjs'));
  const { handle, validNumber, judge, MAX_GUESSES } = core;
  const store = memStore();
  const call = (b, now) => handle(b, store, now);

  // 방 하나를 열고 둘 다 숫자를 정한 상태까지 만든다. 선공 / 후공 토큰을 돌려준다.
  async function newGame(secretA, secretB) {
    const a = (await call({ action: 'create', name: 'A', pick: 'coin' })).body;
    const b = (await call({ action: 'join', code: a.code, name: 'B' })).body;
    await Promise.all([
      call({ action: 'secret', code: a.code, token: a.token, value: secretA }),
      call({ action: 'secret', code: a.code, token: b.token, value: secretB }),
    ]);
    const st = (await call({ action: 'state', code: a.code, token: a.token })).body;
    const tk = [a.token, b.token];
    return { code: a.code, tk, first: st.first, st };
  }
  const guess = (g, i, value) => call({ action: 'guess', code: g.code, token: g.tk[i], value });

  try {
    // 판정
    check('같은 자리 같은 숫자 = 스트라이크', JSON.stringify(judge('123', '123')) === '{"s":3,"b":0}');
    check('자리만 다르면 볼', JSON.stringify(judge('123', '312')) === '{"s":0,"b":3}');
    check('섞이면 1S 1B', JSON.stringify(judge('123', '135')) === '{"s":1,"b":1}');
    check('하나도 없으면 아웃', JSON.stringify(judge('123', '456')) === '{"s":0,"b":0}');

    // 숫자 검사
    check('1~9 서로 다른 세 개는 통과', validNumber('382'));
    check('겹치면 거른다', !validNumber('113'));
    check('0 은 안 쓴다', !validNumber('102'));
    check('자리 수가 다르면 거른다', !validNumber('12') && !validNumber('1234'));
    check('숫자가 아니면 거른다', !validNumber('ab3') && !validNumber(null));

    // 방 · 숫자 정하기
    const a = (await call({ action: 'create', name: '민호', pick: 'coin' })).body;
    check('방이 만들어진다', /^\d{4}$/.test(a.code) && a.phase === 'wait');
    const code = a.code, tA = a.token;
    const b = (await call({ action: 'join', code, name: '지유' })).body;
    const tB = b.token;
    check('들어오면 숫자 정하기부터 (랜덤 선)', b.phase === 'setup' && b.mySecret === null);
    // 가위바위보로 정하는 방은 선부터 정해야 숫자를 정할 수 있다
    const ra = (await call({ action: 'create', pick: 'rps' })).body;
    const rb = (await call({ action: 'join', code: ra.code })).body;
    check('가위바위보 방은 선 정하기부터', rb.phase === 'pick');
    check('선 정하기 전엔 숫자를 못 정한다',
      (await call({ action: 'secret', code: ra.code, token: rb.token, value: '123' })).status === 409);
    await Promise.all([
      call({ action: 'throw', code: ra.code, token: ra.token, value: 'p' }),
      call({ action: 'throw', code: ra.code, token: rb.token, value: 'r' }),
    ]);
    const rs = (await call({ action: 'state', code: ra.code, token: rb.token })).body;
    check('가위바위보 이긴 쪽이 선공', rs.phase === 'setup' && rs.first === 0);
    const alone = (await call({ action: 'create', name: '혼자' })).body;
    const early = await call({ action: 'secret', code: alone.code, token: alone.token, value: '123' });
    check('상대가 안 들어왔으면 숫자 못 정한다', early.status === 409, early.body.error);

    check('이상한 숫자는 거절한다', (await call({ action: 'secret', code, token: tA, value: '112' })).status === 400);
    let r = (await call({ action: 'secret', code, token: tA, value: '382' })).body;
    check('내 숫자가 저장된다', r.mySecret === '382' && r.phase === 'setup');
    const peek = (await call({ action: 'state', code, token: tB })).body;
    check('상대는 "정했다"는 것만 안다', peek.opponentReady === true && peek.theirSecret === null);
    check('상대 숫자가 응답 어디에도 없다', !JSON.stringify(peek).includes('382'));
    r = (await call({ action: 'secret', code, token: tA, value: '519' })).body;
    check('상대가 정하기 전엔 바꿀 수 있다', r.mySecret === '519');

    r = (await call({ action: 'secret', code, token: tB, value: '746' })).body;
    check('둘 다 정하면 시작한다', r.phase === 'play');
    check('시작한 뒤엔 숫자를 못 바꾼다', (await call({ action: 'secret', code, token: tA, value: '123' })).status === 409);
    const playA = (await call({ action: 'state', code, token: tA })).body;
    check('게임 중에도 상대 숫자는 안 보인다',
      playA.theirSecret === null && !JSON.stringify(playA).includes('746'));

    // 동시에 정해도 둘 다 남는다
    let lost = 0;
    for (let i = 0; i < 12; i++) {
      const g = await newGame('123', '456');
      if (g.st.phase !== 'play') lost++;
    }
    check('둘이 동시에 숫자를 정해도 한쪽이 묻히지 않는다', lost === 0, `12번 중 ${lost}번 유실`);

    // 차례
    const tk = [tA, tB];
    const first = playA.first, second = 1 - first;
    check('선공이 정해져 있다', first === 0 || first === 1, (first === 0 ? '민호' : '지유') + ' 먼저');
    check('후공은 먼저 못 던진다', (await call({ action: 'guess', code, token: tk[second], value: '123' })).status === 409);
    check('이상한 숫자는 거절한다', (await call({ action: 'guess', code, token: tk[first], value: '120' })).status === 400);
    r = (await call({ action: 'guess', code, token: tk[first], value: first === 0 ? '764' : '591' })).body;
    const e = r.log[0];
    check('던지면 판정이 기록된다', r.log.length === 1 && e.by === first && e.g.length === 3);
    check('판정이 맞다', first === 0 ? (e.s === 1 && e.b === 2) : (e.s === 1 && e.b === 2),
      `${e.g} → ${e.s}S ${e.b}B`);
    check('던지면 차례가 넘어간다', r.turn === second && !r.yourTurn);
    check('같은 사람이 연달아 못 던진다', (await call({ action: 'guess', code, token: tk[first], value: '123' })).status === 409);

    // 선공이 맞히면 후공에게 마지막 기회 → 후공도 맞히면 무승부
    let g = await newGame('123', '456');
    const sec = ['123', '456'];
    let s = (await guess(g, g.first, sec[1 - g.first])).body;
    check('선공이 맞혀도 바로 안 끝난다', s.phase === 'play' && s.lastChance === 1 - g.first);
    s = (await guess(g, 1 - g.first, sec[g.first])).body;
    check('후공도 마지막에 맞히면 무승부', s.phase === 'done' && s.winner === 'draw');
    check('끝나면 상대 숫자를 공개한다', s.theirSecret === sec[g.first], '상대 숫자 ' + s.theirSecret);
    check('끝난 뒤엔 못 던진다', (await guess(g, g.first, '789')).status === 409);

    // 선공이 맞히고 후공은 놓치면 선공 승
    g = await newGame('123', '456');
    await guess(g, g.first, sec[1 - g.first]);
    s = (await guess(g, 1 - g.first, '789')).body;
    check('후공이 마지막 기회를 놓치면 선공이 이긴다', s.phase === 'done' && s.winner === g.first);

    // 후공이 먼저 맞히면 바로 끝난다 (이미 같은 횟수)
    g = await newGame('123', '456');
    await guess(g, g.first, '789');
    s = (await guess(g, 1 - g.first, sec[g.first])).body;
    check('후공이 맞히면 바로 이긴다', s.phase === 'done' && s.winner === 1 - g.first);

    // 끝까지 못 맞히면 무승부
    g = await newGame('123', '456');
    let rounds = 0;
    while (rounds++ < MAX_GUESSES * 2 + 2) {
      const st = (await call({ action: 'state', code: g.code, token: g.tk[0] })).body;
      if (st.phase !== 'play') break;
      await guess(g, st.turn, '789');
    }
    s = (await call({ action: 'state', code: g.code, token: g.tk[0] })).body;
    check(`한 사람당 ${MAX_GUESSES}번까지 못 맞히면 무승부`, s.phase === 'done' && s.winner === 'draw', s.log.length + '번 던짐');

    // 다시 하기 — 동시에 눌러도 판은 하나, 숫자는 새로
    const [x, y] = await Promise.all([
      call({ action: 'restart', code: g.code, token: g.tk[0], round: 1 }),
      call({ action: 'restart', code: g.code, token: g.tk[1], round: 1 }),
    ]);
    check('둘이 동시에 다시 해도 판은 하나만 올라간다', x.body.round === 2 && y.body.round === 2);
    check('둘이 같은 선공을 본다', x.body.first === y.body.first && x.body.first !== null);
    check('새 판은 숫자 정하기부터', x.body.phase === 'setup' && x.body.mySecret === null && x.body.log.length === 0);

    check('남의 방은 못 본다', (await call({ action: 'state', code, token: 'nope' })).status === 403);
  } catch (e) {
    failures++;
    console.log('FAIL  런타임 예외:', e.message);
    console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  }
  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
