/* 오목 — 15×15. 선공이 흑, 후공이 백. 다섯 이상 이어지면 이긴다.
 *
 * 선공(흑) 쌍삼 금지. 아무 규칙 없는 오목은 선공이 잘 두면 반드시 이기는 게임이라
 * (수학적으로 증명돼 있다) 흑만 '열린 삼 두 개를 한 번에 만드는 수'를 막는다.
 * 백은 제한이 없다. 다섯을 만드는 수는 쌍삼이어도 둘 수 있다.
 * 사사 · 장목(여섯 이상)은 막지 않는다 — 집에서 하는 오목의 흔한 규칙에 맞췄다.
 *
 * 열린 삼: 그 줄에 한 수를 더 두면 '양쪽이 다 비어 있는 넷(.XXXX.)'이 되는 셋.
 *   .XXX. 도, 한 칸 띈 .XX.X. 도 열린 삼이다. 한쪽이 막혔거나 판 끝이면 아니다.
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

/* 수 목록 → 판. 짝수 번째 수가 흑 */
export function makeBoard(moves) {
  const b = new Array(N * N).fill(EMPTY);
  moves.forEach(([r, c], i) => { b[r * N + c] = i % 2 === 0 ? BLACK : WHITE; });
  return b;
}
const at = (b, r, c) => (r < 0 || c < 0 || r >= N || c >= N ? -1 : b[r * N + c]);

/* (r,c) 를 지나는 다섯 이상 줄이 있으면 그 칸들을, 없으면 null */
export function fiveAt(b, r, c) {
  const color = at(b, r, c);
  if (color !== BLACK && color !== WHITE) return null;
  for (const [dr, dc] of DIRS) {
    const cells = [[r, c]];
    for (let k = 1; at(b, r + k * dr, c + k * dc) === color; k++) cells.push([r + k * dr, c + k * dc]);
    for (let k = 1; at(b, r - k * dr, c - k * dc) === color; k++) cells.unshift([r - k * dr, c - k * dc]);
    if (cells.length >= 5) return cells;
  }
  return null;
}

/* (qr,qc) 를 지나는 흑 줄이 정확히 넷이고 양 끝이 비어 있으면 그 줄의 [앞, 뒤] 길이 */
function straightFour(b, qr, qc, dr, dc) {
  let s = 0, e = 0;
  while (at(b, qr - (s + 1) * dr, qc - (s + 1) * dc) === BLACK) s++;
  while (at(b, qr + (e + 1) * dr, qc + (e + 1) * dc) === BLACK) e++;
  if (s + e + 1 !== 4) return null;
  if (at(b, qr - (s + 1) * dr, qc - (s + 1) * dc) !== EMPTY) return null;
  if (at(b, qr + (e + 1) * dr, qc + (e + 1) * dc) !== EMPTY) return null;
  return [s, e];
}

/* 흑이 (r,c) 에 둔 상태에서, 이 방향에 (r,c) 를 포함하는 열린 삼이 있나 */
function openThree(b, r, c, dr, dc) {
  for (let k = -4; k <= 4; k++) {
    if (!k) continue;
    const qr = r + k * dr, qc = c + k * dc;
    if (at(b, qr, qc) !== EMPTY) continue;
    b[qr * N + qc] = BLACK;
    const run = straightFour(b, qr, qc, dr, dc);
    b[qr * N + qc] = EMPTY;
    // 만들어진 넷 안에 방금 둔 돌이 들어 있어야 한다 (q 에서 p 까지 거리 -k)
    if (run && -k >= -run[0] && -k <= run[1]) return true;
  }
  return false;
}

/* 흑이 (r,c) 에 두면 쌍삼인가. 다섯이 되는 수는 괜찮다. */
export function isDoubleThree(b, r, c) {
  if (at(b, r, c) !== EMPTY) return false;
  b[r * N + c] = BLACK;
  let threes = 0;
  if (!fiveAt(b, r, c)) for (const [dr, dc] of DIRS) if (openThree(b, r, c, dr, dc)) threes++;
  b[r * N + c] = EMPTY;
  return threes >= 2;
}

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
  if (moves.length) {
    const [r, c] = moves[moves.length - 1];
    line = fiveAt(b, r, c);
    if (line) { winner = (first + moves.length - 1) % 2; reason = 'five'; }
  }
  if (winner === null) {
    const quit = [0, 1].filter((i) => docs[i].resigned);
    if (quit.length) { winner = 1 - quit[0]; reason = 'resign'; }
    else if (moves.length >= N * N) { winner = 'draw'; reason = 'full'; }
  }
  return { phase: winner === null ? 'play' : 'done', first, b, turn, winner, line, reason };
}

function view(ctx) {
  const { room, idx } = ctx;
  const s = status(ctx);
  const myColor = s.first === null ? null : (s.first === idx ? 'black' : 'white');
  const yourTurn = s.phase === 'play' && s.turn === idx;
  // 흑 차례면 둘 수 없는 자리를 미리 알려준다
  let forbidden = [];
  if (yourTurn && myColor === 'black') {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (s.b[r * N + c] === EMPTY && isDoubleThree(s.b, r, c)) forbidden.push([r, c]);
    }
  }
  return {
    phase: s.phase,
    pick: pickView(ctx),
    size: N,
    first: s.first,
    myColor,
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
    if (black && isDoubleThree(s.b, r, c)) return { error: '흑은 쌍삼을 둘 수 없어요', status: 409 };
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
  options: (body) => ({ pick: pickKind(body.pick) }),
  finished: (ctx) => status(ctx).phase === 'done',
};

export const handle = (body, store, now) => handleRoom(gomoku, body, store, now);
