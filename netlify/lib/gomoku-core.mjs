/* 오목 — 15×15. 선공이 흑, 후공이 백. 다섯을 먼저 이으면 이긴다.
 *
 * 금수(둘 수 없는 자리)는 방을 만들 때 고른다. 흑·백 따로, 세 가지.
 *   삼삼 — 열린 삼 두 개를 한 번에 만드는 수
 *   사사 — 넷 두 개를 한 번에 만드는 수 (한 줄 안의 X.XXX.X 도 둘로 센다)
 *   장목 — 여섯 이상을 만드는 수. 장목을 막은 쪽은 '딱 다섯'이어야 이긴다
 * 다섯을 만드는 수는 금수가 겹쳐도 언제나 둘 수 있다.
 *
 * 묶음(PRESETS)
 *   say   — 세이클럽 · 한게임 시절 '일반룰'. 흑백 모두 삼삼 금지, 장목은 안 쳐준다. 사사는 된다
 *   renju — 렌주룰. 흑만 삼삼 · 사사 · 장목 금지. 백은 제한 없고 장목도 이긴다
 *   free  — 금수 없음
 * 아무 규칙 없는 오목은 흑이 잘 두면 반드시 이기는 게임이다(증명돼 있다). 그래서 기본은 say.
 * 렌주의 '거짓 금수'(금수 자리로만 넷이 되는 삼은 삼이 아니다) 같은 재귀 판정은 하지 않는다.
 *
 * 열린 삼: 그 줄에 한 수를 더 두면 '양쪽이 다 비어 있고, 어느 쪽을 채워도 다섯이 되는 넷'(.XXXX.)이
 *   되는 셋. .XXX. 도, 한 칸 띈 .XX.X. 도 열린 삼이다. 한쪽이 막혔거나 판 끝이면 아니다.
 *
 * 수는 공용 문서에 쓰는데 차례제라 한 번에 한 명만 쓴다.
 * 기권은 아무 때나 누를 수 있어서 자기 문서에 쓴다 (상대 수와 동시에 써도 안 묻힌다).
 * 선공은 미니게임(first-pick)으로 정한다.
 */
import { handleRoom } from './room-kit.mjs';
import { pickKind, firstOf, pickView, pickThrow } from './first-pick.mjs';

export const N = 15;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
export const EMPTY = 0, BLACK = 1, WHITE = 2;

const R = (three, four, long) => ({ three, four, long });
export const PRESETS = {
  say: { black: R(true, false, true), white: R(true, false, true) },
  renju: { black: R(true, true, true), white: R(false, false, false) },
  free: { black: R(false, false, false), white: R(false, false, false) },
};
// 금수 고르기가 생기기 전에 만든 방 — 흑만 삼삼
const LEGACY = { black: R(true, false, false), white: R(false, false, false) };

/* 받은 값을 믿지 않고 true/false 여섯 개로 다시 만든다 */
export function normRules(x) {
  if (!x || typeof x !== 'object') return normRules(PRESETS.say);
  const one = (o) => R(!!(o && o.three), !!(o && o.four), !!(o && o.long));
  return { black: one(x.black), white: one(x.white) };
}
const rulesOf = (room) => (room.opts && room.opts.rules) || LEGACY;

/* 수 목록 → 판. 짝수 번째 수가 흑 */
export function makeBoard(moves) {
  const b = new Array(N * N).fill(EMPTY);
  moves.forEach(([r, c], i) => { b[r * N + c] = i % 2 === 0 ? BLACK : WHITE; });
  return b;
}
const at = (b, r, c) => (r < 0 || c < 0 || r >= N || c >= N ? -1 : b[r * N + c]);

/* (r,c) 에서 dr,dc 방향으로 같은 색이 [뒤로 몇, 앞으로 몇] 이어지나 */
function span(b, r, c, dr, dc, color) {
  let s = 0, e = 0;
  while (at(b, r - (s + 1) * dr, c - (s + 1) * dc) === color) s++;
  while (at(b, r + (e + 1) * dr, c + (e + 1) * dc) === color) e++;
  return [s, e];
}
const isWinLen = (len, exact) => (exact ? len === 5 : len >= 5);

