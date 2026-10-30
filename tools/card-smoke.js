/* 카드 게임 셋 — 고스톱·맞고 / 섯다 / 텍사스 홀덤. 규칙 단위 검사 + 봇끼리 끝까지 여러 판(패·칩 보존, 비밀 노출, 예외 없음)
 *   node tools/card-smoke.js */
'use strict';
const path = require('path');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? ' ok ' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
function memStore() { const m = new Map(); return { async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); }, async set(k, v) { m.set(k, JSON.stringify(v)); } }; }
const lib = (f) => import(path.join(__dirname, '..', 'netlify/lib', f));
const DT = 1000;

/* 사람 자리들은 core 의 botMove 로 대신 둔다 (store 의 방을 직접 읽어 ctx 를 만든다) */
function table(core, humans, bots, max, opts = {}) {
  const store = memStore(); let now = 1_000_000; const toks = [], codes = { code: null };
  const as = async (i, b, dt = 0) => { now += dt; const r = await core.handle({ ...b, token: toks[i], code: codes.code }, store, now); if (r.body.token) toks[i] = r.body.token; if (r.body.code) codes.code = r.body.code; return r; };
  const room = async () => store.get('room:' + codes.code);
  return {
    store, as, room, humans,
    async open() { const r = await as(0, { action: 'create', name: '사람1', max, ...opts }); for (let i = 1; i < humans; i++) await as(i, { action: 'join', name: '사람' + (i + 1) }); for (let i = 0; i < bots; i++) await as(0, { action: 'addbot' }); return r; },
    start: () => as(0, { action: 'start' }),
    poll: (i = 0) => as(i, { action: 'state' }, DT),
    async humanMove(i, rnd) {
      const rm = await room(); const active = rm.players.map((_, k) => k).filter((k) => !(rm.out && rm.out[k]));
      const mv = core.botMove({ room: rm, idx: i, active, body: {}, me: {}, docs: [], n: rm.players.length, now }, rnd);
      if (!mv) return null;
      return as(i, { action: mv.act, ...(mv.body || {}) });
    },
  };
}
/* 끝까지 — 매 걸음 invariant(view, room) 를 부른다 */
async function playOut(core, humans, bots, max, opts, invariant, maxSteps = 4000) {
  const t = table(core, humans, bots, max, opts);
  await t.open();
  let r = await t.start();
  let steps = 0, rnd = (() => { let x = 7; return () => ((x = (x * 48271) % 2147483647) / 2147483647); })();
  while (r.body.stage !== 'done' && steps++ < maxSteps) {
    for (let h = 0; h < humans; h++) {
      r = await t.poll(h);
      if (r.status !== 200) throw new Error('poll ' + r.status + ' ' + r.body.error);
      invariant(r.body, await t.room(), h);
      if (r.body.stage === 'done') break;
      let mv;
      if (r.body.step === 'result') mv = await t.as(h, { action: 'next', hand: r.body.hand });     // 사람이 '다음 판'을 누른다
      else mv = await t.humanMove(h, rnd);
      if (mv && mv.status >= 500) throw new Error('human move ' + mv.status + ' ' + mv.body.error);
    }
  }
  return { r, steps, t };
}

