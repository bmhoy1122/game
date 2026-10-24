/* 향신료 시장 — 자이푸르 방식 카드 게임, 한 라운드짜리로 단순화.
 *
 * 카드 55장: 다이아 6 · 금 6 · 은 6 · 비단 8 · 향신료 8 · 가죽 10 · 낙타 11.
 * 시작: 시장에 낙타 3장 + 덱에서 2장. 각자 5장씩, 손에 온 낙타는 바로 자기 낙타 무리로.
 * 차례에 하나만:
 *   take   시장 상품 1장 가져오기 (손은 7장까지)
 *   camels 시장 낙타 전부 가져오기
 *   trade  시장 상품 2장 이상 ↔ 같은 수의 내 손패/낙타. 시장 낙타는 못 가져오고,
 *          같은 종류를 주고받을 수 없고, 손은 7장까지
 *   sell   손의 한 종류를 원하는 만큼 (다이아·금·은은 2장 이상).
 *          판 장수만큼 상품 토큰을 앞(비싼 것)부터, 3/4/5장 이상이면 보너스 토큰 하나
 * 가져온 뒤엔 시장이 5장이 되게 덱에서 채운다.
 * 끝: 상품 토큰 더미 셋이 비거나, 시장을 채워야 하는데 덱이 모자랄 때.
 * 점수: 상품 토큰 + 보너스 토큰 + 낙타가 더 많은 쪽 5점(같으면 아무도 없음).
 *   같으면 보너스 토큰 개수 → 상품 토큰 개수 → 무승부.
 *
 * 원작과 다른 점: 3라운드(인장 2개 먼저) 대신 한 라운드로 끝낸다.
 *
 * 비밀: 상대 손패(장수만), 덱 순서(장수만), 보너스 토큰 값(내 것도 끝날 때까지 개수만).
 * 낙타 수 · 상품 토큰 · 시장은 공개.
 *
 * 모든 행동은 차례제라 공용 문서(room.g)에 쓴다. 손패도 room 에 있지만 view 가 내 것만 보낸다.
 * 기권만 아무 때나 누를 수 있어서 자기 문서에 쓴다. 선공은 first-pick 미니게임으로 정한다.
 */
import { handleRoom, roundRng, shuffle } from './room-kit.mjs';
import { pickKind, firstOf, pickView, pickThrow, pickBot } from './first-pick.mjs';

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

const isGood = (t) => GOODS.includes(t);
const minSell = (t) => (PRECIOUS.includes(t) ? 2 : 1);
const bonusKey = (n) => (n >= 5 ? 5 : n === 4 ? 4 : n === 3 ? 3 : 0);
const sortHand = (h) => h.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
export function countBy(arr) {
  const o = {};
  for (const t of arr) o[t] = (o[t] || 0) + 1;
  return o;
}

/* ---------------------------------------------------------------- 판 준비 */
export function setup(room) {
  const rnd = roundRng(room);
  const cards = [];
  for (const t of ORDER) for (let i = 0; i < COUNTS[t]; i++) cards.push(t);
  cards.splice(cards.indexOf(CAMEL), 3);               // 시장 낙타 3장은 따로
  const deck = shuffle(cards, rnd);
  const bonus = {};
  for (const k of [3, 4, 5]) bonus[k] = shuffle(BONUS[k].slice(), rnd);
  const g = {
    deck, market: [CAMEL, CAMEL, CAMEL, deck.pop(), deck.pop()],
    hands: [[], []], herds: [0, 0],
    tokens: JSON.parse(JSON.stringify(TOKENS)), bonus,
    won: [{ goods: [], bonus: [] }, { goods: [], bonus: [] }],
    n: 0, sold: 0, over: null, last: null, log: [],
  };
  for (let i = 0; i < 5; i++) for (const p of [0, 1]) g.hands[p].push(deck.pop());
  for (const p of [0, 1]) {
    g.herds[p] = g.hands[p].filter((t) => t === CAMEL).length;
    g.hands[p] = sortHand(g.hands[p].filter((t) => t !== CAMEL));
  }
  room.g = g;
}

/* 시장을 5장으로 채운다. 덱이 모자라면 끝 */
function refill(g) {
  while (g.market.length < MARKET && g.deck.length) g.market.push(g.deck.pop());
  if (g.market.length < MARKET) g.over = g.over || 'deck';
}
const emptyPiles = (g) => GOODS.filter((t) => !g.tokens[t].length).length;
function checkTokens(g) {
  if (emptyPiles(g) >= 3) g.over = g.over || 'tokens';
}

