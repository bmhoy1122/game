#!/usr/bin/env node
/* 여럿이 단어 빙고 테스트 (party-kit 위).
 *   node tools/party-wordbingo-smoke.js
 * 사람 여럿(토큰)과 AI 를 섞어 2~8명·팀전을 끝까지 돌린다. 봇은 BOT_DELAY 뒤에 움직이니 now 를 흘린다.
 */
const path = require('path');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? ' ok ' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
function memStore() { const m = new Map(); return { async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); }, async set(k, v) { m.set(k, JSON.stringify(v)); } }; }
const lib = (f) => import(path.join(__dirname, '..', 'netlify/lib', f));

(async () => {
  const K = await lib('party-kit.mjs');
  const W = await lib('party-wordbingo-core.mjs');
  const DT = K.BOT_DELAY + 300;

  function table(humans, bots, max, opts = {}) {
    const store = memStore(); let now = 1_000_000; const toks = [], codes = { code: null };
    const as = async (i, b, dt = 0) => { now += dt; const r = await W.handle({ ...b, token: toks[i], code: codes.code }, store, now); if (r.body.token) toks[i] = r.body.token; if (r.body.code) codes.code = r.body.code; return r; };
    return {
      store, as, now: () => now, codes,
      async open() {
        const r = await as(0, { action: 'create', name: '사람1', max, ...opts });
        for (let i = 1; i < humans; i++) await as(i, { action: 'join', name: '사람' + (i + 1) });
        for (let i = 0; i < bots; i++) await as(0, { action: 'addbot' });
        return r;
      },
      start: () => as(0, { action: 'start' }),
      poll: (i = 0) => as(i, { action: 'state' }, DT),
      /* 서버 문서를 직접 읽어 i 번 자리의 ctx 를 만든다 (사람 수를 봇 두뇌로 고를 때) */
      async ctx(i) {
        const room = await store.get('room:' + codes.code);
        const docs = await Promise.all(room.players.map(async (_, j) => { const d = await store.get(`room:${codes.code}:p${j}`); return d && d.round === room.round ? d : { round: room.round }; }));
        return { room, idx: i, docs, me: docs[i], active: K.activeSeats(room), n: room.players.length };
      },
      async docs() { return (await this.ctx(0)).docs; },
    };
  }
  /* 사람 자리 humanSeats 는 봇 두뇌로 두고, 나머지는 서버 봇이 움직이도록 폴링. 끝나거나 guard 에 걸리면 마지막 응답 */
  async function playOut(t, humanSeats, r, guardMax = 600, onStep) {
    let guard = 0;
    while (r.body.stage !== 'done' && guard++ < guardMax) {
      let moved = false;
      for (const h of humanSeats) {
        const c = await t.ctx(h);
        if (!c.active.includes(h)) continue;
        const m = W.botMove(c, Math.random);
        if (!m) continue;
        r = await t.as(h, { action: m.act, ...m.body });
        if (r.status !== 200) { check('사람 수 오류', false, r.body.error); return r; }
        moved = true; break;
      }
      if (!moved) r = await t.poll(humanSeats[0] !== undefined ? humanSeats[0] : 0);
      if (onStep) await onStep(r);
    }
    if (r.body.stage !== 'done') r = await t.as(humanSeats[0] || 0, { action: 'state' });
    return r;
  }
  const mkBoard = (prefix, n) => [...Array(n)].map((_, i) => prefix + (i + 1));

  try {
    /* ---------- 방 옵션 ---------- */
    {
      const o1 = W.options({ topic: 'animal', size: 4, lines: 2 });
      check('옵션: 주제·크기·줄', o1.size === 4 && o1.lines === 2 && o1.topic.id === 'animal' && o1.topic.label === '동물');
      const o2 = W.options({ topic: 'zzz', size: 9, lines: 99 });
      check('옵션: 이상한 값은 기본값 (과일, 5×5, 3줄)', o2.size === 5 && o2.lines === 3 && o2.topic.id === 'fruit');
      const o3 = W.options({ topic: 'custom', topicText: '  우리가   본 영화 ', size: 3, lines: 5 });
      check('옵션: 직접 쓰기 주제 이름 정리, 3×3 은 5줄까지', o3.topic.label === '우리가 본 영화' && o3.lines === 5, JSON.stringify(o3));
      check('옵션: 직접 쓰기 빈 이름 → 자유 주제', W.options({ topic: 'custom' }).topic.label === '자유 주제');
    }

    /* ---------- 2명 (사람 둘) — 준비·차례·비밀·공개 ---------- */
    {
      const t = table(2, 0, 2, { topic: 'fruit', size: 3, lines: 1 });
      let r = await t.open(); r = await t.start();
      check('2명: 시작하면 setup, 과일 3×3 1줄, 빈칸 채우기 목록', r.body.stage === 'setup' && r.body.size === 3 && r.body.winLines === 1 && Array.isArray(r.body.suggest) && r.body.suggest.includes('사과'));
      r = await t.as(0, { action: 'ready', board: ['사과', '배', '포도', '딸기', '수박', '참외', '귤', '감', '사 과'] });
      check('2명: 같은 단어 두 번(띄어쓰기 무시)은 거절 + 이유', r.status === 400 && /두 번/.test(r.body.error), r.body.error);
      r = await t.as(0, { action: 'ready', board: ['사과', '배', '포도', '딸기', '수박', '참외', '귤', '감'] });
      check('2명: 칸 수가 틀리면 거절', r.status === 400);
      r = await t.as(0, { action: 'ready', board: ['사과', '배', '포도', '딸기', '수박', '참외', '귤', '감', '  '] });
      check('2명: 빈 칸은 거절', r.status === 400 && /비어/.test(r.body.error), r.body.error);
      const A = ['사과', '배', '포도', '비밀A1', '비밀A2', '비밀A3', '비밀A4', '비밀A5', '비밀A6'];
      const B = ['포도', 'SA과', '사 과', '비밀B1', '비밀B2', '비밀B3', '비밀B4', '비밀B5', '배'];
      r = await t.as(0, { action: 'ready', board: A });
      check('2명: 준비', r.status === 200 && r.body.ready && r.body.stage === 'setup');
      check('2명: 준비해도 suggest 는 안 실린다', r.body.suggest === null);
      check('2명: 두 번 준비는 거절', (await t.as(0, { action: 'ready', board: A })).status === 409);
      r = await t.as(1, { action: 'ready', board: B });
      check('2명: 다 준비하면 play', r.body.stage === 'play', r.body.stage);
      const first = r.body.turn, other = 1 - first;
      const notTurn = await t.as(other, { action: 'call', i: 0 });
      check('2명: 차례 아닌 사람이 부르면 409', notTurn.status === 409 && /차례/.test(notTurn.body.error));
      for (const i of [0, 1]) {
        const s = (await t.as(i, { action: 'state' })).body, str = JSON.stringify(s);
        check(`2명: ${i}번 응답에 남의 판이 없다`, s.boards === null && s.shared === null && !(i === 0 ? /비밀B/ : /비밀A/).test(str) && str.includes(i === 0 ? '비밀A1' : '비밀B1'));
      }
      // 선공이 '사과' 또는 '사 과' 를 부른다 → 두 판 다 지워짐 (count 2)
      const callerBoard = first === 0 ? A : B;
      r = await t.as(first, { action: 'call', i: callerBoard.findIndex((w) => W.norm(w) === '사과') });
      check('2명: 같은 단어(띄어쓰기 무시)는 두 판 다 → count 2', r.status === 200 && r.body.called[0].count === 2 && r.body.called[0].by === first, JSON.stringify(r.body.called));
      check('2명: 한 번 부르면 차례가 넘어간다', r.body.turn === other);
      const otherBoard = other === 0 ? A : B;
      r = await t.as(other, { action: 'call', i: otherBoard.findIndex((w) => W.norm(w) === '사과') });
      check('2명: 이미 나온 단어는 409', r.status === 409 && /이미/.test(r.body.error));
      r = await t.as(other, { action: 'call', i: 99 });
      check('2명: 없는 칸은 400', r.status === 400);
      const mine = otherBoard.findIndex((w) => /비밀/.test(w));
      r = await t.as(other, { action: 'call', i: mine });
      check('2명: 나만 쓴 단어는 count 1', r.body.called[1].count === 1);
      // 0번이 첫 줄(사과·배·포도)을 채우도록 끝까지
      r = await playOut(t, [0, 1], r);
      check('2명: 끝까지 간다', r.body.stage === 'done' && r.body.winners.length >= 1);
      check('2명: 이긴 사람은 목표 줄 이상', r.body.winners.every((i) => r.body.lines[i] >= 1));
      check('2명: 끝나면 판이 다 공개된다', r.body.boards.filter(Boolean).length === 2 && r.body.boards[1].includes('비밀B1'));
      const sh = r.body.shared.map((x) => W.norm(x.w)).sort();
      check('2명: 여럿이 같이 쓴 단어 = 사과·배·포도', JSON.stringify(sh) === JSON.stringify(['배', '사과', '포도']), JSON.stringify(r.body.shared));
      check('2명: 순위(줄 수)', r.body.rank && r.body.rank[0].s === Math.max(...r.body.lines));
      const after = await t.as(0, { action: 'call', i: 5 });
      check('2명: 끝난 뒤 부르기 거절', after.status === 409);
      const again = await t.as(1, { action: 'restart', round: r.body.round });
      check('2명: 다시 하기 — 새 판(setup), 내 판 비움, 자리 유지', again.body.round === 2 && again.body.stage === 'setup' && again.body.board === null && again.body.called.length === 0 && again.body.players.length === 2);
      const dup = await t.as(0, { action: 'restart', round: r.body.round });
      check('2명: 둘이 같이 다시 하기 눌러도 한 판만 넘어간다', dup.body.round === 2);
    }

    /* ---------- 같은 차례에 여럿이 채우면 공동 우승 ---------- */
    {
      const t = table(3, 0, 3, { topic: 'custom', topicText: '우리 단어', size: 3, lines: 1 });
      let r = await t.open(); r = await t.start();
      check('직접 쓰기 주제: suggest 없음', r.body.suggest === null && r.body.hasWords === false && r.body.topic.label === '우리 단어');
      const same = ['가', '나', '다', '라', '마', '바', '사', '아', '자'];
      const third = ['가', '나', '하', '라', '마', '바', '사', '아', '자'];
      await t.as(0, { action: 'ready', board: same }); await t.as(1, { action: 'ready', board: same });
      r = await t.as(2, { action: 'ready', board: third });
      let k = 0;
      while (r.body.stage === 'play' && k < 3) { const who = r.body.turn; r = await t.as(who, { action: 'call', i: k }); if (r.status !== 200) break; k++; }
      // 가·나 + (다 or 하) 를 불렀다. 다를 불렀으면 0·1 동시, 하를 불렀으면 2 혼자
      const calledW = r.body.called.map((c) => c.w);
      const exp = calledW.includes('다') ? [0, 1] : [2];
      check('같은 차례 공동 우승', r.body.stage === 'done' && JSON.stringify(r.body.winners) === JSON.stringify(exp), JSON.stringify({ calledW, w: r.body.winners }));
      check('count = 그 단어를 쓴 사람 수', r.body.called[0].count === 3 && r.body.called.every((c) => c.count === (c.w === '다' ? 2 : c.w === '하' ? 1 : 3)));
    }

    /* ---------- 4명 (사람 2 + AI 2), 8명 (사람 1 + AI 7) ---------- */
    for (const [humans, bots, topic, size, lines] of [[2, 2, 'animal', 4, 2], [1, 7, 'food', 5, 3], [1, 3, 'trip', 5, 2]]) {
      const n = humans + bots;
      const t = table(humans, bots, n, { topic, size, lines });
      let r = await t.open(); r = await t.start();
      r = await t.poll();
      check(`${n}명(${topic}): AI ${bots}명이 한 번의 폴링으로 다 준비(quick)`, r.body.readyAll.filter(Boolean).length === bots, JSON.stringify(r.body.readyAll));
      const docs = await t.docs();
      if (topic === 'trip') check(`${n}명: 목록 없는 주제면 봇은 여러 주제를 섞어 쓴다`, docs.slice(humans).every((d) => d.board && d.board.length === 25));
      else check(`${n}명: 봇 판은 주제 단어`, docs.slice(humans).every((d) => d.board.every((w) => W.wordsOf(topic).includes(w))));
      let leaked = false, countOk = true;
      r = await playOut(t, [...Array(humans)].map((_, i) => i), r, 1500, async (rr) => {
        if (rr.body.stage !== 'done') {
          const str = JSON.stringify(rr.body);
          if (rr.body.boards || rr.body.shared) leaked = true;
          // 다른 사람만 쓴, 아직 안 부른 단어가 응답에 있으면 새는 것
          const ds = await t.docs(), calledK = new Set(rr.body.called.map((c) => W.norm(c.w))), mineK = new Set((ds[rr.body.you].board || []).map(W.norm));
          for (let j = 0; j < ds.length; j++) if (j !== rr.body.you && ds[j].board) for (const w of ds[j].board) if (!calledK.has(W.norm(w)) && !mineK.has(W.norm(w)) && w.length >= 3 && str.includes('"' + w + '"') && !(rr.body.suggest || []).includes(w)) leaked = true;
          for (const c of rr.body.called) if (c.count !== ds.filter((d) => d.board && d.board.some((w) => W.norm(w) === W.norm(c.w))).length) countOk = false;
        }
      });
      check(`${n}명: 끝까지 간다 (부른 단어 ${r.body.called.length}개)`, r.body.stage === 'done' && r.body.winners.length >= 1, 'stage=' + r.body.stage);
      check(`${n}명: 이긴 사람은 목표 줄 이상, 나머지는 미만`, r.body.winners.every((i) => r.body.lines[i] >= lines) && r.body.lines.every((l, i) => r.body.winners.includes(i) || l < lines));
      check(`${n}명: 게임 중 남의 판은 안 보인다`, !leaked);
      check(`${n}명: count = 그 단어를 쓴 사람 수`, countOk);
      check(`${n}명: 끝나면 판 ${n}개 공개 + 같이 쓴 단어`, r.body.boards.filter(Boolean).length === n && Array.isArray(r.body.shared) && r.body.shared.every((x) => x.seats.length >= 2));
    }

    /* ---------- 기권 ---------- */
    {
      const t = table(3, 1, 4, { topic: 'fruit', size: 5, lines: 3 });
      let r = await t.open(); r = await t.start();
      // 2번 사람은 준비 전에 나간다 → 남은 사람끼리 시작
      r = await t.as(2, { action: 'resign' });
      check('기권: 준비 전에 나가도 나머지끼리 시작할 수 있다', r.status === 200 && r.body.players[2].out);
      r = await t.as(2, { action: 'ready', board: mkBoard('x', 25) });
      check('기권: 나간 사람은 준비 못 함', r.status === 409);
      let resigned1 = false;
      r = await playOut(t, [0, 1], r, 800, async (rr) => {
        if (!resigned1 && rr.body.stage === 'play' && rr.body.called.length >= 3) { resigned1 = true; await t.as(1, { action: 'resign' }); }
      });
      check('기권: 게임 중 한 명 더 나가도 끝까지 간다', r.body.stage === 'done' && resigned1 && r.body.players[1].out, 'stage=' + r.body.stage);
      check('기권: 나간 사람은 순위·우승에 없다', r.body.rank.every((x) => x.i !== 1 && x.i !== 2) && r.body.winners.every((i) => i !== 1 && i !== 2));
      check('기권: 나간 사람은 차례에 안 온다', !r.body.called.some((c, k) => c.by === 2));
    }
    {
      // 한 명만 남으면 끝 (그 사람 승)
      const t = table(2, 0, 2, { size: 3, lines: 2 });
      let r = await t.open(); r = await t.start();
      await t.as(0, { action: 'ready', board: mkBoard('a', 9) }); r = await t.as(1, { action: 'ready', board: mkBoard('b', 9) });
      r = await t.as(1, { action: 'resign' });
      r = await t.as(0, { action: 'state' });
      check('기권: 혼자 남으면 끝, 남은 사람 승', r.body.stage === 'done' && JSON.stringify(r.body.winners) === '[0]');
    }

    /* ---------- 혼자 하기 ---------- */
    {
      const t = table(1, 0, 4, { bot: true, topic: 'country', size: 4, lines: 2 });
      let r = await t.open();
      check('혼자 하기: AI 하나와 바로 시작', r.body.phase === 'play' && r.body.players.length === 2 && r.body.bot && r.body.stage === 'setup');
      r = await playOut(t, [0], r, 400);
      check('혼자 하기: 끝까지', r.body.stage === 'done');
    }

    /* ---------- 팀전 2·3·4팀 (teamMode any) ---------- */
    for (const [teams, humans, bots] of [[2, 2, 2], [3, 1, 5], [4, 2, 6], [2, 1, 2]]) {
      const n = humans + bots;
      const t = table(humans, bots, n, { teams, topic: 'sport', size: 5, lines: 2 });
      let r = await t.open(); r = await t.start();
      check(`팀 ${teams}팀 ${n}명: 시작`, r.body.phase === 'play' && r.body.teams === teams, r.body.error || '');
      const room = await t.store.get('room:' + t.codes.code);
      const seq = [...Array(n)].map((_, k) => K.turnSeat(room, k));
      check(`팀 ${teams}팀: 차례가 팀을 번갈아`, seq.every((x, k) => k === 0 || K.teamOf(room, x) !== K.teamOf(room, seq[k - 1])), JSON.stringify(seq));
      r = await playOut(t, [...Array(humans)].map((_, i) => i), r, 1500);
      const tm = r.body.team;
      check(`팀 ${teams}팀: 끝까지 + 팀 결과`, r.body.stage === 'done' && tm && tm.mode === 'any', 'stage=' + r.body.stage);
      const winTeams = [...new Set(r.body.winners.map((i) => r.body.players[i].team))].sort();
      check(`팀 ${teams}팀: 이긴 팀 = 목표 줄을 채운 사람이 든 팀`, JSON.stringify([...tm.winners].sort()) === JSON.stringify(winTeams), JSON.stringify([tm.winners, winTeams, r.body.winners]));
      check(`팀 ${teams}팀: 팀 점수 1/0`, tm.scores.every((s, k) => s === (winTeams.includes(k) ? 1 : 0)));
      if (teams === 2 && humans === 2) {
        const again = await t.as(0, { action: 'restart', round: r.body.round });
        check('팀: 다시 하기 — 팀 그대로', again.body.stage === 'setup' && JSON.stringify(again.body.players.map((p) => p.team)) === JSON.stringify(r.body.players.map((p) => p.team)));
      }
    }
    {
      // 팀전: 한 팀이 다 기권하면 끝 (남은 팀 중 줄 많은 사람)
      let r;
      const t2 = table(2, 2, 4, { teams: 2, size: 4, lines: 3 });
      await t2.open();
      await t2.as(0, { action: 'setteam', seat: 1, team: 0 }); await t2.as(0, { action: 'setteam', seat: 2, team: 1 }); await t2.as(0, { action: 'setteam', seat: 3, team: 1 });
      r = await t2.start();
      await t2.as(0, { action: 'ready', board: mkBoard('a', 16) }); await t2.as(1, { action: 'ready', board: mkBoard('b', 16) });
      r = await t2.poll();
      await t2.as(0, { action: 'resign' }); r = await t2.as(1, { action: 'resign' });
      r = await t2.as(1, { action: 'state' });
      check('팀 기권: 한 팀만 남으면 끝, 남은 팀 승', r.body.stage === 'done' && r.body.team && JSON.stringify(r.body.team.winners) === '[1]', JSON.stringify(r.body.team));
    }

    /* ---------- 무작위 수백 판: 예외·멈춤 0 ---------- */
    {
      const topics = Object.keys(W.TOPICS);
      let games = 0, stuck = 0, errors = 0, done = 0, totalCalls = 0, sameTurnTies = 0;
      for (let g = 0; g < 300; g++) {
        const n = 2 + (g % 7), humans = 1 + (g % 3 === 0 ? 1 : 0), bots = n - humans;
        const size = [3, 4, 5][g % 3], lines = 1 + (g % Math.min(5, 2 * size + 2));
        const teamsOpt = [0, 0, 2, 3, 4][g % 5];
        const teams = teamsOpt && teamsOpt <= n ? teamsOpt : 0;
        const t = table(humans, bots, n, { teams, topic: topics[g % topics.length], topicText: 'x', size, lines });
        try {
          let r = await t.open(); r = await t.start();
          if (r.status !== 200) { errors++; continue; }
          let resigned = false;
          r = await playOut(t, [...Array(humans)].map((_, i) => i), r, 2000, async (rr) => {
            if (humans === 2 && !resigned && g % 4 === 0 && rr.body.stage === 'play' && rr.body.called.length > 2) { resigned = true; await t.as(1, { action: 'resign' }); }
          });
          games++;
          if (r.body.stage === 'done') { done++; totalCalls += r.body.called.length; if (r.body.winners.length > 1) sameTurnTies++; } else stuck++;
          if (r.body.stage === 'done' && (!r.body.winners.length || (teams && !r.body.team))) errors++;
        } catch (e) { errors++; console.log(e.stack); }
      }
      check(`무작위 ${games}판: 예외 0 · 멈춤 0 (평균 ${(totalCalls / Math.max(1, done)).toFixed(1)}번 부름, 공동 우승 ${sameTurnTies}판)`, errors === 0 && stuck === 0 && done === 300, JSON.stringify({ errors, stuck, done }));
    }
  } catch (e) { check('예외 없이 끝난다', false, e.stack || String(e)); }
  console.log(failures ? `\n실패 ${failures}` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
