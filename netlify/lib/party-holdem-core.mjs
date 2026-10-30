/* 텍사스 홀덤 (2~8명) — party-kit 위.
 *
 * 카드 id 0..51: 숫자 = id%13 (0=2 … 8=10, 9=J, 10=Q, 11=K, 12=A), 무늬 = ⌊id/13⌋ (♠♥♦♣).
 * 한 게임 = 여러 판(방 만들 때 5·10·20, 기본 10). 시작 칩 1000, 블라인드 10/20(판 수의 절반을 지나면 20/40).
 * 판: 딜러 버튼이 돈다. 스몰·빅 블라인드 → 홀카드 2장 → 프리플롭 → 플롭(3) → 턴 → 리버 → 쇼다운. 두 명이면 딜러가 스몰 블라인드.
 *   행동: 다이 · 체크/콜 · 레이즈(최소 = 직전 올린 만큼, 2배·판돈·올인 단추) . 칩이 모자라면 올인 — 사이드팟을 제대로 나눈다.
 *   한 명 빼고 다 다이하면 그 사람이 판돈을 가져간다(패 공개 없음). 공개 뒤 '다음 판'은 아무나(멱등).
 * 끝: 마지막 판이 끝나거나 칩 가진 사람이 한 명 — 칩 많은 순.
 * 족보(높은 순): 로열 스트레이트 플러시 > 스트레이트 플러시 > 포카드 > 풀하우스 > 플러시 > 스트레이트 > 트리플 > 투페어 > 원페어 > 하이카드.
 * 평가: 7장 중 최고 5장 — evaluate(ids) → { cat, name, key(비교용 숫자 배열), best(5장) }.
 * 봇: 프리플롭은 손패 등급(페어·높은 두 장·같은 무늬 연속), 이후는 만든 패의 등급과 콜 금액/판돈 비율. 가끔(8%) 허세.
 */
import { handleParty, ranking, shuffle, seeded } from './party-kit.mjs';

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'], SUITS = ['♠', '♥', '♦', '♣'];
export const rankOf = (id) => id % 13, suitOf = (id) => Math.floor(id / 13);
export const cardName = (id) => RANKS[rankOf(id)] + SUITS[suitOf(id)];
export const COUNTS = [5, 10, 20], DEFAULT_COUNT = 10, START_CHIPS = 1000, BLIND = 10;
export const CATS = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시', '로열 스트레이트 플러시'];
export const JOKBO = [
  { cat: 9, name: '로열 스트레이트 플러시', d: '같은 무늬 10·J·Q·K·A' }, { cat: 8, name: '스트레이트 플러시', d: '같은 무늬로 연속 5장' },
  { cat: 7, name: '포카드', d: '같은 숫자 4장' }, { cat: 6, name: '풀하우스', d: '트리플 + 원페어' }, { cat: 5, name: '플러시', d: '같은 무늬 5장' },
  { cat: 4, name: '스트레이트', d: '연속 5장 (A·2·3·4·5 도 됨)' }, { cat: 3, name: '트리플', d: '같은 숫자 3장' }, { cat: 2, name: '투페어', d: '페어 둘' },
  { cat: 1, name: '원페어', d: '같은 숫자 2장' }, { cat: 0, name: '하이카드', d: '아무것도 없음 — 높은 카드로 비교' },
];