/* ---------------------------------------------------------------- 점수 */
export function score(g, p) {
  const w = g.won[p];
  const goods = w.goods.reduce((s, x) => s + x.v, 0);
  const bonus = w.bonus.reduce((s, x) => s + x.v, 0);
  const camel = g.herds[p] > g.herds[1 - p] ? CAMEL_BONUS : 0;
  return { goods, bonus, camel, total: goods + bonus + camel, goodsN: w.goods.length, bonusN: w.bonus.length };
}
/* 0 | 1 | 'draw' */
export function winnerOf(g) {
  const a = score(g, 0), b = score(g, 1);
  for (const k of ['total', 'bonusN', 'goodsN']) if (a[k] !== b[k]) return a[k] > b[k] ? 0 : 1;
  return 'draw';
}

export function status(ctx) {
  const { room, docs, joined } = ctx;
  if (!joined) return { phase: 'wait', first: null };
  const first = firstOf(ctx);
  if (first === null) return { phase: 'pick', first };
  const g = room.g;
  const turn = (first + g.n) % 2;
  let winner = null, reason = null;
  if (g.over) { winner = winnerOf(g); reason = g.over; }
  else {
    const quit = [0, 1].filter((i) => docs[i].resigned);
    if (quit.length) { winner = 1 - quit[0]; reason = 'resign'; }
  }
  return { phase: winner === null ? 'play' : 'done', first, turn, winner, reason };
}

/* ---------------------------------------------------------------- 화면에 줄 것 */
function view(ctx) {
  const { room, idx } = ctx;
  const g = room.g;
  const s = status(ctx);
  const done = s.phase === 'done';
  const o = 1 - idx;
  const pub = (p) => ({
    hand: g.hands[p].length,
    herd: g.herds[p],
    goods: g.won[p].goods.map((x) => x.v),        // 상품 토큰은 공개
    goodsSum: g.won[p].goods.reduce((a, x) => a + x.v, 0),
    bonus: g.won[p].bonus.length,                 // 보너스는 개수만
  });
  const tokens = {};
  for (const t of GOODS) tokens[t] = g.tokens[t].slice();
  const out = {
    phase: s.phase,
    pick: pickView(ctx),
    first: s.first === undefined ? null : s.first,
    turn: s.turn === undefined ? null : s.turn,
    yourTurn: s.phase === 'play' && s.turn === idx,
    winner: s.winner === undefined ? null : s.winner,
    reason: s.reason || null,
    market: g.market.slice(),
    deck: g.deck.length,
    hand: g.hands[idx].slice(),
    herd: g.herds[idx],
    me: pub(idx),
    opp: pub(o),
    tokens,
    bonusLeft: { 3: g.bonus[3].length, 4: g.bonus[4].length, 5: g.bonus[5].length },
    emptyPiles: emptyPiles(g),
    moves: g.n,
    last: g.last,
    log: g.log.slice(-8),
  };
  if (done) {
    // 끝나면 다 공개 — 점수 내역, 보너스 값, 상대 손패
    out.final = { me: score(g, idx), opp: score(g, o), myBonus: g.won[idx].bonus.map((x) => x.v), oppBonus: g.won[o].bonus.map((x) => x.v) };
    out.oppHand = g.hands[o].slice();
  }
  return out;
}

/* ---------------------------------------------------------------- 행동
 * 전부 검사를 먼저 다 하고, 통과했을 때만 판을 고친다 (실패하면 아무것도 안 바뀐다). */
function turnCheck(ctx) {
  const s = status(ctx);
  if (s.phase !== 'play') return { error: '지금은 할 수 없어요', status: 409 };
  if (s.turn !== ctx.idx) return { error: '상대 차례예요', status: 409 };
  return null;
}
function finish(ctx, last) {
  const g = ctx.room.g;
  last.by = ctx.idx;
  last.at = g.n;
  g.last = last;
  g.log.push(last);
  if (g.log.length > 30) g.log.splice(0, g.log.length - 30);
  g.n++;
  checkTokens(g);
  ctx.touchRoom = true;
  return null;
}
const isIdxList = (v, len) => Array.isArray(v) && v.every((i) => Number.isInteger(i) && i >= 0 && i < len) && new Set(v).size === v.length;

