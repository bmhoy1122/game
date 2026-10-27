/* 여럿이 향신료 시장 (2~8명) — 자이푸르 방식, party-kit 위. 규칙은 2인용(spice-core)과 같고 다른 점만:
 *   · 카드 덱을 인원에 맞춰 늘린다: 2명 1벌, 3~4명 2벌, 5~6명 3벌, 7~8명 4벌 (55장 × 벌). 시장 낙타 3장은 한 번만.
 *   · 상품 토큰 더미도 벌 수만큼 겹친다(비싼 값부터 차례로). 보너스 토큰도 벌 수만큼.
 *   · 끝: 상품 토큰 더미 셋이 비거나, 시장을 채워야 하는데 덱이 모자랄 때 (같다).
 *   · 점수: 상품 토큰 + 보너스 + 낙타 보너스 5점(낙타가 **혼자** 가장 많은 사람). 가장 높은 사람이 이긴다 —
 *     같으면 보너스 토큰 개수 → 상품 토큰 개수 → 공동 우승.
 *   · 기권한 사람의 손패·낙타는 그대로 두고 차례에서만 뺀다.
 * 손패·덱은 공용 문서에 두고 view 가 내 것만 보낸다(남은 장수만). 보너스 값은 끝날 때까지 개수만.
 */
import { handleParty, turnSeat, ranking, roundRng, shuffle } from './party-kit.mjs';

export const GOODS = ['d', 'g', 's', 'c', 'p', 'l'];
export const CAMEL = 'k';
export const NAME = { d: '다이아', g: '금', s: '은', c: '비단', p: '향신료', l: '가죽', k: '낙타' };
export const COUNTS = { d: 6, g: 6, s: 6, c: 8, p: 8, l: 10, k: 11 };
export const TOKENS = {
  d: [7, 7, 5, 5, 5], g: [6, 6, 5, 5, 5], s: [5, 5, 5, 5, 5],
  c: [5, 3, 3, 2, 2, 1, 1], p: [5, 3, 3, 2, 2, 1, 1], l: [4, 3, 2, 1, 1, 1, 1, 1, 1],
};
export const BONUS = { 3: [1, 1, 2, 2, 2, 3, 3], 4: [4, 4, 5, 5, 6, 6], 5: [8, 8, 9, 10, 10] };
export const PRECIOUS = ['d', 'g', 's'];
export const HAND_MAX = 7, MARKET = 5, CAMEL_BONUS = 5;
const ORDER = [...GOODS, CAMEL];
export const decksFor = (n) => Math.max(1, Math.ceil(n / 2));

const isGood = (t) => GOODS.includes(t);
const minSell = (t) => (PRECIOUS.includes(t) ? 2 : 1);
const bonusKey = (n) => (n >= 5 ? 5 : n === 4 ? 4 : n === 3 ? 3 : 0);
const sortHand = (h) => h.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
export function countBy(arr) { const o = {}; for (const t of arr) o[t] = (o[t] || 0) + 1; return o; }

function setup(room) {
  const rnd = roundRng(room), n = room.players.length, decks = decksFor(n);
  const cards = [];
  for (let d = 0; d < decks; d++) for (const t of ORDER) for (let i = 0; i < COUNTS[t]; i++) cards.push(t);
  cards.splice(cards.indexOf(CAMEL), 3);
  const deck = shuffle(cards, rnd);
  const tokens = {}, bonus = {};
  for (const t of GOODS) { tokens[t] = []; for (let d = 0; d < decks; d++) tokens[t].push(...TOKENS[t]); tokens[t].sort((a, b) => b - a); }
  for (const k of [3, 4, 5]) { bonus[k] = []; for (let d = 0; d < decks; d++) bonus[k].push(...BONUS[k]); bonus[k] = shuffle(bonus[k], rnd); }
  const g = {
    decks, deck, market: [CAMEL, CAMEL, CAMEL, deck.pop(), deck.pop()],
    hands: room.players.map(() => []), herds: room.players.map(() => 0),
    tokens, bonus, won: room.players.map(() => ({ goods: [], bonus: [] })),
    n: 0, over: null, last: null, log: [],
  };
  for (let i = 0; i < 5; i++) for (let p = 0; p < n; p++) g.hands[p].push(deck.pop());
  for (let p = 0; p < n; p++) {
    g.herds[p] = g.hands[p].filter((t) => t === CAMEL).length;
    g.hands[p] = sortHand(g.hands[p].filter((t) => t !== CAMEL));
  }
  room.g = g;
}
function refill(g) {
  while (g.market.length < MARKET && g.deck.length) g.market.push(g.deck.pop());
  if (g.market.length < MARKET) g.over = g.over || 'deck';
}
const emptyPiles = (g) => GOODS.filter((t) => !g.tokens[t].length).length;

