/* 여럿이 빙고 (2~8명) — 커플 빙고를 party-kit 위에 올린 것.
 * 각자 1~25 를 섞은 판. 차례대로 숫자를 부르면 **모든 판**에 체크. 가로·세로·대각 3줄을 먼저 만든 사람이 이긴다
 * (같은 수에 여럿이 되면 공동 우승). 25개를 다 불렀는데 아무도 3줄이 아니면 줄 수가 가장 많은 사람.
 * 판·준비는 각자 자기 문서에, 부른 숫자는 공용 문서에(차례제). 남의 판은 끝날 때까지 안 보낸다 — 줄 수만.
 */
import { handleParty, turnSeat, ranking, shuffle } from './party-kit.mjs';

export const SIZE = 5, CELLS = 25, WIN_LINES = 3;
export const LINES = (() => {
  const out = [];
  for (let r = 0; r < SIZE; r++) out.push([...Array(SIZE)].map((_, c) => r * SIZE + c));
  for (let c = 0; c < SIZE; c++) out.push([...Array(SIZE)].map((_, r) => r * SIZE + c));
  out.push([...Array(SIZE)].map((_, i) => i * SIZE + i));
  out.push([...Array(SIZE)].map((_, i) => i * SIZE + (SIZE - 1 - i)));
  return out;
})();
export function lineCount(board, called) {
  if (!board) return 0;
  const hit = new Set(called);
  let n = 0;
  for (const line of LINES) if (line.every((i) => hit.has(board[i]))) n++;
  return n;
}
export function validBoard(b) {
  if (!Array.isArray(b) || b.length !== CELLS) return false;
  const seen = new Set();
  for (const v of b) { if (!Number.isInteger(v) || v < 1 || v > CELLS || seen.has(v)) return false; seen.add(v); }
  return true;
}

function setup(room) { room.called = []; }

export function status(ctx) {
  const { room, docs, active } = ctx;
  const boards = docs.map((d, i) => (active.includes(i) && d.ready && validBoard(d.board) ? d.board : null));
  const waiting = active.filter((i) => !boards[i]);
  if (waiting.length) return { phase: 'setup', waiting, lines: docs.map(() => 0) };
  const lines = docs.map((d, i) => (boards[i] ? lineCount(boards[i], room.called) : null));
  const bingo = active.filter((i) => lines[i] >= WIN_LINES);
  let winners = null;
  if (bingo.length) winners = bingo;
  else if (room.called.length >= CELLS || active.length <= 1) {
    const best = Math.max(...active.map((i) => lines[i]));
    winners = active.filter((i) => lines[i] === best);
  }
  const turn = winners ? null : turnSeat(room, room.called.length);
  return { phase: winners ? 'done' : 'play', turn, lines, winners };
}

function view(ctx) {
  const { room, idx, me, docs } = ctx;
  const s = status(ctx);
  return {
    stage: s.phase, winLines: WIN_LINES,
    board: me.board || null, ready: !!me.ready,
    readyAll: docs.map((d) => !!d.ready),
    called: room.called, last: room.called.length ? room.called[room.called.length - 1] : null,
    turn: s.turn, yourTurn: s.phase === 'play' && s.turn === idx,
    lines: s.lines, winners: s.winners,
    boards: s.phase === 'done' ? docs.map((d) => d.board || null) : null,     // 끝나면 다 공개
  };
}

const actions = {
  ready(ctx) {
    if (status(ctx).phase !== 'setup') return { error: '이미 시작했어요', status: 409 };
    if (!validBoard(ctx.body.board)) return { error: '판이 이상해요', status: 400 };
    if (ctx.me.ready) return { error: '이미 준비했어요', status: 409 };
    ctx.me.board = ctx.body.board; ctx.me.ready = true; ctx.touchMe = true;
    return null;
  },
  call(ctx) {
    const n = ctx.body.n;
    if (!Number.isInteger(n) || n < 1 || n > CELLS) return { error: '그런 숫자는 없어요', status: 400 };
    const s = status(ctx);
    if (s.phase !== 'play') return { error: s.phase === 'setup' ? '아직 판을 안 짠 사람이 있어요' : '게임이 끝났어요', status: 409 };
    if (s.turn !== ctx.idx) return { error: '다른 사람 차례예요', status: 409 };
    if (ctx.room.called.includes(n)) return { error: '이미 나온 숫자예요', status: 409 };
    ctx.room.called.push(n); ctx.touchRoom = true;
    return null;
  },
};

export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase === 'setup') return ctx.me.ready ? null : { act: 'ready', body: { board: shuffle([...Array(CELLS)].map((_, i) => i + 1), rnd) } };
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const board = ctx.me.board, called = new Set(ctx.room.called), scored = [];
  for (let n = 1; n <= CELLS; n++) {
    if (called.has(n)) continue;
    const i = board.indexOf(n);
    let sc = rnd();
    for (const line of LINES) if (line.includes(i)) { const hits = line.filter((j) => called.has(board[j])).length; sc += hits === SIZE - 1 ? 100 : hits * hits + 1; }
    scored.push([sc, n]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const pick = scored.length > 1 && scored[0][0] < 100 && rnd() < 0.2 ? scored[1] : scored[0];
  return { act: 'call', body: { n: pick[1] } };
}

export const partyBingo = {
  setup, view, actions, bot: botMove, quick: ['ready'],
  finished: (ctx) => status(ctx).phase === 'done',
};
export const handle = (body, store, now) => handleParty(partyBingo, body, store, now);
