/* 여럿이 단어 빙고 (2~8명) — 2인용 단어 빙고(wordbingo-core)를 party-kit 위에 올린 것.
 *
 * 흐름: 방장이 주제·판 크기(3·4·5)·목표 줄을 고르고 방을 만든다 → 모두 각자 판에 단어 쓰기(자기 문서, '준비')
 *       → 차례대로(turnSeat) 내 판의 칸을 눌러 부르기 → 부른 단어는 **모든 판**에서 같은 단어(norm)면 지워진다.
 * 이기기: 목표 줄을 먼저 채운 사람(같은 차례에 여럿이면 공동 우승). 팀전(teamMode 'any') = 팀원 중 누구든 먼저 채운 팀.
 *       남은 사람이 한 명(팀전이면 한 팀)뿐이면 그때 줄이 가장 많은 사람.
 * 비밀: 남의 판은 끝날 때까지 안 보낸다. 부른 단어는 공개라 '몇 명이 그 단어를 썼는지'(count)는 보여준다.
 *       끝나면 모든 판과 '여럿이 같이 쓴 단어'(shared)를 공개한다.
 * 저장: 판·준비는 자기 문서(동시에 쓴다, quick), 부른 단어는 공용 문서(차례제) room.called = [{ w, k, by }].
 * 규칙 함수(TOPICS·norm·linesFor·boardProblem·lineCount)는 2인용 core 에서 그대로 가져온다.
 */
import { handleParty, turnSeat, ranking, shuffle, oneSideLeft } from './party-kit.mjs';
import { TOPICS, SIZES, DEFAULT_LINES, MAX_WORD, norm, linesFor, boardProblem, lineCount } from './wordbingo-core.mjs';

export { TOPICS, norm, linesFor, boardProblem, lineCount };
const MAX_TOPIC = 20;
export const wordsOf = (id) => (TOPICS[id] && TOPICS[id].words ? TOPICS[id].words.split(' ') : null);
const MIX = [...new Set(Object.keys(TOPICS).flatMap((k) => wordsOf(k) || []))];
const cleanWord = (w) => String(w || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAX_WORD);

export function options(body) {
  const size = SIZES.includes(Number(body.size)) ? Number(body.size) : 5;
  const n = Number(body.lines);
  const lines = Number.isInteger(n) && n >= 1 && n <= Math.min(2 * size + 2, 5) ? n : DEFAULT_LINES[size];
  const id = TOPICS[body.topic] ? body.topic : 'fruit';
  let label = TOPICS[id].label;
  if (id === 'custom') label = String(body.topicText || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC) || '자유 주제';
  return { size, lines, topic: { id, label, icon: TOPICS[id].icon } };
}
const optsOf = (room) => {
  const o = room.opts || {};
  const size = o.size || 5;
  return { size, lines: o.lines || DEFAULT_LINES[size], topic: o.topic || { id: 'fruit', label: '과일', icon: '🍎' } };
};

function setup(room) { room.called = []; }

export function status(ctx) {
  const { room, docs, active } = ctx;
  const o = optsOf(room);
  const boards = docs.map((d, i) => (active.includes(i) && d.ready && !boardProblem(d.board, o.size) ? d.board : null));
  const waiting = active.filter((i) => !boards[i]);
  if (waiting.length) return { phase: 'setup', o, boards, waiting, lines: docs.map(() => 0) };
  const keys = new Set(room.called.map((c) => c.k));
  const lines = docs.map((d, i) => (boards[i] ? lineCount(boards[i], keys, o.size) : null));
  const bingo = active.filter((i) => lines[i] >= o.lines);
  let winners = null;
  let turn = turnSeat(room, room.called.length);
  const stuck = turn !== null && boards[turn] && boards[turn].every((w) => keys.has(norm(w)));   // 부를 칸이 없다 (목표가 판보다 크지 않으니 사실상 안 생김)
  if (bingo.length) winners = bingo;
  else if (oneSideLeft(room, active) || stuck) {
    const best = Math.max(...active.map((i) => lines[i]));
    winners = active.filter((i) => lines[i] === best);
  }
  if (winners) turn = null;
  return { phase: winners ? 'done' : 'play', o, boards, waiting: [], lines, winners, turn, keys };
}

/* 끝났을 때 — 두 판 이상에 있던 단어들 (같은 단어는 norm 으로) */
function sharedWords(boards) {
  const m = new Map();
  boards.forEach((b, i) => { if (b) b.forEach((w) => { const k = norm(w); if (!m.has(k)) m.set(k, { w, seats: [] }); if (!m.get(k).seats.includes(i)) m.get(k).seats.push(i); }); });
  return [...m.values()].filter((x) => x.seats.length > 1).sort((a, b) => b.seats.length - a.seats.length);
}