const actions = {
  throw: pickThrow,

  take(ctx) {
    const e = turnCheck(ctx); if (e) return e;
    const g = ctx.room.g, hand = g.hands[ctx.idx];
    const i = ctx.body.card;
    if (!Number.isInteger(i) || i < 0 || i >= g.market.length) return { error: '가져올 시장 카드를 골라주세요', status: 400 };
    const t = g.market[i];
    if (t === CAMEL) return { error: '낙타는 한 장만 못 가져와요. "낙타 전부"를 눌러요', status: 400 };
    if (hand.length >= HAND_MAX) return { error: '손에 7장이 꽉 찼어요. 먼저 팔거나 교환해요', status: 409 };
    g.market.splice(i, 1);
    hand.push(t); sortHand(hand);
    refill(g);
    return finish(ctx, { kind: 'take', type: t });
  },

  camels(ctx) {
    const e = turnCheck(ctx); if (e) return e;
    const g = ctx.room.g;
    const n = g.market.filter((t) => t === CAMEL).length;
    if (!n) return { error: '시장에 낙타가 없어요', status: 409 };
    g.market = g.market.filter((t) => t !== CAMEL);
    g.herds[ctx.idx] += n;
    refill(g);
    return finish(ctx, { kind: 'camels', n });
  },

  trade(ctx) {
    const e = turnCheck(ctx); if (e) return e;
    const g = ctx.room.g, hand = g.hands[ctx.idx];
    const { take, give } = ctx.body;
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
    // 적용 — 시장의 같은 자리에 내 카드가 들어간다
    const out = giveT.concat(Array(camels).fill(CAMEL));
    take.forEach((mi, k) => { g.market[mi] = out[k]; });
    const keep = hand.filter((_, i) => !giveH.includes(i));
    g.hands[ctx.idx] = sortHand(keep.concat(takeT));
    g.herds[ctx.idx] -= camels;
    return finish(ctx, { kind: 'trade', got: sortHand(takeT.slice()), gave: sortHand(out.slice()) });
  },

  sell(ctx) {
    const e = turnCheck(ctx); if (e) return e;
    const g = ctx.room.g, hand = g.hands[ctx.idx];
    const t = ctx.body.type, n = ctx.body.n;
    if (!isGood(t)) return { error: '팔 상품을 골라주세요', status: 400 };
    const have = hand.filter((x) => x === t).length;
    if (!Number.isInteger(n) || n < 1) return { error: '몇 장 팔지 골라주세요', status: 400 };
    if (n > have) return { error: `${NAME[t]}가 ${have}장뿐이에요`, status: 400 };
    if (n < minSell(t)) return { error: `${NAME[t]}는 2장 이상 모아야 팔 수 있어요`, status: 400 };
    let left = n;
    g.hands[ctx.idx] = hand.filter((x) => (x === t && left > 0 ? (left--, false) : true));
    const got = g.tokens[t].splice(0, n);
    got.forEach((v) => g.won[ctx.idx].goods.push({ t, v }));
    const bk = bonusKey(n);
    let bonus = false;
    if (bk && g.bonus[bk].length) { g.won[ctx.idx].bonus.push({ k: bk, v: g.bonus[bk].shift() }); bonus = true; }
    g.sold += n;
    return finish(ctx, { kind: 'sell', type: t, n, gain: got.reduce((a, v) => a + v, 0), tokens: got.length, bonus, bk });
  },

  resign(ctx) {
    if (status(ctx).phase !== 'play') return { error: '게임 중이 아니에요', status: 409 };
    ctx.me.resigned = true;
    ctx.touchMe = true;
    return null;
  },
};
export { actions };

/* ---------------------------------------------------------------- 혼자 하기 봇
 * 적당한 난이도 — 규칙대로 욕심만 낸다. 앞을 내다보지 않고, 상대에게 뭘 남기는지도 안 본다.
 *  1. 팔기: 다이아·금·은은 2장(가끔 더 기다림), 싼 상품은 3장 이상 모이면. 손이 꽉 찼으면 제일 나은 걸 판다
 *  2. 시장에 낙타가 3장 이상이면 낙타 전부
 *  3. 가끔(35%) 교환: 모으는 종류를 시장에서 2장 이상, 외톨이 싼 카드·낙타를 주고
 *  4. 아니면 상품 1장 — 다음 토큰 값 + 이미 모으는 종류 가산. 20% 는 아무거나
 *  5. 다 안 되면 낙타 / 아무 팔기 — 자기 차례면 반드시 합법 수 하나는 낸다 */
