/* 블랙잭 (2~8명) — party-kit 위. 모두가 딜러(은행, 규칙대로 자동)와 겨룬다 — 서로 겨루지 않는다.
 *
 * 카드 id 0..103 (2벌): 숫자 = id%13 (0=2 … 8=10, 9~11 = J·Q·K = 10, 12 = A = 11 또는 1), 무늬 = ⌊id/13⌋%4.
 * 한 게임 = 여러 판(5·10·20, 기본 10). 시작 칩 1000, 판마다 정한 금액(10·25·50, 기본 25)을 자동으로 건다. 칩이 모자라면 그 판은 구경.
 * 판: 각자 2장(공개) + 딜러 2장(한 장 뒤집음). 딜러 A·10 이면 블랙잭 확인 — 딜러 블랙잭이면 바로 끝(플레이어 블랙잭만 비김).
 *   플레이어 차례(자리 순): 히트 · 스탠드 · 더블(처음 두 장일 때, 걸은 만큼 더 걸고 한 장만). 21 넘으면 버스트. 블랙잭은 자동 스탠드.
 *   스플릿은 없다(가볍게). 모두 끝나면 딜러가 17 이상까지 뽑는다(소프트 17 스탠드).
 * 정산: 버스트 = 건 돈 잃음. 블랙잭(처음 두 장 21, 더블 아님) = 1.5배. 딜러 버스트 또는 내가 높으면 1배. 같으면 비김(돌려받음).
 * 끝: 정한 판 수가 끝나거나 아무도 걸 수 없으면 — 칩 많은 순.
 * 봇: 기본 전략 — 딜러 업카드 7 이상이면 17 까지 히트, 2~6 이면 12(2·3 엔 13)부터 스탠드, 11 더블·10 은 딜러 9 이하에 더블, 소프트 18 은 9 이상에 히트.
 */
import { handleParty, ranking, shuffle, seeded } from './party-kit.mjs';

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'], SUITS = ['♠', '♥', '♦', '♣'];
export const rankOf = (id) => id % 13, suitOf = (id) => Math.floor(id / 13) % 4;
export const COUNTS = [5, 10, 20], DEFAULT_COUNT = 10, BETS = [10, 25, 50], DEFAULT_BET = 25, START_CHIPS = 1000;

/* 합계 — { total, soft } soft = A 를 11 로 센 상태 */
export function handValue(ids) {
  let t = 0, aces = 0;
  for (const id of ids) { const r = rankOf(id); if (r === 12) { aces++; t += 11; } else t += Math.min(10, r + 2); }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { total: t, soft: aces > 0 };
}
export const isBlackjack = (ids) => ids.length === 2 && handValue(ids).total === 21;

function options(body) {
  const c = Number(body.count), b = Number(body.bet);
  return { count: COUNTS.includes(c) ? c : DEFAULT_COUNT, bet: BETS.includes(b) ? b : DEFAULT_BET };
}
function setup(room) {
  const np = room.players.length, o = room.opts || {};
  room.g = { chips: Array(np).fill(START_CHIPS), hand: 0, total: COUNTS.includes(o.count) ? o.count : DEFAULT_COUNT, bet: BETS.includes(o.bet) ? o.bet : DEFAULT_BET, cur: null, log: [], history: [], over: false };
  deal(room);
}
const pushLog = (g, e) => { g.log.push(e); if (g.log.length > 30) g.log.splice(0, g.log.length - 30); };
const canPlay = (room, i) => !(room.out && room.out[i]) && room.g.chips[i] >= room.g.bet;