function view(ctx) {
  const { room, idx, me, docs } = ctx;
  const s = status(ctx);
  const sets = s.boards.map((b) => (b ? new Set(b.map(norm)) : null));
  const done = s.phase === 'done';
  return {
    stage: s.phase,
    size: s.o.size, winLines: s.o.lines, topic: s.o.topic, hasWords: !!wordsOf(s.o.topic.id),
    board: me.board || null, ready: !!me.ready,                         // 내 판만
    readyAll: docs.map((d) => !!d.ready),
    // count: 이 단어를 쓴 사람 수 (부른 사람 포함). 부른 단어는 공개 정보라 숫자만 알려준다
    called: room.called.map((c) => ({ w: c.w, by: c.by, count: sets.filter((x) => x && x.has(c.k)).length })),
    turn: s.turn === undefined ? null : s.turn,
    yourTurn: s.phase === 'play' && s.turn === idx,
    lines: s.lines, winners: s.winners || null,
    rank: done ? ranking(s.lines.map((l, i) => (ctx.active.includes(i) ? l : null))) : null,
    boards: done ? docs.map((d) => (d.ready ? d.board : null)) : null,           // 끝나면 다 공개
    shared: done ? sharedWords(docs.map((d) => (d.ready ? d.board : null))) : null,
    suggest: s.phase === 'setup' && !me.ready ? wordsOf(s.o.topic.id) : null,   // '빈칸 채우기'용 (주제 목록은 공개 정보)
  };
}

const actions = {
  ready(ctx) {
    const s = status(ctx);
    if (s.phase !== 'setup') return { error: '이미 시작했어요', status: 409 };
    if (ctx.me.ready) return { error: '이미 준비했어요', status: 409 };
    const why = boardProblem(ctx.body.board, s.o.size);
    if (why) return { error: why, status: 400 };
    ctx.me.board = ctx.body.board.map(cleanWord);
    ctx.me.ready = true; ctx.touchMe = true;
    return null;
  },
  call(ctx) {
    const s = status(ctx);
    if (s.phase !== 'play') return { error: s.phase === 'setup' ? '아직 단어를 쓰는 사람이 있어요' : '게임이 끝났어요', status: 409 };
    if (s.turn !== ctx.idx) return { error: '다른 사람 차례예요', status: 409 };
    const i = ctx.body.i, board = ctx.me.board;
    if (!Number.isInteger(i) || i < 0 || i >= board.length) return { error: '내 판의 칸을 골라요', status: 400 };
    const k = norm(board[i]);
    if (s.keys.has(k)) return { error: '이미 나온 단어예요', status: 409 };
    ctx.room.called.push({ w: board[i], k, by: ctx.idx });
    ctx.touchRoom = true;
    return null;
  },
};

/* ---- 봇 (2인용 단어 빙고 봇과 같다) ----
 * 판: 주제 단어 목록에서 무작위(목록 없는 주제면 여러 주제를 섞어서).
 * 부르기: 내 판만 보고, 그 칸이 든 줄들의 진행도가 큰 단어. 한 칸 남은 줄이 없으면 20% 는 두 번째. */
export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase === 'setup') {
    if (ctx.me.ready || !ctx.active.includes(ctx.idx)) return null;
    const pool = [...new Set(wordsOf(s.o.topic.id) || MIX)];
    return { act: 'ready', body: { board: shuffle(pool, rnd).slice(0, s.o.size * s.o.size) } };
  }
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const board = ctx.me.board, size = s.o.size, L = linesFor(size);
  const marked = (j) => s.keys.has(norm(board[j]));
  const scored = [];
  for (let i = 0; i < board.length; i++) {
    if (marked(i)) continue;
    let sc = rnd();
    for (const line of L) {
      if (!line.includes(i)) continue;
      const hits = line.filter(marked).length;
      sc += hits === size - 1 ? 100 : hits * hits + 1;
    }
    scored.push([sc, i]);
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b[0] - a[0]);
  const pick = scored.length > 1 && scored[0][0] < 100 && rnd() < 0.2 ? scored[1] : scored[0];
  return { act: 'call', body: { i: pick[1] } };
}

export const partyWordbingo = {
  setup, view, actions, options, bot: botMove, quick: ['ready'],
  teamMode: 'any',                        // 팀전: 팀원 중 누구든 먼저 목표 줄이면 그 팀 승
  finished: (ctx) => status(ctx).phase === 'done',
};
export const handle = (body, store, now) => handleParty(partyWordbingo, body, store, now);
