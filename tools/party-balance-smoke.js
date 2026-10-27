#!/usr/bin/env node
/* 여럿이 이심전심 테스트.
 *   node tools/party-balance-smoke.js
 * 사람 여럿(토큰)과 AI 를 섞어 2~8명 방을 끝까지 돌린다. 봇은 BOT_DELAY 뒤에 움직이니 now 를 흘린다.
 */
const path = require('path');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? ' ok ' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
function memStore() { const m = new Map(); return { async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); }, async set(k, v) { m.set(k, JSON.stringify(v)); } }; }
const lib = (f) => import(path.join(__dirname, '..', 'netlify/lib', f));

(async () => {
  const K = await lib('party-kit.mjs');
  const B = await lib('party-balance-core.mjs');
  const DT = K.BOT_DELAY + 300;

  function table(handle, humans, bots, max, opts = {}) {
    const store = memStore(); let now = 1_000_000; const toks = [], codes = { code: null };
    const as = async (i, b, dt = 0) => { now += dt; const r = await handle({ ...b, token: toks[i], code: codes.code }, store, now); if (r.body.token) toks[i] = r.body.token; if (r.body.code) codes.code = r.body.code; return r; };
    return {
      store, as, now: () => now, toks, codes,
      async open() {
        const r = await as(0, { action: 'create', name: '사람1', max, ...opts });
        for (let i = 1; i < humans; i++) await as(i, { action: 'join', name: '사람' + (i + 1) });
        for (let i = 0; i < bots; i++) await as(0, { action: 'addbot' });
        return r;
      },
      start: () => as(0, { action: 'start' }),
      poll: (i = 0) => as(i, { action: 'state' }, DT),
    };
  }
  const humanSeats = (st) => st.players.map((p, i) => (!p.bot && !p.out ? i : -1)).filter((i) => i >= 0);
  /* 끝까지: 사람은 choose(i, qi) 로 고르고, 공개되면 첫 사람이 '다음' */
  async function playOut(t, nh, choose = () => Math.random() < 0.5 ? 0 : 1, guardMax = 400) {
    let r = await t.poll(0), guard = 0;
    while (r.body.stage === 'play' && guard++ < guardMax) {
      const st = r.body;
      if (st.reveal) { r = await t.as(humanSeats(st)[0] ?? 0, { action: 'next', qi: st.qi }); if (r.status !== 200) return { r, err: r.body.error }; continue; }
      let did = false;
      for (const i of humanSeats(st)) if (i < nh && !st.picked[i]) { const x = await t.as(i, { action: 'pick', qi: st.qi, choice: choose(i, st.qi) }); if (x.status !== 200) return { r: x, err: x.body.error }; did = true; }
      r = await t.poll(humanSeats(st)[0] ?? 0);
      if (!did && !r.body.reveal && r.body.stage === 'play' && r.body.qi === st.qi && r.body.pickedCount === st.pickedCount) { /* 봇 기다림 */ }
    }
    return { r, guard };
  }

  try {
    /* ---------- 옵션 ---------- */
    {
      for (const [c, want] of [[5, 5], [15, 15], [7, 10], [undefined, 10]]) {
        const t = table(B.handle, 1, 1, 2, c === undefined ? {} : { count: c });
        await t.open(); const r = await t.start();
        check(`옵션: 문제 수 ${c} → ${want}`, r.body.total === want, String(r.body.total));
      }
      check('질문 80개를 그대로 가져온다', B.QUESTIONS.length === 80);
    }

    /* ---------- 2명 사람 — 공개·바꾸기·다음·점수 ---------- */
    {
      const t = table(B.handle, 2, 0, 2, { count: 5 });
      await t.open(); let r = await t.start();
      check('2명: 시작 play, 첫 문제', r.body.stage === 'play' && r.body.qi === 0 && Array.isArray(r.body.q) && r.body.q.length === 2);
      r = await t.as(0, { action: 'pick', qi: 0, choice: 1 });
      check('2명: 고르면 1/2', r.body.pickedCount === 1 && r.body.activeCount === 2 && r.body.mine === 1 && !r.body.reveal);
      r = await t.as(0, { action: 'pick', qi: 0, choice: 0 });
      check('2명: 공개 전엔 바꿀 수 있다', r.status === 200 && r.body.mine === 0);
      const a = (await t.as(1, { action: 'state' })).body;
      check('2명: 상대 답은 공개 전 응답에 없다', a.reveal === null && a.mine === null && a.picked[0] === true && !JSON.stringify(a).includes('"picks"'));
      // 상대가 0 이든 1 이든 내 응답은 같다 (답 비밀)
      await t.as(0, { action: 'pick', qi: 0, choice: 1 });
      const b = (await t.as(1, { action: 'state' })).body;
      check('2명: 상대가 답을 바꿔도 내 응답은 똑같다', JSON.stringify(a) === JSON.stringify(b));
      check('2명: 공개 전 다음은 거절', (await t.as(0, { action: 'next', qi: 0 })).status === 409);
      check('2명: 지난/다른 문제 번호로 고르기는 거절', (await t.as(1, { action: 'pick', qi: 3, choice: 0 })).status === 409);
      check('2명: 이상한 답은 거절', (await t.as(1, { action: 'pick', qi: 0, choice: 2 })).status === 400);
      r = await t.as(1, { action: 'pick', qi: 0, choice: 1 });
      check('2명: 둘 다 고르면 공개 + 같은 답이면 각자 +1', r.body.reveal && JSON.stringify(r.body.reveal.picks) === '[1,1]' && JSON.stringify(r.body.reveal.gain) === '[1,1]' && JSON.stringify(r.body.scores) === '[1,1]');
      check('2명: 공개 뒤엔 못 바꾼다', (await t.as(0, { action: 'pick', qi: 0, choice: 0 })).status === 409);
      r = await t.as(0, { action: 'next', qi: 0 });
      const again = await t.as(1, { action: 'next', qi: 0 });
      check('2명: 다음은 멱등 (둘이 눌러도 qi 1)', r.body.qi === 1 && again.status === 200 && again.body.qi === 1);
      check('2명: 지난 문제는 history 에', again.body.history.length === 1 && again.body.history[0].picks.join() === '1,1');
      await t.as(0, { action: 'pick', qi: 1, choice: 0 }); r = await t.as(1, { action: 'pick', qi: 1, choice: 1 });
      check('2명: 다른 답이면 0점', JSON.stringify(r.body.reveal.gain) === '[0,0]' && JSON.stringify(r.body.scores) === '[1,1]');
      await t.as(1, { action: 'next', qi: 1 });
      for (let q = 2; q < 5; q++) { await t.as(0, { action: 'pick', qi: q, choice: 0 }); await t.as(1, { action: 'pick', qi: q, choice: 0 }); r = await t.as(0, { action: 'next', qi: q }); }
      check('2명: 5문제 뒤 끝', r.body.stage === 'done' && r.body.qi === 5 && r.body.history.length === 5);
      check('2명: 점수 4:4 공동 1등', JSON.stringify(r.body.rank.map((x) => [x.i, x.s, x.rank])) === '[[0,4,1],[1,4,1]]' && r.body.winners.length === 2);
      check('2명: 나와 맞은 수 (match)', r.body.match[1] === 4 && r.body.match[0] === 0);
      check('2명: 끝난 뒤 고르기 거절', (await t.as(0, { action: 'pick', qi: 5, choice: 0 })).status === 409);
      const re = await t.as(1, { action: 'restart', round: 1 });
      const re2 = await t.as(0, { action: 'restart', round: 1 });
      check('2명: 다시 하기 — 2판 qi 0, 점수 0, 둘이 눌러도 한 번', re.body.round === 2 && re.body.qi === 0 && re.body.scores.every((s) => s === 0) && re2.body.round === 2);
    }

    /* ---------- 4명 점수 — 같은 사람 수만큼 ---------- */
    {
      const t = table(B.handle, 4, 0, 4, { count: 5 });
      await t.open(); await t.start();
      const ch = [0, 0, 0, 1];
      let r; for (let i = 0; i < 4; i++) r = await t.as(i, { action: 'pick', qi: 0, choice: ch[i] });
      check('4명: 0·0·0·1 → 2·2·2·0', JSON.stringify(r.body.reveal.gain) === '[2,2,2,0]' && JSON.stringify(r.body.reveal.cnt) === '[3,1]');
      // 공개 전에는 3명이 골라도 답이 안 보인다
      await t.as(0, { action: 'next', qi: 0 });
      for (let i = 0; i < 3; i++) await t.as(i, { action: 'pick', qi: 1, choice: i % 2 });
      const s3 = (await t.as(3, { action: 'state' })).body;
      check('4명: 3명 골라도 나머지 한 명에겐 답이 안 보인다', s3.reveal === null && s3.pickedCount === 3 && !JSON.stringify(s3).includes('"picks":[0,1,0'));
    }

    /* ---------- 기권 ---------- */
    {
      const t = table(B.handle, 3, 0, 3, { count: 5 });
      await t.open(); await t.start();
      await t.as(0, { action: 'pick', qi: 0, choice: 0 }); await t.as(1, { action: 'pick', qi: 0, choice: 0 });
      let r = await t.as(2, { action: 'resign' });
      check('기권: 남은 사람이 다 골랐으면 바로 공개', r.body.players[2].out && r.body.reveal && r.body.activeCount === 2);
      check('기권: 기권한 뒤 고르기 거절', (await t.as(2, { action: 'pick', qi: 0, choice: 1 })).status === 409);
      r = await t.as(1, { action: 'resign' });
      check('기권: 한 명만 남으면 끝, 남은 사람 우승', r.body.stage === 'done' && JSON.stringify(r.body.winners) === '[0]' && r.body.rank.length === 1);
    }

    /* ---------- 팀전 2팀: 팀원 모두 같으면 성공 ---------- */
    {
      const t = table(B.handle, 4, 0, 4, { teams: 2, count: 5 });
      await t.open(); let r = await t.start();
      const team = r.body.players.map((p) => p.team);
      check('팀 2: 시작 (0,1,0,1)', JSON.stringify(team) === '[0,1,0,1]');
      // 빨강(0,2) 같은 답, 파랑(1,3) 다른 답
      const ch = [1, 0, 1, 1];
      for (let i = 0; i < 4; i++) r = await t.as(i, { action: 'pick', qi: 0, choice: ch[i] });
      check('팀 2: 빨강 성공 · 파랑 실패', JSON.stringify(r.body.reveal.teamHit) === '[true,false]' && JSON.stringify(r.body.teamScores) === '[1,0]');
      for (let q = 0; q < 5; q++) {
        if (q) for (let i = 0; i < 4; i++) r = await t.as(i, { action: 'pick', qi: q, choice: q === 4 ? 0 : i === 1 ? 1 : 0 });
        r = await t.as(0, { action: 'next', qi: q });
      }
      // q1~3: 빨강 0,0 성공, 파랑 1,0 실패 · q4: 모두 0 → 둘 다 성공 → 빨강 5, 파랑 1
      check('팀 2: 끝 — 팀 점수 5:1', r.body.stage === 'done' && JSON.stringify(r.body.teamScores) === '[5,1]', JSON.stringify(r.body.teamScores));
      check('팀 2: kit 팀 결과 = 빨강 우승 (any)', r.body.team && r.body.team.mode === 'any' && JSON.stringify(r.body.team.winners) === '[0]', JSON.stringify(r.body.team));
      check('팀 2: winners = 빨강 팀원', JSON.stringify(r.body.winners) === '[0,2]');
      check('팀 2: rank 는 개인 텔레파시 점수', r.body.rank.every((x) => x.s === r.body.scores[x.i]));
    }

    /* ---------- 팀전 3팀 — 1명 팀은 다수 쪽과 같으면 +1 ---------- */
    {
      const t = table(B.handle, 5, 0, 5, { teams: 3, count: 5 });
      await t.open(); let r = await t.start();
      const team = r.body.players.map((p) => p.team);           // [0,1,2,0,1] → 초록(2)은 한 명
      check('팀 3: 5명 → 초록 1명', JSON.stringify(team) === '[0,1,2,0,1]');
      let ch = [0, 1, 0, 0, 0];   // cnt 0:4 1:1 → 초록(자리2) 0 = 다수 → 성공. 빨강 0,0 성공. 파랑 1,0 실패
      for (let i = 0; i < 5; i++) r = await t.as(i, { action: 'pick', qi: 0, choice: ch[i] });
      check('팀 3: 1명 팀 다수와 같으면 성공', JSON.stringify(r.body.reveal.teamHit) === '[true,false,true]', JSON.stringify(r.body.reveal.teamHit));
      await t.as(0, { action: 'next', qi: 0 });
      ch = [0, 0, 1, 0, 0];
      for (let i = 0; i < 5; i++) r = await t.as(i, { action: 'pick', qi: 1, choice: ch[i] });
      check('팀 3: 1명 팀 소수면 실패', JSON.stringify(r.body.reveal.teamHit) === '[true,true,false]');
      await t.as(0, { action: 'next', qi: 1 });
      ch = [0, 1, 1, 1, 1];   // 4:… cnt 0:1 1:4
      for (let i = 0; i < 5; i++) r = await t.as(i, { action: 'pick', qi: 2, choice: ch[i] });
      check('팀 3: 빨강 갈리면 실패', JSON.stringify(r.body.reveal.teamHit) === '[false,true,true]');
      const res = await playOut(t, 5, () => 0);
      check('팀 3: 끝까지', res.r.body.stage === 'done' && res.r.body.team && res.r.body.team.winners.length >= 1, res.err || '');
      const ts = res.r.body.teamScores, best = Math.max(...ts);
      check('팀 3: 이긴 팀 = 성공 수 최대', res.r.body.team.winners.every((k) => ts[k] === best) && ts.every((v, k) => v < best || res.r.body.team.winners.includes(k)), JSON.stringify([ts, res.r.body.team.winners]));
    }

    /* ---------- 팀전 4팀 + 봇, 8명 ---------- */
    {
      const t = table(B.handle, 2, 6, 8, { teams: 4 });
      await t.open(); const r0 = await t.start();
      check('팀 4: 8명 시작', r0.body.phase === 'play' && r0.body.teams === 4 && r0.body.players.length === 8);
      const res = await playOut(t, 2);
      const b = res.r.body;
      check('팀 4: 사람 2 + AI 6 끝까지', b.stage === 'done' && b.history.length === 10, res.err || 'stage=' + b.stage);
      const best = Math.max(...b.teamScores);
      check('팀 4: 팀 결과가 규칙대로', b.team && JSON.stringify(b.team.winners) === JSON.stringify(b.teamScores.map((v, k) => (v === best ? k : -1)).filter((k) => k >= 0)), JSON.stringify([b.teamScores, b.team && b.team.winners]));
      // 손으로 다시 계산
      const tm = b.players.map((p) => p.team), sc = Array(4).fill(0);
      for (const h of b.history) for (let k = 0; k < 4; k++) { const m = h.picks.filter((p, i) => tm[i] === k && p !== null); if (m.length > 1 ? m.every((p) => p === m[0]) : m.length === 1 && h.picks.filter((p) => p === m[0]).length >= h.picks.filter((p) => p === 1 - m[0]).length) sc[k]++; }
      check('팀 4: 팀 점수 다시 계산과 같다', JSON.stringify(sc) === JSON.stringify(b.teamScores));
      const ind = Array(8).fill(0); for (const h of b.history) h.picks.forEach((p, i) => { if (p !== null) ind[i] += h.picks.filter((q, j) => j !== i && q === p).length; });
      check('팀 4: 개인 점수 다시 계산과 같다', JSON.stringify(ind) === JSON.stringify(b.scores));
    }

    /* ---------- AI 여럿은 한 요청에 다 고른다 (quick) ---------- */
    {
      const t = table(B.handle, 1, 7, 8);
      await t.open(); let r = await t.start();
      r = await t.poll(0);
      check('8명: AI 일곱이 한 번의 폴링으로 다 고른다', r.body.pickedCount === 7, String(r.body.pickedCount));
      check('8명: 사람이 안 고르면 공개 안 됨 · AI 가 다음을 안 누른다', r.body.reveal === null && (await t.poll(0)).body.qi === 0);
      await t.as(0, { action: 'pick', qi: 0, choice: 0 });
      r = await t.poll(0); r = await t.poll(0);
      check('8명: 사람이 있으면 다음은 사람이 누른다', r.body.qi === 0 && r.body.reveal);
      const res = await playOut(t, 1);
      check('8명: 사람 1 + AI 7 끝까지', res.r.body.stage === 'done' && res.r.body.rank.length === 8, res.err || '');
      const me = res.r.body.match;
      check('8명: 나와 맞은 수 = history 에서 센 값', me.every((v, j) => j === 0 || v === res.r.body.history.filter((h) => h.picks[0] === h.picks[j]).length));
    }

    /* ---------- 사람이 다 기권하면 AI 가 다음을 눌러 끝까지 ---------- */
    {
      const t = table(B.handle, 2, 3, 5, { count: 5 });
      await t.open(); await t.start();
      await t.as(0, { action: 'resign' }); await t.as(1, { action: 'resign' });
      let r, g = 0;
      do { r = await t.poll(0); } while (r.body.stage === 'play' && g++ < 100);
      check('봇만 남으면 AI 가 다음을 눌러 끝난다', r.body.stage === 'done' && r.body.history.length === 5 && r.body.rank.length === 3, `stage=${r.body.stage} g=${g}`);
    }

    /* ---------- 같은 순간 두 요청이 봇 답을 정해도 같다 (seeded) ---------- */
    {
      const t = table(B.handle, 2, 1, 3);
      await t.open(); await t.start();
      const room = await t.store.get('room:' + t.codes.code);
      const ctx = { room, idx: 2, me: { round: room.round }, docs: [{}, {}, {}], active: [0, 1, 2] };
      const a = B.botMove(ctx), b = B.botMove(ctx);
      check('봇: 답이 seeded — 두 번 물어도 같다', a.act === 'pick' && a.body.choice === b.body.choice);
    }

    /* ---------- 혼자 하기 ---------- */
    {
      const t = table(B.handle, 1, 0, 2, { bot: true });
      const r = await t.open();
      check('혼자 하기: AI 하나와 바로 시작', r.body.phase === 'play' && r.body.players.length === 2 && r.body.stage === 'play');
      const res = await playOut(t, 1);
      check('혼자 하기: 끝까지', res.r.body.stage === 'done', res.err || '');
    }

    /* ---------- 무작위 수백 판 ---------- */
    {
      let games = 0, stuck = 0, errs = 0, teamBad = 0;
      for (let g = 0; g < 300; g++) {
        const n = 2 + (g % 7), nh = 1 + (g % Math.min(n, 3)), nb = n - nh;
        const teams = [0, 2, 3, 4][g % 4];
        const tm = teams && teams <= n ? teams : 0;
        const t = table(B.handle, nh, nb, n, { teams: tm, count: [5, 10, 15][g % 3] });
        try {
          await t.open(); const s = await t.start();
          if (s.status !== 200) { errs++; continue; }
          // 가끔 사람 하나가 기권
          if (nh > 1 && g % 5 === 0) await t.as(nh - 1, { action: 'resign' });
          const res = await playOut(t, nh, undefined, 800);
          if (res.err) errs++;
          else if (res.r.body.stage !== 'done') stuck++;
          else {
            games++;
            const b = res.r.body;
            if (tm && b.team) { const live = b.team.scores.map((v) => v !== null); const best = Math.max(...b.teamScores.filter((_, k) => live[k])); if (!b.team.winners.every((k) => b.teamScores[k] === best)) teamBad++; }
          }
        } catch (e) { errs++; console.log(e); }
      }
      check(`무작위 300판 (2~8명, 팀 0·2·3·4, 기권 섞어) — 끝 ${games}, 멈춤 ${stuck}, 오류 ${errs}`, games === 300 && !stuck && !errs);
      check('무작위: 팀 결과가 성공 수 최대 팀', teamBad === 0, String(teamBad));
    }
  } catch (e) { console.error(e); failures++; }

  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
