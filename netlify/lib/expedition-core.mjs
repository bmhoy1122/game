/* 탐험대 — 로스트 시티 방식 카드 게임, 한 라운드.
 *
 * 카드: 탐험로 다섯 색(사막 · 바다 · 숲 · 화산 · 설산) × (내기 카드 🤝 3장 + 숫자 2~10) = 60장.
 *   카드 번호(id) = 색 × 12 + k.  k 0·1·2 = 내기 카드, k 3~11 = 숫자 2~10 (숫자 = k − 1).
 *   화면도 같은 식으로 풀어 쓴다(couple-expedition/index.html 의 col/val).
 *
 * 시작: 각자 8장. 남은 44장이 덱. 덱 순서는 방 코드 + 판 번호로 섞는다(seeded) —
 *   둘이 동시에 '다시 하기'를 눌러도 같은 판이 된다.
 *
 * 내 차례 = 두 걸음(step).
 *   'play' — 손패 한 장을 내 탐험로에 놓거나(같은 색, 이미 놓인 것보다 큰 숫자만.
 *            내기 카드는 그 색에 숫자를 놓기 전에만) 그 색 버림 더미에 버린다.
 *   'draw' — 덱 맨 위나 아무 버림 더미 맨 위에서 한 장 가져온다. 방금 버린 더미에선 못 가져온다.
 * 덱 마지막 장을 가져가면 바로 끝.
 *
 * 점수(시작한 탐험로만): (숫자 합 − 20) × (1 + 내기 카드 수), 카드 8장 이상이면 +20(곱하지 않음).
 *   시작 안 한 탐험로는 0. 총합이 높은 쪽이 이긴다. 같으면 무승부.
 *
 * 저장: 손패 · 덱 · 탐험로 · 버림 더미 전부 공용 문서(room)에 둔다. 두 걸음 다 차례제라
 *   한 번에 한 명만 쓴다. 손패를 room 에 둬도 응답엔 내 손패만, 상대는 장수만 넣는다.
 *   덱도 남은 장수만. 선공은 미니게임(first-pick)으로 정한다.
 */
import { handleRoom, seeded, shuffle } from './room-kit.mjs';
import { pickKind, firstOf, pickView, pickThrow, pickBot } from './first-pick.mjs';

export const COLORS = 5, PER = 12, HAND = 8;
export const col = (id) => Math.floor(id / PER);
export const val = (id) => { const k = id % PER; return k < 3 ? 0 : k - 1; };   // 0 = 내기 카드
export const isWager = (id) => id % PER < 3;
const isCard = (id) => Number.isInteger(id) && id >= 0 && id < COLORS * PER;
const byOrder = (a, b) => a - b;                         // 색 → 내기 → 숫자 순 (id 순서가 곧 그것)

export function deckFor(code, round) {
  const ids = [...Array(COLORS * PER).keys()];
  return shuffle(ids, seeded(`${code}:${round}:deck`));
}

function setup(room) {
  const deck = deckFor(room.code, room.round);
  room.hands = [deck.splice(0, HAND).sort(byOrder), deck.splice(0, HAND).sort(byOrder)];
  room.deck = deck;                                      // 맨 위 = 배열 끝
  room.lines = [[[], [], [], [], []], [[], [], [], [], []]];
  room.discard = [[], [], [], [], []];
  room.turnNo = 0;                                       // 끝난 차례 수
  room.step = 'play';
  room.blocked = null;                                   // 이번 차례에 버린 색 (그 더미에선 못 가져온다)
  room.log = [];
}

/* 탐험로 하나의 점수 */
export function lineScore(line) {
  if (!line.length) return 0;
  let sum = 0, w = 0;
  for (const id of line) { if (isWager(id)) w++; else sum += val(id); }
  return (sum - 20) * (1 + w) + (line.length >= 8 ? 20 : 0);
}
export const totalScore = (lines) => lines.reduce((t, l) => t + lineScore(l), 0);

/* 이 카드를 이 탐험로에 놓을 수 있나. 안 되면 이유 문자열, 되면 null */
export function lineWhy(line, id) {
  if (!line.length) return null;
  const top = line[line.length - 1];
  if (isWager(id)) return isWager(top) ? null : '내기 카드는 숫자를 놓기 전에만 놓을 수 있어요';
  if (isWager(top)) return null;
  return val(id) > val(top) ? null : `이미 ${val(top)}까지 놓았어요. 더 큰 숫자만 놓을 수 있어요`;
}

export function status(ctx) {
  const { room, joined } = ctx;
  if (!joined) return { phase: 'wait', first: null };
  const first = firstOf(ctx);
  if (first === null) return { phase: 'pick', first };
  const turn = (first + room.turnNo) % 2;
  const scores = [totalScore(room.lines[0]), totalScore(room.lines[1])];
  if (room.deck.length > 0) return { phase: 'play', first, turn, step: room.step, scores, winner: null };
  const winner = scores[0] === scores[1] ? 'draw' : scores[0] > scores[1] ? 0 : 1;
  return { phase: 'done', first, turn: null, step: null, scores, winner };
}

