#!/usr/bin/env node
/* 혼자 하기(AI 상대) 테스트 — 네 게임 모두 봇 방을 만들어 끝까지 돌린다.
 *   node tools/bot-smoke.js
 * 봇은 사람의 요청(state 폴링 포함)을 처리할 때 BOT_DELAY 뒤에 한 행동씩 한다. 그래서 now 를 직접 넘겨 흉내 낸다.
 */
const path = require('path');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? ' ok ' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
function memStore() {
  const m = new Map();
  return {
    async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
  };
}
const lib = (f) => import(path.join(__dirname, '..', 'netlify/lib', f));

(async () => {
  const { BOT_DELAY, BOT_NAME } = await lib('room-kit.mjs');
  const G = await lib('gomoku-core.mjs'), Bi = await lib('bingo-core.mjs'), Ba = await lib('baseball-core.mjs'), Bl = await lib('balance-core.mjs');
  const P = await lib('first-pick.mjs');
  // 사람 한 명이 폰으로 하는 것처럼: now 를 흐르게 하면서 폴링한다
  function player(handle) {
    let now = 1_000_000, tok = null, code = null;
    const store = memStore();
    const call = async (b, dt = 0) => { now += dt; const r = await handle({ ...b, token: tok, code }, store, now); if (r.body.token) tok = r.body.token; if (r.body.code) code = r.body.code; return r; };
    const poll = () => call({ action: 'state' }, BOT_DELAY + 500);     // 폴링 한 번 = 봇이 한 번 움직일 시간
    return { call, poll, store };
  }
  try {
    /* ---- 오목 ---- */
    {
      const h = player(G.handle);
      let r = await h.call({ action: 'create', name: '나', pick: 'coin', rules: G.PRESETS.say, bot: true });
      check('오목: 봇 방은 바로 상대가 있다', r.status === 200 && r.body.opponent.joined && r.body.opponent.name === BOT_NAME && r.body.bot === true, JSON.stringify(r.body.opponent));
      const j = await G.handle({ action: 'join', name: '남', code: r.body.code }, h.store, 2_000_000);
      check('오목: 봇 방엔 남이 못 들어온다', j.status === 409);
      r = await h.call({ action: 'state' });
      check('오목: 랜덤 선 정하기라 바로 play', r.body.phase === 'play', r.body.phase);
      // 상대(봇)가 선공이면 폴링 한 번에 둔다
      if (r.body.turn !== r.body.you) { const before = r.body.moves.length; r = await h.poll(); check('오목: 봇 차례면 폴링 뒤 한 수 둔다', r.body.moves.length === before + 1); }
      const noDelay = await h.call({ action: 'state' }, 0);
      check('오목: 지연 전엔 안 둔다', noDelay.body.moves.length === r.body.moves.length);
      // 사람이 한 줄로 넷을 열면 봇이 막는다: 사람은 (0,0)~ 가로로 둔다
      let n = 0, moves = r.body.moves.length;
      const empty = (m, rr, cc) => !m.some(([a, b]) => a === rr && b === cc);
      let blocked = false;
      for (let i = 0; i < 60 && r.body.phase === 'play'; i++) {
        if (r.body.turn === r.body.you) {
          let placed = false;
          for (let cc = 0; cc < 15 && !placed; cc++) if (empty(r.body.moves, 0, cc) && !r.body.forbidden.some(([a, b]) => a === 0 && b === cc)) { r = await h.call({ action: 'place', r: 0, c: cc }); placed = r.status === 200; }
          if (!placed) break;
        } else {
          r = await h.poll(); n++;
        }
      }
      check('오목: 봇이 계속 응수한다 (사람 넷을 막아 이기지 못하게 하거나 먼저 이긴다)', r.body.phase === 'done' ? r.body.winner !== r.body.you || r.body.moves.length > 9 : r.body.moves.length >= 8, 'phase=' + r.body.phase + ' winner=' + r.body.winner + ' moves=' + r.body.moves.length);
      // 열린 넷 직접 검증: botMove 가 막는 자리를 고르나
      const b = G.makeBoard([[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6]]);   // 흑(사람) .XXXX. 열림, 백(봇) 차례
      const ctx = { room: { moves: [[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6]], opts: { pick: 'coin', rules: G.PRESETS.say }, code: '1111', round: 1, players: [{}, { bot: true }] }, docs: [{}, {}], idx: 1, joined: true, me: {}, other: {} };
      // firstOf 가 roundRng 로 정해지므로 선공이 0(사람=흑)이 되는 코드를 찾는다
      for (let k = 0; k < 50; k++) { ctx.room.code = String(1000 + k); if (G.status(ctx).first === 0) break; }
      const mv = G.botMove(ctx, () => 0.99);
      check('오목: 열린 넷은 반드시 막는다', mv && mv.act === 'place' && mv.body.r === 7 && (mv.body.c === 2 || mv.body.c === 7), JSON.stringify(mv));
      const ctx5 = { ...ctx, room: { ...ctx.room, moves: [[7, 3], [1, 1], [7, 4], [1, 2], [7, 5], [1, 3], [0, 0], [1, 4], [0, 1]] } };   // 백(봇) 차례, 백 넷 — 다섯 만들기
      const mv5 = G.botMove(ctx5, () => 0.99);
      check('오목: 다섯이 되면 그 수를 둔다', mv5 && mv5.body.r === 1 && (mv5.body.c === 0 || mv5.body.c === 5), JSON.stringify(mv5));
    }
    /* ---- 빙고 ---- */
    {
      const h = player(Bi.handle);
      let r = await h.call({ action: 'create', name: '나', pick: 'rps', bot: true });
      check('빙고: 봇 방 생성', r.body.opponent.name === BOT_NAME && r.body.phase === 'pick');
      // 가위바위보 — 봇이 낼 때까지 폴링, 사람은 바위만. 비기면 반복
      for (let i = 0; i < 20 && r.body.phase === 'pick'; i++) { if (r.body.pick.mineNow === null) r = await h.call({ action: 'throw', value: 'r' }); r = await h.poll(); }
      check('빙고: 봇과 가위바위보로 선을 정한다', r.body.phase === 'setup', r.body.phase);
      r = await h.poll();
      check('빙고: 봇이 판을 짜고 준비한다', r.body.opponentReady === true);
      const board = [...Array(25)].map((_, i) => i + 1);
      r = await h.call({ action: 'ready', board });
      check('빙고: 둘 다 준비하면 play', r.body.phase === 'play', r.body.phase);
      for (let i = 0; i < 80 && r.body.phase === 'play'; i++) {
        if (r.body.yourTurn) { const n = board.find((x) => !r.body.called.includes(x)); r = await h.call({ action: 'call', n }); }
        else r = await h.poll();
      }
      check('빙고: 끝까지 간다', r.body.phase === 'done', r.body.phase + ' called=' + r.body.called.length);
      const again = await h.call({ action: 'restart', round: r.body.round });
      check('빙고: 다시 하기 뒤 봇 방 유지', again.body.bot === true && again.body.round === 2 && again.body.opponent.joined);
    }
    /* ---- 숫자야구 ---- */
    {
      const h = player(Ba.handle);
      let r = await h.call({ action: 'create', name: '나', pick: 'coin', bot: true });
      r = await h.poll();
      check('숫자야구: 봇이 비밀 숫자를 정한다', r.body.opponentReady === true, JSON.stringify(r.body));
      r = await h.call({ action: 'secret', value: '123' });
      check('숫자야구: 둘 다 정하면 play', r.body.phase === 'play', r.body.phase);
      let guesses = 0;
      const nums = []; for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) for (let c = 1; c <= 9; c++) if (a !== b && b !== c && a !== c) nums.push('' + a + b + c);
      for (let i = 0; i < 120 && r.body.phase === 'play'; i++) {
        if (r.body.yourTurn) { r = await h.call({ action: 'guess', value: nums[guesses++] }); }   // 사람은 순서대로 (느리게)
        else r = await h.poll();
      }
      const botGuesses = r.body.log.filter((e) => e.by === 1);
      check('숫자야구: 봇이 맞히고 끝난다', r.body.phase === 'done' && botGuesses.some((e) => e.s === 3), 'phase=' + r.body.phase + ' bot=' + botGuesses.length);
      check('숫자야구: 봇은 12번 안에 맞힌다 (모순 없는 후보만 던짐)', botGuesses.length <= 12, String(botGuesses.length));
      check('숫자야구: 끝나면 봇 비밀 숫자가 공개된다', /^[1-9]{3}$/.test(r.body.theirSecret || ''));
    }
    /* ---- 이심전심 ---- */
    {
      const h = player(Bl.handle);
      let r = await h.call({ action: 'create', name: '나', bot: true });
      check('이심전심: 봇 방은 바로 play', r.body.phase === 'play');
      for (let i = 0; i < 40 && r.body.phase === 'play'; i++) {
        if (r.body.mine === null) r = await h.call({ action: 'pick', qi: r.body.qi, choice: 0 });
        else if (!r.body.reveal) r = await h.poll();
        else r = await h.call({ action: 'next', qi: r.body.qi });
      }
      check('이심전심: 열 문제 다 넘어간다', r.body.phase === 'done' && r.body.history.length === 10, r.body.phase + ' ' + (r.body.history || []).length);
    }
    /* ---- 선 정하기 봇 단독 ---- */
    {
      const mk = (kind, A, B) => ({ room: { opts: { pick: kind } }, docs: [{ throws: A }, { throws: B }], idx: 1 });
      check('선 정하기 봇: 묵찌빠에서 손을 낸다', P.pickBot(mk('mjb', ['r'], []), () => 0.1).body.value === 'r');
      check('선 정하기 봇: 하나빼기 두 손은 서로 다르다', (() => { const v = P.pickBot(mk('hana', [], []), Math.random).body.value; return v.length === 2 && v[0] !== v[1]; })());
      check('선 정하기 봇: 이미 냈으면 기다린다', P.pickBot(mk('rps', [], ['r']), Math.random) === null);
      check('선 정하기 봇: 랜덤이면 낼 게 없다', P.pickBot(mk('coin', [], []), Math.random) === null);
    }
  } catch (e) { check('예외 없이 끝난다', false, e.stack || String(e)); }
  console.log(failures ? `\n실패 ${failures}` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
