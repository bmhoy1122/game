#!/usr/bin/env node
/* 탐험대 규칙 테스트 — npm install 없이 돈다.
 *   node tools/expedition-smoke.js
 * netlify/lib/expedition-core.mjs 를 그대로 불러 메모리 저장소로 돌린다.
 */
const path = require('path');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? ' ok ' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
function memStore() {
  const m = new Map();
  return {
    m,
    async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
  };
}
const lib = (f) => import(path.join(__dirname, '..', 'netlify/lib', f));
// 결정적 난수 (테스트 재현용)
function rng(seed) { let h = seed >>> 0; return () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

(async () => {
  const E = await lib('expedition-core.mjs');
  const { BOT_DELAY, BOT_NAME } = await lib('room-kit.mjs');
  const { col, val, isWager, lineScore, lineWhy, deckFor } = E;
  const id = (c, v) => c * 12 + (v === 'w1' ? 0 : v === 'w2' ? 1 : v === 'w3' ? 2 : v + 1);   // 테스트용 카드 만들기

  try {
    /* ---- 카드 ---- */
    const all = [...Array(60).keys()];
    check('카드 60장 — 색마다 12장(내기 3 + 숫자 2~10)', [0, 1, 2, 3, 4].every((c) => {
      const cs = all.filter((x) => col(x) === c);
      return cs.length === 12 && cs.filter(isWager).length === 3 && cs.filter((x) => !isWager(x)).map(val).join() === '2,3,4,5,6,7,8,9,10';
    }));

    /* ---- 점수 ---- */
    check('시작 안 한 탐험로는 0점', lineScore([]) === 0);
    check('숫자 5 하나 → 5−20 = −15', lineScore([id(0, 5)]) === -15);
    check('내기 1 + 숫자 5 → (5−20)×2 = −30', lineScore([id(0, 'w1'), id(0, 5)]) === -30);
    check('내기만 하나 → −20×2 = −40', lineScore([id(0, 'w1')]) === -40);
    check('7+8+9 → 24−20 = 4', lineScore([id(1, 7), id(1, 8), id(1, 9)]) === 4);
    const nine = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => id(2, v));
    check('2~10 아홉 장 → 54−20 + 보너스 20 = 54', lineScore(nine) === 54, String(lineScore(nine)));
    check('내기 3 + 2~10 → (54−20)×4 + 20 = 156 (보너스는 안 곱한다)', lineScore([id(2, 'w1'), id(2, 'w2'), id(2, 'w3'), ...nine]) === 156);
    check('딱 8장이면 보너스', lineScore([3, 4, 5, 6, 7, 8, 9, 10].map((v) => id(3, v))) === 52 - 20 + 20);
    check('7장이면 보너스 없음', lineScore([4, 5, 6, 7, 8, 9, 10].map((v) => id(3, v))) === 49 - 20);

    /* ---- 놓기 규칙 ---- */
    check('빈 탐험로엔 아무거나', !lineWhy([], id(0, 9)) && !lineWhy([], id(0, 'w2')));
    check('더 큰 숫자만', !lineWhy([id(0, 4)], id(0, 6)) && !!lineWhy([id(0, 6)], id(0, 4)));
    check('내기 뒤엔 내기 · 숫자 다 된다', !lineWhy([id(0, 'w1')], id(0, 'w2')) && !lineWhy([id(0, 'w1')], id(0, 2)));
    check('숫자 뒤엔 내기 안 됨', !!lineWhy([id(0, 3)], id(0, 'w1')));

    /* ---- 같은 판 재현 ---- */
    check('같은 방 코드 + 판 번호 → 같은 덱', deckFor('1234', 1).join() === deckFor('1234', 1).join());
    check('판 번호가 다르면 다른 덱', deckFor('1234', 1).join() !== deckFor('1234', 2).join());
    check('덱은 60장 전부, 겹침 없음', new Set(deckFor('5555', 3)).size === 60);

    /* ---- 방으로 한 판 ---- */
    const store = memStore();
    let now = 5_000_000;
    const H = (b) => E.handle(b, store, (now += 10));
    let a = await H({ action: 'create', name: '민호', pick: 'coin' });
    const code = a.body.code, ta = a.body.token;
    check('방 만들기 → 대기', a.status === 200 && a.body.phase === 'wait');
    let b = await H({ action: 'join', code, name: '지유' });
    const tb = b.body.token;
    const A = (x) => H({ ...x, code, token: ta }), B = (x) => H({ ...x, code, token: tb });
    a = await A({ action: 'state' }); b = await B({ action: 'state' });
    check('랜덤 선 정하기라 바로 play', a.body.phase === 'play' && b.body.phase === 'play');
    check('각자 8장, 덱 44장', a.body.hand.length === 8 && b.body.hand.length === 8 && a.body.deck === 44 && a.body.oppHand === 8);
    const room = await store.get('room:' + code);
    check('손패가 색·숫자 순으로 정렬', a.body.hand.join() === a.body.hand.slice().sort((x, y) => x - y).join());
    check('내 손패만 받는다', a.body.hand.join() === room.hands[0].join() && b.body.hand.join() === room.hands[1].join());
    const leak = (v, rm, who) => {
      const s = JSON.stringify(v);
      const opp = rm.hands[1 - who];
      if ('hands' in v) return 'hands 필드';
      if (typeof v.deck !== 'number') return 'deck 이 숫자가 아님';
      if (opp.length > 1 && s.includes(JSON.stringify(opp))) return '상대 손패 배열';
      if (rm.deck.length > 1 && s.includes(JSON.stringify(rm.deck))) return '덱 순서';
      if (rm.deck.length > 1 && s.includes(JSON.stringify(rm.deck.slice().reverse()))) return '덱 순서(뒤집힘)';
      if (v.hand.some((x) => opp.includes(x))) return '내 손에 상대 카드';
      if (v.log.some((e) => e.by !== who && e.t === 'draw' && e.from === 'deck' && 'card' in e)) return '상대가 덱에서 뽑은 카드';
      return null;
    };
    check('상대 손패 · 덱 순서가 응답에 없다 (A)', !leak(a.body, room, 0), leak(a.body, room, 0) || '');
    check('상대 손패 · 덱 순서가 응답에 없다 (B)', !leak(b.body, room, 1), leak(b.body, room, 1) || '');

    const first = a.body.turn;
    const P = first === 0 ? A : B, Q = first === 0 ? B : A;
    let p = first === 0 ? a : b;
    let r = await Q({ action: 'play', card: (first === 0 ? b : a).body.hand[0], to: 'discard' });
    check('차례 아닌 사람은 409', r.status === 409 && /상대 차례/.test(r.body.error));
    r = await P({ action: 'draw', from: 'deck' });
    check('놓기 전에 가져오면 409', r.status === 409);
    r = await P({ action: 'play', card: (first === 0 ? b : a).body.hand[0], to: 'line' });
    check('손에 없는 카드는 409', r.status === 409);
    r = await P({ action: 'play', card: p.body.hand[0], to: 'somewhere' });
    check('놓을 곳이 이상하면 400', r.status === 400);
    // 버리기 → 방금 버린 더미에서 못 가져온다
    const dc = p.body.hand[0];
    r = await P({ action: 'play', card: dc, to: 'discard' });
    check('버리면 그 색 버림 더미 맨 위', r.status === 200 && r.body.piles[col(dc)] === dc && r.body.pileCount[col(dc)] === 1 && r.body.step === 'draw' && r.body.hand.length === 7);
    r = await P({ action: 'play', card: p.body.hand[1], to: 'discard' });
    check('한 차례에 두 장은 못 낸다', r.status === 409);
    r = await P({ action: 'draw', from: col(dc) });
    check('방금 버린 카드는 다시 못 가져온다', r.status === 409 && /방금/.test(r.body.error));
    r = await P({ action: 'draw', from: (col(dc) + 1) % 5 });
    check('빈 버림 더미에선 못 가져온다', r.status === 409 && /비어/.test(r.body.error));
    r = await P({ action: 'draw', from: 'deck' });
    check('덱에서 가져오면 차례가 넘어간다', r.status === 200 && r.body.deck === 43 && r.body.hand.length === 8 && r.body.yourTurn === false);
    let q = await Q({ action: 'state' });
    check('상대는 버림 더미 맨 위를 본다', q.body.piles[col(dc)] === dc && q.body.yourTurn && q.body.step === 'play');
    check('상대 덱 뽑기 카드는 로그에 안 보인다', q.body.log.some((e) => e.t === 'draw' && e.from === 'deck' && !('card' in e)));
    // 상대는 그 버림 카드를 가져갈 수 있다
    const qc = q.body.hand.find((x) => col(x) !== col(dc));
    r = await Q({ action: 'play', card: qc, to: 'discard' });
    r = await Q({ action: 'draw', from: col(dc) });
    check('남이 버린 카드는 가져올 수 있다', r.status === 200 && r.body.hand.includes(dc) && r.body.pileCount[col(dc)] === 0);
    // 탐험로 규칙 — P 차례. 손에서 같은 색 두 장 이상 찾아 큰 걸 먼저 놓고 작은 걸 놓아본다
    p = await P({ action: 'state' });
    const byC = {};
    p.body.hand.forEach((x) => { if (!isWager(x)) (byC[col(x)] = byC[col(x)] || []).push(x); });
    const pairC = Object.values(byC).find((xs) => xs.length >= 2);
    if (pairC) {
      const big = pairC[pairC.length - 1], small = pairC[0];
      r = await P({ action: 'play', card: big, to: 'line' });
      check('탐험로에 놓으면 점수가 바로 계산된다', r.status === 200 && r.body.lines.me[col(big)].join() === String(big) && r.body.lineScores.me[col(big)] === val(big) - 20);
      check('놓았으면 막힌 더미 없음', r.body.blocked === null);
      await P({ action: 'draw', from: 'deck' });
      q = await Q({ action: 'state' });
      check('상대 탐험로가 보인다', q.body.lines.them[col(big)].join() === String(big) && q.body.score.them === val(big) - 20);
      await Q({ action: 'play', card: q.body.hand[0], to: 'discard' }); await Q({ action: 'draw', from: 'deck' });
      r = await P({ action: 'play', card: small, to: 'line' });
      check('더 작은 숫자는 못 놓는다 (이유를 알려준다)', r.status === 409 && /큰 숫자/.test(r.body.error), r.body.error);
      p = await P({ action: 'state' });
      check('못 놓는 카드는 canLine 에 없다', !p.body.canLine.includes(small));
    } else check('(같은 색 두 장이 없어 탐험로 검사는 건너뜀)', true);

    r = await A({ action: 'restart', round: a.body.round });
    check('안 끝났으면 다시 하기 안 됨', r.status === 400);

    // 끝까지 — 무작위 합법 수
    const R = rng(7);
    async function randomMove(who) {
      const call = who === 0 ? A : B;
      const v = (await call({ action: 'state' })).body;
      if (v.phase !== 'play' || !v.yourTurn) return v;
      if (v.step === 'play') {
        const c = v.hand[Math.floor(R() * v.hand.length)];
        const to = v.canLine.includes(c) && R() < 0.6 ? 'line' : 'discard';
        const res = await call({ action: 'play', card: c, to });
        if (res.status !== 200) throw new Error('합법 수가 거절됨: ' + res.body.error);
        return res.body;
      }
      const from = ['deck', ...[0, 1, 2, 3, 4].filter((c) => c !== v.blocked && v.pileCount[c] > 0)];
      const res = await call({ action: 'draw', from: from[Math.floor(R() * from.length)] });
      if (res.status !== 200) throw new Error('합법 가져오기가 거절됨: ' + res.body.error);
      return res.body;
    }
    let guard = 0, v = null, leaks = 0, cardSum = true;
    while (guard++ < 2000) {
      const st = (await A({ action: 'state' })).body;
      if (st.phase === 'done') { v = st; break; }
      const who = st.yourTurn ? 0 : 1;
      await randomMove(who);
      const rm = await store.get('room:' + code);
      const va = (await A({ action: 'state' })).body, vb = (await B({ action: 'state' })).body;
      if (leak(va, rm, 0) || leak(vb, rm, 1)) leaks++;
      const n = rm.deck.length + rm.hands[0].length + rm.hands[1].length + rm.discard.flat().length + rm.lines.flat(2).length;
      if (n !== 60) cardSum = false;
    }
    check('끝까지 가면 done', v && v.phase === 'done', v ? v.phase : 'guard');
    check('끝날 때 덱 0장', v && v.deck === 0);
    check('진행 내내 카드는 항상 60장', cardSum);
    check('진행 내내 상대 비밀이 새지 않는다', leaks === 0, leaks + '번');
    const vb = (await B({ action: 'state' })).body;
    check('점수는 서로 뒤집어 보인다', v.score.me === vb.score.them && v.score.them === vb.score.me);
    check('총점 = 탐험로 점수 합', v.score.me === v.lineScores.me.reduce((x, y) => x + y, 0));
    const expect = v.score.me === v.score.them ? 'draw' : v.score.me > v.score.them ? 0 : 1;
    check('이긴 사람 = 총점 높은 쪽', v.winner === expect, `winner=${v.winner} ${v.score.me}:${v.score.them}`);
    r = await A({ action: 'play', card: v.hand[0], to: 'discard' });
    check('끝난 뒤엔 못 낸다', r.status === 409);
    // 다시 하기 — 둘이 동시에 눌러도 같은 판
    const [ra, rb] = await Promise.all([A({ action: 'restart', round: v.round }), B({ action: 'restart', round: v.round })]);
    check('다시 하기 → 2판, 새 덱 44장', ra.body.round === 2 && rb.body.round === 2 && ra.body.deck === 44 && ra.body.phase === 'play');
    const room2 = await store.get('room:' + code);
    check('2판 덱 = deckFor(code, 2)', JSON.stringify([...room2.hands[0], ...room2.hands[1], ...room2.deck].sort((x, y) => x - y)) === JSON.stringify(all) &&
      room2.deck.join() === deckFor(code, 2).slice(16).join());

    /* ---- 선 정하기(가위바위보)를 거치는 방 ---- */
    {
      const s2 = memStore();
      const c1 = await E.handle({ action: 'create', name: '가', pick: 'rps' }, s2, 1e6);
      const j1 = await E.handle({ action: 'join', code: c1.body.code, name: '나' }, s2, 1e6 + 1);
      const X = (t, x) => E.handle({ ...x, code: c1.body.code, token: t }, s2, 1e6 + 2);
      let s = await X(c1.body.token, { action: 'state' });
      check('가위바위보 방은 pick 부터', s.body.phase === 'pick' && s.body.hand.length === 8);
      r = await X(c1.body.token, { action: 'play', card: s.body.hand[0], to: 'discard' });
      check('선 정하기 전엔 못 낸다', r.status === 409);
      await X(c1.body.token, { action: 'throw', value: 'r' });
      s = await X(j1.body.token, { action: 'throw', value: 's' });
      check('바위가 이기면 그 사람이 선', s.body.phase === 'play' && s.body.first === 0 && s.body.turn === 0);
    }

    /* ---- 봇 방 끝까지 (사람은 폴링하며 무작위 합법 수) ---- */
    {
      const st2 = memStore();
      let t = 9_000_000, tok = null, bc = null;
      const call = async (x, dt = 0) => { t += dt; const res = await E.handle({ ...x, token: tok, code: bc }, st2, t); if (res.body.token) tok = res.body.token; if (res.body.code) bc = res.body.code; return res; };
      const poll = () => call({ action: 'state' }, BOT_DELAY + 500);
      let s = await call({ action: 'create', name: '나', pick: 'mjb', bot: true });
      check('봇 방은 바로 상대가 있다', s.body.opponent.joined && s.body.opponent.name === BOT_NAME && s.body.bot === true);
      for (let i = 0; i < 30 && s.body.phase === 'pick'; i++) { if (s.body.pick.mineNow === null) await call({ action: 'throw', value: ['r', 's', 'p'][i % 3] }); s = await poll(); }
      check('봇과 묵찌빠로 선을 정한다', s.body.phase === 'play', s.body.phase);
      const R2 = rng(99);
      let steps = 0, botTurns = 0, prevTurn = s.body.turnNo;
      const noDelay = await call({ action: 'state' }, 0);
      if (!noDelay.body.yourTurn) { const again = await call({ action: 'state' }, 10); check('봇은 지연 전엔 안 움직인다', again.body.turnNo === noDelay.body.turnNo && again.body.step === noDelay.body.step); }
      while (s.body.phase === 'play' && steps++ < 1500) {
        if (s.body.yourTurn) {
          if (s.body.step === 'play') {
            const c = s.body.canLine.length && R2() < 0.5 ? s.body.canLine[0] : s.body.hand[Math.floor(R2() * s.body.hand.length)];
            s = await call({ action: 'play', card: c, to: s.body.canLine.includes(c) ? 'line' : 'discard' }, 300);
          } else {
            s = await call({ action: 'draw', from: 'deck' }, 300);
          }
          if (s.status !== 200) { check('사람 합법 수', false, s.body.error); break; }
        } else {
          s = await poll();
          if (s.body.turnNo !== prevTurn) botTurns++;
        }
        prevTurn = s.body.turnNo;
      }
      check('봇 방이 끝까지 간다', s.body.phase === 'done', s.body.phase + ' steps=' + steps);
      check('봇도 차례를 꼬박꼬박 한다', botTurns >= 15, String(botTurns));
      const again = await call({ action: 'restart', round: s.body.round });
      check('다시 하기 뒤 봇 방 유지', again.body.bot === true && again.body.round === 2 && again.body.opponent.joined);
    }

    /* ---- 수백 판: 봇끼리 · 봇 대 무작위 (방 없이 규칙만 직접) ---- */
    function newRoom(code) {
      const room = { code, round: 1, opts: { pick: 'coin' }, players: [{}, {}] };
      E.expedition.setup(room);
      return room;
    }
    const ctxOf = (room, idx, body = {}) => ({ room, idx, body, docs: [{ round: 1 }, { round: 1 }], me: {}, other: {}, joined: true, touchRoom: false, touchMe: false });
    function randomAct(room, idx, R) {
      const v = E.expedition.view(ctxOf(room, idx));
      if (v.step === 'play') {
        const c = v.hand[Math.floor(R() * v.hand.length)];
        return { act: 'play', body: { card: c, to: v.canLine.includes(c) && R() < 0.5 ? 'line' : 'discard' } };
      }
      const from = ['deck', ...[0, 1, 2, 3, 4].filter((c) => c !== v.blocked && v.pileCount[c] > 0)];
      return { act: 'draw', body: { from: from[Math.floor(R() * from.length)] } };
    }
    function playGame(code, kinds, R) {
      const room = newRoom(code);
      for (let n = 0; n < 400; n++) {
        const s = E.status(ctxOf(room, 0));
        if (s.phase === 'done') return { room, s, n };
        const who = s.turn;
        const mv = kinds[who] === 'bot' ? E.botMove(ctxOf(room, who), R) : randomAct(room, who, R);
        if (!mv) throw new Error(`${kinds[who]} 가 자기 차례에 null`);
        const ctx = ctxOf(room, who, mv.body);
        const err = E.expedition.actions[mv.act](ctx);
        if (err) throw new Error(`${kinds[who]} 의 수가 거절됨: ${err.error} ${JSON.stringify(mv)}`);
      }
      throw new Error('400 행동 안에 안 끝남');
    }
    let crash = null, maxN = 0;
    const tally = (kinds, games, seed) => {
      const R = rng(seed);
      const w = [0, 0, 0], sc = [0, 0];
      for (let g = 0; g < games; g++) {
        try {
          // 자리를 번갈아 바꿔 선공 유불리를 지운다
          const swap = g % 2 === 1;
          const k = swap ? [kinds[1], kinds[0]] : kinds;
          const { s, n } = playGame(String(1000 + g) + ':' + seed, k, R);
          maxN = Math.max(maxN, n);
          const s0 = swap ? s.scores[1] : s.scores[0], s1 = swap ? s.scores[0] : s.scores[1];
          sc[0] += s0; sc[1] += s1;
          w[s0 > s1 ? 0 : s0 < s1 ? 1 : 2]++;
        } catch (e) { crash = crash || e.message; }
      }
      return { w, avg: sc.map((x) => Math.round(x / games)) };
    };
    const bb = tally(['bot', 'bot'], 300, 1);
    const br = tally(['bot', 'rand'], 300, 2);
    check('봇끼리 300판 — 예외 · 멈춤 없음', !crash, crash || `승 ${bb.w.join('/')} 평균 ${bb.avg.join(':')}`);
    check('봇 대 무작위 300판 — 봇이 거의 다 이긴다', !crash && br.w[0] >= 270, `봇 승/패/무 ${br.w.join('/')} 평균 점수 ${br.avg.join(':')}`);
    check('봇 평균 점수가 0 이상 (함부로 시작해 빚지지 않는다)', bb.avg[0] > 0 && br.avg[0] > 0, `봇끼리 ${bb.avg.join(':')}`);
    check('한 판은 400 행동 안에 끝난다', maxN > 0 && maxN < 400, String(maxN));
    // 봇 대 무작위에서도 상대 비밀 미노출 (view 를 직접 검사)
    {
      const room = newRoom('7777'); const R = rng(5); let bad = 0;
      for (let n = 0; n < 400; n++) {
        const s = E.status(ctxOf(room, 0)); if (s.phase === 'done') break;
        const mv = s.turn === 1 ? E.botMove(ctxOf(room, 1), R) : randomAct(room, 0, R);
        E.expedition.actions[mv.act](ctxOf(room, s.turn, mv.body));
        for (const i of [0, 1]) if (leak(E.expedition.view(ctxOf(room, i)), room, i)) bad++;
      }
      check('봇 판에서도 view 에 상대 손패 · 덱 순서 없음', bad === 0, bad + '번');
    }
  } catch (e) {
    console.log('예외', e && e.stack);
    failures++;
  }
  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