function view(ctx) {
  const { room, idx } = ctx;
  const s = status(ctx);
  const me = idx, them = 1 - idx;
  const yourTurn = s.phase === 'play' && s.turn === idx;
  const hand = room.hands[me].slice().sort(byOrder);
  return {
    phase: s.phase,
    pick: pickView(ctx),
    first: s.first,
    turn: s.turn === undefined ? null : s.turn,
    yourTurn,
    step: yourTurn ? s.step : (s.phase === 'play' ? s.step : null),
    hand,                                                 // 내 손패만
    canLine: yourTurn && s.step === 'play' ? hand.filter((id) => !lineWhy(room.lines[me][col(id)], id)) : [],
    oppHand: room.hands[them].length,                     // 상대는 장수만
    deck: room.deck.length,                               // 덱은 장수만
    lines: { me: room.lines[me], them: room.lines[them] },
    lineScores: { me: room.lines[me].map(lineScore), them: room.lines[them].map(lineScore) },
    score: { me: totalScore(room.lines[me]), them: totalScore(room.lines[them]) },
    piles: room.discard.map((p) => (p.length ? p[p.length - 1] : null)),   // 버림 더미 맨 위
    pileCount: room.discard.map((p) => p.length),
    blocked: s.phase === 'play' ? room.blocked : null,
    turnNo: room.turnNo,
    // 지난 행동들 — 덱에서 가져온 카드는 비밀이라 안 넣는다(내 것만 넣는다)
    log: room.log.slice(-6).map((e) => (e.t === 'draw' && e.from === 'deck' && e.by !== idx ? { by: e.by, t: e.t, from: e.from } : e)),
    winner: s.winner === undefined ? null : s.winner,
  };
}

function turnCheck(ctx, step) {
  const s = status(ctx);
  if (s.phase !== 'play') return { error: s.phase === 'done' ? '게임이 끝났어요' : '아직 시작 전이에요', status: 409 };
  if (s.turn !== ctx.idx) return { error: '상대 차례예요', status: 409 };
  if (s.step !== step) return { error: step === 'play' ? '먼저 한 장 가져와야 해요 (덱이나 버림 더미)' : '먼저 카드를 한 장 놓거나 버려야 해요', status: 409 };
  return null;
}

const actions = {
  throw: pickThrow,
  /* body: { card, to: 'line' | 'discard' } */
  play(ctx) {
    const bad = turnCheck(ctx, 'play');
    if (bad) return bad;
    const { room, idx, body } = ctx;
    const id = body.card;
    if (!isCard(id)) return { error: '그런 카드가 없어요', status: 400 };
    const hand = room.hands[idx];
    const at = hand.indexOf(id);
    if (at < 0) return { error: '손에 없는 카드예요', status: 409 };
    if (body.to !== 'line' && body.to !== 'discard') return { error: '놓을지 버릴지 골라주세요', status: 400 };
    const c = col(id);
    if (body.to === 'line') {
      const why = lineWhy(room.lines[idx][c], id);
      if (why) return { error: why, status: 409 };
      room.lines[idx][c].push(id);
      room.blocked = null;
    } else {
      room.discard[c].push(id);
      room.blocked = c;
    }
    hand.splice(at, 1);
    room.step = 'draw';
    room.log.push({ by: idx, t: body.to, card: id });
    if (room.log.length > 12) room.log.splice(0, room.log.length - 12);
    ctx.touchRoom = true;
    return null;
  },
  /* body: { from: 'deck' | 0~4 (버림 더미 색) } */
  draw(ctx) {
    const bad = turnCheck(ctx, 'draw');
    if (bad) return bad;
    const { room, idx, body } = ctx;
    let id, from = body.from;
    if (from === 'deck') {
      id = room.deck.pop();
    } else {
      if (!Number.isInteger(from) || from < 0 || from >= COLORS) return { error: '어디서 가져올지 골라주세요', status: 400 };
      if (from === room.blocked) return { error: '방금 버린 카드는 다시 가져올 수 없어요', status: 409 };
      if (!room.discard[from].length) return { error: '그 버림 더미는 비어 있어요', status: 409 };
      id = room.discard[from].pop();
    }
    room.hands[idx].push(id);
    room.hands[idx].sort(byOrder);
    room.step = 'play';
    room.blocked = null;
    room.turnNo++;
    room.log.push({ by: idx, t: 'draw', from, card: id });   // 덱에서 온 카드는 view 가 상대에게서 지운다
    if (room.log.length > 12) room.log.splice(0, room.log.length - 12);
    ctx.touchRoom = true;
    return null;
  },
};

