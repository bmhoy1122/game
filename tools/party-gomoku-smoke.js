#!/usr/bin/env node
/* 팀 오목(party-gomoku) 테스트.
 *   node tools/party-gomoku-smoke.js
 * 사람(토큰)과 AI 를 섞어 1:1 · 2:2 · 4:4 · 3:1 로 끝까지, 금수, 기권(선공 기권 포함), 다시 하기, 무작위 수백 판.
 */
const path = require('path');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? ' ok ' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
function memStore() { const m = new Map(); return { async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); }, async set(k, v) { m.set(k, JSON.stringify(v)); } }; }
const lib = (f) => import(path.join(__dirname, '..', 'netlify/lib', f));

(async () => {
  const K = await lib('party-kit.mjs');
  const G = await lib('party-gomoku-core.mjs');
  const DT = K.BOT_DELAY + 300;
  const SAY = G.PRESETS.say, RENJU = G.PRESETS.renju, FREE = G.PRESETS.free;

  function table(humans, bots, max, opts = {}) {
    const store = memStore(); let now = 1_000_000; const toks = [], codes = { code: null };
    const as = async (i, b, dt = 0) => { now += dt; const r = await G.handle({ ...b, token: toks[i], code: codes.code }, store, now); if (r.body.token) toks[i] = r.body.token; if (r.body.code) codes.code = r.body.code; return r; };
    return {
      store, as, now: () => now, code: () => codes.code,
      async open() {
        const r = await as(0, { action: 'create', name: '사람1', max, teams: 2, ...opts });
        for (let i = 1; i < humans; i++) await as(i, { action: 'join', name: '사람' + (i + 1) });
        for (let i = 0; i < bots; i++) await as(0, { action: 'addbot' });
        return r;
      },
      start: () => as(0, { action: 'start' }),
      poll: (i = 0) => as(i, { action: 'state' }, DT),
      room: () => store.get('room:' + codes.code),
      async setRoom(f) { const room = await store.get('room:' + codes.code); f(room); await store.set('room:' + codes.code, room); },
    };
  }
  const deepHas = (o, pred) => JSON.stringify(o, (k, v) => (pred(k, v) ? '__HIT__' : v)).includes('__HIT__');
  const ctxOf = (room, idx) => ({ room, idx, active: K.activeSeats(room), docs: room.players.map(() => ({})) });
  /* 사람 차례면 봇 수(또는 rnd 로 아무 합법 수)를 빌려 둔다 */
  async function humanMove(t, r, who, randomish = 0) {
    const room = await t.room();
    let m = G.botMove(ctxOf(room, who), Math.random);
    if (randomish && Math.random() < randomish) {
      const busy = new Set(r.body.moves.map(([a, b]) => a * 15 + b)), bad = new Set((r.body.forbidden || []).map(([a, b]) => a * 15 + b));
      const free = [...Array(225).keys()].filter((i) => !busy.has(i) && !bad.has(i));
      if (free.length) { const i = free[Math.floor(Math.random() * free.length)]; m = { act: 'place', body: { r: Math.floor(i / 15), c: i % 15 } }; }
    }
    return t.as(who, { action: m.act, ...m.body });
  }
  /* 끝까지 — humans 명은 사람(봇 수를 빌림), 나머지는 서버 봇 */
  async function playOut(t, humans, r, opt = {}) {
    let guard = 0, colorsOk = true;
    while (r.body.stage === 'play' && guard++ < 1200) {
      const who = r.body.turn;
      if (who < humans && !(r.body.players[who].out)) {
        if (opt.onHuman && (await opt.onHuman(who, r))) { r = await t.as(0, { action: 'state' }); continue; }
        r = await humanMove(t, r, who, opt.randomish || 0);
        if (r.status !== 200) { check('사람 수 오류', false, r.body.error); break; }
      } else r = await t.poll(0);
    }
    const room = await t.room();
    room.g.moves.forEach(([, , s], k) => { if ((G.colorOf(room, s) === 1) !== (k % 2 === 0)) colorsOk = false; });
    return { r, guard, colorsOk, room };
  }

  try {
    /* ---------- 방: 팀전만 ---------- */
    {
      const t = table(1, 1, 4, { teams: 0 });
      let r = await t.open();
      check('방: 개인전을 골라도 2팀 팀전', r.body.teams === 2 && JSON.stringify(r.body.teamOptions) === '[2]', String(r.body.teams));
      check('방: 개인전·3팀으로는 못 바꾼다', (await t.as(0, { action: 'teams', n: 0 })).status === 400 && (await t.as(0, { action: 'teams', n: 3 })).status === 400);
      check('방: 금수를 안 보내면 렌주 (2026-10 기본)', JSON.stringify((await t.room()).opts.rules) === JSON.stringify(RENJU));
      const t2 = table(1, 0, 4, { rules: { black: { three: 1, four: 'x', long: 0 }, white: null } });
      await t2.open();
      check('방: 금수 값은 서버가 다시 거른다', JSON.stringify((await t2.room()).opts.rules) === JSON.stringify({ black: { three: true, four: true, long: false }, white: { three: false, four: false, long: false } }));
      const solo = table(1, 0, 4, { bot: true }); r = await solo.open();
      check('방: 혼자 하기(?bot=1) — AI 하나와 1:1 로 바로 시작', r.body.phase === 'play' && r.body.players.length === 2 && r.body.players[0].team !== r.body.players[1].team && r.body.stage === 'play');
    }

    /* ---------- 1:1 · 2:2 · 4:4 끝까지 ---------- */
    for (const [humans, bots] of [[1, 1], [2, 0], [2, 2], [1, 7], [3, 5]]) {
      const n = humans + bots;
      const t = table(humans, bots, n);
      await t.open();
      let r = await t.start();
      const room0 = await t.room();
      check(`${n}명: 시작 — 선공 팀이 흑`, r.body.stage === 'play' && r.body.blackTeam === K.teamOf(room0, room0.first) && r.body.turn === room0.first && r.body.turnColor === 'black', JSON.stringify({ bt: r.body.blackTeam, first: room0.first, turn: r.body.turn }));
      const seq = [...Array(2 * n)].map((_, k) => G.seatFor(room0, k));
      check(`${n}명: 차례 — 흑팀·백팀 번갈아, 한 바퀴에 모두 한 번씩`, seq.every((s, k) => (G.colorOf(room0, s) === 1) === (k % 2 === 0)) && new Set(seq.slice(0, n)).size === n, JSON.stringify(seq));
      check(`${n}명: 다음 사람 미리보기 = 다음 차례들`, JSON.stringify(r.body.upcoming) === JSON.stringify(seq.slice(1, 4)));
      const out = await playOut(t, humans, r);
      r = out.r;
      check(`${n}명: 끝까지 간다 (${r.body.moves.length}수)`, r.body.stage === 'done' && r.body.winners && r.body.winners.length >= 1, 'stage=' + r.body.stage + ' reason=' + r.body.reason);
      check(`${n}명: 모든 수가 제 색 팀 사람이 뒀다`, out.colorsOk);
      if (r.body.reason === 'five') {
        const wt = r.body.winTeam, last = r.body.moves[r.body.moves.length - 1];
        check(`${n}명: 다섯 이은 팀 전원이 winners`, JSON.stringify(r.body.winners) === JSON.stringify(r.body.players.map((p, i) => i).filter((i) => r.body.players[i].team === wt)) && r.body.line.length >= 5);
        check(`${n}명: 마지막 수를 둔 사람이 이긴 팀`, out.room.players[last[2]].team === wt);
        check(`${n}명: kit 팀 결과 = 이긴 팀 하나`, r.body.team && JSON.stringify(r.body.team.winners) === JSON.stringify([wt]) && r.body.team.mode === 'any', JSON.stringify(r.body.team));
        check(`${n}명: 등수 — 이긴 팀 1등, 진 팀 2등`, r.body.rank.every((x) => x.rank === (r.body.players[x.i].team === wt ? 1 : 2)));
      }
      check(`${n}명: 남의 토큰은 응답에 없다`, !deepHas(r.body, (k) => k === 'token'));
      if (n === 4) {
        const again = await t.as(0, { action: 'restart', round: r.body.round });
        const room1 = await t.room();
        check('다시 하기: 새 판, 자리·팀 그대로, 흑 = 새 선공 팀', again.body.round === 2 && again.body.moves.length === 0 && again.body.stage === 'play'
          && JSON.stringify(again.body.players.map((p) => p.team)) === JSON.stringify(r.body.players.map((p) => p.team)) && again.body.blackTeam === K.teamOf(room1, room1.first));
      }
    }

    /* ---------- 3:1 (팀 인원이 달라도) ---------- */
    {
      const t = table(1, 3, 4);
      await t.open();
      for (const i of [1, 2]) await t.as(0, { action: 'setteam', seat: i, team: 0 });
      await t.as(0, { action: 'setteam', seat: 3, team: 1 });
      let r = await t.start();
      const room = await t.room();
      const lone = [0, 1, 2, 3].find((i) => K.teamOf(room, i) === 1);
      const seq = [...Array(6)].map((_, k) => G.seatFor(room, k));
      check('3:1: 혼자인 팀은 매번 같은 사람', seq.filter((s) => K.teamOf(room, s) === 1).every((s) => s === lone), JSON.stringify(seq));
      const out = await playOut(t, 1, r);
      check('3:1: 끝까지, 색 번갈아', out.r.body.stage === 'done' && out.colorsOk, out.r.body.reason);
    }

    /* ---------- 차례 아닌 행동 · 금수 ---------- */
    {
      const t = table(2, 0, 2);
      await t.open();
      let r = await t.start();
      const first = r.body.turn, other = 1 - first;
      let bad = await t.as(other, { action: 'place', r: 7, c: 7 });
      check('차례 아닌 사람이 두면 409', bad.status === 409 && /차례/.test(bad.body.error), bad.body.error);
      check('판 밖은 400', (await t.as(first, { action: 'place', r: 15, c: 0 })).status === 400);
      r = await t.as(first, { action: 'place', r: 7, c: 7 });
      check('두면 차례가 넘어간다', r.status === 200 && r.body.turn === other && r.body.moves.length === 1 && r.body.moves[0][2] === first);
      bad = await t.as(other, { action: 'place', r: 7, c: 7 });
      check('돌 위엔 못 둔다 409', bad.status === 409, bad.body.error);
      // 흑 삼삼 자리 만들기: 흑 (7,5)(7,6)(5,7)(6,7), 백은 구석. 흑이 (7,7)에 두면 삼삼
      await t.setRoom((room) => {
        const B = room.first, W = 1 - room.first;
        room.g.moves = [[7, 5, B], [0, 0, W], [7, 6, B], [0, 2, W], [5, 7, B], [0, 4, W], [6, 7, B], [14, 14, W]];
      });
      r = await t.as(first, { action: 'state' });
      check('흑 차례엔 삼삼 자리가 forbidden 에 (세이클럽식)', r.body.yourTurn && r.body.forbidden.some(([a, b, w]) => a === 7 && b === 7 && w === 'three'));
      bad = await t.as(first, { action: 'place', r: 7, c: 7 });
      check('삼삼 자리에 두면 409 + 이유', bad.status === 409 && /삼삼/.test(bad.body.error), bad.body.error);
      const r2 = await t.as(other, { action: 'state' });
      check('내 차례가 아니면 forbidden 은 비어 있다', r2.body.forbidden.length === 0 && !r2.body.yourTurn);
      // 금수 없음이면 둔다
      const tf = table(2, 0, 2, { rules: FREE });
      await tf.open(); r = await tf.start();
      await tf.setRoom((room) => { const B = room.first, W = 1 - room.first; room.g.moves = [[7, 5, B], [0, 0, W], [7, 6, B], [0, 2, W], [5, 7, B], [0, 4, W], [6, 7, B], [14, 14, W]]; });
      r = await tf.as(r.body.turn, { action: 'place', r: 7, c: 7 });
      check('금수 없음이면 같은 자리에 둔다', r.status === 200);
      // 렌주: 백 장목은 이긴다
      const tr = table(2, 0, 2, { rules: RENJU });
      await tr.open(); r = await tr.start();
      const Bf = r.body.turn, Wf = 1 - Bf;
      await tr.setRoom((room) => { room.g.moves = [[0, 0, Bf], [3, 0, Wf], [0, 2, Bf], [3, 1, Wf], [0, 4, Bf], [3, 2, Wf], [0, 6, Bf], [3, 4, Wf], [0, 8, Bf], [3, 5, Wf], [0, 10, Bf]]; });
      r = await tr.as(Wf, { action: 'place', r: 3, c: 3 });
      check('렌주: 백 여섯(장목)도 이긴다', r.status === 200 && r.body.stage === 'done' && r.body.winTeam === r.body.players[Wf].team, JSON.stringify([r.status, r.body.error, r.body.stage]));
      // 세이클럽식: 흑 장목은 금수
      const ts = table(2, 0, 2, { rules: SAY });
      await ts.open(); r = await ts.start();
      const Bs = r.body.turn, Ws = 1 - Bs;
      await ts.setRoom((room) => { room.g.moves = [[3, 0, Bs], [0, 0, Ws], [3, 1, Bs], [0, 2, Ws], [3, 2, Bs], [0, 4, Ws], [3, 4, Bs], [0, 6, Ws], [3, 5, Bs], [0, 8, Ws]]; });
      bad = await ts.as(Bs, { action: 'place', r: 3, c: 3 });
      check('세이클럽식: 흑 여섯(장목)은 못 둔다', bad.status === 409 && /장목/.test(bad.body.error), bad.body.error);
    }

    /* ---------- 판이 꽉 차면 무승부 ---------- */
    {
      const t = table(2, 0, 2, { rules: FREE });
      await t.open(); let r = await t.start();
      const Bp = r.body.turn, Wp = 1 - Bp;
      // 다섯이 없는 무늬: (c + 2r) % 4 < 2 이면 흑. 흑 113 · 백 112 가 되도록 칸 하나를 바꾼다
      const cells = [...Array(225).keys()].map((i) => { const rr = Math.floor(i / 15), cc = i % 15; return { rr, cc, b: (cc + 2 * rr) % 4 < 2 }; });
      const blacks = cells.filter((x) => x.b), whites = cells.filter((x) => !x.b);
      const moves = [];
      for (let k = 0; k < 225; k++) { const x = k % 2 === 0 ? blacks[k / 2] : whites[(k - 1) / 2]; if (!x) break; moves.push([x.rr, x.cc, k % 2 === 0 ? Bp : Wp]); }
      check('(무늬 준비) 흑 113 · 백 112', blacks.length === 113 && whites.length === 112, blacks.length + '/' + whites.length);
      await t.setRoom((room) => { room.g.moves = moves; });
      r = await t.as(0, { action: 'state' });
      check('판이 꽉 차면 무승부 — 둘 다 winners, 같은 등수', r.body.stage === 'done' && r.body.draw === true && r.body.reason === 'full' && r.body.winners.length === 2 && r.body.rank.every((x) => x.rank === 1), JSON.stringify([r.body.stage, r.body.reason, r.body.winTeam]));
    }

    /* ---------- 기권 ---------- */
    {
      // 1:1 — 한 명이 나가면 남은 팀 승
      const t = table(2, 0, 2);
      await t.open(); let r = await t.start();
      await t.as(r.body.turn, { action: 'place', r: 7, c: 7 });
      r = await t.as(1, { action: 'resign' });
      r = await t.as(0, { action: 'state' });
      check('1:1 기권: 남은 사람 팀 승', r.body.stage === 'done' && r.body.reason === 'resign' && JSON.stringify(r.body.winners) === '[0]' && r.body.team && JSON.stringify(r.body.team.winners) === JSON.stringify([r.body.players[0].team]));
      check('기권한 사람은 순위에 없다', r.body.rank.every((x) => x.i !== 1));
    }
    {
      // 2:2 사람 넷 — 선공이 기권해도 색은 계속 번갈아, 한 팀이 다 나가면 끝
      const t = table(4, 0, 4);
      await t.open(); let r = await t.start();
      const first = r.body.turn;
      let resigned = [];
      const out = await playOut(t, 4, r, {
        onHuman: async (who, cur) => {
          if (!resigned.length && cur.body.moves.length === 3) { await t.as(first, { action: 'resign' }); resigned.push(first); return true; }
          return false;
        },
      });
      r = out.r;
      check('2:2 선공 기권: 나머지 셋이 끝까지, 색 번갈아', r.body.stage === 'done' && out.colorsOk && r.body.players[first].out, JSON.stringify([r.body.stage, r.body.reason]));
      check('2:2 선공 기권: 기권한 사람은 winners 에 없다', !r.body.winners.includes(first));
      // 한 팀이 다 나가기
      const t2 = table(4, 0, 4);
      await t2.open(); r = await t2.start();
      const room = await t2.room();
      const team1 = [0, 1, 2, 3].filter((i) => K.teamOf(room, i) === 1);
      for (const i of team1) await t2.as(i, { action: 'resign' });
      r = await t2.as(0, { action: 'state' });
      check('한 팀이 다 나가면 남은 팀 승', r.body.stage === 'done' && r.body.winTeam === 0 && r.body.reason === 'resign' && r.body.winners.every((i) => r.body.players[i].team === 0));
      check('기권 뒤엔 둘 수 없다', (await t2.as(team1[0], { action: 'place', r: 1, c: 1 })).status === 409);
    }

    /* ---------- 무작위·봇 수백 판 ---------- */
    {
      let games = 0, stuck = 0, errs = 0, moves = 0, fives = 0, draws = 0, resigns = 0;
      const ruleSets = [SAY, RENJU, FREE, { black: { three: true, four: true, long: true }, white: { three: true, four: true, long: true } }];
      const t0 = Date.now();
      for (let g = 0; g < 240; g++) {
        const n = 2 + (g % 7), humans = 1 + (g % 3 === 0 ? Math.min(2, n - 1) : 0), bots = n - humans;
        const t = table(humans, bots, n, { rules: ruleSets[g % ruleSets.length] });
        await t.open();
        if (g % 5 === 0) await t.as(0, { action: 'shuffleteams' });
        let r = await t.start();
        if (r.status !== 200) { errs++; continue; }
        let quit = g % 11 === 0 ? 1 : -1;
        const out = await playOut(t, humans, r, {
          randomish: g % 2 ? 0.5 : 0,
          onHuman: async (who, cur) => { if (quit === 1 && cur.body.moves.length > 10 && humans > 1) { quit = 0; await t.as(who, { action: 'resign' }); return true; } return false; },
        });
        games++;
        if (out.r.body.stage !== 'done') stuck++;
        if (!out.colorsOk) errs++;
        moves += out.r.body.moves.length;
        if (out.r.body.reason === 'five') fives++; else if (out.r.body.draw) draws++; else resigns++;
        if (out.r.body.stage === 'done' && (!out.r.body.team || !out.r.body.team.winners.length)) errs++;
      }
      check(`무작위·봇 ${games}판: 멈춤 0 · 오류 0 (다섯 ${fives} · 무 ${draws} · 기권 ${resigns}, 평균 ${Math.round(moves / games)}수, ${((Date.now() - t0) / 1000).toFixed(1)}초)`, stuck === 0 && errs === 0, JSON.stringify({ stuck, errs }));
    }

    /* ---------- 봇 실력: 무작위 상대에겐 거의 다 이긴다 ---------- */
    {
      let win = 0, total = 40;
      for (let g = 0; g < total; g++) {
        const t = table(1, 1, 2, { rules: SAY });
        await t.open(); let r = await t.start();
        const out = await playOut(t, 1, r, { randomish: 1 });
        if (out.r.body.winTeam === out.r.body.players[1].team && out.r.body.reason === 'five') win++;
      }
      check(`봇 vs 무작위 ${total}판: 봇 ${win}승`, win >= total * 0.9);
    }
  } catch (e) { check('예외 없이 끝난다', false, e.stack || String(e)); }
  console.log(failures ? `\n실패 ${failures}` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
