/* 여럿이 탐험대 (2~8명) — 로스트 시티 방식, party-kit 위. 규칙은 2인용(expedition-core)과 같고 다른 점만:
 *   · 카드 덱을 인원에 맞춰 늘린다: 2명 1벌, 3~4명 2벌, 5~6명 3벌, 7~8명 4벌 (60장 × 벌). 같은 카드가 여러 장 있을 수 있다
 *     (같은 숫자는 한 탐험로에 두 번 못 놓으니 두 번째 장은 버리는 수밖에 없다 — 그게 재미).
 *   · 버림 더미 다섯은 모두가 같이 쓴다. 각자 탐험로 다섯. 손패 8장.
 *   · 덱 마지막 장을 가져가면 끝. 점수가 가장 높은 사람이 이긴다(같으면 공동).
 *   · 기권한 사람의 탐험로는 그대로 두고(점수엔 안 들어감) 차례에서만 뺀다.
 */
import { handleParty, turnSeat, ranking, seeded, shuffle, oneSideLeft } from './party-kit.mjs';

export const COLORS = 5, PER = 12, HAND = 8;
export const col = (id) => Math.floor(id / PER);
export const val = (id) => { const k = id % PER; return k < 3 ? 0 : k - 1; };
export const isWager = (id) => id % PER < 3;
const isCard = (id) => Number.isInteger(id) && id >= 0 && id < COLORS * PER;
const byOrder = (a, b) => a - b;
export const decksFor = (n) => Math.max(1, Math.ceil(n / 2));

export function deckFor(code, round, decks) {
  const ids = [];
  for (let d = 0; d < decks; d++) for (let i = 0; i < COLORS * PER; i++) ids.push(i);
  return shuffle(ids, seeded(`${code}:${round}:deck`));
}
function setup(room) {
  const n = room.players.length, decks = decksFor(n);
  const deck = deckFor(room.code, room.round, decks);
  room.decks = decks;
  room.hands = room.players.map(() => deck.splice(0, HAND).sort(byOrder));
  room.deck = deck;
  room.lines = room.players.map(() => [[], [], [], [], []]);
  room.discard = [[], [], [], [], []];
  room.turnNo = 0; room.step = 'play'; room.blocked = null; room.log = [];
}
export function lineScore(line) {
  if (!line.length) return 0;
  let sum = 0, w = 0;
  for (const id of line) { if (isWager(id)) w++; else sum += val(id); }
  return (sum - 20) * (1 + w) + (line.length >= 8 ? 20 : 0);
}
export const totalScore = (lines) => lines.reduce((t, l) => t + lineScore(l), 0);
export function lineWhy(line, id) {
  if (!line.length) return null;
  const top = line[line.length - 1];
  if (isWager(id)) return isWager(top) ? null : '내기 카드는 숫자를 놓기 전에만 놓을 수 있어요';
  if (isWager(top)) return null;
  return val(id) > val(top) ? null : `이미 ${val(top)}까지 놓았어요. 더 큰 숫자만 놓을 수 있어요`;
}

export function status(ctx) {
  const { room, active } = ctx;
  const scores = room.players.map((_, i) => (active.includes(i) ? totalScore(room.lines[i]) : null));
  if (room.deck.length > 0 && !oneSideLeft(room, active)) return { phase: 'play', turn: turnSeat(room, room.turnNo), step: room.step, scores, winners: null };
  const best = Math.max(...active.map((i) => scores[i]));
  return { phase: 'done', turn: null, step: null, scores, winners: active.filter((i) => scores[i] === best) };
}

function view(ctx) {
  const { room, idx } = ctx, s = status(ctx);
  const yourTurn = s.phase === 'play' && s.turn === idx;
  const hand = room.hands[idx].slice().sort(byOrder);
  return {
    stage: s.phase, turn: s.turn, yourTurn, step: s.phase === 'play' ? s.step : null,
    hand, canLine: yourTurn && s.step === 'play' ? hand.filter((id) => !lineWhy(room.lines[idx][col(id)], id)) : [],
    handCounts: room.hands.map((h) => h.length), deck: room.deck.length, decks: room.decks,
    lines: room.lines, lineScores: room.lines.map((ls) => ls.map(lineScore)), scores: s.scores,
    piles: room.discard.map((p) => (p.length ? p[p.length - 1] : null)), pileCount: room.discard.map((p) => p.length),
    blocked: s.phase === 'play' ? room.blocked : null, turnNo: room.turnNo,
    log: room.log.slice(-8).map((e) => (e.t === 'draw' && e.from === 'deck' && e.by !== idx ? { by: e.by, t: e.t, from: e.from } : e)),
    winners: s.winners, rank: s.phase === 'done' ? ranking(s.scores) : null,
  };
}