/* 5장 평가 → { cat, key } key 는 큰 쪽이 센 숫자 배열(사전순 비교) */
function eval5(ids) {
  const rs = ids.map(rankOf).sort((a, b) => b - a), ss = ids.map(suitOf);
  const flush = ss.every((s) => s === ss[0]);
  let straightHi = -1;
  const uniq = [...new Set(rs)];
  if (uniq.length === 5) {
    if (rs[0] - rs[4] === 4) straightHi = rs[0];
    else if (rs.join() === '12,3,2,1,0') straightHi = 3;                 // A·2·3·4·5 (휠)
  }
  const cnt = {}; for (const r of rs) cnt[r] = (cnt[r] || 0) + 1;
  const groups = Object.entries(cnt).map(([r, c]) => [c, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const key = groups.map((g) => g[1]);
  if (straightHi >= 0 && flush) return { cat: straightHi === 12 ? 9 : 8, key: [straightHi] };
  if (groups[0][0] === 4) return { cat: 7, key };
  if (groups[0][0] === 3 && groups[1][0] === 2) return { cat: 6, key };
  if (flush) return { cat: 5, key: rs };
  if (straightHi >= 0) return { cat: 4, key: [straightHi] };
  if (groups[0][0] === 3) return { cat: 3, key };
  if (groups[0][0] === 2 && groups[1][0] === 2) return { cat: 2, key };
  if (groups[0][0] === 2) return { cat: 1, key };
  return { cat: 0, key: rs };
}
export function cmpHand(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) { const d = (a.key[i] || -1) - (b.key[i] || -1); if (d) return d; }
  return 0;
}
/* 5~7장 중 최고 5장 */
export function evaluate(ids) {
  if (ids.length < 5) { const pair = ids.length === 2 && rankOf(ids[0]) === rankOf(ids[1]); const e = { cat: pair ? 1 : 0, key: ids.map(rankOf).sort((a, b) => b - a) }; return { ...e, name: CATS[e.cat], best: ids }; }
  let bestE = null, bestC = null;
  const n = ids.length;
  const rec = (start, pick) => {
    if (pick.length === 5) { const e = eval5(pick); if (!bestE || cmpHand(e, bestE) > 0) { bestE = e; bestC = pick.slice(); } return; }
    for (let i = start; i <= n - (5 - pick.length); i++) { pick.push(ids[i]); rec(i + 1, pick); pick.pop(); }
  };
  rec(0, []);
  return { ...bestE, name: CATS[bestE.cat], best: bestC };
}

function options(body) { const c = Number(body.count); return { count: COUNTS.includes(c) ? c : DEFAULT_COUNT }; }
function setup(room) {
  const np = room.players.length;
  room.g = { chips: Array(np).fill(START_CHIPS), hand: 0, total: (room.opts && COUNTS.includes(room.opts.count)) ? room.opts.count : DEFAULT_COUNT, cur: null, log: [], history: [], over: false };
  deal(room);
}
const alive = (room, i) => !(room.out && room.out[i]) && room.g.chips[i] > 0;
const livingSeats = (room) => room.players.map((_, i) => i).filter((i) => alive(room, i));
const pushLog = (g, e) => { g.log.push(e); if (g.log.length > 30) g.log.splice(0, g.log.length - 30); };
const after = (order, i, k = 1) => order[(order.indexOf(i) + k) % order.length];

function deal(room) {
  const g = room.g, seats = livingSeats(room);
  if (seats.length <= 1 || g.hand >= g.total) { g.over = true; g.cur = null; return; }
  const deck = shuffle([...Array(52)].map((_, i) => i), seeded(`${room.code}:${room.round}:h${g.hand}`));
  const bb = g.hand >= Math.ceil(g.total / 2) ? BLIND * 4 : BLIND * 2, sb = bb / 2;
  const dealer = seats[(room.first + g.hand) % seats.length];
  const sbSeat = seats.length === 2 ? dealer : after(seats, dealer), bbSeat = after(seats, sbSeat);
  const cards = {}, bet = {}, total = {}, folded = {}, acted = {}, allin = {};
  for (const i of seats) { cards[i] = [deck.pop(), deck.pop()]; bet[i] = 0; total[i] = 0; folded[i] = false; acted[i] = false; }
  const cur = { dealer, sbSeat, bbSeat, sb, bb, seats, cards, board: [], deck, bet, total, folded, acted, allin, toCall: bb, minRaise: bb, street: 0, stage: 'bet', result: null, pot: 0 };
  const post = (i, amt) => { const a = Math.min(amt, g.chips[i]); g.chips[i] -= a; cur.bet[i] += a; cur.total[i] += a; cur.pot += a; if (g.chips[i] === 0) cur.allin[i] = true; };
  post(sbSeat, sb); post(bbSeat, bb);
  cur.turn = firstToAct(cur, after(seats, bbSeat));
  g.cur = cur;
  pushLog(g, { t: 'deal', hand: g.hand, dealer, bb });
}
const canAct = (cur, i) => !cur.folded[i] && !cur.allin[i];
/* from 부터 돌며 행동할 수 있는 첫 사람 */
function firstToAct(cur, from) {
  const o = cur.seats, s = o.indexOf(from);
  for (let k = 0; k < o.length; k++) { const i = o[(s + k) % o.length]; if (canAct(cur, i)) return i; }
  return null;
}
/* 이 거리(street)의 베팅이 끝났나 — 행동 가능한 모두가 행동했고 콜을 맞췄다 */
function streetDone(cur) {
  const live = cur.seats.filter((i) => !cur.folded[i]);
  if (live.length <= 1) return true;
  const actors = live.filter((i) => !cur.allin[i]);
  return actors.every((i) => cur.acted[i] && cur.bet[i] >= cur.toCall);
}
function nextStreet(room) {
  const g = room.g, cur = g.cur;
  const live = cur.seats.filter((i) => !cur.folded[i]);
  if (live.length <= 1) return finish(room);
  if (cur.street === 3) return finish(room);
  cur.street++;
  cur.board.push(...cur.deck.splice(-(cur.street === 1 ? 3 : 1)));
  for (const i of cur.seats) { cur.bet[i] = 0; cur.acted[i] = false; }
  cur.toCall = 0; cur.minRaise = cur.bb;
  // 올인 때문에 더 행동할 사람이 하나 이하면 끝까지 깐다
  const actors = live.filter((i) => !cur.allin[i]);
  if (actors.length <= 1) { cur.turn = null; return nextStreet(room); }
  cur.turn = firstToAct(cur, after(cur.seats, cur.dealer));
}
/* 쇼다운 — 사이드팟 나누기 */
function finish(room) {
  const g = room.g, cur = g.cur;
  const live = cur.seats.filter((i) => !cur.folded[i]);
  const won = Object.fromEntries(cur.seats.map((i) => [i, 0]));
  let evals = null, bestName = null;
  if (live.length === 1) { won[live[0]] = cur.pot; }
  else {
    while (cur.board.length < 5) cur.board.push(cur.deck.pop());
    evals = Object.fromEntries(live.map((i) => [i, evaluate([...cur.cards[i], ...cur.board])]));
    // 기여 금액 단계별로 팟을 쪼갠다
    const levels = [...new Set(cur.seats.map((i) => cur.total[i]).filter((v) => v > 0))].sort((a, b) => a - b);
    let prev = 0;
    for (const lv of levels) {
      const contributors = cur.seats.filter((i) => cur.total[i] >= lv);
      const potPart = (lv - prev) * contributors.length;
      prev = lv;
      const eligible = live.filter((i) => cur.total[i] >= lv);
      if (!eligible.length) { // 아무도 자격 없으면(다 다이) 남은 사람에게
        won[live[0]] += potPart; continue;
      }
      let best = null; for (const i of eligible) if (!best || cmpHand(evals[i], evals[best]) > 0) best = i;
      const ws = eligible.filter((i) => cmpHand(evals[i], evals[best]) === 0);
      const share = Math.floor(potPart / ws.length); let rest = potPart - share * ws.length;
      for (const w of ws) { won[w] += share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; }
    }
    const top = live.slice().sort((a, b) => cmpHand(evals[b], evals[a]))[0];
    bestName = evals[top].name;
  }
  for (const i of cur.seats) g.chips[i] += won[i];
  const winners = cur.seats.filter((i) => won[i] > 0);
  cur.stage = 'result'; cur.turn = null;
  cur.result = { winners, won, byFold: live.length === 1, reveal: live.length === 1 ? {} : Object.fromEntries(live.map((i) => [i, cur.cards[i]])), evals: evals ? Object.fromEntries(live.map((i) => [i, { name: evals[i].name, cat: evals[i].cat, key: evals[i].key, best: evals[i].best }])) : null, board: cur.board, pot: cur.pot };
  g.history.push({ hand: g.hand, winners, pot: cur.pot, name: bestName || '모두 다이' });
  if (g.history.length > 30) g.history.splice(0, g.history.length - 30);
  pushLog(g, { t: 'win', hand: g.hand, winners, pot: cur.pot, name: bestName });
}
/* 지금 할 수 있는 행동 */
export function betOptions(room, i) {
  const g = room.g, cur = g.cur; if (!cur || cur.stage !== 'bet' || cur.turn !== i) return [];
  const need = cur.toCall - cur.bet[i], chips = g.chips[i], out = [];
  if (need <= 0) out.push({ k: 'check', label: '체크', add: 0 });
  else out.push({ k: 'call', label: need >= chips ? '올인 콜 ' + chips : '콜 ' + need, add: Math.min(need, chips) });
  if (chips > need) {
    const minTo = cur.toCall + cur.minRaise;                                  // 레이즈 뒤 내 이번 거리 총 베팅
    const cands = [['min', '레이즈', minTo], ['x2', '2배', Math.max(minTo, cur.toCall * 2)], ['pot', '판돈', Math.max(minTo, cur.toCall + cur.pot + need)], ['allin', '올인', cur.bet[i] + chips]];
    const seen = new Set();
    for (const [k, label, to0] of cands) {
      const to = Math.min(to0, cur.bet[i] + chips), add = to - cur.bet[i];
      if (add <= need || seen.has(to)) continue;
      if (to < minTo && to !== cur.bet[i] + chips) continue;                 // 최소 레이즈 미만은 올인일 때만
      seen.add(to); out.push({ k, label: label + ' ' + to, add, to });
    }
  }
  out.push({ k: 'fold', label: '다이', add: 0 });
  return out;
}

const actions = {
  bet(ctx) {
    const { room, idx, body } = ctx, g = room.g, cur = g.cur;
    if (g.over || !cur) return { error: '게임이 끝났어요', status: 409 };
    if (cur.stage !== 'bet') return { error: '이 판은 끝났어요 — 다음 판을 눌러요', status: 409 };
    if (cur.turn !== idx) return { error: '다른 사람 차례예요', status: 409 };
    const opts = betOptions(room, idx), o = opts.find((x) => x.k === body.k);
    if (!o) return { error: '그렇게는 못 해요', status: 400 };
    if (o.k === 'fold') { cur.folded[idx] = true; pushLog(g, { t: 'fold', by: idx }); }
    else {
      g.chips[idx] -= o.add; cur.bet[idx] += o.add; cur.total[idx] += o.add; cur.pot += o.add;
      if (o.to !== undefined) {
        const raiseBy = cur.bet[idx] - cur.toCall;
        if (raiseBy >= cur.minRaise) cur.minRaise = raiseBy;                   // 올인 쇼트 레이즈는 최소 레이즈를 안 올린다
        cur.toCall = cur.bet[idx];
        for (const j of cur.seats) if (j !== idx) cur.acted[j] = false;
      }
      if (g.chips[idx] === 0) cur.allin[idx] = true;
      pushLog(g, { t: o.k, by: idx, add: o.add, street: cur.street });
    }
    cur.acted[idx] = true;
    if (streetDone(cur)) nextStreet(room);
    else cur.turn = firstToAct(cur, after(cur.seats, idx));
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
  if (!cur || cur.stage !== 'bet' || cur.folded[idx] === undefined) return;
  cur.folded[idx] = true; cur.acted[idx] = true;
  if (streetDone(cur)) nextStreet(room);
  else if (cur.turn === idx) cur.turn = firstToAct(cur, after(cur.seats, idx));
}

function view(ctx) {
  const { room, idx } = ctx, g = room.g, cur = g.cur;
  const done = g.over;
  const mine = cur && cur.cards[idx] ? cur.cards[idx] : null;
  const board = cur ? cur.board : [];
  return {
    stage: done ? 'done' : 'play', hand: g.hand, total: g.total, chips: g.chips,
    turn: cur && cur.stage === 'bet' ? cur.turn : null, yourTurn: !!(cur && cur.stage === 'bet' && cur.turn === idx),
    pot: cur ? cur.pot : 0, board, street: cur ? cur.street : null, step: cur ? cur.stage : null,
    dealer: cur ? cur.dealer : null, sbSeat: cur ? cur.sbSeat : null, bbSeat: cur ? cur.bbSeat : null, bb: cur ? cur.bb : null, seats: cur ? cur.seats : [],
    bets: cur ? cur.bet : {}, totals: cur ? cur.total : {}, folded: cur ? cur.folded : {}, allin: cur ? cur.allin : {}, toCall: cur ? cur.toCall : 0,
    mine, myEval: mine ? (board.length ? evaluate([...mine, ...board]) : null) : null,
    options: cur && cur.stage === 'bet' && cur.turn === idx ? betOptions(room, idx) : [],
    result: cur && cur.stage === 'result' ? cur.result : null, log: g.log.slice(-12), history: g.history,
    winners: done ? winnersOf(room) : null, rank: done ? ranking(room.players.map((_, i) => (room.out && room.out[i] ? null : g.chips[i]))) : null,
  };
}
function winnersOf(room) {
  const g = room.g, seats = room.players.map((_, i) => i).filter((i) => !(room.out && room.out[i]));
  const best = Math.max(...seats.map((i) => g.chips[i]));
  return seats.filter((i) => g.chips[i] === best);
}
/* 프리플롭 손패 등급 0~3 */
function holeGrade(a, b) {
  const r1 = rankOf(a), r2 = rankOf(b), hi = Math.max(r1, r2), lo = Math.min(r1, r2), suited = suitOf(a) === suitOf(b);
  if (r1 === r2) return r1 >= 8 ? 3 : 2;
  if (hi === 12 && lo >= 9) return 3;
  if (hi >= 10 && lo >= 8) return 2;
  if (suited && hi - lo <= 2 && lo >= 4) return 2;
  if (hi >= 11 || (suited && hi - lo <= 4)) return 1;
  return 0;
}
export function botMove(ctx, rnd) {
  const { room, idx } = ctx, g = room.g, cur = g.cur;
  if (g.over || !cur) return null;
  if (cur.stage === 'result') {
    const humans = cur.seats.filter((i) => !room.players[i].bot && !(room.out && room.out[i]));
    return humans.length ? null : { act: 'next', body: { hand: g.hand } };
  }
  if (cur.turn !== idx) return null;
  const r = rnd || seeded(`${room.code}:${room.round}:${g.hand}:${cur.street}:${idx}:${cur.pot}`);
  const opts = betOptions(room, idx), pick = (k) => opts.find((o) => o.k === k);
  const callish = pick('check') || pick('call'), need = cur.toCall - cur.bet[idx];
  const go = (o) => ({ act: 'bet', body: { k: (o || callish || pick('fold')).k } });
  let strength;                                                                  // 0 약함 ~ 3 강함
  if (!cur.board.length) strength = holeGrade(cur.cards[idx][0], cur.cards[idx][1]);
  else {
    const e = evaluate([...cur.cards[idx], ...cur.board]);
    const boardE = cur.board.length >= 5 ? evaluate(cur.board) : null;
    strength = e.cat >= 5 ? 3 : e.cat >= 2 ? 2 : e.cat === 1 ? (e.key[0] >= 8 ? 2 : 1) : (e.key[0] === 12 ? 1 : 0);
    if (boardE && cmpHand(e, boardE) === 0) strength = Math.min(strength, 1);  // 내 패가 보드 그대로면 별것 없다
  }
  const bluff = r() < 0.08;
  const cheap = need <= Math.max(cur.bb, Math.floor(cur.pot * 0.3));
  if (strength === 3) return go(r() < 0.7 ? (pick('pot') || pick('x2') || pick('min')) : callish);
  if (strength === 2) return go(r() < 0.35 ? (pick('min') || pick('x2')) : (need <= g.chips[idx] * 0.5 ? callish : pick('fold')));
  if (strength === 1) return go(bluff ? (pick('min') || callish) : cheap ? callish : pick('fold'));
  if (need <= 0) return go(bluff ? pick('min') : pick('check'));
  return go(bluff && cheap ? callish : pick('fold'));
}

export const partyHoldem = {
  setup, view, actions, options, onOut, bot: botMove, teamOptions: [0],
  finished: (ctx) => ctx.room.g.over,
};
export const handle = (body, store, now) => handleParty(partyHoldem, body, store, now);
