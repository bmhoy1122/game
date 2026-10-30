/* 섯다 (2~8명) — party-kit 위. 화투 1~10월 20장으로 두 장 섯다.
 *
 * 카드 id 0..19: 월 = ⌊id/2⌋+1, 변형 k = id%2. k=0 이 특별한 패 — 1·3·8월은 광, 4·7월은 열끗(새). 나머지는 띠/피지만 섯다에선 다 같다.
 * 족보(높은 순): 38광땡 > 13광땡 > 18광땡 > 장땡(10) > 9땡 … 1땡 > 알리(1·2) > 독사(1·4) > 구삥(1·9) > 장삥(1·10) > 장사(4·10) > 세륙(4·6)
 *               > 갑오(9끗) > 8끗 … 1끗 > 망통(0끗).  끗 = 두 달의 합 % 10.
 * 특수: 암행어사(4열끗+7열끗) 는 13·18광땡을 잡는다(38광땡엔 진다, 그 외엔 1끗). 땡잡이(3광+7열끗) 는 1~9땡을 잡는다(장땡·광땡엔 못 이기고,
 *       그 외엔 망통). 구사(4·9): 판에 남아 있고 이긴 패가 알리보다 낮으면 재경기(판돈 그대로 다음 판으로). 멍텅구리구사(4열끗+9) 는 장땡 미만이면 재경기.
 *
 * 한 게임 = 여러 판(방 만들 때 5·10·15, 기본 10). 시작 칩 300, 판마다 기본 5씩 낸다. 칩이 0 이면 그 판부터 구경.
 * 판: 두 장 돌림 → 베팅 한 바퀴(딜러 다음부터) → 공개. 베팅: 체크/콜 · 삥(기본 5) · 따당(직전 올린 것의 2배) · 하프(판돈 절반) · 풀(판돈) · 다이.
 *   올리기는 판마다 3번까지. 칩이 모자라면 있는 만큼 콜(올인) — 사이드팟은 없다(가볍게 하는 게임이라 전부 걸고 받는다).
 *   모두 다이하면 남은 한 명이 가져간다. 공개 뒤 '다음 판'은 아무나(멱등). 마지막 판이 끝나거나 칩 가진 사람이 한 명이면 끝 — 칩 많은 순.
 * 봇: 패 세기로 베팅 — 땡 이상이면 세게, 알리~갑오는 콜·가끔 삥, 낮으면 체크 아니면 다이(콜 금액이 작으면 콜).
 */
import { handleParty, ranking, shuffle, seeded } from './party-kit.mjs';

export const month = (id) => Math.floor(id / 2) + 1;
export const isGwang = (id) => id % 2 === 0 && [1, 3, 8].includes(month(id));
export const isBird = (id) => id % 2 === 0 && [4, 7].includes(month(id));     // 4·7월 열끗
export const COUNTS = [5, 10, 15], DEFAULT_COUNT = 10, START_CHIPS = 300, ANTE = 5, MAX_RAISES = 3;

/* 족보 — v 가 클수록 세다. 이름·설명은 화면 표에도 쓴다 */
export const JOKBO = [
  { k: 'g38', name: '38광땡', v: 1000, d: '3월 광 + 8월 광' }, { k: 'g13', name: '13광땡', v: 900, d: '1월 광 + 3월 광' }, { k: 'g18', name: '18광땡', v: 890, d: '1월 광 + 8월 광' },
  { k: 't10', name: '장땡', v: 810, d: '10 · 10' }, { k: 't9', name: '9땡', v: 809 }, { k: 't8', name: '8땡', v: 808 }, { k: 't7', name: '7땡', v: 807 }, { k: 't6', name: '6땡', v: 806 },
  { k: 't5', name: '5땡', v: 805 }, { k: 't4', name: '4땡', v: 804 }, { k: 't3', name: '3땡', v: 803 }, { k: 't2', name: '2땡', v: 802 }, { k: 't1', name: '1땡', v: 801 },
  { k: 'ali', name: '알리', v: 700, d: '1 · 2' }, { k: 'dok', name: '독사', v: 690, d: '1 · 4' }, { k: 'gu', name: '구삥', v: 680, d: '1 · 9' }, { k: 'jang', name: '장삥', v: 670, d: '1 · 10' },
  { k: 'js', name: '장사', v: 660, d: '4 · 10' }, { k: 'sr', name: '세륙', v: 650, d: '4 · 6' },
  { k: 'k9', name: '갑오 (9끗)', v: 509, d: '합이 9' }, { k: 'k8', name: '8끗', v: 508 }, { k: 'k7', name: '7끗', v: 507 }, { k: 'k6', name: '6끗', v: 506 }, { k: 'k5', name: '5끗', v: 505 },
  { k: 'k4', name: '4끗', v: 504 }, { k: 'k3', name: '3끗', v: 503 }, { k: 'k2', name: '2끗', v: 502 }, { k: 'k1', name: '1끗', v: 501 }, { k: 'k0', name: '망통', v: 500, d: '합이 0' },
];
export const SPECIALS = [
  { k: 'amhaeng', name: '암행어사', d: '4월 열끗 + 7월 열끗 — 13·18광땡을 잡아요 (38광땡엔 져요). 그 외엔 1끗' },
  { k: 'ttaengjab', name: '땡잡이', d: '3월 광 + 7월 열끗 — 1~9땡을 잡아요 (장땡·광땡엔 못 이겨요). 그 외엔 망통' },
  { k: 'gusa', name: '구사', d: '4 · 9 — 끝까지 남았는데 이긴 패가 알리보다 낮으면 재경기' },
  { k: 'mgusa', name: '멍텅구리 구사', d: '4월 열끗 + 9 — 이긴 패가 장땡보다 낮으면 재경기' },
];
const J = Object.fromEntries(JOKBO.map((j) => [j.k, j]));

