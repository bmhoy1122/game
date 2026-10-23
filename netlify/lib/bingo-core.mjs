/* 커플 빙고 — 방 상태와 규칙 전부. 저장소도 네트워크도 모른다.
 *
 * 흐름: 들어오기 → 선 정하기(first-pick) → 각자 판 짜기 → 번갈아 부르기 → 끝
 *
 * 공용 방(room-kit) 위에 올라가 있다.
 * · 판(board)과 '준비'는 각자 자기 문서에만 쓴다. 둘이 동시에 준비를 눌러도 안 묻힌다.
 *   (예전엔 공용 문서 하나에 썼다 — 동시에 누르면 한쪽 준비가 사라질 수 있었다.)
 * · 부른 숫자는 공용 문서에 쓰는데, 차례제라 한 번에 한 명만 쓴다.
 * · 누가 먼저인지는 선 정하기 기록에서 계산한다. 차례 = (선공 + 부른 개수) % 2.
 * · 상대 판은 응답에서 뺀다. 상대에 대해 알려주는 건 줄 수까지.
 *
 * 승패는 '누가 먼저 3줄이냐'. 둘이 같은 수에 3줄이면 무승부.
 * 선공 이점은 시뮬레이션으로 쟀다 — 둘 다 욕심껏 부르면 47.6 : 42.8, 아무렇게나면 39 : 39.
 * '후공에게 마지막 한 번'(숫자야구식)을 넣으면 오히려 후공이 43 : 18 로 유리해진다.
 * 부른 숫자가 상대 판에도 체크되는 게임이라, 마지막에 부르는 쪽이 이득을 다 가져간다.
 * 그래서 규칙은 그대로 두고, 누가 먼저 할지만 둘이 미니게임으로 정한다.
 *
 * 여기엔 @netlify/blobs import 가 없다. 저장소는 handle() 의 인자로 받는다.
 */
import { handleRoom, shuffle } from './room-kit.mjs';
import { pickKind, firstOf, pickView, pickThrow, pickBot } from './first-pick.mjs';

export const SIZE = 5;
export const WIN_LINES = 3;          // 몇 줄이면 이기나
export const CELLS = SIZE * SIZE;

/* 5×5 의 12줄 (가로 5 + 세로 5 + 대각 2) 을 인덱스로 미리 적어둔다 */
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
  for (const v of b) {
    if (!Number.isInteger(v) || v < 1 || v > CELLS || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

function setup(room) {
  room.called = [];
}

/* 저장하는 건 부른 숫자 · 두 판 · 선 정하기 기록뿐이다. 나머지는 여기서 계산한다. */
export function status(ctx) {
  const { room, docs, joined } = ctx;
  if (!joined) return { phase: 'wait', first: null };
  const first = firstOf(ctx);
  if (first === null) return { phase: 'pick', first };
  const boards = docs.map((d) => (d.ready && validBoard(d.board) ? d.board : null));
  if (!boards[0] || !boards[1]) return { phase: 'setup', first };
  const lines = boards.map((b) => lineCount(b, room.called));
  const done = lines.map((l) => l >= WIN_LINES);
  let winner = null;
  if (done[0] || done[1]) winner = done[0] && done[1] ? 'draw' : done[0] ? 0 : 1;
  else if (room.called.length >= CELLS) winner = lines[0] === lines[1] ? 'draw' : lines[0] > lines[1] ? 0 : 1;
  const turn = (first + room.called.length) % 2;
  return { phase: winner === null ? 'play' : 'done', first, lines, winner, turn };
}

function view(ctx) {
  const { room, idx, me, other } = ctx;
  const s = status(ctx);
  return {
    phase: s.phase,
    winLines: WIN_LINES,
    pick: pickView(ctx),
    first: s.first,
    board: me.board || null,          // 내 판만
    ready: !!me.ready,
    opponentReady: !!other.ready,
    called: room.called,
    last: room.called.length ? room.called[room.called.length - 1] : null,
    turn: s.turn === undefined ? null : s.turn,
    yourTurn: s.phase === 'play' && s.turn === idx,
    lines: s.lines || [0, 0],
    winner: s.winner === undefined ? null : s.winner,
  };
}

const actions = {
  throw: pickThrow,
  ready(ctx) {
    const s = status(ctx);
    if (s.phase === 'wait') return { error: '상대가 아직 안 들어왔어요', status: 409 };
    if (s.phase === 'pick') return { error: '먼저 누가 먼저 할지 정해요', status: 409 };
    if (s.phase !== 'setup') return { error: '이미 시작했어요', status: 409 };
    if (!validBoard(ctx.body.board)) return { error: '판이 이상해요', status: 400 };
    if (ctx.me.ready) return { error: '이미 준비했어요', status: 409 };
    ctx.me.board = ctx.body.board;
    ctx.me.ready = true;
    ctx.touchMe = true;
    return null;
  },
  call(ctx) {
    const n = ctx.body.n;
    if (!Number.isInteger(n) || n < 1 || n > CELLS) return { error: '그런 숫자는 없어요', status: 400 };
    const s = status(ctx);
    if (s.phase !== 'play') return { error: '게임 중이 아니에요', status: 409 };
    if (s.turn !== ctx.idx) return { error: '상대 차례예요', status: 409 };
    if (ctx.room.called.includes(n)) return { error: '이미 나온 숫자예요', status: 409 };
    ctx.room.called.push(n);
    ctx.touchRoom = true;
    return null;
  },
};

/* ---- 혼자 하기 봇 (적당한 난이도) ----
 * 판은 아무렇게나 섞고, 부를 땐 내 판만 본다(사람 판은 서버가 알지만 안 본다 — 공정하게).
 * 숫자마다 '그 칸이 든 줄들의 진행도' 를 더해 가장 좋은 걸 부르고, 20% 는 두 번째로 좋은 걸 부른다. */
export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase === 'pick') return pickBot(ctx, rnd);
  if (s.phase === 'setup') {
    if (ctx.me.ready) return null;
    return { act: 'ready', body: { board: shuffle([...Array(CELLS)].map((_, i) => i + 1), rnd) } };
  }
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const board = ctx.me.board, called = new Set(ctx.room.called);
  const scored = [];
  for (let n = 1; n <= CELLS; n++) {
    if (called.has(n)) continue;
    const i = board.indexOf(n);
    let sc = rnd();
    for (const line of LINES) {
      if (!line.includes(i)) continue;
      const hits = line.filter((j) => called.has(board[j])).length;
      sc += hits === SIZE - 1 ? 100 : hits * hits + 1;
    }
    scored.push([sc, n]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const pick = scored.length > 1 && scored[0][0] < 100 && rnd() < 0.2 ? scored[1] : scored[0];
  return { act: 'call', body: { n: pick[1] } };
}

export const bingo = {
  setup, view, actions, bot: botMove,
  options: (body) => ({ pick: pickKind(body.pick) }),
  finished: (ctx) => status(ctx).phase === 'done',
};

export const handle = (body, store, now) => handleRoom(bingo, body, store, now);
