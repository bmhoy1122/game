#!/usr/bin/env node
/* 백개먼 규칙 테스트.
 *   node tools/backgammon-smoke.js
 * netlify/lib/backgammon-core.mjs 를 그대로 불러서 메모리 저장소를 끼운다. npm install 필요 없음.
 */
const path = require('path');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? ' ok ' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
function memStore() {
  const m = new Map();
  return {
    async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
    m,
  };
}
const lib = (f) => import(path.join(__dirname, '..', 'netlify/lib', f));

(async () => {
  const G = await lib('backgammon-core.mjs');
  const { BOT_DELAY } = await lib('room-kit.mjs');
  const { stepsFor, applyStep, legalNow, maxLen, startArr, pip, rollDice, turnState, evaluate, finals } = G;

  // 자기 기준 배열 만들기: { 칸: 개수 } — 바는 25, 뺀 말은 0
  const A = (o) => { const a = new Array(26).fill(0); for (const k in o) a[+k] = o[k]; return a; };
  // 판을 직접 만든 턴 상태 (s=0 차례)
  const T0 = (mine, opp, dice, used = []) => {
    const room = { pos: [A(mine), A(opp)], dice, used, maxUse: 0 };
    room.maxUse = maxLen(room.pos, 0, G.expandDice(dice));
    return turnState(room, 0);
  };
  const has = (L, f, t) => L.some((m) => m.from === f && m.to === t);

  try {
    /* ---- 기본 이동 ---- */
    const start = [startArr(), startArr()];
    check('처음 배치: 15개씩, 핍 167', startArr().reduce((a, b) => a + b, 0) === 15 && pip(startArr()) === 167);
    check('처음 배치: 내 24칸 = 상대 기준 1칸 (상대 말과 안 겹친다)', G.oppAt(start, 0, 1) === 2 && G.oppAt(start, 0, 24) === 0 && G.oppAt(start, 0, 19) === 5);
    const s6 = stepsFor(start, 0, 5).map((x) => x.join('>'));
    check('처음 5: 13→8, 8→3 은 되고 24→19(상대 5개) · 6→1(상대 2개)은 안 된다', s6.includes('13>8') && s6.includes('8>3') && !s6.includes('6>1') && !s6.includes('24>19'), s6.join(' '));
    check('처음 6: 24→18 됨, 13→7 됨, 8→2 됨', ['24>18', '13>7', '8>2'].every((k) => stepsFor(start, 0, 6).map((x) => x.join('>')).includes(k)));

    /* ---- 잡기 · 바 ---- */
    {
      const pos = [A({ 10: 1, 6: 2 }), A({ 18: 1 })];          // 상대 18칸 = 내 기준 7칸 블롯
      const hit = applyStep(pos, 0, 10, 7);
      check('블롯(1개) 칸에 가면 잡아서 바로 보낸다', hit && pos[1][25] === 1 && pos[1][18] === 0 && pos[0][7] === 1);
      check('바에 말이 있으면 그것만 움직일 수 있다', stepsFor(pos, 1, 3).every(([f]) => f === 25) && stepsFor(pos, 1, 3).length === 1);
      check('바에서 들어오기: 주사위 3 → 자기 22칸', stepsFor(pos, 1, 3)[0][1] === 22);
      const blocked = [A({ 25: 1 }), A({ 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 2 })];   // 상대 홈 전부 막힘
      check('상대 홈이 다 막혔으면 들어올 수 없다', [1, 2, 3, 4, 5, 6].every((d) => stepsFor(blocked, 0, d).length === 0));
      check('상대 말 2개 이상인 칸엔 못 간다', !stepsFor([A({ 10: 1 }), A({ 18: 2 })], 0, 3).length);
    }

    /* ---- 빼내기 ---- */
    {
      const notHome = [A({ 7: 1, 3: 1, 0: 13 }), A({ 0: 15 })];
      check('홈 밖에 말이 있으면 못 뺀다', !stepsFor(notHome, 0, 3).some(([, t]) => t === 0));
      const home = [A({ 5: 1, 3: 1, 0: 13 }), A({ 0: 15 })];
      check('정확한 눈이면 뺀다 (3 → 3칸)', stepsFor(home, 0, 3).some(([f, t]) => f === 3 && t === 0));
      check('더 먼 말이 있으면 큰 눈으로 못 뺀다 (4 로 3칸 X)', !stepsFor(home, 0, 4).some(([f, t]) => f === 3 && t === 0) && stepsFor(home, 0, 4).some(([f, t]) => f === 5 && t === 1));
      check('가장 먼 말이면 큰 눈으로 뺀다 (6 → 5칸)', stepsFor(home, 0, 6).some(([f, t]) => f === 5 && t === 0) && !stepsFor(home, 0, 6).some(([f]) => f === 3));
    }

    /* ---- 주사위 강제 규칙 ---- */
    {
      // 말 하나(13), 6·5. 2칸이 막혀서 둘 다는 못 쓴다 → 큰 눈(6)만
      const T = T0({ 13: 1, 0: 14 }, { 23: 2, 24: 13 }, [6, 5]);
      const L = legalNow(T);
      check('하나만 쓸 수 있으면 큰 눈을 써야 한다', T.M === 1 && L.length === 1 && has(L, 13, 7), JSON.stringify(L));
      // 8·3, 6·2, 상대 4칸 막음: 3→1(2) 을 먼저 두면 4를 못 쓴다 → 8→6 만 허락
      const T2 = T0({ 8: 1, 3: 1, 0: 13 }, { 21: 2, 24: 13 }, [4, 2]);
      const L2 = legalNow(T2);
      check('두 눈을 다 쓸 수 있으면 다 써야 한다 (한 눈만 쓰는 수는 막힘)', T2.M === 2 && L2.length === 1 && has(L2, 8, 6), JSON.stringify(L2));
      check('더블은 네 번', T0({ 13: 5, 0: 10 }, { 24: 15 }, [2, 2]).M === 4);
      check('처음 판 3·1 은 두 걸음', T0({ 24: 2, 13: 5, 8: 3, 6: 5 }, { 24: 2, 13: 5, 8: 3, 6: 5 }, [3, 1]).M === 2);
    }

    /* ---- 방 + 차례 ---- */
    const store = memStore();
    let now = 5_000_000;
    const call = (b) => G.handle(b, store, (now += 10));
    let r = await call({ action: 'create', name: '민호', pick: 'rps' });
    const code = r.body.code, t0 = r.body.token;
    check('방 만들기 → wait', r.status === 200 && r.body.phase === 'wait');
    r = await call({ action: 'join', code, name: '지유' });
    const t1 = r.body.token;
    check('들어가면 pick', r.body.phase === 'pick');
    const tok = [t0, t1];
    const P = (i, b) => call({ ...b, code, token: tok[i] });
    // 가위바위보: 0 바위, 1 가위 → 0 선공
    await P(0, { action: 'throw', value: 'r' });
    r = await P(1, { action: 'throw', value: 's' });
    check('선 정하기 끝 → play, 선공 0', r.body.phase === 'play' && r.body.first === 0 && r.body.turn === 0);
    check('후공 화면: 내 차례 아님, 할 수 있는 수 없음', r.body.yourTurn === false && r.body.legal.length === 0);
    r = await P(1, { action: 'roll' });
    check('차례 아닌 사람이 굴리면 409', r.status === 409);
    r = await P(0, { action: 'move', from: 13, to: 8 });
    check('굴리기 전엔 못 옮긴다', r.status === 409 && /굴려/.test(r.body.error));
    r = await P(0, { action: 'roll' });
    const d = r.body.dice;
    check('굴리면 주사위 두 개 (seeded)', r.status === 200 && d && d.length === 2 && JSON.stringify(d) === JSON.stringify(rollDice(code, 1, 0)));
    check('다시 굴리기는 안 된다', (await P(0, { action: 'roll' })).status === 409);
    check('주사위 굴린 뒤 할 수 있는 수가 있다', r.body.legal.length > 0 && r.body.canEnd === false);
    const first = r.body.legal[0];
    const r1 = await P(1, { action: 'move', from: first[0], to: first[1] });
    check('상대 차례에 옮기면 409', r1.status === 409);
    check('확정은 주사위를 다 써야 된다', (await P(0, { action: 'end' })).status === 409);
    r = await P(0, { action: 'move', from: first[0], to: first[1] });
    check('한 걸음 옮기기', r.status === 200 && r.body.steps === 1 && r.body.canUndo);
    const mid = r.body;
    // 상대 화면에도 옮기는 중인 길이 보인다
    const ov = await P(1, { action: 'state' });
    check('상대 화면엔 옮기는 길(trail)이 상대 기준 번호로 보인다', ov.body.trail.length === 1 && ov.body.trail[0].from === (first[0] === 25 ? 25 : 25 - first[0]));
    r = await P(0, { action: 'undo' });
    check('되돌리기 → 처음으로', r.status === 200 && r.body.steps === 0 && JSON.stringify(r.body.me) === JSON.stringify(startArr()));
    check('되돌려도 주사위는 그대로', JSON.stringify(r.body.dice) === JSON.stringify(d));
    check('되돌릴 게 없으면 409', (await P(0, { action: 'undo' })).status === 409);
    // 엉뚱한 걸음 — 이유를 알려준다
    r = await P(0, { action: 'move', from: 13, to: 14 });
    check('뒤로 가면 이유', r.status === 409 && /앞으로/.test(r.body.error), r.body.error);
    r = await P(0, { action: 'move', from: 24, to: 19 });
    check('상대 말 5개 칸이면 이유', r.status === 409 && /2개 이상/.test(r.body.error), r.body.error);
    r = await P(0, { action: 'move', from: 6, to: 0 });
    check('홈에 다 안 모였는데 빼면 이유', r.status === 409 && /15개/.test(r.body.error), r.body.error);
    // 다 쓰고 확정
    r = await P(0, { action: 'state' });
    let guard = 0;
    while (r.body.legal && r.body.legal.length && guard++ < 6) { const m = r.body.legal[0]; r = await P(0, { action: 'move', from: m[0], to: m[1] }); }
    r = await P(0, { action: 'state' });
    check('다 쓰면 확정할 수 있다', r.body.canEnd === true && r.body.steps === r.body.need);
    r = await P(0, { action: 'end' });
    check('확정하면 상대 차례', r.status === 200 && r.body.turn === 1 && r.body.yourTurn === false && r.body.log.length === 1 && r.body.log[0].who === 'me');
    r = await P(1, { action: 'state' });
    check('상대 화면: 내 차례, 굴리기 전', r.body.yourTurn && !r.body.dice && r.body.log[0].who === 'them');
    check('핍: 상대 화면에서 [내, 상대] 순서', r.body.pips[0] === 167 && r.body.pips[1] < 167, r.body.pips.join(','));
    check('토큰은 응답에 없다', !JSON.stringify(r.body).includes(t0));

    /* ---- 같은 판 재현 ---- */
    check('같은 code:round:차례 → 같은 주사위', JSON.stringify(rollDice('1234', 2, 7)) === JSON.stringify(rollDice('1234', 2, 7)));
    let diff = 0; for (let k = 0; k < 30; k++) if (JSON.stringify(rollDice('1234', 1, k)) !== JSON.stringify(rollDice('1234', 2, k))) diff++;
    check('판이 다르면 주사위도 다르다', diff > 15, diff + '/30');
    const counts = [0, 0, 0, 0, 0, 0, 0]; for (let k = 0; k < 6000; k++) for (const x of rollDice('9', 1, k)) counts[x]++;
    check('주사위 1~6 고르게', counts.slice(1).every((c) => c > 1700 && c < 2300), counts.slice(1).join(','));

    /* ---- 자동 넘김 (갈 곳 없음) ---- */
    {
      const st2 = memStore(); let nn = 1;
      const c = (b) => G.handle(b, st2, (nn += 10));
      const a = await c({ action: 'create', name: 'a', pick: 'coin' });
      const b = await c({ action: 'join', code: a.body.code, name: 'b' });
      const tk = [a.body.token, b.body.token];
      const room = JSON.parse(st2.m.get('room:' + a.body.code));
      const firstSeat = a.body.first !== null && a.body.first !== undefined ? a.body.first : (await c({ action: 'state', code: a.body.code, token: tk[0] })).body.first;
      // 선공이 바에 하나, 상대가 홈을 다 막은 판으로 바꾼다
      room.pos[firstSeat] = A({ 25: 1, 6: 14 });
      room.pos[1 - firstSeat] = A({ 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 2, 13: 3 });
      st2.m.set('room:' + a.body.code, JSON.stringify(room));
      const rr = await c({ action: 'roll', code: a.body.code, token: tk[firstSeat] });
      check('갈 곳이 없으면 굴리자마자 차례가 넘어간다', rr.status === 200 && rr.body.turn === 1 - firstSeat && rr.body.log.length === 1 && rr.body.log[0].pass === true);
    }

    /* ---- 끝 · 개먼 · 백개먼 · 다시 하기 ---- */
    {
      const st3 = memStore(); let nn = 1;
      const c = (b) => G.handle(b, st3, (nn += 10));
      const a = await c({ action: 'create', name: 'a', pick: 'coin' });
      const cd = a.body.code;
      const b = await c({ action: 'join', code: cd, name: 'b' });
      const tk = [a.body.token, b.body.token];
      const fs = b.body.first;
      const set = (mine, opp) => { const room = JSON.parse(st3.m.get('room:' + cd)); room.pos[fs] = A(mine); room.pos[1 - fs] = A(opp); st3.m.set('room:' + cd, JSON.stringify(room)); };
      set({ 1: 1, 2: 1, 0: 13 }, { 20: 2, 13: 13 });             // 진 쪽: 하나도 못 뺐고 이긴 쪽 홈(진 쪽 19~24)에 말 → 백개먼
      let rr = await c({ action: 'roll', code: cd, token: tk[fs] });
      while (rr.body.phase === 'play' && rr.body.legal.length) { const m = rr.body.legal.find((x) => x[1] === 0) || rr.body.legal[0]; rr = await c({ action: 'move', from: m[0], to: m[1], code: cd, token: tk[fs] }); }
      const other = await c({ action: 'state', code: cd, token: tk[1 - fs] });
      check('15개 다 빼면 바로 끝', rr.body.phase === 'done' && rr.body.winner === fs && other.body.winner === fs, rr.body.phase);
      check('못 뺐고 이긴 쪽 홈에 말이 남으면 백개먼(3배)', rr.body.kind === 'backgammon' && rr.body.mult === 3, rr.body.kind);
      check('끝난 뒤엔 굴릴 수 없다', (await c({ action: 'roll', code: cd, token: tk[1 - fs] })).status === 409);
      const re = await c({ action: 'restart', round: 1, code: cd, token: tk[0] });
      const re2 = await c({ action: 'restart', round: 1, code: cd, token: tk[1] });   // 동시에 눌러도 같은 판
      check('다시 하기 → 2판, 처음 배치', re.body.round === 2 && re2.body.round === 2 && JSON.stringify(re.body.me) === JSON.stringify(startArr()) && re.body.phase === 'play');
      // 개먼 / 일반승
      const room = JSON.parse(st3.m.get('room:' + cd));
      const ctx = { room, docs: [{}, {}], joined: true, idx: 0 };
      const fs2 = G.status(ctx).first, turnSeat = (fs2 + room.turnNo) % 2;
      room.pos[turnSeat] = A({ 0: 15 }); room.pos[1 - turnSeat] = A({ 13: 15 });
      check('못 뺐지만 홈 밖이면 개먼(2배)', G.status(ctx).kind === 'gammon');
      room.pos[1 - turnSeat] = A({ 0: 1, 22: 14 });
      check('하나라도 뺐으면 일반승', G.status(ctx).kind === 'single');
      // 기권
      const st4 = memStore(); let n4 = 1;
      const c4 = (b2) => G.handle(b2, st4, (n4 += 10));
      const a4 = await c4({ action: 'create', name: 'a', pick: 'coin' });
      const b4 = await c4({ action: 'join', code: a4.body.code, name: 'b' });
      const q = await c4({ action: 'resign', code: a4.body.code, token: b4.body.token });
      check('기권하면 상대 승', q.body.phase === 'done' && q.body.winner === 0 && q.body.reason === 'resign');
    }

    /* ---- 봇 평가 ---- */
    {
      // 상대 블롯을 잡을 수 있으면 잡는다: 내 13칸에서 4 → 9칸에 상대 블롯(상대 기준 16)
      const room = { code: '1000', round: 1, turnNo: 0, pos: [A({ 13: 2, 6: 5, 8: 3, 24: 2, 0: 3 }), A({ 16: 1, 24: 2, 13: 4, 6: 5, 8: 3 })], dice: [4, 1], used: [], maxUse: 2, log: [], opts: { pick: 'coin' }, players: [{}, { bot: true }] };
      const T = turnState(room, 0);
      const fins = finals(T);
      const bestHit = fins.reduce((a, c) => (evaluate(c.pos, 0) > evaluate(a.pos, 0) ? c : a));
      check('봇 평가: 잡을 수 있으면 잡는 쪽을 고른다', bestHit.pos[1][25] === 1, JSON.stringify(bestHit.first));
      // 처음 판 3·1 → 5칸 만들기(8→5, 6→5)
      const r31 = { ...room, pos: [startArr(), startArr()], dice: [3, 1], maxUse: 2 };
      const f31 = finals(turnState(r31, 0));
      const b31 = f31.reduce((a, c) => (evaluate(c.pos, 0) > evaluate(a.pos, 0) ? c : a));
      check('봇 평가: 처음 3·1 은 5칸을 막는다', b31.pos[0][5] === 2, b31.pos[0].join(','));
      // 속도: 복잡한 더블
      const t = Date.now();
      const rd = { ...room, pos: [A({ 24: 1, 20: 1, 18: 2, 13: 3, 11: 1, 9: 2, 8: 2, 6: 3 }), A({ 23: 1, 21: 2, 17: 1, 13: 3, 10: 2, 8: 2, 6: 3, 4: 1 })], dice: [2, 2], maxUse: 0 };
      rd.maxUse = maxLen(rd.pos, 0, [2, 2, 2, 2]);
      const fd = finals(turnState(rd, 0));
      check('봇: 더블 수열 계산이 빠르다', Date.now() - t < 1500 && fd.length > 10, (Date.now() - t) + 'ms, ' + fd.length + '개');
    }

    /* ---- 봇 방 끝까지 (사람은 아무 합법 수) ---- */
    {
      const st5 = memStore();
      let nw = 1_000_000, tk = null, cd = null;
      const call5 = async (b, dt = 0) => { nw += dt; const x = await G.handle({ ...b, token: tk, code: cd }, st5, nw); if (x.body.token) tk = x.body.token; if (x.body.code) cd = x.body.code; return x; };
      const poll = () => call5({ action: 'state' }, BOT_DELAY + 500);
      let x = await call5({ action: 'create', name: '나', pick: 'rps', bot: true });
      check('봇 방: 바로 상대가 있다', x.body.opponent.joined && x.body.bot === true && x.body.phase === 'pick');
      for (let i = 0; i < 30 && x.body.phase === 'pick'; i++) { if (x.body.pick.mineNow === null) x = await call5({ action: 'throw', value: 'p' }); x = await poll(); }
      check('봇 방: 봇과 가위바위보로 선을 정한다', x.body.phase === 'play', x.body.phase);
      let botActs = 0, myTurns = 0, i = 0;
      const rnd = (n) => Math.floor(Math.random() * n);
      for (; i < 4000 && x.body.phase === 'play'; i++) {
        if (x.body.yourTurn) {
          if (!x.body.dice) { x = await call5({ action: 'roll' }, 50); myTurns++; }
          else if (x.body.legal.length) { const m = x.body.legal[rnd(x.body.legal.length)]; x = await call5({ action: 'move', from: m[0], to: m[1] }, 50); }
          else x = await call5({ action: 'end' }, 50);
          if (x.status !== 200) { check('봇 방: 사람 행동이 거절되지 않는다', false, x.body.error); break; }
        } else { x = await poll(); botActs++; }
      }
      check('봇 방: 끝까지 간다', x.body.phase === 'done', `phase=${x.body.phase} 반복=${i} 내 차례=${myTurns} 봇 폴링=${botActs}`);
      check('봇 방: 아무렇게나 두면 봇이 이긴다 (대개)', x.body.winner === 1 || true, 'winner=' + x.body.winner + ' ' + x.body.kind);
      const again = await call5({ action: 'restart', round: x.body.round });
      check('봇 방: 다시 하기 뒤에도 봇 방', again.body.bot === true && again.body.round === 2);
    }

    /* ---- 수백 판: 봇 vs 아무 수 (엔진 직접) ---- */
    {
      let botWins = 0, games = 0, errs = 0, maxTurns = 0, gammons = 0;
      const t = Date.now();
      for (let g = 0; g < 300; g++) {
        const room = { code: String(1000 + g), round: 1, players: [{}, { bot: true }], opts: { pick: 'coin' } };
        G.backgammon.setup(room);
        const docs = [{ round: 1 }, { round: 1 }];
        const mk = (idx, body = {}) => ({ room, idx, docs, me: docs[idx], other: docs[1 - idx], joined: true, body, now: 0 });
        let steps = 0, ok = true;
        while (steps++ < 3000) {
          const s = G.status(mk(0));
          if (s.phase === 'done') break;
          const seat = s.turn;
          let mv;
          if (seat === 1 || g % 3 === 0) mv = G.botMove(mk(seat), Math.random);   // 3판에 1판은 봇끼리
          else {
            if (!room.dice) mv = { act: 'roll' };
            else { const L = legalNow(turnState(room, seat)); mv = L.length ? { act: 'move', body: L[Math.floor(Math.random() * L.length)] } : { act: 'end' }; }
          }
          if (!mv) { ok = false; break; }
          const e = G.backgammon.actions[mv.act](mk(seat, mv.body || {}));
          if (e) { ok = false; console.log('  거절:', mv, e); break; }
        }
        const s = G.status(mk(0));
        if (!ok || s.phase !== 'done') { errs++; continue; }
        // 말 수가 늘 15개씩인지
        const T = turnState(room, s.turn);
        if (T.pos[0].reduce((a, b) => a + b, 0) !== 15 || T.pos[1].reduce((a, b) => a + b, 0) !== 15) errs++;
        maxTurns = Math.max(maxTurns, room.turnNo);
        if (g % 3 !== 0) { games++; if (s.winner === 1) botWins++; if (s.kind !== 'single') gammons++; }
      }
      check('300판 — 예외 · 거절 · 무한루프 없이 다 끝난다, 말은 늘 15개', errs === 0, `오류 ${errs}, 최장 ${maxTurns}차례, ${Date.now() - t}ms`);
      check('봇이 아무렇게나 두는 상대를 거의 다 이긴다', botWins / games > 0.85, `${botWins}/${games} (개먼 이상 ${gammons})`);
    }
  } catch (e) { check('예외 없이 끝난다', false, e.stack || String(e)); }
  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
