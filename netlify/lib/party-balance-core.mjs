/* 여럿이 이심전심 (2~8명) — 이심전심(balance-core)을 party-kit 위에 올린 것. 질문은 balance-core 의 QUESTIONS 그대로.
 *
 * 한 판 = 질문 5·10·15개(방 만들 때, 기본 10). 순서는 roundRng(방 코드:판 번호).
 * 문제마다 모두가 **동시에** 둘 중 하나를 고른다 — 각자 자기 문서(picks[qi])에만 쓴다(quick 행동이라 봇 여럿이 한 요청에).
 * 활성(기권 안 한) 사람이 다 고르면 공개. 공개 전엔 남의 답을 응답에 안 넣는다 — 누가 골랐는지(picked)만.
 * 공개 전엔 내 답을 바꿀 수 있다. '다음'은 공개 뒤 아무나, 멱등(qi+1) — 공용 문서.
 *
 * 개인 점수(텔레파시): 문제마다 나와 같은 걸 고른 사람 수만큼 +1. 끝나면 점수 순 + 나와 가장 잘 맞는 사람(쌍별 일치 수).
 * 팀전: 문제마다 팀원(그 문제를 고른 사람) 전원이 같은 답이면 그 팀 +1 '이심전심 성공'.
 *   그 문제를 고른 팀원이 1명뿐이면(1명 팀, 나머지 기권) 그 사람 답이 **다수 쪽**(같은 수면 둘 다 다수)과 같을 때 +1.
 *   팀원 수가 다르니 kit 'sum' 은 불공평 → teamMode 'any', winners = 팀 성공 수가 가장 큰 팀(들)의 활성 팀원.
 *   rank 의 s 는 개인 텔레파시 점수. 팀 성공 수는 view.teamScores 에 따로 싣는다.
 * 봇: 동전 던지기 — 단 seeded(코드:판:문제:자리). 두 요청이 같은 순간 봇 답을 정해도 같은 답이라 공개 뒤 뒤집히지 않는다.
 *   '다음'은 사람이 누른다. 활성 사람이 하나도 없으면(모두 기권) 봇이 눌러 멈추지 않게.
 */
import { handleParty, ranking, shuffle, seeded, roundRng, oneSideLeft, teamOf } from './party-kit.mjs';
import { QUESTIONS } from './balance-core.mjs';

export { QUESTIONS };
export const COUNTS = [5, 10, 15], DEFAULT_COUNT = 10;

function options(body) {
  const c = Number(body.count);
  return { count: COUNTS.includes(c) ? c : DEFAULT_COUNT };
}
function setup(room) {
  const count = (room.opts && COUNTS.includes(room.opts.count)) ? room.opts.count : DEFAULT_COUNT;
  room.qs = shuffle(QUESTIONS.map((_, i) => i), roundRng(room)).slice(0, count);
  room.qi = 0;
}

const pickOf = (doc, k) => {
  const v = doc && doc.picks && doc.picks[k];
  return v === 0 || v === 1 ? v : null;
};

/* 한 문제의 결과 — picks[i] (null = 안 고름) */
export function score(room, picks) {
  const gain = picks.map((p, i) => (p === null ? 0 : picks.filter((q, j) => j !== i && q === p).length));
  const cnt = [0, 1].map((c) => picks.filter((p) => p === c).length);
  let teamHit = null;
  if (room.teams) {
    teamHit = [...Array(room.teams)].map((_, t) => {
      const mine = picks.map((p, i) => (p !== null && teamOf(room, i) === t ? p : null)).filter((p) => p !== null);
      if (!mine.length) return false;
      if (mine.length === 1) return cnt[mine[0]] >= cnt[1 - mine[0]];          // 혼자면 다수 쪽과 같을 때
      return mine.every((p) => p === mine[0]);
    });
  }
  return { gain, cnt, teamHit };
}

export function status(ctx) {
  const { room, docs, active } = ctx;
  const total = room.qs.length;
  const over = room.qi >= total || oneSideLeft(room, active);
  const qi = Math.min(room.qi, total);
  const picksAt = (k) => docs.map((d) => pickOf(d, k));
  const cur = !over ? picksAt(qi) : null;
  const revealed = !!cur && active.every((i) => cur[i] !== null);
  // 지난 문제 + (공개됐으면) 지금 문제
  const done = [];
  for (let k = 0; k < qi; k++) done.push({ k, picks: picksAt(k) });
  if (revealed) done.push({ k: qi, picks: cur });
  const scored = done.map((d) => ({ ...d, ...score(room, d.picks) }));
  const n = room.players.length;
  const scores = Array(n).fill(0);
  const teamScores = room.teams ? Array(room.teams).fill(0) : null;
  const pairs = [...Array(n)].map(() => Array(n).fill(0));
  for (const s of scored) {
    s.gain.forEach((g, i) => { scores[i] += g; });
    if (teamScores) s.teamHit.forEach((h, t) => { if (h) teamScores[t]++; });
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && s.picks[i] !== null && s.picks[i] === s.picks[j]) pairs[i][j]++;
  }
  return { over, qi, total, cur, revealed, scored, scores, teamScores, pairs };
}