export function score(g, p, active) {
  const w = g.won[p];
  const goods = w.goods.reduce((s, x) => s + x.v, 0), bonus = w.bonus.reduce((s, x) => s + x.v, 0);
  const others = active.filter((i) => i !== p).map((i) => g.herds[i]);
  const camel = g.herds[p] > 0 && others.every((h) => g.herds[p] > h) ? CAMEL_BONUS : 0;
  return { goods, bonus, camel, total: goods + bonus + camel, goodsN: w.goods.length, bonusN: w.bonus.length };
}
export function winnersOf(g, active) {
  const sc = active.map((i) => ({ i, s: score(g, i, active) }));
  let best = sc;
  for (const k of ['total', 'bonusN', 'goodsN']) { const m = Math.max(...best.map((x) => x.s[k])); best = best.filter((x) => x.s[k] === m); }
  return best.map((x) => x.i);
}

export function status(ctx) {
  const { room, active } = ctx, g = room.g;
  const over = g.over || (active.length <= 1 ? 'alone' : null);
  if (over) return { phase: 'done', turn: null, winners: winnersOf(g, active), reason: over };
  return { phase: 'play', turn: turnSeat(room, g.n), winners: null, reason: null };
}

function view(ctx) {
  const { room, idx, active } = ctx, g = room.g, s = status(ctx);
  const tokens = {}; for (const t of GOODS) tokens[t] = g.tokens[t].slice();
  const seats = room.players.map((_, p) => ({
    hand: g.hands[p].length, herd: g.herds[p],
    goods: g.won[p].goods.map((x) => x.v), goodsSum: g.won[p].goods.reduce((a, x) => a + x.v, 0), bonus: g.won[p].bonus.length,
  }));
  const out = {
    stage: s.phase, turn: s.turn, yourTurn: s.phase === 'play' && s.turn === idx, winners: s.winners, reason: s.reason,
    market: g.market.slice(), deck: g.deck.length, decks: g.decks,
    hand: g.hands[idx].slice(), herd: g.herds[idx], seats, tokens,
    bonusLeft: { 3: g.bonus[3].length, 4: g.bonus[4].length, 5: g.bonus[5].length },
    emptyPiles: emptyPiles(g), moves: g.n, last: g.last, log: g.log.slice(-10),
  };
  if (s.phase === 'done') {
    out.final = room.players.map((_, p) => (active.includes(p) ? { ...score(g, p, active), bonusVals: g.won[p].bonus.map((x) => x.v), hand: g.hands[p].slice() } : null));
    out.rank = ranking(out.final.map((f) => (f ? f.total : null)));
  }
  return out;
}

function turnCheck(ctx) {
  const s = status(ctx);
  if (s.phase !== 'play') return { error: '게임이 끝났어요', status: 409 };
  if (s.turn !== ctx.idx) return { error: '다른 사람 차례예요', status: 409 };
  return null;
}
function finish(ctx, last) {
  const g = ctx.room.g;
  last.by = ctx.idx; last.at = g.n; g.last = last; g.log.push(last);
  if (g.log.length > 40) g.log.splice(0, g.log.length - 40);
  g.n++;
  if (emptyPiles(g) >= 3) g.over = g.over || 'tokens';
  ctx.touchRoom = true;
  return null;
}
const isIdxList = (v, len) => Array.isArray(v) && v.every((i) => Number.isInteger(i) && i >= 0 && i < len) && new Set(v).size === v.length;

