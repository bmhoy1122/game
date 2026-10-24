#!/usr/bin/env node
/* 비밀 타일 규칙 테스트.
 *   node tools/tiles-smoke.js
 * netlify/lib/tiles-core.mjs 를 그대로 불러서 메모리 저장소를 끼운다. npm install 필요 없음.
 */
const path = require('path');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? ' ok ' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
function memStore() {
  const m = new Map();
  return {
    async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
    raw: m,
  };
}
const lib = (f) => import(path.join(__dirname, '..', 'netlify/lib', f));

/* 응답 안에 상대 비밀이 들어 있는지 — 키 이름 k / deck 이 어디에도 없어야 하고,
   상대 숨은 타일엔 숫자가 없어야 하고, 상대가 가져온 타일엔 숫자가 없어야 한다 */
function leaks(body) {
  const bad = [];
  const walk = (o, p) => {
    if (!o || typeof o !== 'object') return;
    for (const key of Object.keys(o)) {
      if (key === 'k' || key === 'deck' || key === 'hands' || key === 'nextId') bad.push(p + '.' + key);
      walk(o[key], p + '.' + key);
    }
  };
  walk(body, '');
  if (body.phase !== 'done') {
    (body.theirs || []).forEach((t, i) => { if (!t.open && t.n !== null) bad.push('theirs[' + i + '].n'); });
    if (body.drawn && body.drawn.by !== body.you && body.drawn.n !== null) bad.push('drawn.n');
  }
  return bad;
}

