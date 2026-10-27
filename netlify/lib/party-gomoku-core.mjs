/* 팀 오목 (2~8명, 팀전 전용) — 2인용 오목(gomoku-core)을 party-kit 위에 올린 것.
 *
 * 흑팀 · 백팀 두 팀. 선공(room.first)의 팀이 흑이다. kit 의 turnSeat 가 팀을 번갈아 돌리므로
 * k 번째 수(0부터)는 k 가 짝수면 흑팀, 홀수면 백팀 사람이 둔다. 팀 안에서는 한 명씩 돌아가며 둔다 —
 * 팀원끼리 상의 없이 번갈아 두는 게 이 게임의 재미(말로 상의하는 건 자유).
 * 1:1(두 명)이면 각자 한 팀이라 그냥 오목이다.
 *
 * 15×15, 다섯(장목 금지 쪽은 딱 다섯)을 먼저 이은 팀이 이긴다. 금수(삼삼·사사·장목, 흑백 따로)는 방 만들 때
 * 고른다 — 판정은 gomoku-core 의 forbiddenWhy 그대로. 판이 꽉 차거나 둘 차례인 색이 둘 곳이 하나도 없으면 무승부.
 * 한 팀이 다 기권하면 남은 팀이 이긴다(oneSideLeft).
 *
 * 수는 공용 문서 room.g.moves = [[r, c, 둔 자리], …] (차례제라 한 명만 쓴다). 비밀 없음.
 * kit teamMode 'any' — winners 에 이긴 팀 전원(기권 안 한 사람)을 넣는다.
 *
 * 기권한 사람이 선공이면 kit 의 팀 순서가 다른 팀부터 시작할 수 있다. 그래서 차례는 seatFor 로
 * '이번 색의 팀' 사람이 나올 때까지 한 칸 밀어서 고른다 — 색이 두 번 연달아 나오는 일이 없게.
 */
import { handleParty, turnSeat, ranking, oneSideLeft, teamOf } from './party-kit.mjs';
import { N, EMPTY, BLACK, WHITE, PRESETS, normRules, makeBoard, fiveAt, forbiddenWhy } from './gomoku-core.mjs';

export { N, PRESETS, normRules };
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const WHY_MSG = { three: '삼삼이라 거기엔 둘 수 없어요', four: '사사라 거기엔 둘 수 없어요', long: '여섯 개 이상(장목)이 돼서 거기엔 둘 수 없어요' };
const rulesOf = (room) => (room.opts && room.opts.rules) || normRules(PRESETS.say);
const colorKey = (color) => (color === BLACK ? 'black' : 'white');

function setup(room) {
  const t = teamOf(room, room.first);
  room.g = { moves: [], black: Number.isInteger(t) ? t : 0 };
}

/* 자리 i 의 돌 색 — 흑팀이면 흑 */
export function colorOf(room, i) {
  if (!room.teams) return i === room.first ? BLACK : WHITE;     // (팀 없는 방은 없지만 혹시)
  return teamOf(room, i) === room.g.black ? BLACK : WHITE;
}
const teamOfColor = (room, color) => (color === BLACK ? room.g.black : 1 - room.g.black);

/* k 번째 수를 둘 사람 — 그 색 팀 사람이 나올 때까지 turnSeat 를 한 칸 민다 */
export function seatFor(room, k) {
  const want = k % 2 === 0 ? BLACK : WHITE;
  for (let d = 0; d < 2; d++) {
    const s = turnSeat(room, k + d);
    if (s !== null && colorOf(room, s) === want) return s;
  }
  return null;
}
/* color 가 둘 수 있는 빈 칸이 하나라도 있나 (보통 첫 칸에서 끝난다) */
function hasLegal(b, color, rule) {
  for (let i = 0; i < N * N; i++) if (b[i] === EMPTY && !forbiddenWhy(b, Math.floor(i / N), i % N, color, rule)) return true;
  return false;
}