function deal(room) {
  const g = room.g, seats = room.players.map((_, i) => i).filter((i) => canPlay(room, i));
  if (!seats.length || g.hand >= g.total) { g.over = true; g.cur = null; return; }
  const deck = shuffle([...Array(104)].map((_, i) => i), seeded(`${room.code}:${room.round}:h${g.hand}`));
  const cards = {}, bets = {}, done = {}, doubled = {};
  for (const i of seats) { cards[i] = []; bets[i] = g.bet; g.chips[i] -= g.bet; done[i] = false; doubled[i] = false; }
  for (let k = 0; k < 2; k++) for (const i of seats) cards[i].push(deck.pop());
  const dealer = [deck.pop(), deck.pop()];
  const cur = { seats, cards, dealer, deck, bets, done, doubled, stage: 'play', turn: null, result: null, peek: false };
  for (const i of seats) if (isBlackjack(cards[i])) done[i] = true;                    // 블랙잭은 자동 스탠드
  const up = rankOf(dealer[0]);
  if ((up === 12 || up >= 8) && isBlackjack(dealer)) { cur.peek = true; return finish(room, cur); }   // 딜러 블랙잭 — 바로 공개
  cur.turn = nextTurn(cur);
  g.cur = cur;
  pushLog(g, { t: 'deal', hand: g.hand });
  if (cur.turn === null) finish(room, cur);
}
const nextTurn = (cur) => { for (const i of cur.seats) if (!cur.done[i]) return i; return null; };
/* 딜러가 뽑고 정산 */
function finish(room, cur) {
  const g = room.g;
  g.cur = cur; cur.stage = 'result'; cur.turn = null;
  const anyLive = cur.seats.some((i) => handValue(cur.cards[i]).total <= 21);
  if (anyLive && !cur.peek) {
    while (handValue(cur.dealer).total < 17) cur.dealer.push(cur.deck.pop());          // 17 이상이면 멈춤 (소프트 17 도 스탠드)
  }
  const dv = handValue(cur.dealer).total, dBust = dv > 21, dBJ = isBlackjack(cur.dealer);
  const won = {}, outcome = {};
  for (const i of cur.seats) {
    const v = handValue(cur.cards[i]).total, bj = isBlackjack(cur.cards[i]) && !cur.doubled[i], bet = cur.bets[i];
    let o, w = 0;
    if (v > 21) o = 'bust';
    else if (bj && !dBJ) { o = 'blackjack'; w = bet + Math.floor(bet * 1.5); }
    else if (dBJ && !bj) o = 'lose';
    else if (dBust || v > dv) { o = 'win'; w = bet * 2; }
    else if (v === dv) { o = 'push'; w = bet; }
    else o = 'lose';
    won[i] = w; outcome[i] = o; g.chips[i] += w;
  }
  cur.result = { dealer: cur.dealer, dealerTotal: dv, dealerBust: dBust, dealerBJ: dBJ, won, outcome };
  const winners = cur.seats.filter((i) => outcome[i] === 'win' || outcome[i] === 'blackjack');
  g.history.push({ hand: g.hand, dealerTotal: dv, dealerBust: dBust, winners, outcome });
  if (g.history.length > 30) g.history.splice(0, g.history.length - 30);
  pushLog(g, { t: 'result', hand: g.hand, dealerTotal: dv, winners });
}
export function playerOptions(room, i) {
  const g = room.g, cur = g.cur; if (!cur || cur.stage !== 'play' || cur.turn !== i) return [];
  const out = [{ k: 'hit', label: '히트 (한 장 더)' }, { k: 'stand', label: '스탠드' }];
  if (cur.cards[i].length === 2 && g.chips[i] >= cur.bets[i]) out.push({ k: 'double', label: '더블 (+' + cur.bets[i] + ', 한 장만)' });
  return out;
}
const actions = {
  play(ctx) {
    const { room, idx, body } = ctx, g = room.g, cur = g.cur;
    if (g.over || !cur) return { error: '게임이 끝났어요', status: 409 };
    if (cur.stage !== 'play') return { error: '이 판은 끝났어요 — 다음 판을 눌러요', status: 409 };
    if (cur.turn !== idx) return { error: '다른 사람 차례예요', status: 409 };
    const o = playerOptions(room, idx).find((x) => x.k === body.k);
    if (!o) return { error: '그렇게는 못 해요', status: 400 };
    const hand = cur.cards[idx];
    if (o.k === 'double') { g.chips[idx] -= cur.bets[idx]; cur.bets[idx] *= 2; cur.doubled[idx] = true; hand.push(cur.deck.pop()); cur.done[idx] = true; }
    else if (o.k === 'hit') { hand.push(cur.deck.pop()); if (handValue(hand).total >= 21) cur.done[idx] = true; }
    else cur.done[idx] = true;
    pushLog(g, { t: o.k, by: idx, total: handValue(hand).total });
    cur.turn = nextTurn(cur);
    if (cur.turn === null) finish(room, cur);
    ctx.touchRoom = true;
    return null;
  },
  next(ctx) {
    const { room, body } = ctx, g = room.g;
    const h = Number(body.hand);
    if (h < g.hand) return null;
    if (g.over || !g.cur || g.cur.stage !== 'result' || h !== g.hand) return { error: '아직 이 판이 안 끝났어요', status: 409 };
    g.hand++; deal(room); ctx.touchRoom = true;
    return null;
  },
};
function onOut(room, idx) {
  const g = room.g, cur = g.cur;
  if (!cur || cur.stage !== 'play' || cur.done[idx] === undefined) return;
  cur.done[idx] = true;
  if (cur.turn === idx) { cur.turn = nextTurn(cur); if (cur.turn === null) finish(room, cur); }
}
function view(ctx) {
  const { room, idx } = ctx, g = room.g, cur = g.cur;
  const done = g.over;
  return {
    stage: done ? 'done' : 'play', hand: g.hand, total: g.total, betSize: g.bet, chips: g.chips,
    turn: cur && cur.stage === 'play' ? cur.turn : null, yourTurn: !!(cur && cur.stage === 'play' && cur.turn === idx),
    step: cur ? cur.stage : null, seats: cur ? cur.seats : [],
    cards: cur ? cur.cards : {}, totals: cur ? Object.fromEntries(cur.seats.map((i) => [i, handValue(cur.cards[i])])) : {},
    bets: cur ? cur.bets : {}, done: cur ? cur.done : {}, doubled: cur ? cur.doubled : {},
    dealer: cur ? (cur.stage === 'result' ? cur.dealer : [cur.dealer[0], null]) : [],
    dealerTotal: cur && cur.stage === 'result' ? handValue(cur.dealer).total : null,
    options: cur ? playerOptions(room, idx) : [],
    result: cur && cur.stage === 'result' ? cur.result : null, log: g.log.slice(-12), history: g.history,
    winners: done ? winnersOf(room) : null, rank: done ? ranking(room.players.map((_, i) => (room.out && room.out[i] ? null : g.chips[i]))) : null,
  };
}
function winnersOf(room) {
  const g = room.g, seats = room.players.map((_, i) => i).filter((i) => !(room.out && room.out[i]));
  const best = Math.max(...seats.map((i) => g.chips[i]));
  return seats.filter((i) => g.chips[i] === best);
}
/* 기본 전략 */
export function basicMove(hand, upId, canDouble) {
  const v = handValue(hand), upV = rankOf(upId) === 12 ? 11 : Math.min(10, rankOf(upId) + 2);
  if (v.soft && hand.length === 2) {
    if (v.total >= 19) return 'stand';
    if (v.total === 18) return upV >= 9 ? 'hit' : (canDouble && upV >= 3 && upV <= 6 ? 'double' : 'stand');
    if (canDouble && upV >= 4 && upV <= 6) return 'double';
    return 'hit';
  }
  if (v.soft && v.total >= 18) return 'stand';
  if (v.soft) return 'hit';
  if (canDouble && v.total === 11) return 'double';
  if (canDouble && v.total === 10 && upV <= 9) return 'double';
  if (canDouble && v.total === 9 && upV >= 3 && upV <= 6) return 'double';
  if (v.total >= 17) return 'stand';
  if (v.total >= 13) return upV >= 7 ? 'hit' : 'stand';
  if (v.total === 12) return upV >= 4 && upV <= 6 ? 'stand' : 'hit';
  return 'hit';
}
export function botMove(ctx) {
  const { room, idx } = ctx, g = room.g, cur = g.cur;
  if (g.over || !cur) return null;
  if (cur.stage === 'result') {
    const humans = room.players.map((_, i) => i).filter((i) => !room.players[i].bot && !(room.out && room.out[i]));
    return humans.length ? null : { act: 'next', body: { hand: g.hand } };
  }
  if (cur.turn !== idx) return null;
  const opts = playerOptions(room, idx), canDouble = opts.some((o) => o.k === 'double');
  let k = basicMove(cur.cards[idx], cur.dealer[0], canDouble);
  if (!opts.some((o) => o.k === k)) k = k === 'double' ? 'hit' : 'stand';
  return { act: 'play', body: { k } };
}
export const partyBlackjack = {
  setup, view, actions, options, onOut, bot: botMove, teamOptions: [0],
  finished: (ctx) => ctx.room.g.over,
};
export const handle = (body, store, now) => handleParty(partyBlackjack, body, store, now);