/* 두 장의 족보 — { k, name, v, special? } */
export function handRank(a, b) {
  const [x, y] = [a, b].map(month).sort((p, q) => p - q);
  const gw = isGwang(a) && isGwang(b);
  if (gw && x === 3 && y === 8) return J.g38;
  if (gw && x === 1 && y === 3) return J.g13;
  if (gw && x === 1 && y === 8) return J.g18;
  let base;
  if (x === y) base = J['t' + x];
  else if (x === 1 && y === 2) base = J.ali;
  else if (x === 1 && y === 4) base = J.dok;
  else if (x === 1 && y === 9) base = J.gu;
  else if (x === 1 && y === 10) base = J.jang;
  else if (x === 4 && y === 10) base = J.js;
  else if (x === 4 && y === 6) base = J.sr;
  else base = J['k' + ((x + y) % 10)];
  const birds = [a, b].filter(isBird).length;
  if (x === 4 && y === 7 && birds === 2) return { ...base, special: 'amhaeng', name: '암행어사 (1끗)' };
  if (x === 3 && y === 7 && (isGwang(a) || isGwang(b)) && birds === 1) return { ...base, special: 'ttaengjab', name: '땡잡이 (망통)' };
  if (x === 4 && y === 9) return { ...base, special: birds ? 'mgusa' : 'gusa', name: base.name + (birds ? ' · 멍텅구리구사' : ' · 구사') };
  return base;
}
/* 남은 사람들 중 이긴 자리들(공동 가능) 과 재경기 여부 */
export function showdown(hands, seats) {
  const ranks = seats.map((i) => handRank(hands[i][0], hands[i][1]));
  let bestV = Math.max(...ranks.map((r) => r.v));
  let winners = seats.filter((_, k) => ranks[k].v === bestV);
  const top = ranks.find((r) => r.v === bestV);
  // 땡잡이: 1~9땡이 이기고 있을 때 / 암행어사: 13·18광땡이 이기고 있을 때
  if (top.v >= 801 && top.v <= 809) { const tj = seats.filter((_, k) => ranks[k].special === 'ttaengjab'); if (tj.length) winners = tj; }
  if (top.v === 900 || top.v === 890) { const am = seats.filter((_, k) => ranks[k].special === 'amhaeng'); if (am.length) winners = am; }
  const wv = handRank(hands[winners[0]][0], hands[winners[0]][1]).v;
  const redeal = seats.some((i, k) => (ranks[k].special === 'gusa' && wv < 700) || (ranks[k].special === 'mgusa' && wv < 810));
  return { winners, redeal, ranks };
}