/* (r,c) 를 지나는 이긴 줄이 있으면 그 칸들을, 없으면 null.
 * exact 면 딱 다섯만 (장목을 막은 쪽) */
export function fiveAt(b, r, c, exact = false) {
  const color = at(b, r, c);
  if (color !== BLACK && color !== WHITE) return null;
  for (const [dr, dc] of DIRS) {
    const [s, e] = span(b, r, c, dr, dc, color);
    if (!isWinLen(s + e + 1, exact)) continue;
    const cells = [];
    for (let k = -s; k <= e; k++) cells.push([r + k * dr, c + k * dc]);
    return cells;
  }
  return null;
}
const overline = (b, r, c, color) => DIRS.some(([dr, dc]) => { const [s, e] = span(b, r, c, dr, dc, color); return s + e + 1 >= 6; });

/* (r,c) 에 color 돌이 놓인 상태. 이 방향에서 (r,c) 를 포함한 넷이 몇 개인가 (0·1·2).
 * 넷 = 빈 칸 하나만 채우면 다섯이 되는 줄. .XXXX. 처럼 양끝이 다 되는 건 넷 하나다. */
function foursInDir(b, r, c, dr, dc, color, exact) {
  const ks = [];
  for (let k = -4; k <= 4; k++) {
    if (!k) continue;
    const qr = r + k * dr, qc = c + k * dc;
    if (at(b, qr, qc) !== EMPTY) continue;
    b[qr * N + qc] = color;
    const [s, e] = span(b, qr, qc, dr, dc, color);
    b[qr * N + qc] = EMPTY;
    // 다섯 안에 방금 둔 돌이 들어 있어야 한다 (q 에서 p 까지 거리 -k)
    if (isWinLen(s + e + 1, exact) && -k >= -s && -k <= e) ks.push(k);
  }
  if (ks.length === 2 && Math.abs(ks[0] - ks[1]) === 5) return 1;      // 열린 넷
  return Math.min(ks.length, 2);
}

/* 이 방향에 (r,c) 를 포함하는 열린 삼이 있나 */
function openThree(b, r, c, dr, dc, color, exact) {
  for (let k = -4; k <= 4; k++) {
    if (!k) continue;
    const qr = r + k * dr, qc = c + k * dc;
    if (at(b, qr, qc) !== EMPTY) continue;
    b[qr * N + qc] = color;
    const [s, e] = span(b, qr, qc, dr, dc, color);
    let ok = s + e + 1 === 4 && -k >= -s && -k <= e;
    if (ok) {
      // 양 끝이 비어 있고, 채웠을 때 다섯이 돼야 한다 (장목을 막았으면 그 너머가 같은 색이면 안 된다)
      const ends = [[qr - (s + 1) * dr, qc - (s + 1) * dc, -1], [qr + (e + 1) * dr, qc + (e + 1) * dc, 1]];
      for (const [er, ec, sg] of ends) {
        if (at(b, er, ec) !== EMPTY) ok = false;
        else if (exact && at(b, er + sg * dr, ec + sg * dc) === color) ok = false;
      }
    }
    b[qr * N + qc] = EMPTY;
    if (ok) return true;
  }
  return false;
}

/* color 가 (r,c) 에 두면 금수인가. 금수면 'three' | 'four' | 'long', 아니면 null.
 * rule = { three, four, long } — 그 색에 걸린 금수 */
export function forbiddenWhy(b, r, c, color, rule) {
  if (at(b, r, c) !== EMPTY || !rule || !(rule.three || rule.four || rule.long)) return null;
  b[r * N + c] = color;
  let why = null;
  if (!fiveAt(b, r, c, rule.long)) {                       // 다섯이 되면 무엇이든 둔다
    if (rule.long && overline(b, r, c, color)) why = 'long';
    else if (rule.four && DIRS.reduce((n, [dr, dc]) => n + foursInDir(b, r, c, dr, dc, color, rule.long), 0) >= 2) why = 'four';
    else if (rule.three && DIRS.filter(([dr, dc]) => openThree(b, r, c, dr, dc, color, rule.long)).length >= 2) why = 'three';
  }
  b[r * N + c] = EMPTY;
  return why;
}