(async () => {
  const T = await lib('tiles-core.mjs');
  const { BOT_DELAY, BOT_NAME } = await lib('room-kit.mjs');
  const { codeOf, numOf, colOf, candidates } = T;
  try {
    /* ---- 판 준비 ---- */
    const mkRoom = (code, round) => { const r = { code, round, opts: { pick: 'coin' } }; T.tiles.setup(r); return r; };
    const r1 = mkRoom('1234', 1), r1b = mkRoom('1234', 1), r2 = mkRoom('1234', 2);
    check('같은 방 코드 · 판 번호면 같은 판', JSON.stringify(r1.hands) === JSON.stringify(r1b.hands) && JSON.stringify(r1.deck) === JSON.stringify(r1b.deck));
    check('판 번호가 다르면 다른 판', JSON.stringify(r1.deck) !== JSON.stringify(r2.deck));
    const allK = [...r1.hands[0], ...r1.hands[1]].map((t) => t.k).concat(r1.deck);
    check('타일 24개가 한 번씩', allK.length === 24 && new Set(allK).size === 24);
    check('각자 4개, 더미 16개', r1.hands[0].length === 4 && r1.hands[1].length === 4 && r1.deck.length === 16);
    check('줄은 작은 수 → 큰 수, 같은 수면 검정이 왼쪽', r1.hands.every((h) => h.every((t, i) => !i || h[i - 1].k < t.k)) &&
      codeOf(5, 'b') < codeOf(5, 'w') && codeOf(5, 'w') < codeOf(6, 'b'));
    check('코드 ↔ 숫자 · 색', numOf(codeOf(7, 'w')) === 7 && colOf(codeOf(7, 'w')) === 'w' && colOf(codeOf(0, 'b')) === 'b');

    /* ---- 후보 계산 ---- */
    const H = (arr) => arr.map(([n, c, open], i) => ({ k: codeOf(n, c), id: i + 100, open: !!open }));
    let room = { hands: [H([[0, 'b'], [1, 'b']]), H([[2, 'b'], [2, 'w', true]])], deck: [], log: [], drawn: null };
    let cd = candidates(room, 0);
    check('후보: 공개된 흰2 왼쪽 검정은 0~2, 내가 가진 0·1 빼면 2뿐', JSON.stringify(cd[100]) === '[2]', JSON.stringify(cd));
    room = { hands: [H([[11, 'w']]), H([[3, 'w'], [4, 'b'], [9, 'w']])], deck: [], log: [{ t: 'g', by: 0, tid: 102, n: 10, ok: false }], drawn: null };
    cd = candidates(room, 0);
    check('후보: 맨 왼쪽 흰 타일은 오른쪽 둘이 들어갈 자리를 남긴다 (0~8)', JSON.stringify(cd[100]) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8]), JSON.stringify(cd[100]));
    check('후보: 맨 오른쪽 흰 타일은 틀린 10 · 내 11 이 빠져 1~9', JSON.stringify(cd[102]) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]), JSON.stringify(cd[102]));
    check('후보: 가운데 검정은 양쪽에 하나씩 남겨 1~9', JSON.stringify(cd[101]) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]), JSON.stringify(cd[101]));
    room.drawn = { k: codeOf(9, 'w'), id: 9, by: 0 };
    check('후보: 내가 가져온 타일 숫자도 뺀다', !candidates(room, 0)[102].includes(9));
    room.drawn.by = 1;
    check('후보: 상대가 가져온 타일은 모르니 안 뺀다', candidates(room, 0)[102].includes(9));

    /* ---- 방 흐름 (사람 둘) ---- */
    const store = memStore();
    const call = (b) => T.handle(b, store);
    const a = (await call({ action: 'create', name: '민호', pick: 'coin' })).body;
    check('만든 직후는 상대 기다림', a.phase === 'wait');
    const b = (await call({ action: 'join', code: a.code, name: '지유' })).body;
    const code = a.code, tk = [a.token, b.token];
    check('들어오면 바로 시작 (랜덤 선)', b.phase === 'play' && b.stage === 'draw' && b.fresh === true);
    const first = b.first, second = 1 - first;
    const as = (i, act, extra) => call({ action: act, code, token: tk[i], ...(extra || {}) });
    const peek = () => store.get('room:' + code);
    let v0 = (await as(0, 'state')).body, v1 = (await as(1, 'state')).body;
    check('응답에 상대 비밀이 없다 (0번)', !leaks(v0).length, leaks(v0).join(','));
    check('응답에 상대 비밀이 없다 (1번)', !leaks(v1).length, leaks(v1).join(','));
    check('내 타일은 숫자까지 보인다', v0.mine.every((t) => Number.isInteger(t.n)) && v0.mine.length === 4);
    check('상대 타일은 색만 보인다', v0.theirs.every((t) => t.n === null && (t.c === 'b' || t.c === 'w')));
    check('더미는 색별 개수만', v0.deckB + v0.deckW === 16 && !('deck' in v0));

    check('후공은 먼저 못 가져온다', (await as(second, 'draw', { c: 'b' })).status === 409);
    check('가져오기 전엔 못 맞힌다', (await as(first, 'guess', { tid: v0.theirs[0].id, n: 0 })).status === 409);
    let R = await peek();
    const wantC = R.deck.some((k) => !(k & 1)) ? 'b' : 'w';
    let r = await as(first, 'draw', { c: wantC });
    check('더미에서 고른 색으로 가져온다', r.status === 200 && r.body.drawn && r.body.drawn.c === wantC && Number.isInteger(r.body.drawn.n) && r.body.stage === 'guess');
    check('두 번은 못 가져온다', (await as(first, 'draw', { c: 'b' })).status === 409);
    const sv = (await as(second, 'state')).body;
    check('상대는 내가 가져온 타일의 색만 안다', sv.drawn && sv.drawn.c === wantC && sv.drawn.n === null && !leaks(sv).length, JSON.stringify(sv.drawn));
    check('맞히기 전엔 멈출 수 없다', (await as(first, 'stop')).status === 409);

    R = await peek();
    const opp = R.hands[second];
    const target = opp[0];
    check('0~11 밖 숫자는 거절', (await as(first, 'guess', { tid: target.id, n: 12 })).status === 400);
    check('내 타일은 못 고른다', (await as(first, 'guess', { tid: R.hands[first][0].id, n: 0 })).status === 400);
    // 맞히기
    r = await as(first, 'guess', { tid: target.id, n: numOf(target.k) });
    check('맞히면 그 타일이 공개되고 계속/멈추기', r.status === 200 && r.body.theirs.find((t) => t.id === target.id).open && r.body.stage === 'more' && r.body.streak === 1);
    check('공개된 숫자는 둘 다 본다', (await as(second, 'state')).body.mine.find((t) => t.id === target.id).open);
    check('공개된 타일은 다시 못 고른다', (await as(first, 'guess', { tid: target.id, n: numOf(target.k) })).status === 400);
    // 멈추기 → 가져온 타일은 숨긴 채 제자리
    const drawnK = R.drawn.k, drawnId = R.drawn.id;
    r = await as(first, 'stop');
    R = await peek();
    const placed = R.hands[first].find((t) => t.id === drawnId);
    check('멈추면 가져온 타일을 숨긴 채 내 줄에', r.status === 200 && placed && !placed.open && placed.k === drawnK);
    check('넣은 뒤에도 줄이 정렬돼 있다', R.hands[first].every((t, i, h) => !i || h[i - 1].k < t.k));
    check('멈추면 차례가 넘어간다', r.body.turn === second && r.body.stage === 'draw');
    const sv2 = (await as(second, 'state')).body;
    check('상대 줄에 새 타일이 생겨도 숫자는 안 보인다', sv2.theirs.length === 5 && sv2.theirs.find((t) => t.id === drawnId).n === null && !leaks(sv2).length);

    // 틀리기 → 가져온 타일이 공개된 채로
    await as(second, 'draw', {});
    R = await peek();
    const tgt2 = R.hands[first].find((t) => !t.open);
    const wrongN = (numOf(tgt2.k) + 1) % 12;
    const d2 = R.drawn;
    r = await as(second, 'guess', { tid: tgt2.id, n: wrongN });
    R = await peek();
    check('틀리면 가져온 타일을 공개한 채 내 줄에 넣고 차례 끝', r.status === 200 && R.hands[second].find((t) => t.id === d2.id).open === true && r.body.turn === first);
    check('틀린 추측은 공개 기록에 남는다', (r.body.wrong[tgt2.id] || []).includes(wrongN) && r.body.log.some((e) => e.t === 'g' && e.tid === tgt2.id && e.n === wrongN && !e.ok));
    const fv = (await as(first, 'state')).body;
    check('공개된 상대 타일 숫자는 보인다', fv.theirs.find((t) => t.id === d2.id).n === numOf(d2.k));
    const sc = (await as(second, 'state')).body.cands[tgt2.id];
    check('틀린 숫자는 그 타일 후보에서 빠진다', Array.isArray(sc) && !sc.includes(wrongN) && sc.includes(numOf(tgt2.k)), JSON.stringify(sc));
    // 같은 타일에 같은 틀린 숫자 다시 → 거절 (내 차례 돌아왔을 때)
    await as(first, 'draw', {});
    R = await peek();
    const t3 = R.hands[second].find((t) => !t.open);
    r = await as(first, 'guess', { tid: t3.id, n: (numOf(t3.k) + 1) % 12 });   // 틀림
    r = await as(second, 'draw', {});
    r = await as(second, 'guess', { tid: tgt2.id, n: wrongN });
    check('같은 타일에 이미 틀린 숫자는 다시 못 말한다', r.status === 409, r.body.error);

    /* ---- 더미가 빈 뒤 틀리면 내 타일 공개 ---- */
    R = await peek();
    R.deck = [];
    R.drawn = null;
    R.stage = 'guess';
    await store.set('room:' + code, R);
    const turnNow = (await as(0, 'state')).body.turn;
    R = await peek();
    const victim = R.hands[1 - turnNow].find((t) => !t.open && !(T.wrongMap(R)[t.id] || []).includes((numOf(t.k) + 1) % 12));
    r = await as(turnNow, 'guess', { tid: victim.id, n: (numOf(victim.k) + 1) % 12 });
    check('빈 더미에서 틀리면 내 타일을 공개하는 단계', r.status === 200 && r.body.stage === 'reveal' && r.body.turn === turnNow);
    check('공개 단계엔 다른 걸 못 한다', (await as(turnNow, 'guess', { tid: victim.id, n: numOf(victim.k) })).status === 409 && (await as(turnNow, 'stop')).status === 409);
    R = await peek();
    const own = R.hands[turnNow].find((t) => !t.open);
    check('상대 타일은 공개 못 한다', (await as(turnNow, 'reveal', { tid: victim.id })).status === 400);
    r = await as(turnNow, 'reveal', { tid: own.id });
    check('내 타일을 고르면 공개되고 차례가 넘어간다', r.status === 200 && r.body.mine.find((t) => t.id === own.id).open && r.body.turn === 1 - turnNow && r.body.stage === 'guess');
    check('빈 더미면 가져오기 없이 바로 맞히기', (await as(1 - turnNow, 'draw', { c: 'b' })).status === 409);

    /* ---- 끝: 상대 줄을 다 맞히면 이긴다 ---- */
    let who = 1 - turnNow;
    R = await peek();
    for (const t of R.hands[1 - who]) if (!t.open) r = await as(who, 'guess', { tid: t.id, n: numOf(t.k) });
    check('상대 줄이 전부 공개되면 이긴다', r.body.phase === 'done' && r.body.winner === who && r.body.reason === 'open');
    const loser = (await as(1 - who, 'state')).body;
    check('진 사람도 같은 결과, 끝나면 숫자를 다 보여준다', loser.winner === who && loser.theirs.every((t) => Number.isInteger(t.n)));
    check('끝난 뒤엔 못 맞힌다', (await as(1 - who, 'guess', { tid: loser.theirs[0].id, n: 0 })).status === 409);
    check('끝난 뒤엔 기권도 안 된다', (await as(1 - who, 'resign')).status === 409);

    /* ---- 다시 하기 ---- */
    const [re0, re1] = await Promise.all([as(0, 'restart', { round: 1 }), as(1, 'restart', { round: 1 })]);
    check('둘이 동시에 다시 하기 → 판 2, 같은 판', re0.body.round === 2 && re1.body.round === 2 &&
      JSON.stringify(re0.body.mine) === JSON.stringify((await as(0, 'state')).body.mine));
    R = await peek();
    check('새 판은 새로 섞는다', R.round === 2 && R.hands[0].length === 4 && R.deck.length === 16 && R.turns === 0 && R.log.length === 0);
    check('지난 판 번호로 다시 하기 = 그냥 지금 상태', (await as(0, 'restart', { round: 1 })).body.round === 2);
    check('안 끝났는데 다시 하기는 거절', (await as(0, 'restart', { round: 2 })).status === 400);

    /* ---- 기권 ---- */
    r = await as(0, 'resign');
    check('기권하면 상대가 이긴다', r.body.phase === 'done' && r.body.winner === 1 && r.body.reason === 'resign');

    /* ---- 가위바위보 선 정하기 ---- */
    {
      const s = memStore();
      const c = (x) => T.handle(x, s);
      const A = (await c({ action: 'create', pick: 'rps' })).body;
      const B = (await c({ action: 'join', code: A.code })).body;
      check('가위바위보면 pick 부터', B.phase === 'pick');
      check('선 정하기 전엔 못 가져온다', (await c({ action: 'draw', code: A.code, token: A.token, c: 'b' })).status === 409);
      await c({ action: 'throw', code: A.code, token: A.token, value: 'r' });
      const z = (await c({ action: 'throw', code: A.code, token: B.token, value: 's' })).body;
      check('이긴 사람이 선공', z.phase === 'play' && z.first === 0 && z.turn === 0);
    }

    /* ---- 봇 방 끝까지 (사람은 후보 중 아무거나 — 폴링하며 now 를 흘린다) ---- */
    {
      let now = 1_000_000, tok = null, bcode = null;
      const s = memStore();
      const c = async (x, dt = 0) => { now += dt; const res = await T.handle({ ...x, token: tok, code: bcode }, s, now); if (res.body.token) tok = res.body.token; if (res.body.code) bcode = res.body.code; return res; };
      const poll = () => c({ action: 'state' }, BOT_DELAY + 500);
      let q = await c({ action: 'create', name: '나', pick: 'mjb', bot: true });
      check('봇 방: 바로 상대가 있다', q.body.opponent.name === BOT_NAME && q.body.bot === true && q.body.phase === 'pick');
      for (let i = 0; i < 40 && q.body.phase === 'pick'; i++) { if (q.body.pick.mineNow === null) q = await c({ action: 'throw', value: ['r', 's', 'p'][i % 3] }); q = await poll(); }
      check('봇 방: 묵찌빠로 선을 정한다', q.body.phase === 'play', q.body.phase);
      let botActs = 0, leaked = 0, steps = 0;
      for (; steps < 400 && q.body.phase === 'play'; steps++) {
        if (leaks(q.body).length) leaked++;
        if (!q.body.yourTurn) { const before = q.body.log.length; q = await poll(); if (q.body.log.length > before) botActs++; continue; }
        if (q.body.stage === 'draw') q = await c({ action: 'draw', c: q.body.deckB ? 'b' : 'w' });
        else if (q.body.stage === 'reveal') q = await c({ action: 'reveal', tid: q.body.mine.find((t) => !t.open).id });
        else if (q.body.stage === 'more' && steps % 2) q = await c({ action: 'stop' });
        else {
          const t = q.body.theirs.find((x) => !x.open);
          const cs = q.body.cands[t.id];
          q = await c({ action: 'guess', tid: t.id, n: cs[steps % cs.length] });
        }
        if (q.status !== 200) { check('봇 방: 사람 수가 거절되지 않는다', false, q.body.error); break; }
      }
      check('봇 방: 끝까지 간다', q.body.phase === 'done', 'phase=' + q.body.phase + ' steps=' + steps);
      check('봇 방: 봇이 실제로 둔다', botActs > 3, String(botActs));
      check('봇 방: 진행 중 비밀이 한 번도 안 샌다', leaked === 0, String(leaked));
      const again = await c({ action: 'restart', round: q.body.round });
      check('봇 방: 다시 하기 뒤에도 봇 방', again.body.bot === true && again.body.round === 2);
    }

    /* ---- 많이 돌리기: 봇 vs 봇, 봇 vs 아무 수 — 예외 · 무한루프 · 후보 계산 오류 없음 ---- */
    {
      let seed = 7;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
      const randomMove = (ctx) => {          // 규칙상 되는 수 중 아무거나 (멈추기 포함)
        const { room, idx } = ctx;
        if (room.stage === 'draw') return { act: 'draw', body: { c: rnd() < 0.5 ? 'b' : 'w' } };
        if (room.stage === 'reveal') { const h = room.hands[idx].filter((t) => !t.open); return { act: 'reveal', body: { tid: h[Math.floor(rnd() * h.length)].id } }; }
        if (room.stage === 'more' && rnd() < 0.5) return { act: 'stop', body: {} };
        const h = room.hands[1 - idx].filter((t) => !t.open);
        return { act: 'guess', body: { tid: h[Math.floor(rnd() * h.length)].id, n: Math.floor(rnd() * 12) } };
      };
      let games = 0, botWins = 0, errors = 0, stuck = 0, candBad = 0, rejected = 0, totalActs = 0;
      const GAMES = 600;
      for (let g = 0; g < GAMES; g++) {
        const roomX = { code: String(1000 + g), round: 1 + (g % 3), opts: { pick: 'coin' }, players: [{}, {}] };
        T.tiles.setup(roomX);
        const docs = [{ round: roomX.round }, { round: roomX.round }];
        const mode = g % 3;                  // 0: 봇 vs 봇, 1: 봇(1) vs 아무 수(0), 2: 아무 수 vs 아무 수
        let acts = 0, done = false;
        while (acts < 2000) {
          const ctx = { room: roomX, docs, joined: true, now: 0, body: {} };
          const st = T.status({ ...ctx, idx: 0 });
          if (st.phase === 'done') { done = true; if (mode === 1 && st.winner === 1) botWins++; break; }
          const idx = st.turn;
          const me = { ...ctx, idx, me: docs[idx], other: docs[1 - idx] };
          // 후보 계산이 진짜 숫자를 빼는 일이 없어야 한다
          const cd = candidates(roomX, idx);
          for (const t of roomX.hands[1 - idx]) if (!t.open && !(cd[t.id] || []).includes(numOf(t.k))) candBad++;
          const useBot = mode === 0 || (mode === 1 && idx === 1);
          const mv = useBot ? T.botMove(me, rnd) : randomMove(me);
          if (!mv) { stuck++; break; }
          me.body = mv.body;
          let err;
          try { err = T.tiles.actions[mv.act](me); } catch (e) { errors++; console.log(e.stack); break; }
          if (err) { if (useBot) { rejected++; console.log('봇 수 거절', err.error, JSON.stringify(mv)); break; } }
          acts++;
        }
        if (!done) stuck++;
        else games++;
        totalActs += acts;
      }
      check(`봇·무작위 ${GAMES}판 전부 끝난다 (예외·멈춤 없음)`, games === GAMES && !errors && !stuck, `끝 ${games} 예외 ${errors} 멈춤 ${stuck}`);
      check('봇의 수는 한 번도 거절되지 않는다', rejected === 0, String(rejected));
      check('후보 계산이 진짜 숫자를 빼는 일이 없다', candBad === 0, String(candBad));
      check('봇은 아무렇게나 두는 상대를 대부분 이긴다', botWins > GAMES / 3 * 0.8, `${botWins}/${GAMES / 3}`);
      console.log(`      (평균 ${Math.round(totalActs / GAMES)} 행동/판)`);
    }
  } catch (e) {
    failures++;
    console.log('FAIL  런타임 예외:', e.message);
    console.log(e.stack.split('\n').slice(1, 5).join('\n'));
  }
  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
