#!/usr/bin/env node
/* 향신료 시장 규칙 테스트 — netlify/lib/spice-core.mjs 를 그대로 불러 돌린다. npm install 없이:
 *   node tools/spice-smoke.js
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

(async () => {
  const S = await lib('spice-core.mjs');
  const { BOT_DELAY, BOT_NAME, seeded } = await lib('room-kit.mjs');
  const { handle, actions, setup, status, score, winnerOf, botMove, GOODS, CAMEL, COUNTS, TOKENS, countBy } = S;

  // 서버 밖에서 판 하나를 직접 만지는 맥락
  const mkRoom = (code = '1234', round = 1) => { const room = { code, round, players: [{ token: 'a' }, { token: 'b' }], opts: { pick: 'coin' } }; setup(room); return room; };
  const mkCtx = (room, idx, body = {}) => { const docs = [{ round: room.round }, { round: room.round }]; return { room, idx, now: 0, body, me: docs[idx], other: docs[1 - idx], docs, joined: true, touchRoom: false, touchMe: false }; };
  const turnOf = (room) => status(mkCtx(room, 0)).turn;
  const doAct = (room, act, body, idx = turnOf(room)) => actions[act](mkCtx(room, idx, body));
  const allCards = (g) => g.deck.length + g.market.length + g.hands[0].length + g.hands[1].length + g.herds[0] + g.herds[1] + g.sold;

  try {
    /* ---- 준비 ---- */
    {
      const room = mkRoom();
      const g = room.g;
      check('카드는 모두 55장', allCards(g) === 55, String(allCards(g)));
      const all = [...g.deck, ...g.market, ...g.hands[0], ...g.hands[1]];
      const c = countBy(all);
      c.k = (c.k || 0) + g.herds[0] + g.herds[1];
      check('종류별 장수가 규칙대로', Object.keys(COUNTS).every((t) => (c[t] || 0) === COUNTS[t]), JSON.stringify(c));
      check('시장은 5장, 낙타가 3장 이상', g.market.length === 5 && g.market.filter((t) => t === CAMEL).length >= 3);
      check('손에 든 낙타는 무리로 갔다', !g.hands[0].includes(CAMEL) && !g.hands[1].includes(CAMEL) && g.hands[0].length + g.herds[0] === 5 && g.hands[1].length + g.herds[1] === 5);
      check('덱 40장 남음', g.deck.length === 40, String(g.deck.length));
      check('상품 토큰 더미 6개', GOODS.every((t) => JSON.stringify(g.tokens[t]) === JSON.stringify(TOKENS[t])));
      const r2 = mkRoom(), r3 = mkRoom('1234', 2), r4 = mkRoom('9999', 1);
      check('같은 방 · 같은 판이면 같은 덱 (다시 하기 동시 클릭)', JSON.stringify(r2.g) === JSON.stringify(room.g));
      check('판이 바뀌면 덱도 바뀐다', JSON.stringify(r3.g.deck) !== JSON.stringify(room.g.deck) && JSON.stringify(r4.g.deck) !== JSON.stringify(room.g.deck));
      check('보너스 토큰은 섞여 있다 (방마다 순서가 다르다)', [...Array(20)].some((_, i) => JSON.stringify(mkRoom(String(2000 + i)).g.bonus[3]) !== JSON.stringify(room.g.bonus[3])));
    }

    /* ---- 가져오기 / 낙타 ---- */
    {
      const room = mkRoom(); const g = room.g; const p = turnOf(room);
      g.market = ['k', 'k', 'd', 'l', 'k']; g.hands[p] = ['c']; const deckBefore = g.deck.length;
      check('시장 낙타를 한 장만은 못 가져온다', !!doAct(room, 'take', { card: 0 }));
      let e = doAct(room, 'take', { card: 2 });
      check('상품 1장 가져오기', !e && g.hands[p].includes('d') && g.market.length === 5 && g.deck.length === deckBefore - 1, e && e.error);
      check('차례가 넘어간다', turnOf(room) === 1 - p);
      check('상대 차례에 하면 409', (doAct(room, 'take', { card: 0 }, p) || {}).status === 409);
      const q = 1 - p;
      g.hands[q] = ['c', 'c', 'c', 'p', 'p', 'l', 'l'];
      g.market = ['d', 'k', 'k', 's', 'g'];
      check('손 7장이면 가져오기 막힘', (doAct(room, 'take', { card: 0 }) || {}).status === 409);
      const herd = g.herds[q];
      e = doAct(room, 'camels', {});
      check('낙타 전부 가져오기', !e && g.herds[q] === herd + 2 && !g.market.slice(0, 3).includes('k') && g.market.length === 5, e && e.error);
      g.market = ['d', 'g', 's', 'c', 'p'];
      check('시장에 낙타가 없으면 막힘', !!doAct(room, 'camels', {}));
    }

    /* ---- 교환 ---- */
    {
      const room = mkRoom(); const g = room.g; const p = turnOf(room);
      g.market = ['d', 'g', 'k', 'c', 'l']; g.hands[p] = ['s', 'p', 'l']; g.herds[p] = 2;
      check('1장은 교환 못 함', !!doAct(room, 'trade', { take: [0], give: [0] }));
      check('시장 낙타는 교환으로 못 가져옴', !!doAct(room, 'trade', { take: [0, 2], give: [0, 1] }));
      check('같은 종류는 주고받을 수 없다', /같은 종류/.test((doAct(room, 'trade', { take: [0, 4], give: [0, 2] }) || {}).error || ''));
      check('수가 안 맞으면 막힘', !!doAct(room, 'trade', { take: [0, 1], give: [0] }));
      check('낙타가 모자라면 막힘', !!doAct(room, 'trade', { take: [0, 1, 3], give: [], camels: 3 }));
      const e = doAct(room, 'trade', { take: [0, 1, 3], give: [0], camels: 2 });
      check('손패 1 + 낙타 2 ↔ 시장 3장', !e && JSON.stringify(g.hands[p]) === JSON.stringify(['d', 'g', 'c', 'p', 'l']) && g.herds[p] === 0
        && JSON.stringify(g.market) === JSON.stringify(['s', 'k', 'k', 'k', 'l']), (e && e.error) + ' ' + g.hands[p] + ' / ' + g.market);
      check('교환은 덱을 안 건드린다', g.deck.length === 40);
      check('카드 수 보존', allCards(g) === 55);
      const room2 = mkRoom(); const g2 = room2.g; const p2 = turnOf(room2);
      g2.market = ['d', 'g', 's', 'c', 'k']; g2.hands[p2] = ['l', 'l', 'l', 'l', 'p', 'p']; g2.herds[p2] = 3;
      check('바꾸고 7장 넘으면 막힘', /7장/.test((doAct(room2, 'trade', { take: [0, 1, 2], give: [0], camels: 2 }) || {}).error || ''));
    }

    /* ---- 팔기 ---- */
    {
      const room = mkRoom(); const g = room.g; const p = turnOf(room);
      g.hands[p] = ['d', 'c', 'c', 'c', 'c', 'l'];
      check('다이아 1장은 못 판다', /2장 이상/.test((doAct(room, 'sell', { type: 'd', n: 1 }) || {}).error || ''));
      check('없는 만큼은 못 판다', !!doAct(room, 'sell', { type: 'c', n: 5 }));
      const b4 = g.bonus[4][0];
      const e = doAct(room, 'sell', { type: 'c', n: 4 });
      const w = g.won[p];
      check('비단 4장 → 토큰 5+3+3+2 = 13', !e && w.goods.reduce((a, x) => a + x.v, 0) === 13 && JSON.stringify(g.tokens.c) === '[2,1,1]', JSON.stringify(w));
      check('4장 보너스 토큰 하나 (위에서부터)', w.bonus.length === 1 && w.bonus[0].v === b4 && g.bonus[4].length === 5);
      check('손에서 빠졌다', JSON.stringify(g.hands[p]) === '["d","l"]');
      check('마지막 행동 기록', g.last.kind === 'sell' && g.last.type === 'c' && g.last.n === 4 && g.last.gain === 13 && g.last.bonus === true && g.last.by === p);
      // 토큰이 모자라면 남은 것만
      const q = 1 - p;
      g.hands[q] = ['p', 'p', 'p', 'p', 'p', 'p', 'p']; g.tokens.p = [1, 1];
      doAct(room, 'sell', { type: 'p', n: 7 });
      check('토큰이 2개뿐이면 2개만, 보너스는 5장 이상', g.won[q].goods.length === 2 && g.won[q].bonus[0].k === 5);
      check('1~2장 팔면 보너스 없음', (() => { const r = mkRoom(); const t = turnOf(r); r.g.hands[t] = ['l', 'l']; doAct(r, 'sell', { type: 'l', n: 2 }); return r.g.won[t].bonus.length === 0 && r.g.won[t].goods.length === 2; })());
    }

    /* ---- 끝 조건 ---- */
    {
      const room = mkRoom(); const g = room.g; const p = turnOf(room);
      g.tokens.d = []; g.tokens.g = []; g.tokens.s = [5];
      g.hands[p] = ['s', 's'];
      doAct(room, 'sell', { type: 's', n: 2 });
      check('토큰 더미 3개가 비면 끝', status(mkCtx(room, 0)).phase === 'done' && g.over === 'tokens');
      check('끝나면 아무것도 못 함', (doAct(room, 'take', { card: 3 }, 1 - p) || {}).status === 409);
      const r2 = mkRoom(); const g2 = r2.g; const p2 = turnOf(r2);
      g2.deck = []; g2.market = ['d', 'k', 'k', 's', 'g']; g2.hands[p2] = [];
      doAct(r2, 'take', { card: 0 });
      check('시장을 못 채우면 끝', g2.over === 'deck' && status(mkCtx(r2, 0)).phase === 'done');
      const r3 = mkRoom(); const g3 = r3.g; const p3 = turnOf(r3);
      g3.deck = ['c']; g3.market = ['k', 'k', 'k', 's', 'g'];
      doAct(r3, 'camels', {});
      check('덱이 모자라면 (3장 필요, 1장 남음) 끝', g3.over === 'deck' && g3.market.length === 3);
      const r4 = mkRoom(); const g4 = r4.g;
      g4.deck = ['c']; g4.market = ['d', 'k', 'k', 's', 'g'];
      doAct(r4, 'take', { card: 0 });
      check('딱 채울 수 있으면 안 끝남', !g4.over && g4.deck.length === 0 && g4.market.length === 5);
    }

    /* ---- 점수 · 동점 ---- */
    {
      const room = mkRoom(); const g = room.g;
      g.won[0] = { goods: [{ t: 'd', v: 7 }, { t: 'd', v: 7 }], bonus: [{ k: 3, v: 2 }] };
      g.won[1] = { goods: [{ t: 'l', v: 4 }, { t: 'l', v: 3 }, { t: 'l', v: 2 }, { t: 'l', v: 1 }], bonus: [{ k: 4, v: 4 }] };
      g.herds = [1, 4];
      check('점수 = 상품 + 보너스 + 낙타 5', score(g, 0).total === 16 && score(g, 1).total === 19 && score(g, 1).camel === 5);
      g.herds = [3, 3];
      check('낙타가 같으면 아무도 5점 없음', score(g, 0).camel === 0 && score(g, 1).camel === 0);
      g.won[1].goods.pop(); g.won[1].goods.push({ t: 'l', v: 3 });   // 1: 4+3+2+3+4 = 16
      check('동점이면 보너스 개수 → 같으면 상품 토큰 개수', winnerOf(g) === 1, String(winnerOf(g)));
      g.won[0].goods = [{ t: 'c', v: 5 }, { t: 'c', v: 3 }, { t: 'c', v: 3 }, { t: 'c', v: 3 }]; // 14+2 = 16, 토큰 4개 · 보너스 1개
      check('다 같으면 무승부', winnerOf(g) === 'draw', JSON.stringify([score(g, 0), score(g, 1)]));
      g.won[0].bonus.push({ k: 3, v: 0 });
      check('보너스 개수가 많은 쪽이 이긴다', winnerOf(g) === 0);
    }

    /* ---- 서버를 거쳐서: 비밀 · 차례 · 다시 하기 ---- */
    {
      const store = memStore();
      let now = 5_000_000;
      const call = (b) => handle(b, store, (now += 10));
      const c = await call({ action: 'create', name: '민호', pick: 'rps' });
      const code = c.body.code, t0 = c.body.token;
      check('방 만들기 → 기다리기', c.status === 200 && c.body.phase === 'wait');
      const j = await call({ action: 'join', code, name: '지유' });
      const t1 = j.body.token;
      check('들어가면 선 정하기', j.body.phase === 'pick');
      await call({ action: 'throw', code, token: t0, value: 'r' });
      let r = await call({ action: 'throw', code, token: t1, value: 's' });
      check('가위바위보로 민호 먼저', r.body.phase === 'play' && r.body.first === 0, r.body.phase + ' ' + r.body.first);
      const room = await store.get('room:' + code);
      const A = await call({ action: 'state', code, token: t0 });
      const B = await call({ action: 'state', code, token: t1 });
      const js = JSON.stringify(A.body);
      check('내 손패는 받는다', JSON.stringify(A.body.hand) === JSON.stringify(room.g.hands[0]));
      check('상대 손패는 장수만 (숫자)', typeof A.body.opp.hand === 'number' && A.body.opp.hand === room.g.hands[1].length && !('oppHand' in A.body));
      check('덱은 장수만', typeof A.body.deck === 'number' && !js.includes(JSON.stringify(room.g.deck)) && !js.includes(room.g.deck.join('')));
      check('보너스 토큰 값은 안 보낸다', typeof A.body.bonusLeft[3] === 'number' && !js.includes(JSON.stringify(room.g.bonus[3])) && !js.includes(JSON.stringify(room.g.bonus[5])) && !('final' in A.body));
      check('응답 어디에도 room.g 통째가 없다', !js.includes('"hands"') && !js.includes('"won"'));
      check('지유 쪽도 민호 손패를 모른다', !JSON.stringify(B.body).includes('"hand":' + JSON.stringify(room.g.hands[0])) && B.body.opp.hand === room.g.hands[0].length);
      const bad = await call({ action: 'camels', code, token: t1 });
      check('차례 아닌 행동은 409', bad.status === 409);
      // 민호가 낙타 전부 → 지유 화면에 마지막 행동
      r = await call({ action: 'camels', code, token: t0 });
      check('낙타 전부', r.status === 200 && r.body.herd >= 3, JSON.stringify(r.body.error));
      const B2 = await call({ action: 'state', code, token: t1 });
      check('상대 화면에 마지막 행동', B2.body.last && B2.body.last.kind === 'camels' && B2.body.last.by === 0 && B2.body.yourTurn);
      // 내 보너스 값도 끝날 때까지 비밀: 방을 고쳐 보너스를 하나 쥐여 준다
      const rm = await store.get('room:' + code);
      rm.g.won[0].bonus.push({ k: 5, v: 10 });
      await store.set('room:' + code, rm);
      const A2 = await call({ action: 'state', code, token: t0 });
      check('내가 받은 보너스도 개수만', A2.body.me.bonus === 1 && !JSON.stringify(A2.body.me).includes('10'));
      // 기권 → 끝 → 공개 → 다시 하기
      r = await call({ action: 'resign', code, token: t1 });
      check('기권하면 끝', r.body.phase === 'done' && r.body.winner === 0 && r.body.reason === 'resign');
      check('끝나면 점수 내역 · 보너스 값 · 상대 손패 공개', r.body.final && Array.isArray(r.body.final.oppBonus) && r.body.final.oppBonus[0] === 10 && Array.isArray(r.body.oppHand));
      const again = await call({ action: 'restart', code, token: t0, round: 1 });
      const again2 = await call({ action: 'restart', code, token: t1, round: 1 });
      check('다시 하기 → 2판, 선 정하기부터', again.body.round === 2 && again.body.phase === 'pick' && again2.body.round === 2);
      const rm2 = await store.get('room:' + code);
      const ref = { code, round: 2, players: [{}, {}], opts: { pick: 'rps' } }; setup(ref);
      check('둘이 동시에 눌러도 같은 판 (seeded)', JSON.stringify(rm2.g.deck) === JSON.stringify(ref.g.deck));
      check('끝나기 전 다시 하기는 막힘', (await call({ action: 'restart', code, token: t0, round: 2 })).status === 400);
    }

    /* ---- 봇 방 끝까지 (사람은 폰처럼 폴링하며 대충 둔다) ---- */
    {
      let now = 1_000_000, tok = null, code = null;
      const store = memStore();
      const call = async (b, dt = 0) => { now += dt; const r = await handle({ ...b, token: tok, code }, store, now); if (r.body.token) tok = r.body.token; if (r.body.code) code = r.body.code; return r; };
      const poll = () => call({ action: 'state' }, BOT_DELAY + 500);
      let r = await call({ action: 'create', name: '나', pick: 'mjb', bot: true });
      check('봇 방은 바로 상대가 있다', r.body.opponent.joined && r.body.opponent.name === BOT_NAME && r.body.bot);
      for (let i = 0; i < 30 && r.body.phase === 'pick'; i++) { if (r.body.pick.mineNow === null) r = await call({ action: 'throw', value: ['r', 's', 'p'][i % 3] }); r = await poll(); }
      check('봇과 묵찌빠로 선을 정한다', r.body.phase === 'play', r.body.phase);
      const noDelay = await call({ action: 'state' }, 0);
      check('지연 전엔 봇이 안 움직인다', noDelay.body.moves === r.body.moves);
      let mine = 0, theirs = 0, guard = 0;
      while (r.body.phase === 'play' && guard++ < 400) {
        if (r.body.yourTurn) {
          const b = r.body; const cnt = countBy(b.hand);
          let mv = null;
          const sellT = GOODS.find((t) => (cnt[t] || 0) >= 3) || (b.hand.length >= 7 ? GOODS.find((t) => (cnt[t] || 0) >= (['d', 'g', 's'].includes(t) ? 2 : 1)) : null);
          if (sellT) mv = { action: 'sell', type: sellT, n: cnt[sellT] };
          else if (b.market.filter((t) => t === 'k').length >= 2) mv = { action: 'camels' };
          else { const i = b.market.findIndex((t) => t !== 'k'); mv = i >= 0 && b.hand.length < 7 ? { action: 'take', card: i } : { action: 'camels' }; }
          const before = b.moves;
          r = await call(mv);
          if (r.status !== 200) { check('사람 수가 거절되지 않는다', false, JSON.stringify(mv) + ' ' + r.body.error); break; }
          if (r.body.moves === before + 1) mine++;
        } else { const before = r.body.moves; r = await poll(); if (r.body.moves > before) theirs++; }
      }
      check('봇 방이 끝까지 간다', r.body.phase === 'done', r.body.phase + ' guard=' + guard);
      check('봇도 계속 둔다', theirs >= 10, `사람 ${mine} · 봇 ${theirs}`);
      check('끝나면 점수가 나온다', r.body.final && typeof r.body.final.me.total === 'number', JSON.stringify(r.body.final));
      const again = await call({ action: 'restart', round: r.body.round });
      check('다시 하기 뒤 봇 방 유지', again.body.bot === true && again.body.round === 2 && again.body.opponent.joined);
    }

    /* ---- 봇끼리 · 무작위 수로 수백 판 ---- */
    {
      const rnd = seeded('spice-sim');
      const legal = (ctx) => {
        const g = ctx.room.g, hand = g.hands[ctx.idx], c = [];
        g.market.forEach((t, i) => { if (t !== CAMEL) c.push(['take', { card: i }]); });
        c.push(['camels', {}]);
        const cnt = countBy(hand);
        for (const t of GOODS) for (let n = 1; n <= (cnt[t] || 0); n++) c.push(['sell', { type: t, n }]);
        for (let k = 0; k < 3; k++) {                 // 무작위 교환 (대부분 반칙이라 걸러진다)
          const take = [0, 1, 2, 3, 4].sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 3));
          const give = hand.map((_, i) => i).sort(() => rnd() - 0.5).slice(0, Math.floor(rnd() * (take.length + 1)));
          c.push(['trade', { take, give, camels: take.length - give.length }]);
        }
        return c.sort(() => rnd() - 0.5);
      };
      let games = 0, crashes = 0, stuck = 0, illegalBot = 0, broken = 0, longest = 0, wins = [0, 0, 0], trades = 0;
      for (let i = 0; i < 600; i++) {
        const room = mkRoom(String(3000 + i));
        const mode = i % 3;                           // 0: 봇 vs 봇, 1: 봇 vs 무작위, 2: 무작위 vs 무작위
        try {
          let n = 0;
          for (; n < 2000; n++) {
            const s = status(mkCtx(room, 0));
            if (s.phase === 'done') break;
            const ctx = mkCtx(room, s.turn);
            const useBot = mode === 0 || (mode === 1 && s.turn === 1);
            if (useBot) {
              const mv = botMove(ctx, rnd);
              if (!mv) { stuck++; break; }
              ctx.body = mv.body;
              if (actions[mv.act](ctx)) { illegalBot++; break; }
            } else {
              let ok = false;
              for (const [a, b] of legal(ctx)) { const c2 = mkCtx(room, s.turn, b); if (!actions[a](c2)) { ok = true; if (a === 'trade') trades++; break; } }
              if (!ok) { stuck++; break; }
            }
            if (allCards(room.g) !== 55 || room.g.market.length > 5 || room.g.hands.some((h) => h.length > 7)) { broken++; break; }
          }
          longest = Math.max(longest, n);
          const s = status(mkCtx(room, 0));
          if (s.phase === 'done') { games++; if (mode === 1) wins[s.winner === 'draw' ? 2 : s.winner]++; }
        } catch (e) { crashes++; if (crashes < 3) console.log(e.stack); }
      }
      check('600판 예외 없음', crashes === 0, String(crashes));
      check('봇이 반칙 수를 낸 적 없음 · 멈춘 적 없음', illegalBot === 0 && stuck === 0, `illegal=${illegalBot} stuck=${stuck}`);
      check('카드 55장 · 시장 ≤5 · 손 ≤7 이 늘 지켜진다', broken === 0, String(broken));
      check('전부 끝까지 간다 (무한 루프 없음)', games === 600, `${games}판, 가장 긴 판 ${longest}수`);
      check('무작위 수도 교환을 해 봤다', trades > 20, String(trades));
      check('봇은 무작위 수를 거의 다 이긴다', wins[1] >= 190, JSON.stringify(wins));
    }
  } catch (e) { check('예외 없이 끝난다', false, e.stack || String(e)); }
  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