const actions = {
  take(ctx) {
    const e = turnCheck(ctx); if (e) return e;
    const g = ctx.room.g, hand = g.hands[ctx.idx], i = ctx.body.card;
    if (!Number.isInteger(i) || i < 0 || i >= g.market.length) return { error: '가져올 시장 카드를 골라주세요', status: 400 };
    const t = g.market[i];
    if (t === CAMEL) return { error: '낙타는 한 장만 못 가져와요. "낙타 전부"를 눌러요', status: 400 };
    if (hand.length >= HAND_MAX) return { error: '손에 7장이 꽉 찼어요. 먼저 팔거나 교환해요', status: 409 };
    g.market.splice(i, 1); hand.push(t); sortHand(hand); refill(g);
    return finish(ctx, { kind: 'take', type: t });
  },
  camels(ctx) {
    const e = turnCheck(ctx); if (e) return e;
    const g = ctx.room.g, n = g.market.filter((t) => t === CAMEL).length;
    if (!n) return { error: '시장에 낙타가 없어요', status: 409 };
    g.market = g.market.filter((t) => t !== CAMEL); g.herds[ctx.idx] += n; refill(g);
    return finish(ctx, { kind: 'camels', n });
  },
  trade(ctx) {
    const e = turnCheck(ctx); if (e) return e;
    const g = ctx.room.g, hand = g.hands[ctx.idx], { take, give } = ctx.body;
    const camels = ctx.body.camels === undefined ? 0 : ctx.body.camels;
    if (!isIdxList(take, g.market.length)) return { error: '가져올 시장 카드를 골라주세요', status: 400 };
    if (!isIdxList(give || [], hand.length)) return { error: '줄 카드를 골라주세요', status: 400 };
    if (!Number.isInteger(camels) || camels < 0) return { error: '낙타 수가 이상해요', status: 400 };
    const giveH = give || [];
    if (take.length < 2) return { error: '교환은 시장 카드를 2장 이상 가져와야 해요 (1장은 "가져오기")', status: 400 };
    const takeT = take.map((i) => g.market[i]);
    if (takeT.includes(CAMEL)) return { error: '시장 낙타는 교환으로 못 가져와요', status: 400 };
    if (camels > g.herds[ctx.idx]) return { error: '낙타가 그만큼 없어요', status: 400 };
    if (giveH.length + camels !== take.length) return { error: `가져올 ${take.length}장만큼 내 카드/낙타를 골라주세요 (지금 ${giveH.length + camels}장)`, status: 400 };
    const giveT = giveH.map((i) => hand[i]);
    const same = takeT.find((t) => giveT.includes(t));
    if (same) return { error: `같은 종류(${NAME[same]})는 주고받을 수 없어요`, status: 400 };
    if (hand.length - giveH.length + take.length > HAND_MAX) return { error: '바꾸고 나면 손이 7장을 넘어요. 낙타를 더 써요', status: 409 };
    const out = giveT.concat(Array(camels).fill(CAMEL));
    take.forEach((mi, k) => { g.market[mi] = out[k]; });
    g.hands[ctx.idx] = sortHand(hand.filter((_, i) => !giveH.includes(i)).concat(takeT));
    g.herds[ctx.idx] -= camels;
    return finish(ctx, { kind: 'trade', got: sortHand(takeT.slice()), gave: sortHand(out.slice()) });
  },
  sell(ctx) {
    const e = turnCheck(ctx); if (e) return e;
    const g = ctx.room.g, hand = g.hands[ctx.idx], t = ctx.body.type, n = ctx.body.n;
    if (!isGood(t)) return { error: '팔 상품을 골라주세요', status: 400 };
    const have = hand.filter((x) => x === t).length;
    if (!Number.isInteger(n) || n < 1) return { error: '몇 장 팔지 골라주세요', status: 400 };
    if (n > have) return { error: `${NAME[t]}가 ${have}장뿐이에요`, status: 400 };
    if (n < minSell(t)) return { error: `${NAME[t]}는 2장 이상 모아야 팔 수 있어요`, status: 400 };
    let left = n;
    g.hands[ctx.idx] = hand.filter((x) => (x === t && left > 0 ? (left--, false) : true));
    const got = g.tokens[t].splice(0, n);
    got.forEach((v) => g.won[ctx.idx].goods.push({ t, v }));
    const bk = bonusKey(n); let bonus = false;
    if (bk && g.bonus[bk].length) { g.won[ctx.idx].bonus.push({ k: bk, v: g.bonus[bk].shift() }); bonus = true; }
    return finish(ctx, { kind: 'sell', type: t, n, gain: got.reduce((a, v) => a + v, 0), tokens: got.length, bonus, bk });
  },
};