(async () => {
  const G = await lib('party-gostop-core.mjs'), S = await lib('party-seotda-core.mjs'), H = await lib('party-holdem-core.mjs');
  try {
    /* ---------- 고스톱 점수 ---------- */
    {
      const id = (m, k) => (m - 1) * 4 + k;
      check('고스톱: 삼광 3점', G.scoreOf([id(1, 0), id(3, 0), id(8, 0)]).score === 3);
      check('고스톱: 비삼광 2점', G.scoreOf([id(1, 0), id(3, 0), id(12, 0)]).score === 2);
      check('고스톱: 사광 4 · 오광 15', G.scoreOf([id(1, 0), id(3, 0), id(8, 0), id(11, 0)]).score === 4 && G.scoreOf([id(1, 0), id(3, 0), id(8, 0), id(11, 0), id(12, 0)]).score === 15);
      check('고스톱: 고도리 5 (열끗 3장만으로)', G.scoreOf([id(2, 0), id(4, 0), id(8, 1)]).score === 5);
      check('고스톱: 홍단 3 + 띠 5장 1', G.scoreOf([id(1, 1), id(2, 1), id(3, 1), id(4, 1), id(5, 1)]).score === 4);
      check('고스톱: 피 10장 1점, 쌍피는 2장', G.scoreOf([id(11, 1), id(12, 3), ...[1, 2, 3, 4, 5, 6].map((m) => id(m, 2))]).score === 1 && G.scoreOf([...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => id(m, 2))]).score === 0);
      check('고스톱: 열끗 5장 1점 · 7장(고도리 없이) 3점', G.scoreOf([2, 5, 6, 7, 9].map((m) => id(m, 0))).score === 1 && G.scoreOf([2, 5, 6, 7, 9, 10, 12].map((m) => id(m, 1 + (m === 12 ? 0 : 0) - (m === 12 ? 0 : 1) + 1)).map((_, k) => [2, 5, 6, 7, 9, 10].concat([12])[k]).map((m) => (m === 12 ? id(12, 1) : id(m, 0)))).score === 3);
      check('고스톱: 기준 점수 2명 7 · 3명 3', G.threshold(2) === 7 && G.threshold(3) === 3);
    }
    /* ---------- 고스톱 끝까지 (3명·2명) ---------- */
    for (const [humans, bots] of [[1, 2], [1, 1], [2, 1], [3, 0]]) {
      let hid = 0, maxCaps = 0;
      const inv = (v, rm, h) => {
        const g = rm.g, all = [...g.hands.flat(), ...g.floor, ...g.deck, ...g.caps.flat()];
        if (all.length !== 48 || new Set(all).size !== 48) throw new Error('패가 ' + all.length + '장');
        if (JSON.stringify(v.hand) !== JSON.stringify(g.hands[h])) throw new Error('내 손패 불일치');
        if (v.stage !== 'done' && v.allHands) throw new Error('남의 손패 노출');
        if ('hands' in v || 'deck' in v && typeof v.deck !== 'number') hid++;
        maxCaps = Math.max(maxCaps, ...g.caps.map((c) => c.length));
      };
      const { r, steps } = await playOut(G, humans, bots, humans + bots, {}, inv);
      const res = r.body.result;
      check(`고스톱 ${humans + bots}명(사람 ${humans}): 끝까지 돈다 — ${res.nagari ? '나가리' : '승자 ' + res.winner + ' ' + res.pts + '점 [' + res.lines.join(', ') + ']'}`, r.body.stage === 'done' && hid === 0 && steps < 4000, steps + '걸음, 잡은 패 최대 ' + maxCaps);
      check(`고스톱 ${humans + bots}명: 순위·우승 있음`, Array.isArray(r.body.winners) && r.body.winners.length >= 1 && Array.isArray(r.body.rank));
    }
    /* 고스톱 여러 판 — 이긴 판·나가리 비율 */
    {
      let wins = 0, nag = 0, totalPts = 0, N = 30;
      for (let k = 0; k < N; k++) {
        const t = table(G, 1, 2, 3); await t.open(); let r = await t.start();
        // 다른 코드가 나오게 몇 번 다시 하기
        let steps = 0; const rnd = (() => { let x = 11 + k; return () => ((x = (x * 48271) % 2147483647) / 2147483647); })();
        while (r.body.stage !== 'done' && steps++ < 2000) { r = await t.poll(0); if (r.body.stage === 'done') break; await t.humanMove(0, rnd); }
        if (r.body.result.nagari) nag++; else { wins++; totalPts += r.body.result.pts; }
      }
      check(`고스톱 ${N}판: 승부 ${wins} · 나가리 ${nag} · 평균 ${wins ? (totalPts / wins).toFixed(1) : '-'}점`, wins > 0);
    }
    /* ---------- 섯다 족보 ---------- */
    {
      const c = (m, k) => (m - 1) * 2 + k;      // k=0 광/열끗
      const hr = (a, b) => S.handRank(a, b);
      check('섯다: 38광땡 > 13광땡 > 18광땡 > 장땡', hr(c(3, 0), c(8, 0)).v > hr(c(1, 0), c(3, 0)).v && hr(c(1, 0), c(3, 0)).v > hr(c(1, 0), c(8, 0)).v && hr(c(1, 0), c(8, 0)).v > hr(c(10, 0), c(10, 1)).v);
      check('섯다: 3·8 이 광이 아니면 1끗', hr(c(3, 1), c(8, 1)).name === '1끗');
      check('섯다: 알리 > 독사 > 구삥 > 장삥 > 장사 > 세륙 > 갑오', [hr(c(1, 1), c(2, 0)), hr(c(1, 1), c(4, 1)), hr(c(1, 1), c(9, 0)), hr(c(1, 1), c(10, 0)), hr(c(4, 1), c(10, 0)), hr(c(4, 1), c(6, 0)), hr(c(2, 0), c(7, 1))].every((x, i, a) => !i || a[i - 1].v > x.v));
      check('섯다: 끗수 — 5·7 = 2끗, 5·5 = 5땡, 10·10 장땡', hr(c(5, 0), c(7, 1)).name === '2끗' && hr(c(5, 0), c(5, 1)).name === '5땡' && hr(c(10, 0), c(10, 1)).name === '장땡');
      const sd = S.showdown({ 0: [c(3, 0), c(7, 0)], 1: [c(9, 0), c(9, 1)] }, [0, 1]);
      check('섯다: 땡잡이가 9땡을 잡는다', JSON.stringify(sd.winners) === '[0]');
      const sd2 = S.showdown({ 0: [c(3, 0), c(7, 0)], 1: [c(10, 0), c(10, 1)] }, [0, 1]);
      check('섯다: 땡잡이는 장땡엔 진다', JSON.stringify(sd2.winners) === '[1]');
      const sd3 = S.showdown({ 0: [c(4, 0), c(7, 0)], 1: [c(1, 0), c(8, 0)], 2: [c(2, 0), c(6, 0)] }, [0, 1, 2]);
      check('섯다: 암행어사가 18광땡을 잡는다', JSON.stringify(sd3.winners) === '[0]');
      const sd4 = S.showdown({ 0: [c(4, 0), c(7, 0)], 1: [c(3, 0), c(8, 0)] }, [0, 1]);
      check('섯다: 암행어사도 38광땡엔 진다', JSON.stringify(sd4.winners) === '[1]');
      const sd5 = S.showdown({ 0: [c(4, 1), c(9, 1)], 1: [c(2, 0), c(6, 1)] }, [0, 1]);
      check('섯다: 구사가 있고 이긴 패가 8끗이면 재경기', sd5.redeal === true);
      const sd6 = S.showdown({ 0: [c(4, 1), c(9, 1)], 1: [c(1, 1), c(2, 0)] }, [0, 1]);
      check('섯다: 이긴 패가 알리면 구사 재경기 없음', sd6.redeal === false && JSON.stringify(sd6.winners) === '[1]');
      const sd7 = S.showdown({ 0: [c(5, 0), c(6, 0)], 1: [c(8, 1), c(3, 1)] }, [0, 1]);
      check('섯다: 같은 끗수면 공동', sd7.winners.length === 2);
    }
    /* ---------- 섯다 끝까지 ---------- */
    for (const [humans, bots, count] of [[1, 3, 10], [1, 7, 5], [2, 0, 5], [1, 1, 15]]) {
      const np = humans + bots; let leak = 0;
      const inv = (v, rm, h) => {
        const g = rm.g, cur = g.cur;
        const sum = g.chips.reduce((a, b) => a + b, 0) + (cur && cur.stage === 'bet' ? cur.pot : 0) + g.carry;   // 공개 뒤엔 판돈이 칩(또는 carry)으로 넘어가 있다
        if (sum !== np * S.START_CHIPS) throw new Error('칩 합 ' + sum);
        if (cur && cur.stage === 'bet') { for (const i of cur.seats) if (i !== h && JSON.stringify(v).includes(JSON.stringify(cur.cards[i]))) leak++; }
        if (v.mine && cur && JSON.stringify(v.mine) !== JSON.stringify(cur.cards[h])) throw new Error('내 패 불일치');
      };
      const { r, steps } = await playOut(S, humans, bots, np, { count }, inv);
      check(`섯다 ${np}명 ${count}판(사람 ${humans}): 끝까지 — 칩 ${JSON.stringify(r.body.chips)} 우승 ${JSON.stringify(r.body.winners)}`, r.body.stage === 'done' && leak === 0 && Array.isArray(r.body.rank) && r.body.history.length >= 1, steps + '걸음 · 기록 ' + r.body.history.length + '판');
    }
    /* ---------- 홀덤 족보 ---------- */
    {
      const C = (r, s) => s * 13 + ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].indexOf(r);
      const ev = (...cs) => H.evaluate(cs);
      check('홀덤: 로열 스트레이트 플러시', ev(C('10', 0), C('J', 0), C('Q', 0), C('K', 0), C('A', 0), C('2', 1), C('3', 2)).cat === 9);
      check('홀덤: 휠 스트레이트(A·2·3·4·5)', ev(C('A', 0), C('2', 1), C('3', 2), C('4', 3), C('5', 0), C('9', 1), C('K', 2)).cat === 4);
      check('홀덤: 풀하우스 > 플러시', H.cmpHand(ev(C('3', 0), C('3', 1), C('3', 2), C('9', 0), C('9', 1)), ev(C('2', 0), C('5', 0), C('8', 0), C('J', 0), C('K', 0))) > 0);
      check('홀덤: 투페어 킥커 비교', H.cmpHand(ev(C('A', 0), C('A', 1), C('K', 0), C('K', 1), C('Q', 2)), ev(C('A', 2), C('A', 3), C('K', 2), C('K', 3), C('J', 2))) > 0);
      check('홀덤: 7장 중 최고 — 보드 스트레이트에 손패로 더 높은 스트레이트', ev(C('9', 0), C('8', 1), C('5', 2), C('6', 3), C('7', 0), C('2', 1), C('2', 2)).key[0] === 7);
      check('홀덤: 포카드 > 풀하우스', H.cmpHand(ev(C('5', 0), C('5', 1), C('5', 2), C('5', 3), C('2', 0)), ev(C('A', 0), C('A', 1), C('A', 2), C('K', 0), C('K', 1))) > 0);
      check('홀덤: 같은 패는 0', H.cmpHand(ev(C('A', 0), C('K', 1), C('Q', 2), C('J', 3), C('9', 0)), ev(C('A', 1), C('K', 2), C('Q', 3), C('J', 0), C('9', 1))) === 0);
    }
    /* ---------- 홀덤 끝까지 ---------- */
    for (const [humans, bots, count] of [[1, 3, 10], [1, 7, 20], [2, 0, 5], [1, 1, 10], [3, 2, 10]]) {
      const np = humans + bots; let leak = 0, allins = 0, showdowns = 0, folds = 0;
      const inv = (v, rm, h) => {
        const g = rm.g, cur = g.cur;
        const sum = g.chips.reduce((a, b) => a + b, 0) + (cur && cur.stage === 'bet' ? cur.pot : 0);
        if (sum !== np * H.START_CHIPS) throw new Error('칩 합 ' + sum + ' (판 ' + g.hand + ')');
        if (cur && cur.stage === 'bet') { for (const i of cur.seats) if (i !== h && JSON.stringify(v).includes(JSON.stringify(cur.cards[i]))) leak++; if (Object.keys(cur.allin).length) allins++; }
        if (cur && cur.stage === 'result') { if (cur.result.byFold) folds++; else showdowns++; }
        if (cur && cur.stage === 'bet' && cur.turn !== null && (cur.folded[cur.turn] || cur.allin[cur.turn])) throw new Error('다이/올인한 사람 차례');
        if (cur && cur.board.length > 5) throw new Error('보드 ' + cur.board.length);
      };
      const { r, steps } = await playOut(H, humans, bots, np, { count }, inv, 8000);
      check(`홀덤 ${np}명 ${count}판(사람 ${humans}): 끝까지 — 칩 ${JSON.stringify(r.body.chips)} 우승 ${JSON.stringify(r.body.winners)}`, r.body.stage === 'done' && leak === 0 && Array.isArray(r.body.rank) && r.body.history.length >= 1, steps + '걸음 · 올인 걸음 ' + allins + ' · 쇼다운/다이 ' + showdowns + '/' + folds);
    }
    /* 홀덤 사이드팟 — 칩이 다른 셋이 다 올인 */
    {
      const t = table(H, 3, 0, 3, { count: 5 }); await t.open(); await t.start();
      const rm = await t.room(); rm.g.chips = [50, 200, 1000]; rm.g.hand = 0; // 다음 판부터 적용되게 지금 판을 끝낸다
      // 지금 판: 모두 다이시켜 끝내고 next
      await t.store.set('room:' + rm.code, rm);
      let v = (await t.poll(0)).body; let guard = 0;
      while (v.stage === 'play' && v.step === 'bet' && guard++ < 20) { const turn = v.turn; v = (await t.as(turn, { action: 'bet', k: (await t.poll(turn)).body.options.find((o) => o.k === 'fold') ? 'fold' : 'check' })).body; }
      const before = (await t.room()).g.chips.slice();
      v = (await t.as(0, { action: 'next', hand: v.hand })).body;
      let g2 = (await t.room()).g, c2 = g2.cur, steps2 = 0;
      while (c2.stage === 'bet' && steps2++ < 30) {
        const turn = c2.turn, opts = H.betOptions({ g: g2 }, turn), ai = opts.find((o) => o.k === 'allin') || opts.find((o) => o.k === 'call') || opts.find((o) => o.k === 'check');
        await t.as(turn, { action: 'bet', k: ai.k }); g2 = (await t.room()).g; c2 = g2.cur;
      }
      const sum = g2.chips.reduce((a, b) => a + b, 0);
      check('홀덤 사이드팟: 셋 다 올인 — 칩 합 보존 · 쇼다운 공개 3명', sum === before.reduce((a, b) => a + b, 0) && c2.stage === 'result' && Object.keys(c2.result.reveal).length === 3, JSON.stringify(g2.chips) + ' ' + JSON.stringify(c2.result.won) + ' byFold=' + c2.result.byFold + ' hand=' + g2.hand + ' steps=' + steps2);
      if (!c2.result.evals) { console.log('  사이드팟 디버그', JSON.stringify({ folded: c2.folded, allin: c2.allin, total: c2.total, street: c2.street, log: g2.log.slice(-6) })); }
      const ranks = c2.result.evals ? [0, 1, 2].map((i) => c2.result.evals[i]) : [];
      const bestI = c2.result.evals ? [0, 1, 2].sort((a, b) => H.cmpHand(c2.result.evals[b], c2.result.evals[a]))[0] : 0;
      check('홀덤 사이드팟: 적게 건 사람은 자기 몫까지만 받는다', c2.result.won[bestI] <= (bestI === 0 ? 150 : bestI === 1 ? 450 : 1250) && Object.values(c2.result.won).reduce((a, b) => a + b, 0) === c2.pot, JSON.stringify(c2.result.won) + ' ' + ranks.map((e) => e.name).join('/'));
    }
  } catch (e) { console.error(e); failures++; }
  console.log(failures ? `\n실패 ${failures}` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