/* 흑이 (r,c) 에 두면 쌍삼인가 — 예전 테스트용 */
export const isDoubleThree = (b, r, c) => forbiddenWhy(b, r, c, BLACK, R(true, false, false)) === 'three';
const WHY_MSG = { three: '삼삼이라 거기엔 둘 수 없어요', four: '사사라 거기엔 둘 수 없어요', long: '여섯 개 이상(장목)이 돼서 거기엔 둘 수 없어요' };

function setup(room) {
  room.moves = [];
}

export function status(ctx) {
  const { room, docs, joined } = ctx;
  if (!joined) return { phase: 'wait', first: null };
  const first = firstOf(ctx);
  if (first === null) return { phase: 'pick', first };
  const moves = room.moves;
  const b = makeBoard(moves);
  const turn = (first + moves.length) % 2;           // 선공(first)이 흑, 짝수 번째 수
  let winner = null, line = null, reason = null;
  const rules = rulesOf(room);
  if (moves.length) {
    const [r, c] = moves[moves.length - 1];
    const lastBlack = (moves.length - 1) % 2 === 0;
    line = fiveAt(b, r, c, (lastBlack ? rules.black : rules.white).long);
    if (line) { winner = (first + moves.length - 1) % 2; reason = 'five'; }
  }
  if (winner === null) {
    const quit = [0, 1].filter((i) => docs[i].resigned);
    if (quit.length) { winner = 1 - quit[0]; reason = 'resign'; }
    else if (moves.length >= N * N) { winner = 'draw'; reason = 'full'; }
  }
  return { phase: winner === null ? 'play' : 'done', first, b, turn, winner, line, reason, rules };
}

function view(ctx) {
  const { room, idx } = ctx;
  const s = status(ctx);
  const myColor = s.first === null ? null : (s.first === idx ? 'black' : 'white');
  const yourTurn = s.phase === 'play' && s.turn === idx;
  // 내 차례면 둘 수 없는 자리를 미리 알려준다 [r, c, 이유]
  const forbidden = [];
  if (yourTurn) {
    const color = myColor === 'black' ? BLACK : WHITE, rule = s.rules[myColor];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const why = forbiddenWhy(s.b, r, c, color, rule);
      if (why) forbidden.push([r, c, why]);
    }
  }
  return {
    phase: s.phase,
    pick: pickView(ctx),
    size: N,
    first: s.first,
    myColor,
    rules: rulesOf(room),
    moves: room.moves,
    turn: s.turn === undefined ? null : s.turn,
    yourTurn,
    winner: s.winner === undefined ? null : s.winner,
    line: s.line || null,
    reason: s.reason || null,
    forbidden,
  };
}

const actions = {
  throw: pickThrow,
  place(ctx) {
    const { r, c } = ctx.body;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= N || c >= N) {
      return { error: '판 밖이에요', status: 400 };
    }
    const s = status(ctx);
    if (s.phase !== 'play') return { error: '지금은 둘 수 없어요', status: 409 };
    if (s.turn !== ctx.idx) return { error: '상대 차례예요', status: 409 };
    if (s.b[r * N + c] !== EMPTY) return { error: '이미 돌이 있어요', status: 409 };
    const black = s.first === ctx.idx;
    const why = forbiddenWhy(s.b, r, c, black ? BLACK : WHITE, s.rules[black ? 'black' : 'white']);
    if (why) return { error: WHY_MSG[why], status: 409 };
    ctx.room.moves.push([r, c]);
    ctx.touchRoom = true;
    return null;
  },
  resign(ctx) {
    if (status(ctx).phase !== 'play') return { error: '게임 중이 아니에요', status: 409 };
    ctx.me.resigned = true;
    ctx.touchMe = true;
    return null;
  },
};

export const gomoku = {
  setup, view, actions,
  options: (body) => ({ pick: pickKind(body.pick), rules: normRules(body.rules) }),
  finished: (ctx) => status(ctx).phase === 'done',
};

export const handle = (body, store, now) => handleRoom(gomoku, body, store, now);