function options(body) { const c = Number(body.count); return { count: COUNTS.includes(c) ? c : DEFAULT_COUNT }; }
function setup(room) {
  const np = room.players.length;
  room.g = { chips: Array(np).fill(START_CHIPS), hand: 0, total: (room.opts && COUNTS.includes(room.opts.count)) ? room.opts.count : DEFAULT_COUNT, carry: 0, hands: null, log: [], history: [], over: false };
  deal(room);
}
const alive = (room, i) => !(room.out && room.out[i]) && room.g.chips[i] > 0;
const livingSeats = (room) => room.players.map((_, i) => i).filter((i) => alive(room, i));
function deal(room) {
  const g = room.g, seats = livingSeats(room);
  if (seats.length <= 1 || g.hand >= g.total) { g.over = true; g.cur = null; return; }
  const deck = shuffle([...Array(20)].map((_, i) => i), seeded(`${room.code}:${room.round}:h${g.hand}`));
  const dealer = seats[(room.first + g.hand) % seats.length];
  const order = [...seats.slice(seats.indexOf(dealer) + 1), ...seats.slice(0, seats.indexOf(dealer) + 1)];   // 딜러 다음부터, 딜러 마지막
  const cards = {}; let pot = g.carry; g.carry = 0;
  const bet = {}, folded = {}, acted = {};
  const allin = {};
  for (const i of seats) { cards[i] = [deck.pop(), deck.pop()]; const a = Math.min(ANTE, g.chips[i]); g.chips[i] -= a; pot += a; bet[i] = 0; folded[i] = false; acted[i] = false; if (g.chips[i] === 0) allin[i] = true; }
  g.cur = { dealer, order, seats, cards, pot, bet, folded, acted, toCall: 0, lastRaise: ANTE, raises: 0, turnK: 0, stage: 'bet', result: null, allin };
  pushLog(g, { t: 'deal', hand: g.hand, dealer });
}
const pushLog = (g, e) => { g.log.push(e); if (g.log.length > 24) g.log.splice(0, g.log.length - 24); };
/* 지금 행동할 자리 — order 를 돌며 다이·올인 아닌 사람 중 아직 콜을 못 맞췄거나 행동 안 한 사람 */
function nextTurn(cur) {
  const live = cur.seats.filter((i) => !cur.folded[i]);
  if (live.length <= 1) return null;
  if (live.every((i) => cur.allin[i])) return null;                          // 다 올인이면 바로 공개
  for (let k = 0; k < cur.order.length; k++) {
    const i = cur.order[(cur.turnK + k) % cur.order.length];
    if (cur.folded[i] || cur.allin[i]) continue;
    if (!cur.acted[i] || cur.bet[i] < cur.toCall) return i;
  }
  return null;
}
/* 베팅이 끝났는지 보고 공개 */
function settleIfDone(room) {
  const g = room.g, cur = g.cur;
  const t = nextTurn(cur);
  if (t !== null) return;
  const live = cur.seats.filter((i) => !cur.folded[i]);
  let res;
  if (live.length === 1) { res = { winners: live, redeal: false, byFold: true, ranks: null }; }
  else {
    const sd = showdown(cur.cards, live);
    res = { winners: sd.winners, redeal: sd.redeal, byFold: false, ranks: Object.fromEntries(live.map((i, k) => [i, sd.ranks[k]])) };
  }
  if (res.redeal) { g.carry = cur.pot; pushLog(g, { t: 'redeal', hand: g.hand }); }
  else {
    const share = Math.floor(cur.pot / res.winners.length); let rest = cur.pot - share * res.winners.length;
    for (const w of res.winners) { g.chips[w] += share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; }
    pushLog(g, { t: 'win', hand: g.hand, winners: res.winners, pot: cur.pot, name: res.ranks ? res.ranks[res.winners[0]].name : null });
  }
  cur.result = { ...res, pot: cur.pot, reveal: Object.fromEntries(live.map((i) => [i, cur.cards[i]])) };
  cur.stage = 'result';
  g.history.push({ hand: g.hand, winners: res.winners, pot: cur.pot, name: res.ranks ? res.ranks[res.winners[0]].name : (res.redeal ? '재경기' : '모두 다이'), redeal: res.redeal });
  if (g.history.length > 30) g.history.splice(0, g.history.length - 30);
}
/* 지금 할 수 있는 베팅 — [{k, label, add}] add = 내가 더 내는 칩 */
export function betOptions(room, i) {
  const g = room.g, cur = g.cur; if (!cur || cur.stage !== 'bet') return [];
  const need = cur.toCall - cur.bet[i], chips = g.chips[i], out = [];
  if (need <= 0) out.push({ k: 'check', label: '체크', add: 0 });
  else out.push({ k: 'call', label: need >= chips ? '올인 콜 ' + chips : '콜 ' + need, add: Math.min(need, chips) });
  if (cur.raises < MAX_RAISES && chips > need) {
    const cands = [['ping', '삥', ANTE], ['ddadang', '따당', cur.lastRaise * 2], ['half', '하프', Math.max(ANTE, Math.ceil(cur.pot / 2))], ['full', '풀', Math.max(ANTE, cur.pot)]];
    const seen = new Set();
    for (const [k, label, r] of cands) { const add = Math.min(need + r, chips); if (seen.has(add) || add <= need) continue; seen.add(add); out.push({ k, label: label + ' +' + (add - need), add, raise: add - need }); }
  }
  out.push({ k: 'fold', label: '다이', add: 0 });
  return out;
}