function turnCheck(ctx, step) {
  const s = status(ctx);
  if (s.phase !== 'play') return { error: '게임이 끝났어요', status: 409 };
  if (s.turn !== ctx.idx) return { error: '다른 사람 차례예요', status: 409 };
  if (s.step !== step) return { error: step === 'play' ? '먼저 한 장 가져와야 해요 (덱이나 버림 더미)' : '먼저 카드를 한 장 놓거나 버려야 해요', status: 409 };
  return null;
}
const pushLog = (room, e) => { room.log.push(e); if (room.log.length > 16) room.log.splice(0, room.log.length - 16); };
const actions = {
  play(ctx) {
    const bad = turnCheck(ctx, 'play'); if (bad) return bad;
    const { room, idx, body } = ctx, id = body.card;
    if (!isCard(id)) return { error: '그런 카드가 없어요', status: 400 };
    const hand = room.hands[idx], at = hand.indexOf(id);
    if (at < 0) return { error: '손에 없는 카드예요', status: 409 };
    if (body.to !== 'line' && body.to !== 'discard') return { error: '놓을지 버릴지 골라주세요', status: 400 };
    const c = col(id);
    if (body.to === 'line') { const why = lineWhy(room.lines[idx][c], id); if (why) return { error: why, status: 409 }; room.lines[idx][c].push(id); room.blocked = null; }
    else { room.discard[c].push(id); room.blocked = c; }
    hand.splice(at, 1); room.step = 'draw';
    pushLog(room, { by: idx, t: body.to, card: id }); ctx.touchRoom = true;
    return null;
  },
  draw(ctx) {
    const bad = turnCheck(ctx, 'draw'); if (bad) return bad;
    const { room, idx, body } = ctx; let id, from = body.from;
    if (from === 'deck') id = room.deck.pop();
    else {
      if (!Number.isInteger(from) || from < 0 || from >= COLORS) return { error: '어디서 가져올지 골라주세요', status: 400 };
      if (from === room.blocked) return { error: '방금 버린 카드는 다시 가져올 수 없어요', status: 409 };
      if (!room.discard[from].length) return { error: '그 버림 더미는 비어 있어요', status: 409 };
      id = room.discard[from].pop();
    }
    room.hands[idx].push(id); room.hands[idx].sort(byOrder);
    room.step = 'play'; room.blocked = null; room.turnNo++;
    pushLog(room, { by: idx, t: 'draw', from, card: id }); ctx.touchRoom = true;
    return null;
  },
};
/* 기권하면 차례 중간이었을 때 걸음을 정리한다 (놓기만 하고 나갔으면 그 차례는 끝난 것으로) */
function onOut(room, idx) {
  if (room.step === 'draw' && turnSeat(room, room.turnNo) !== undefined) { room.step = 'play'; room.blocked = null; room.turnNo++; }
}

const lastNum = (line) => { for (let i = line.length - 1; i >= 0; i--) if (!isWager(line[i])) return val(line[i]); return 1; };
const handSum = (hand, c) => hand.reduce((t, id) => t + (col(id) === c && !isWager(id) ? val(id) : 0), 0);
export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const { room, idx, active } = ctx, hand = room.hands[idx], mine = room.lines[idx], deck = room.deck.length;
  const others = active.filter((i) => i !== idx).map((i) => room.lines[i]);
  if (s.step === 'draw') {
    let best = null, bestSc = 0;
    for (let c = 0; c < COLORS; c++) {
      if (c === room.blocked || !room.discard[c].length) continue;
      const id = room.discard[c][room.discard[c].length - 1], line = mine[c]; let sc = 0;
      if (line.length && !lineWhy(line, id)) { const gap = isWager(id) ? 0 : val(id) - lastNum(line) - 1; sc = isWager(id) ? (deck > 20 ? 3 : 0) : 6 - gap; }
      else if (!line.length && !isWager(id) && val(id) >= 6 && handSum(hand, c) + val(id) >= 22 && deck > 12) sc = 2;
      if (sc > bestSc) { bestSc = sc; best = c; }
    }
    return { act: 'draw', body: { from: best !== null && bestSc >= 2 ? best : 'deck' } };
  }
  let play = null, playSc = -Infinity;
  const consider = (id, sc) => { sc += rnd() * 0.5; if (sc > playSc) { playSc = sc; play = id; } };
  for (let c = 0; c < COLORS; c++) {
    const line = mine[c], cards = hand.filter((h) => col(h) === c && !lineWhy(line, h)).sort(byOrder);
    if (!cards.length) continue;
    const nums = cards.filter((h) => !isWager(h)), wagers = cards.filter(isWager);
    if (line.length) {
      if (wagers.length && deck > 22) consider(wagers[0], 4);
      if (nums.length) { const gap = val(nums[0]) - lastNum(line) - 1; consider(nums[0], 8 - gap * 1.5 + (deck < 10 ? 4 : 0)); }
    } else {
      const sum = handSum(hand, c), need = deck > 30 ? 20 : deck > 18 ? 24 : 30;
      if (sum < need) continue;
      const sc = 3 + (sum - need) * 0.3;
      if (wagers.length && deck >= 26 && sum >= 24) consider(wagers[0], sc); else if (nums.length) consider(nums[0], sc);
    }
  }
  if (play !== null && playSc >= 2) return { act: 'play', body: { card: play, to: 'line' } };
  let dump = null, dumpSc = Infinity;
  for (const id of hand) {
    const c = col(id), line = mine[c]; let useMe;
    if (line.length) useMe = lineWhy(line, id) ? 0 : (isWager(id) ? 2 : 6 - Math.max(0, val(id) - lastNum(line) - 1) * 0.5);
    else useMe = (handSum(hand, c) >= 15 ? 4 : 1) + (isWager(id) ? (deck > 25 ? 1 : -1) : val(id) * 0.15);
    let helpOpp = 0;
    for (const ol of others) { const o = ol[c]; const h = o.length ? (lineWhy(o, id) ? 0 : (isWager(id) ? 3 : 5)) : (isWager(id) ? 0.5 : val(id) >= 7 ? 2 : 1); helpOpp = Math.max(helpOpp, h); }
    const sc = useMe + helpOpp + rnd() * 0.5;
    if (sc < dumpSc) { dumpSc = sc; dump = id; }
  }
  if (play !== null && playSc > -2 && dumpSc > 5) return { act: 'play', body: { card: play, to: 'line' } };
  return { act: 'play', body: { card: dump, to: 'discard' } };
}

export const partyExpedition = { setup, view, actions, bot: botMove, onOut, finished: (ctx) => status(ctx).phase === 'done' };
export const handle = (body, store, now) => handleParty(partyExpedition, body, store, now);