/* ---- 혼자 하기 봇 (적당한 난이도) ----
 * 놓기: 이미 시작한 탐험로면 이어지는 작은 숫자부터(건너뛰는 숫자가 적을수록 좋다).
 *   새 탐험로는 그 색 손패 숫자 합이 넉넉할 때만(덱이 줄수록 문턱이 올라간다). 내기 카드는 초반에만.
 * 버리기: 내게 쓸모없고(이미 지나간 숫자 · 안 갈 색) 상대 탐험로에 이어지지 않는 카드.
 * 가져오기: 내 탐험로에 바로 이어지는 버림 카드면 가져오고, 아니면 덱.
 * 멀리 내다보진 않는다 — 상대 손패를 세거나 덱 끝을 늘리는 수는 안 쓴다. */
const lastNum = (line) => { for (let i = line.length - 1; i >= 0; i--) if (!isWager(line[i])) return val(line[i]); return 1; };
const handSum = (hand, c) => hand.reduce((t, id) => t + (col(id) === c && !isWager(id) ? val(id) : 0), 0);

export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase === 'pick') return pickBot(ctx, rnd);
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const { room, idx } = ctx;
  const hand = room.hands[idx], mine = room.lines[idx], opp = room.lines[1 - idx];
  const deck = room.deck.length;

  if (s.step === 'draw') {
    let best = null, bestSc = 0;
    for (let c = 0; c < COLORS; c++) {
      if (c === room.blocked || !room.discard[c].length) continue;
      const id = room.discard[c][room.discard[c].length - 1];
      const line = mine[c];
      let sc = 0;
      if (line.length && !lineWhy(line, id)) {
        const gap = isWager(id) ? 0 : val(id) - lastNum(line) - 1;
        sc = isWager(id) ? (deck > 20 ? 3 : 0) : 6 - gap;
      } else if (!line.length && !isWager(id) && val(id) >= 6 && handSum(hand, c) + val(id) >= 22 && deck > 12) {
        sc = 2;                                         // 이 색을 시작할 만해진다
      }
      if (sc > bestSc) { bestSc = sc; best = c; }
    }
    return { act: 'draw', body: { from: best !== null && bestSc >= 2 ? best : 'deck' } };
  }

  // 놓기 후보
  let play = null, playSc = -Infinity;
  const consider = (id, sc) => { sc += rnd() * 0.5; if (sc > playSc) { playSc = sc; play = id; } };
  for (let c = 0; c < COLORS; c++) {
    const line = mine[c];
    const cards = hand.filter((h) => col(h) === c && !lineWhy(line, h)).sort(byOrder);
    if (!cards.length) continue;
    const nums = cards.filter((h) => !isWager(h)), wagers = cards.filter(isWager);
    if (line.length) {
      // 이어 놓기 — 그 색에서 놓을 수 있는 가장 작은 카드만 본다
      if (wagers.length && deck > 22) consider(wagers[0], 4);
      if (nums.length) {
        const gap = val(nums[0]) - lastNum(line) - 1;
        consider(nums[0], 8 - gap * 1.5 + (deck < 10 ? 4 : 0));
      }
    } else {
      // 새로 시작 — 그 색 손패 숫자 합이 넉넉할 때만. 덱이 줄수록 문턱이 올라간다
      const sum = handSum(hand, c);
      const need = deck > 30 ? 20 : deck > 18 ? 24 : 30;
      if (sum < need) continue;
      const sc = 3 + (sum - need) * 0.3;
      if (wagers.length && deck >= 26 && sum >= 24) consider(wagers[0], sc);   // 내기 카드는 초반 + 손이 좋을 때만
      else if (nums.length) consider(nums[0], sc);
    }
  }
  if (play !== null && playSc >= 2) return { act: 'play', body: { card: play, to: 'line' } };

  // 버리기 — 쓸모 + 상대에게 주는 도움이 가장 작은 카드
  let dump = null, dumpSc = Infinity;
  for (const id of hand) {
    const c = col(id), line = mine[c], o = opp[c];
    let useMe;
    if (line.length) useMe = lineWhy(line, id) ? 0 : (isWager(id) ? 2 : 6 - Math.max(0, val(id) - lastNum(line) - 1) * 0.5);
    else useMe = (handSum(hand, c) >= 15 ? 4 : 1) + (isWager(id) ? (deck > 25 ? 1 : -1) : val(id) * 0.15);
    let helpOpp;
    if (o.length) helpOpp = lineWhy(o, id) ? 0 : (isWager(id) ? 3 : 5);
    else helpOpp = isWager(id) ? 0.5 : val(id) >= 7 ? 2 : 1;
    const sc = useMe + helpOpp + rnd() * 0.5;
    if (sc < dumpSc) { dumpSc = sc; dump = id; }
  }
  // 버릴 게 너무 아까우면 그나마 놓을 수 있는 수
  if (play !== null && playSc > -2 && dumpSc > 5) return { act: 'play', body: { card: play, to: 'line' } };
  return { act: 'play', body: { card: dump, to: 'discard' } };
}

export const expedition = {
  setup, view, actions, bot: botMove,
  options: (body) => ({ pick: pickKind(body.pick) }),
  finished: (ctx) => status(ctx).phase === 'done',
};

export const handle = (body, store, now) => handleRoom(expedition, body, store, now);