export function status(ctx) {
  const { room, active } = ctx;
  const moves = room.g.moves, rules = rulesOf(room);
  const b = makeBoard(moves);
  let winTeam = null, line = null, reason = null, draw = false;
  if (moves.length) {
    const [r, c] = moves[moves.length - 1];
    const color = (moves.length - 1) % 2 === 0 ? BLACK : WHITE;
    line = fiveAt(b, r, c, rules[colorKey(color)].long);
    if (line) { winTeam = teamOfColor(room, color); reason = 'five'; }
  }
  const turnColor = moves.length % 2 === 0 ? BLACK : WHITE;
  if (winTeam === null) {
    if (oneSideLeft(room, active)) {
      if (active.length) winTeam = teamOf(room, active[0]); else draw = true;
      reason = 'resign';
    } else if (moves.length >= N * N) { draw = true; reason = 'full'; }
    else if (!hasLegal(b, turnColor, rules[colorKey(turnColor)])) { draw = true; reason = 'stuck'; }
  }
  const done = winTeam !== null || draw;
  let winners = null;
  if (done) {
    winners = draw ? active.slice() : active.filter((i) => teamOf(room, i) === winTeam);
    if (!winners.length && winTeam !== null) winners = room.players.map((_, i) => i).filter((i) => teamOf(room, i) === winTeam);
  }
  const turn = done ? null : seatFor(room, moves.length);
  return { phase: done ? 'done' : 'play', b, rules, turn, turnColor, winTeam, draw, line, reason, winners };
}

function view(ctx) {
  const { room, idx } = ctx;
  const s = status(ctx);
  const moves = room.g.moves;
  const yourTurn = s.phase === 'play' && s.turn === idx;
  const myColor = colorOf(room, idx);
  // 내 차례면 둘 수 없는 자리를 미리 알려준다 [r, c, 이유]
  const forbidden = [];
  if (yourTurn) {
    const rule = s.rules[colorKey(myColor)];
    if (rule.three || rule.four || rule.long) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const why = forbiddenWhy(s.b, r, c, myColor, rule);
        if (why) forbidden.push([r, c, why]);
      }
    }
  }
  // 앞으로 둘 사람 셋 (지금 사람 다음부터)
  const upcoming = s.phase === 'play' ? [1, 2, 3].map((d) => seatFor(room, moves.length + d)) : [];
  const done = s.phase === 'done';
  return {
    stage: s.phase, size: N, rules: s.rules,
    moves, blackTeam: room.g.black,
    myColor: colorKey(myColor), turnColor: colorKey(s.turnColor),
    turn: s.turn, yourTurn, upcoming,
    winTeam: s.winTeam, draw: s.draw, line: s.line || null, reason: s.reason,
    winners: s.winners,
    rank: done ? ranking(room.players.map((_, i) => (room.out && room.out[i] ? null : s.winners.includes(i) ? 1 : 0))) : null,
    forbidden,
  };
}

const actions = {
  place(ctx) {
    const { r, c } = ctx.body;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= N || c >= N) return { error: '판 밖이에요', status: 400 };
    const s = status(ctx);
    if (s.phase !== 'play') return { error: '게임이 끝났어요', status: 409 };
    if (s.turn !== ctx.idx) return { error: '지금은 ' + (ctx.room.players[s.turn] ? ctx.room.players[s.turn].name || '다른 사람' : '다른 사람') + ' 차례예요', status: 409 };
    if (s.b[r * N + c] !== EMPTY) return { error: '이미 돌이 있어요', status: 409 };
    const color = colorOf(ctx.room, ctx.idx);
    const why = forbiddenWhy(s.b, r, c, color, s.rules[colorKey(color)]);
    if (why) return { error: WHY_MSG[why], status: 409 };
    ctx.room.g.moves.push([r, c, ctx.idx]);
    ctx.touchRoom = true;
    return null;
  },
};