const nextVals = (g, t, n) => g.tokens[t].slice(0, n).reduce((a, v) => a + v, 0);
const BONUS_EXP = { 3: 2, 4: 5, 5: 9 };
function sellValue(g, t, n) {
  const bk = bonusKey(n);
  return nextVals(g, t, n) + (bk && g.bonus[bk].length ? BONUS_EXP[bk] : 0);
}
export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase === 'pick') return pickBot(ctx, rnd);
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const g = ctx.room.g, hand = g.hands[ctx.idx], market = g.market;
  const cnt = countBy(hand), mc = countBy(market);
  const camelsM = mc[CAMEL] || 0;
  const full = hand.length >= HAND_MAX;

  // 1. 팔기
  const sells = GOODS.filter((t) => (cnt[t] || 0) >= minSell(t)).map((t) => ({ t, n: cnt[t], v: sellValue(g, t, cnt[t]) }));
  sells.sort((a, b) => b.v - a.v);
  const ready = sells.filter(({ t, n }) => {
    if (!g.tokens[t].length) return n >= 3 && g.bonus[bonusKey(n)] && g.bonus[bonusKey(n)].length;  // 토큰 없으면 보너스나 노린다
    if (PRECIOUS.includes(t)) return n >= 3 || g.tokens[t].length <= 2 || rnd() < 0.55;
    return n >= 4 || (n >= 3 && rnd() < 0.75) || g.tokens[t].length <= 1;
  });
  if (ready.length) return { act: 'sell', body: { type: ready[0].t, n: ready[0].n } };
  if (full && sells.length && !(camelsM >= 3)) return { act: 'sell', body: { type: sells[0].t, n: sells[0].n } };

  // 2. 낙타
  if (camelsM >= 3 || (camelsM >= 2 && hand.length >= 6 && rnd() < 0.5)) return { act: 'camels', body: {} };

  // 3. 가끔 교환
  if (rnd() < 0.35) {
    const want = market.map((t, i) => ({ t, i })).filter(({ t }) => isGood(t) && ((cnt[t] || 0) >= 1 || PRECIOUS.includes(t)));
    const wantT = new Set(want.map((x) => x.t));
    const junk = hand.map((t, i) => ({ t, i })).filter(({ t }) => cnt[t] === 1 && !PRECIOUS.includes(t) && !wantT.has(t));
    const herd = g.herds[ctx.idx];
    const k = Math.min(want.length, junk.length + Math.max(0, herd - 1));
    if (k >= 2) {
      const take = want.slice(0, k).map((x) => x.i);
      const give = junk.slice(0, k).map((x) => x.i);
      const camels = k - give.length;
      if (hand.length - give.length + k <= HAND_MAX) return { act: 'trade', body: { take, give, camels } };
    }
  }

  // 4. 상품 1장
  if (!full) {
    const opts = market.map((t, i) => ({ t, i })).filter(({ t }) => isGood(t));
    if (opts.length) {
      if (rnd() < 0.2) return { act: 'take', body: { card: opts[Math.floor(rnd() * opts.length)].i } };
      let best = null, bv = -1;
      for (const { t, i } of opts) {
        const v = (g.tokens[t][cnt[t] || 0] || 0) + 2.2 * (cnt[t] || 0) + rnd() * 1.5;
        if (v > bv) { bv = v; best = i; }
      }
      return { act: 'take', body: { card: best } };
    }
  }

  // 5. 남은 것
  if (camelsM) return { act: 'camels', body: {} };
  if (sells.length) return { act: 'sell', body: { type: sells[0].t, n: sells[0].n } };
  // 여기 올 일은 없다 (손이 꽉 찼으면 팔 게 반드시 있고, 아니면 시장에 뭐든 있다) — 그래도 교환이라도
  return null;
}

export const spice = {
  setup, view, actions, bot: botMove,
  options: (body) => ({ pick: pickKind(body.pick) }),
  finished: (ctx) => status(ctx).phase === 'done',
};

export const handle = (body, store, now) => handleRoom(spice, body, store, now);