const actions = {
  bet(ctx) {
    const { room, idx, body } = ctx, g = room.g, cur = g.cur;
    if (g.over || !cur) return { error: '게임이 끝났어요', status: 409 };
    if (cur.stage !== 'bet') return { error: '공개됐어요 — 다음 판을 눌러요', status: 409 };
    if (nextTurn(cur) !== idx) return { error: '다른 사람 차례예요', status: 409 };
    const opts = betOptions(room, idx), o = opts.find((x) => x.k === body.k);
    if (!o) return { error: '그렇게는 못 걸어요', status: 400 };
    if (o.k === 'fold') { cur.folded[idx] = true; pushLog(g, { t: 'fold', by: idx }); }
    else {
      g.chips[idx] -= o.add; cur.bet[idx] += o.add; cur.pot += o.add;
      if (o.raise) { cur.toCall = cur.bet[idx]; cur.lastRaise = o.raise; cur.raises++; }
      if (g.chips[idx] === 0) cur.allin[idx] = true;
      pushLog(g, { t: o.k, by: idx, add: o.add });
    }
    cur.acted[idx] = true;
    cur.turnK = (cur.order.indexOf(idx) + 1) % cur.order.length;
    settleIfDone(room);
    ctx.touchRoom = true;
    return null;
  },
  next(ctx) {
    const { room, body } = ctx, g = room.g;
    const h = Number(body.hand);
    if (h < g.hand) return null;                                  // 누가 먼저 넘겼다
    if (g.over || !g.cur || g.cur.stage !== 'result' || h !== g.hand) return { error: '아직 이 판이 안 끝났어요', status: 409 };
    g.hand++; deal(room); ctx.touchRoom = true;
    return null;
  },
};
function onOut(room, idx) {
  const g = room.g, cur = g.cur;
  if (!cur || cur.stage !== 'bet' || cur.folded[idx] === undefined) return;
  cur.folded[idx] = true; cur.acted[idx] = true;
  settleIfDone(room);
}

function view(ctx) {
  const { room, idx } = ctx, g = room.g, cur = g.cur;
  const done = g.over;
  const turn = cur && cur.stage === 'bet' ? nextTurn(cur) : null;
  const mine = cur && cur.cards[idx] ? cur.cards[idx] : null;
  return {
    stage: done ? 'done' : 'play', hand: g.hand, total: g.total, chips: g.chips, turn, yourTurn: turn === idx,
    pot: cur ? cur.pot : 0, carry: g.carry, dealer: cur ? cur.dealer : null, seats: cur ? cur.seats : [], step: cur ? cur.stage : null,
    bets: cur ? cur.bet : {}, folded: cur ? cur.folded : {}, toCall: cur ? cur.toCall : 0, allin: cur ? cur.allin : {},
    mine, myRank: mine ? handRank(mine[0], mine[1]) : null, options: turn === idx ? betOptions(room, idx) : [],
    result: cur && cur.stage === 'result' ? cur.result : null, log: g.log.slice(-12), history: g.history,
    winners: done ? winnersOf(room) : null, rank: done ? ranking(room.players.map((_, i) => (room.out && room.out[i] ? null : g.chips[i]))) : null,
  };
}
function winnersOf(room) {
  const g = room.g, seats = room.players.map((_, i) => i).filter((i) => !(room.out && room.out[i]));
  const best = Math.max(...seats.map((i) => g.chips[i]));
  return seats.filter((i) => g.chips[i] === best);
}
export function botMove(ctx, rnd) {
  const { room, idx } = ctx, g = room.g, cur = g.cur;
  if (g.over || !cur) return null;
  if (cur.stage === 'result') {
    const humans = cur.seats.filter((i) => !room.players[i].bot && !(room.out && room.out[i]));
    return humans.length ? null : { act: 'next', body: { hand: g.hand } };
  }
  if (nextTurn(cur) !== idx) return null;
  const r = rnd || seeded(`${room.code}:${room.round}:${g.hand}:${idx}:${cur.raises}:${cur.turnK}`);
  const v = handRank(cur.cards[idx][0], cur.cards[idx][1]).v, opts = betOptions(room, idx);
  const pick = (k) => opts.find((o) => o.k === k);
  const need = cur.toCall - cur.bet[idx];
  const callish = pick('check') || pick('call');
  const go = (o) => ({ act: 'bet', body: { k: (o || callish || pick('fold')).k } });
  if (v >= 801) return go(pick('full') || pick('half') || pick('ddadang'));                       // 땡 이상 — 세게
  if (v >= 650) return go(r() < 0.4 ? (pick('half') || pick('ping')) : callish);                 // 알리~세륙 — 콜, 가끔 올리기
  if (v >= 506) return go(r() < 0.25 ? pick('ping') : (need <= Math.max(10, g.chips[idx] * 0.25) ? callish : pick('fold')));   // 6끗~갑오
  if (need <= 0) return go(r() < 0.12 ? pick('ping') : pick('check'));                            // 낮은 패 — 공짜면 본다
  return go(need <= ANTE && r() < 0.35 ? callish : pick('fold'));
}

export const partySeotda = {
  setup, view, actions, options, onOut, bot: botMove, teamOptions: [0],
  finished: (ctx) => ctx.room.g.over,
};
export const handle = (body, store, now) => handleParty(partySeotda, body, store, now);
