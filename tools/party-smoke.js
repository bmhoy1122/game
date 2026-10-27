#!/usr/bin/env node
/* 여럿이 하는 방(party-kit) + 네 게임 테스트.
 *   node tools/party-smoke.js
 * 사람 여럿(토큰)과 AI 를 섞어 2~8명 방을 끝까지 돌린다. 봇은 BOT_DELAY 뒤에 움직이니 now 를 흘린다.
 */
const path = require('path');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? ' ok ' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
function memStore() { const m = new Map(); return { async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); }, async set(k, v) { m.set(k, JSON.stringify(v)); } }; }
const lib = (f) => import(path.join(__dirname, '..', 'netlify/lib', f));

(async () => {
  const K = await lib('party-kit.mjs');
  const Bi = await lib('party-bingo-core.mjs'), Sp = await lib('party-spice-core.mjs'), Ex = await lib('party-expedition-core.mjs'), Ma = await lib('party-marble-core.mjs');
  const DT = K.BOT_DELAY + 300;

  /* 방 하나를 여러 사람이 쓰는 흉내 — humans 명이 토큰을 들고, bots 명은 서버 봇 */
  function table(handle, humans, bots, max, opts = {}) {
    const store = memStore(); let now = 1_000_000; const toks = [], codes = { code: null };
    const as = async (i, b, dt = 0) => { now += dt; const r = await handle({ ...b, token: toks[i], code: codes.code }, store, now); if (r.body.token) toks[i] = r.body.token; if (r.body.code) codes.code = r.body.code; return r; };
    return {
      store, as, now: () => now,
      async open() {   // 사람이 먼저 앉고(0..humans-1) AI 는 그 뒤 자리
        const r = await as(0, { action: 'create', name: '사람1', max, ...opts });
        for (let i = 1; i < humans; i++) await as(i, { action: 'join', name: '사람' + (i + 1) });
        for (let i = 0; i < bots; i++) await as(0, { action: 'addbot' });
        return r;
      },
      start: () => as(0, { action: 'start' }),
      poll: (i = 0) => as(i, { action: 'state' }, DT),
    };
  }
  const deepHas = (o, pred) => JSON.stringify(o, (k, v) => (pred(k, v) ? '__HIT__' : v)).includes('__HIT__');

  try {
    /* ---------- kit: 방 만들기·들어오기·시작·AI ---------- */
    {
      const t = table(Bi.handle, 3, 0, 3);
      let r = await t.open();
      check('kit: 방장이 만들고 둘이 들어와 3명', r.status === 200 && (await t.poll()).body.players.length === 3);
      const full = await Bi.handle({ action: 'join', name: '넷째', code: (await t.poll()).body.code }, t.store, t.now());
      check('kit: 자리가 차면 못 들어온다', full.status === 409, full.body.error);
      const notHost = await t.as(1, { action: 'start' });
      check('kit: 방장만 시작', notHost.status === 403);
      const early = await t.as(1, { action: 'call', n: 3 });
      check('kit: 시작 전엔 게임 행동 거부', early.status === 409);
      r = await t.start();
      check('kit: 시작하면 play', r.body.phase === 'play' && typeof r.body.first === 'number');
      const late = await Bi.handle({ action: 'join', name: '늦은이', code: r.body.code }, t.store, t.now());
      check('kit: 시작한 뒤엔 못 들어온다', late.status === 409);
      const t2 = table(Bi.handle, 1, 0, 8);
      await t2.open();
      for (let i = 0; i < 9; i++) await t2.as(0, { action: 'addbot' });
      r = await t2.poll();
      check('kit: AI 추가는 최대 인원까지 (8명)', r.body.players.length === 8 && r.body.players.filter((p) => p.bot).length === 7, String(r.body.players.length));
      await t2.as(0, { action: 'removebot' });
      check('kit: AI 빼기', (await t2.poll()).body.players.length === 7);
      const alone = table(Bi.handle, 1, 0, 4); await alone.open();
      check('kit: 혼자서는 시작 못 함', (await alone.start()).status === 409);
      const solo = table(Bi.handle, 1, 0, 4, { bot: true }); r = await solo.open();
      check('kit: 탕비실 혼자 하기(bot:true)는 AI 하나와 바로 시작', r.body.phase === 'play' && r.body.players.length === 2 && r.body.bot === true);
      const solo3 = table(Bi.handle, 1, 0, 2, { bot: true, bots: 3 }); r = await solo3.open();
      check('kit: 혼자 하기 bots:3 — AI 셋과 4명 방으로 바로 시작 (max 가 작아도 늘린다)', r.body.phase === 'play' && r.body.players.length === 4 && r.body.max === 4 && r.body.players.filter((p) => p.bot).length === 3, JSON.stringify({ n: r.body.players.length, max: r.body.max }));
      const solo9 = table(Bi.handle, 1, 0, 8, { bot: true, bots: 9 }); r = await solo9.open();
      check('kit: 혼자 하기 bots 는 7명까지', r.body.players.length === 8);
      check('kit: 등수 — 같은 점수는 같은 등수', JSON.stringify(K.ranking([10, 30, 30, null, 5]).map((x) => [x.i, x.rank])) === JSON.stringify([[1, 1], [2, 1], [0, 3], [4, 4]]));
    }

    /* ---------- 빙고 5명 (사람 2 + AI 3) ---------- */
    {
      const t = table(Bi.handle, 2, 3, 5);
      let r = await t.open(); r = await t.start();
      check('빙고: 시작 직후 setup', r.body.stage === 'setup');
      for (let i = 0; i < 3 && r.body.readyAll.filter(Boolean).length < 3; i++) r = await t.poll();
      check('빙고: AI 셋이 한 번의 폴링으로 다 준비(quick)', r.body.readyAll.filter(Boolean).length === 3, JSON.stringify(r.body.readyAll));
      const board = (seed) => { const a = [...Array(25)].map((_, i) => i + 1); for (let i = a.length - 1; i > 0; i--) { const j = (seed * (i + 7)) % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
      await t.as(0, { action: 'ready', board: board(3) });
      r = await t.as(1, { action: 'ready', board: board(11) });
      check('빙고: 다 준비하면 play', r.body.stage === 'play', r.body.stage);
      check('빙고: 남의 판은 안 보인다', r.body.boards === null && !deepHas(r.body, (k, v) => k === 'board' && Array.isArray(v) && v.length === 25 && v !== r.body.board) && Array.isArray(r.body.board));
      let guard = 0;
      while (r.body.stage === 'play' && guard++ < 200) {
        if (r.body.turn === 0 || r.body.turn === 1) { const me = r.body.turn; const b = me === 0 ? board(3) : board(11); const n = b.find((x) => !r.body.called.includes(x)); r = await t.as(me, { action: 'call', n }); if (r.status !== 200) { check('빙고: 부르기 오류', false, r.body.error); break; } r = await t.as(me === 0 ? 1 : 0, { action: 'state' }); }
        else r = await t.poll(0);
      }
      check('빙고: 5명이 끝까지 간다', r.body.stage === 'done' && r.body.winners && r.body.winners.length >= 1, 'stage=' + r.body.stage + ' winners=' + JSON.stringify(r.body.winners) + ' called=' + r.body.called.length);
      check('빙고: 끝나면 판이 다 공개된다', r.body.boards && r.body.boards.filter(Boolean).length === 5);
      const again = await t.as(0, { action: 'restart', round: r.body.round });
      check('빙고: 다시 하기 — 새 판, 자리 유지', again.body.round === 2 && again.body.stage === 'setup' && again.body.players.length === 5);
    }

    /* ---------- 향신료 시장 2·4·8명 (AI 만) ---------- */
    for (const n of [2, 4, 8]) {
      const t = table(Sp.handle, 1, n - 1, n);
      let r = await t.open(); r = await t.start();
      check(`향신료 ${n}명: 덱 ${Sp.decksFor(n)}벌`, r.body.decks === Sp.decksFor(n) && r.body.hand.length <= 5 && r.body.market.length === 5, JSON.stringify({ decks: r.body.decks, hand: r.body.hand.length }));
      let guard = 0, leaked = false;
      while (r.body.stage === 'play' && guard++ < 600) {
        if (r.body.yourTurn) { /* 사람은 봇 수를 빌려 쓴다 */
          const st = await t.store.get('room:' + r.body.code);
          const ctx = { room: st, idx: 0, active: K.activeSeats(st), docs: st.players.map(() => ({})) };
          const m = Sp.botMove(ctx, Math.random);
          r = await t.as(0, { action: m.act, ...m.body }); if (r.status !== 200) { check('향신료: 사람 수 오류', false, r.body.error); break; }
        } else r = await t.poll(0);
        if (deepHas(r.body, (k, v) => k === 'hands')) leaked = true;
      }
      check(`향신료 ${n}명: 끝까지 간다 (${guard}번)`, r.body.stage === 'done' && r.body.winners.length >= 1 && r.body.rank, 'stage=' + r.body.stage + ' reason=' + r.body.reason);
      check(`향신료 ${n}명: 남의 손패는 장수만`, !leaked && r.body.seats.every((s) => typeof s.hand === 'number'));
      if (n === 4) {
        // 낙타 보너스는 혼자 1등일 때만
        const g = (await t.store.get('room:' + r.body.code)).g, act = [0, 1, 2, 3];
        const herds = g.herds.slice(); const top = Math.max(...herds); const tops = herds.filter((h) => h === top).length;
        check('향신료: 낙타 보너스는 혼자 가장 많을 때만', act.every((i) => (Sp.score(g, i, act).camel === 5) === (herds[i] === top && tops === 1 && top > 0)));
      }
    }

    /* ---------- 탐험대 3명: 사람 1 + AI 2, 중간 기권 ---------- */
    {
      const t = table(Ex.handle, 2, 1, 3);
      let r = await t.open(); r = await t.start();
      check('탐험대 3명: 덱 2벌, 손 8장', r.body.decks === 2 && r.body.hand.length === 8 && r.body.deck === 120 - 24);
      let guard = 0, resigned = false;
      while (r.body.stage === 'play' && guard++ < 800) {
        if (r.body.yourTurn) {
          const st = await t.store.get('room:' + r.body.code);
          const m = Ex.botMove({ room: st, idx: 0, active: K.activeSeats(st) }, Math.random);
          r = await t.as(0, { action: m.act, ...m.body }); if (r.status !== 200) { check('탐험대: 사람 수 오류', false, r.body.error); break; }
        } else if (r.body.turn === 1) {
          if (!resigned && r.body.turnNo > 6) { r = await t.as(1, { action: 'resign' }); resigned = true; r = await t.as(0, { action: 'state' }); }
          else { const st = await t.store.get('room:' + r.body.code); const m = Ex.botMove({ room: st, idx: 1, active: K.activeSeats(st) }, Math.random); await t.as(1, { action: m.act, ...m.body }); r = await t.as(0, { action: 'state' }); }
        } else r = await t.poll(0);
      }
      check('탐험대 3명: 한 명이 기권해도 끝까지 간다', r.body.stage === 'done' && resigned && r.body.players[1].out === true, 'stage=' + r.body.stage + ' guard=' + guard);
      check('탐험대: 기권한 사람은 순위에 없다', r.body.rank.every((x) => x.i !== 1) && r.body.scores[1] === null);
      check('탐험대: 남의 손패는 장수만', !deepHas(r.body, (k, v) => k === 'hands') && Array.isArray(r.body.handCounts));
    }

    /* ---------- 마블 4명 (사람 1 + AI 3) 와 6명 (AI 만) ---------- */
    for (const [humans, bots] of [[1, 3], [1, 5]]) {
      const n = humans + bots, t = table(Ma.handle, humans, bots, n);
      let r = await t.open(); r = await t.start();
      check(`마블 ${n}명: 시작 — 현금 ${Ma.START_CASH}, 출발점`, r.body.cash.every((c) => c === Ma.START_CASH) && r.body.pos.every((p) => p === 0) && r.body.state === 'roll');
      let guard = 0, bought = false, rentPaid = false;
      while (r.body.stage === 'play' && guard++ < 3000) {
        if (r.body.yourTurn) {
          const act = r.body.state === 'roll' ? 'roll' : r.body.state === 'buy' ? (r.body.cash[0] - Ma.BOARD[r.body.pending].price > 100 ? 'buy' : 'skip') : 'build';
          r = await t.as(0, { action: act }); if (r.status !== 200) { check('마블: 사람 수 오류', false, r.body.error + ' state=' + r.body.state); break; }
        } else r = await t.poll(0);
        if (r.body.own.some((o) => o)) bought = true;
        if (r.body.log.some((l) => /통행료/.test(l.text))) rentPaid = true;
      }
      check(`마블 ${n}명: 끝까지 간다 (${guard}번, 차례 ${r.body.turnNo}/${r.body.maxTurns})`, r.body.stage === 'done' && r.body.rank && r.body.winners.length >= 1, 'stage=' + r.body.stage);
      check(`마블 ${n}명: 땅을 사고 통행료가 오간다`, bought && rentPaid);
      check(`마블 ${n}명: 현금은 음수가 안 된다`, r.body.cash.every((c) => c >= 0));
      check(`마블 ${n}명: 총자산 순위 = 1등은 가장 부자`, r.body.rank[0].s === Math.max(...r.body.worth.filter((w) => w !== null)));
    }
    // 규칙 단위: 같은 색 셋 → 통행료 2배, 건물 값
    {
      const g = { own: Array(Ma.N).fill(null), cash: [0] };
      g.own[1] = { p: 0, lv: 0 };
      check('마블: 땅만 있을 때 통행료 = 가격의 10%', Ma.rentOf(g, 1) === 6);
      g.own[2] = { p: 0, lv: 0 }; g.own[4] = { p: 0, lv: 0 };
      check('마블: 같은 색 셋이면 2배', Ma.rentOf(g, 1) === 12);
      g.own[1].lv = 3;
      check('마블: 호텔 통행료 = 가격 × 1.5 (× 독점 2)', Ma.rentOf(g, 1) === 180);
      check('마블: 빌라 건축비 = 가격의 절반', Ma.buildCost(27, 1) === 160);
    }
  } catch (e) { check('예외 없이 끝난다', false, e.stack || String(e)); }
  console.log(failures ? `\n실패 ${failures}` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