/* ---- 봇 — 2인용 오목 봇과 같은 점수 함수 (자기 팀 색 기준) ----
 * 돌 근처 빈 칸마다 '내 색이 두면' 점수 + '상대 색이 두면' 점수 × 0.9. 다섯은 무조건, 상대 다섯은 무조건 막는다.
 * 급하지 않을 땐 15% 확률로 두 번째 수. 금수 자리는 후보에서 뺀다. */
const at = (b, r, c) => (r < 0 || c < 0 || r >= N || c >= N ? -1 : b[r * N + c]);
function span(b, r, c, dr, dc, color) {
  let s = 0, e = 0;
  while (at(b, r - (s + 1) * dr, c - (s + 1) * dc) === color) s++;
  while (at(b, r + (e + 1) * dr, c + (e + 1) * dc) === color) e++;
  return [s, e];
}
function lineScore(len, open, exact) {
  if (len >= 5) return exact && len > 5 ? 0 : 100000;
  if (len === 4) return open === 2 ? 10000 : open === 1 ? 1200 : 0;
  if (len === 3) return open === 2 ? 1000 : open === 1 ? 120 : 0;
  if (len === 2) return open === 2 ? 60 : open === 1 ? 12 : 0;
  return open === 2 ? 4 : 1;
}
function cellScore(b, r, c, color, exact) {
  b[r * N + c] = color;
  let total = 0;
  for (const [dr, dc] of DIRS) {
    const [s, e] = span(b, r, c, dr, dc, color);
    const open = (at(b, r - (s + 1) * dr, c - (s + 1) * dc) === EMPTY ? 1 : 0) + (at(b, r + (e + 1) * dr, c + (e + 1) * dc) === EMPTY ? 1 : 0);
    total += lineScore(s + e + 1, open, exact);
  }
  b[r * N + c] = EMPTY;
  return total;
}
const nearStone = (b, r, c, d) => {
  for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) if ((dr || dc) && at(b, r + dr, c + dc) > 0) return true;
  return false;
};
export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const b = s.b;
  if (!ctx.room.g.moves.length) return { act: 'place', body: { r: 7, c: 7 } };
  const me = colorOf(ctx.room, ctx.idx), opp = me === BLACK ? WHITE : BLACK;
  const myRule = s.rules[colorKey(me)], oppRule = s.rules[colorKey(opp)];
  const top = [];                                   // 상위 2개 [score, r, c]
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (b[r * N + c] !== EMPTY || !nearStone(b, r, c, 2)) continue;
    if (forbiddenWhy(b, r, c, me, myRule)) continue;
    const sc = cellScore(b, r, c, me, myRule.long) + cellScore(b, r, c, opp, oppRule.long) * 0.9 + rnd() * 0.5;
    if (!top[0] || sc > top[0][0]) top.unshift([sc, r, c]); else if (!top[1] || sc > top[1][0]) top[1] = [sc, r, c];
    if (top.length > 2) top.length = 2;
  }
  if (!top.length) {                                // 근처가 다 막혔거나 금수 — 아무 빈 칸
    for (let i = 0; i < N * N; i++) if (b[i] === EMPTY && !forbiddenWhy(b, Math.floor(i / N), i % N, me, myRule)) return { act: 'place', body: { r: Math.floor(i / N), c: i % N } };
    return null;                                    // (status 가 'stuck' 무승부로 끝내므로 여기 오지 않는다)
  }
  const pick = top.length > 1 && top[0][0] < 1500 && rnd() < 0.15 ? top[1] : top[0];
  return { act: 'place', body: { r: pick[1], c: pick[2] } };
}

export const partyGomoku = {
  setup, view, actions, bot: botMove,
  teamMode: 'any',                       // 다섯을 이은 팀 전원이 winners
  teamOptions: [2],                      // 흑팀·백팀 팀전만
  options: (body) => ({ rules: normRules(body && body.rules) }),
  finished: (ctx) => status(ctx).phase === 'done',
};
export const handle = (body, store, now) => handleParty(partyGomoku, body, store, now);