function view(ctx) {
  const { room, idx, me, active } = ctx;
  const s = status(ctx);
  const out = {
    stage: s.over ? 'done' : 'play', total: s.total, qi: s.qi, turn: null, yourTurn: false,
    scores: s.scores, teamScores: s.teamScores, match: s.pairs[idx],
    history: s.scored.filter((x) => x.k < s.qi).map((x) => ({ q: QUESTIONS[room.qs[x.k]], picks: x.picks, gain: x.gain, teamHit: x.teamHit })),
  };
  if (!s.over) {
    out.q = QUESTIONS[room.qs[s.qi]];
    out.mine = pickOf(me, s.qi);
    out.picked = s.cur.map((p, i) => p !== null && active.includes(i));      // 누가 골랐는지만 — 무엇을 골랐는지는 공개 전엔 안 보낸다
    out.pickedCount = active.filter((i) => s.cur[i] !== null).length;
    out.activeCount = active.length;
    const r = s.revealed ? s.scored[s.scored.length - 1] : null;
    out.reveal = r ? { picks: r.picks, gain: r.gain, cnt: r.cnt, teamHit: r.teamHit } : null;
  } else {
    const sc = s.scores.map((v, i) => (active.includes(i) ? v : null));
    out.rank = ranking(sc);
    if (room.teams) {
      const live = [...Array(room.teams)].map((_, t) => active.some((i) => teamOf(room, i) === t));
      const best = Math.max(-1, ...s.teamScores.filter((_, t) => live[t]));
      out.winners = active.filter((i) => live[teamOf(room, i)] && s.teamScores[teamOf(room, i)] === best);
    } else {
      const best = out.rank.length ? out.rank[0].s : null;
      out.winners = out.rank.filter((r) => r.s === best).map((r) => r.i);
    }
  }
  return out;
}

const actions = {
  pick(ctx) {
    const { room, me, body } = ctx;
    const s = status(ctx);
    if (s.over) return { error: '이미 끝났어요', status: 409 };
    if (Number(body.qi) !== room.qi) return { error: '지난 질문이에요', status: 409 };
    if (body.choice !== 0 && body.choice !== 1) return { error: '둘 중 하나를 골라주세요', status: 400 };
    if (s.revealed) return { error: '이미 공개됐어요', status: 409 };
    me.picks = { ...(me.picks || {}), [room.qi]: body.choice };
    ctx.touchMe = true;
    return null;
  },
  next(ctx) {
    const { room, body } = ctx;
    const qi = Number(body.qi);
    if (qi < room.qi) return null;                          // 누가 먼저 넘겼다 — 지금 상태 그대로
    const s = status(ctx);
    if (s.over || qi !== room.qi) return { error: '넘길 질문이 없어요', status: 409 };
    if (!s.revealed) return { error: '모두 골라야 넘어가요', status: 409 };
    room.qi = qi + 1;                                       // 여럿이 동시에 눌러도 같은 값
    ctx.touchRoom = true;
    return null;
  },
};

export function botMove(ctx, rnd) {
  const { room, idx, me, active } = ctx;
  const s = status(ctx);
  if (s.over) return null;
  if (!s.revealed) {
    if (pickOf(me, room.qi) !== null) return null;
    const r = rnd || seeded(`${room.code}:${room.round}:${room.qi}:${idx}`);
    return { act: 'pick', body: { qi: room.qi, choice: r() < 0.5 ? 0 : 1 } };
  }
  const humans = active.filter((i) => !room.players[i].bot);
  return humans.length ? null : { act: 'next', body: { qi: room.qi } };
}

export const partyBalance = {
  setup, view, actions, options, bot: botMove, quick: ['pick'],
  teamMode: 'any',                      // 팀 성공 수가 가장 큰 팀이 이긴다 (winners 에 그 팀원)
  finished: (ctx) => status(ctx).over,
};
export const handle = (body, store, now) => handleParty(partyBalance, body, store, now);