/* 봇 — 2인용과 같은 욕심쟁이 */
const nextVals = (g, t, n) => g.tokens[t].slice(0, n).reduce((a, v) => a + v, 0);
const BONUS_EXP = { 3: 2, 4: 5, 5: 9 };
const sellValue = (g, t, n) => { const bk = bonusKey(n); return nextVals(g, t, n) + (bk && g.bonus[bk].length ? BONUS_EXP[bk] : 0); };
export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const g = ctx.room.g, hand = g.hands[ctx.idx], market = g.market;
  const cnt = countBy(hand), mc = countBy(market), camelsM = mc[CAMEL] || 0, full = hand.length >= HAND_MAX;
  const sells = GOODS.filter((t) => (cnt[t] || 0) >= minSell(t)).map((t) => ({ t, n: cnt[t], v: sellValue(g, t, cnt[t]) })).sort((a, b) => b.v - a.v);
  const ready = sells.filter(({ t, n }) => {
    if (!g.tokens[t].length) return n >= 3 && g.bonus[bonusKey(n)] && g.bonus[bonusKey(n)].length;
    if (PRECIOUS.includes(t)) return n >= 3 || g.tokens[t].length <= 2 || rnd() < 0.55;
    return n >= 4 || (n >= 3 && rnd() < 0.75) || g.tokens[t].length <= 1;
  });
  if (ready.length) return { act: 'sell', body: { type: ready[0].t, n: ready[0].n } };
  if (full && sells.length && !(camelsM >= 3)) return { act: 'sell', body: { type: sells[0].t, n: sells[0].n } };
  if (camelsM >= 3 || (camelsM >= 2 && hand.length >= 6 && rnd() < 0.5)) return { act: 'camels', body: {} };
  if (rnd() < 0.35) {
    const want = market.map((t, i) => ({ t, i })).filter(({ t }) => isGood(t) && ((cnt[t] || 0) >= 1 || PRECIOUS.includes(t)));
    const wantT = new Set(want.map((x) => x.t));
    const junk = hand.map((t, i) => ({ t, i })).filter(({ t }) => cnt[t] === 1 && !PRECIOUS.includes(t) && !wantT.has(t));
    const k = Math.min(want.length, junk.length + Math.max(0, g.herds[ctx.idx] - 1));
    if (k >= 2) {
      const take = want.slice(0, k).map((x) => x.i), give = junk.slice(0, k).map((x) => x.i), camels = k - give.length;
      if (hand.length - give.length + k <= HAND_MAX) return { act: 'trade', body: { take, give, camels } };
    }
  }
  if (!full) {
    const opts = market.map((t, i) => ({ t, i })).filter(({ t }) => isGood(t));
    if (opts.length) {
      if (rnd() < 0.2) return { act: 'take', body: { card: opts[Math.floor(rnd() * opts.length)].i } };
      let best = null, bv = -1;
      for (const { t, i } of opts) { const v = (g.tokens[t][cnt[t] || 0] || 0) + 2.2 * (cnt[t] || 0) + rnd() * 1.5; if (v > bv) { bv = v; best = i; } }
      return { act: 'take', body: { card: best } };
    }
  }
  if (camelsM) return { act: 'camels', body: {} };
  if (sells.length) return { act: 'sell', body: { type: sells[0].t, n: sells[0].n } };
  return null;
}

export const partySpice = { setup, view, actions, bot: botMove, finished: (ctx) => status(ctx).phase === 'done' };
export const handle = (body, store, now) => handleParty(partySpice, body, store, now);
