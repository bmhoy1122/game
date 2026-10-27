/* 마블 (2~8명) — 모노폴리·부루마불 방식 부동산 보드게임, 짧게 끝나도록 단순화.
 *
 * 판 28칸 (한 변 7칸, 모서리 4개):
 *   0 출발 · 7 무인도 · 14 복지기금 · 21 복권  모서리
 *   도시 18 = 6색 × 3 (같은 색 셋을 다 가지면 통행료 2배), 항만·공항 2 (건물 없음, 둘 다 가지면 2배)
 *   황금열쇠 3 (카드 12장 중 seeded 로 한 장), 세금 1 (현금의 10% → 복지기금)
 * 돈 단위는 '만'. 시작 1500, 출발 지날 때 +200.
 * 차례: 주사위 두 개(seeded — 코드:판:굴린 횟수) → 이동 → 칸 처리
 *   빈 도시 → 사기/넘어가기 (돈 있을 때만 묻는다)
 *   내 도시 → 건물 올리기/넘어가기 (0 땅 → 1 빌라 → 2 빌딩 → 3 호텔, 한 번 들를 때 한 단계)
 *   남의 도시 → 통행료 자동 지불. 돈이 모자라면 비싼 것부터 반값에 자동 매각, 그래도 모자라면 파산(빠짐)
 *   더블이면 한 번 더(세 번 연속 더블은 무인도). 무인도는 두 차례 쉬고(더블이면 바로 탈출)
 * 끝: 한 명만 남거나, 차례가 인원 × 20 번 돌면 — 총자산(현금 + 땅값 + 건물값)으로 순위.
 * 비밀 없음 — 다 공개. 황금열쇠만 뽑을 때 정해진다.
 */
import { handleParty, turnSeat, activeSeats, ranking, seeded, oneSideLeft, teamOf } from './party-kit.mjs';

export const N = 28, START_CASH = 1500, SALARY = 200, MAX_LAPS = 20;
export const LEVELS = ['땅', '빌라', '빌딩', '호텔'];
const BUILD_COST = [0, 0.5, 1, 1.5];           // 가격 × 배
const RENT_RATE = [0.1, 0.3, 0.7, 1.5];
const city = (name, group, price) => ({ t: 'city', name, group, price });
export const BOARD = [
  { t: 'start', name: '출발' },
  city('제주', 0, 60), city('강릉', 0, 60), { t: 'key', name: '황금열쇠' }, city('춘천', 0, 80), { t: 'tax', name: '세금' }, city('전주', 1, 100),
  { t: 'island', name: '무인도' },
  city('광주', 1, 100), city('대전', 1, 120), { t: 'port', name: '항만', price: 150 }, city('청주', 2, 140), city('울산', 2, 140), city('대구', 2, 160),
  { t: 'fund', name: '복지기금' },
  city('수원', 3, 180), { t: 'key', name: '황금열쇠' }, city('인천', 3, 180), city('부산', 3, 200), { t: 'port', name: '공항', price: 150 }, city('도쿄', 4, 220),
  { t: 'lotto', name: '복권' },
  city('방콕', 4, 220), city('시드니', 4, 240), { t: 'key', name: '황금열쇠' }, city('파리', 5, 260), city('런던', 5, 280), city('뉴욕', 5, 320),
];
export const GROUP_NAMES = ['연두', '하늘', '보라', '주황', '분홍', '금색'];
export const KEYS = [
  { k: 'tostart', text: '출발점으로 이동해요. 월급도 받아요' },
  { k: 'island', text: '무인도에 갇혔어요' },
  { k: 'fwd3', text: '앞으로 3칸' },
  { k: 'back2', text: '뒤로 2칸' },
  { k: 'cash', v: 100, text: '복권 당첨! +100' },
  { k: 'cash', v: -50, text: '주차 위반 벌금 -50 (복지기금으로)' },
  { k: 'birthday', v: 20, text: '생일! 모두에게 20씩 받아요' },
  { k: 'donate', v: 10, text: '기부의 날. 모두에게 10씩 줘요' },
  { k: 'build', text: '무료 건축권 — 가장 비싼 내 땅에 건물 한 단계' },
  { k: 'cash', v: 80, text: '세금 환급 +80' },
  { k: 'tofund', text: '복지기금 칸으로 이동해 기금을 받아요' },
  { k: 'cash', v: -70, text: '병원비 -70 (복지기금으로)' },
  { k: 'cash', v: 150, text: '주식 대박 +150' },
];
const sq = (i) => BOARD[i];
export const buildCost = (i, lv) => Math.round(sq(i).price * BUILD_COST[lv]);
export const propValue = (g, i) => { const o = g.own[i]; if (!o) return 0; let v = sq(i).price; for (let l = 1; l <= (o.lv || 0); l++) v += buildCost(i, l); return v; };
export function rentOf(g, i) {
  const o = g.own[i], s = sq(i);
  if (!o) return 0;
  if (s.t === 'port') { const both = BOARD.every((b, j) => b.t !== 'port' || (g.own[j] && g.own[j].p === o.p)); return both ? 40 : 20; }
  let r = Math.round(s.price * RENT_RATE[o.lv]);
  const mono = BOARD.every((b, j) => b.t !== 'city' || b.group !== s.group || (g.own[j] && g.own[j].p === o.p));
  return mono ? r * 2 : r;
}
export const netWorth = (g, p) => g.cash[p] + BOARD.reduce((t, b, i) => t + (g.own[i] && g.own[i].p === p ? propValue(g, i) : 0), 0);

function setup(room) {
  const n = room.players.length;
  room.g = {
    pos: Array(n).fill(0), cash: Array(n).fill(START_CASH), own: Array(N).fill(null), fund: 0,
    island: Array(n).fill(0), laps: Array(n).fill(0), bankrupt: Array(n).fill(false),
    turnNo: 0, rolls: 0, dbl: 0, state: 'roll', pending: null, dice: null, log: [], keyNo: 0, maxTurns: n * MAX_LAPS,
  };
}
const log = (g, text, by) => { g.log.push({ by, text, at: g.turnNo }); if (g.log.length > 30) g.log.splice(0, g.log.length - 30); };
const aliveSeats = (room) => activeSeats(room).filter((i) => !room.g.bankrupt[i]);
const curTurn = (room) => { const g = room.g; return turnSeat({ ...room, out: room.players.map((_, i) => (room.out && room.out[i]) || g.bankrupt[i]) }, g.turnNo); };

/* 돈 내기 — 모자라면 비싼 자산부터 반값에 판다. 그래도 모자라면 파산 */
function pay(room, p, amount, to) {
  const g = room.g;
  g.cash[p] -= amount;
  while (g.cash[p] < 0) {
    const mine = BOARD.map((b, i) => i).filter((i) => g.own[i] && g.own[i].p === p);
    if (!mine.length) break;
    mine.sort((a, b) => propValue(g, b) - propValue(g, a));
    const i = mine[0], v = Math.round(propValue(g, i) / 2);
    g.own[i] = null; g.cash[p] += v;
    log(g, `${sq(i).name}을(를) ${v}에 급매`, p);
  }
  if (g.cash[p] < 0) {
    const paid = amount + g.cash[p];                // 낼 수 있었던 만큼만
    g.cash[p] = 0; g.bankrupt[p] = true;
    log(g, '파산! 게임에서 빠져요', p);
    if (to !== null && to !== undefined) g.cash[to] += Math.max(0, paid); else g.fund += Math.max(0, paid);
    BOARD.forEach((_, i) => { if (g.own[i] && g.own[i].p === p) g.own[i] = null; });
    return false;
  }
  if (to !== null && to !== undefined) g.cash[to] += amount; else g.fund += amount;
  return true;
}
function moveTo(room, p, pos, viaStart = true) {
  const g = room.g;
  if (viaStart && pos < g.pos[p]) { g.cash[p] += SALARY; g.laps[p]++; log(g, `출발을 지나 월급 ${SALARY}`, p); }
  g.pos[p] = pos;
}
function endTurn(room) {
  const g = room.g;
  g.state = 'roll'; g.pending = null;
  if (g.dbl > 0 && !g.bankrupt[curTurn(room)] && g.island[curTurn(room)] === 0) { g.state = 'roll'; return; }   // 더블이면 같은 사람
  g.dbl = 0; g.turnNo++;
}
/* 칸 처리 — 사기/건물 결정이 필요하면 state 를 바꾸고 멈춘다 */
function land(room, p) {
  const g = room.g, i = g.pos[p], s = sq(i);
  if (s.t === 'city' || s.t === 'port') {
    const o = g.own[i];
    if (!o) {
      if (g.cash[p] >= s.price) { g.state = 'buy'; g.pending = i; return; }
      log(g, `${s.name} — 돈이 모자라 못 사요`, p);
    } else if (o.p === p) {
      if (s.t === 'city' && o.lv < 3 && g.cash[p] >= buildCost(i, o.lv + 1)) { g.state = 'build'; g.pending = i; return; }
    } else if (room.teams && teamOf(room, o.p) === teamOf(room, p)) {
      log(g, `${s.name} — 팀원(${room.players[o.p].name}) 땅이라 통행료 없음`, p);   // 팀전: 팀원끼리는 안 낸다
    } else {
      const r = rentOf(g, i);
      log(g, `${s.name}(${room.players[o.p].name}) 통행료 ${r}`, p);
      if (!pay(room, p, r, o.p)) { g.dbl = 0; }
    }
  } else if (s.t === 'tax') {
    const t = Math.floor(g.cash[p] * 0.1); if (t) { pay(room, p, t, null); log(g, `세금 ${t} → 복지기금`, p); }
  } else if (s.t === 'fund') {
    if (g.fund) { log(g, `복지기금 ${g.fund} 받음`, p); g.cash[p] += g.fund; g.fund = 0; }
  } else if (s.t === 'island') {
    g.island[p] = 2; g.dbl = 0; log(g, '무인도에 갇혔어요 (두 차례)', p);
  } else if (s.t === 'lotto') {
    const v = (Math.floor(seeded(`${room.code}:${room.round}:lotto:${g.rolls}`)() * 6) + 1) * 10;
    g.cash[p] += v; log(g, `복권 ${v} 당첨`, p);
  } else if (s.t === 'key') {
    const card = KEYS[Math.floor(seeded(`${room.code}:${room.round}:key:${g.keyNo++}`)() * KEYS.length)];
    log(g, `황금열쇠: ${card.text}`, p);
    if (card.k === 'tostart') { g.cash[p] += SALARY; g.laps[p]++; g.pos[p] = 0; }
    else if (card.k === 'island') { g.pos[p] = 7; g.island[p] = 2; g.dbl = 0; }
    else if (card.k === 'fwd3') { moveTo(room, p, (i + 3) % N); return land(room, p); }
    else if (card.k === 'back2') { g.pos[p] = (i - 2 + N) % N; return land(room, p); }
    else if (card.k === 'cash') { if (card.v >= 0) g.cash[p] += card.v; else pay(room, p, -card.v, null); }
    else if (card.k === 'birthday') { for (const q of aliveSeats(room)) if (q !== p) { const v = Math.min(card.v, g.cash[q]); g.cash[q] -= v; g.cash[p] += v; } }
    else if (card.k === 'donate') { for (const q of aliveSeats(room)) if (q !== p && !g.bankrupt[p]) { const v = Math.min(card.v, g.cash[p]); g.cash[p] -= v; g.cash[q] += v; } }
    else if (card.k === 'build') { const mine = BOARD.map((b, j) => j).filter((j) => g.own[j] && g.own[j].p === p && BOARD[j].t === 'city' && g.own[j].lv < 3).sort((a, b) => sq(b).price - sq(a).price); if (mine.length) { g.own[mine[0]].lv++; log(g, `${sq(mine[0]).name} ${LEVELS[g.own[mine[0]].lv]} 완성`, p); } }
    else if (card.k === 'tofund') { moveTo(room, p, 14); return land(room, p); }
  }
}

export function status(ctx) {
  const { room } = ctx, g = room.g, alive = aliveSeats(room);
  const over = oneSideLeft(room, alive) || g.turnNo >= g.maxTurns;   // 팀전이면 한 팀만 남아도 끝
  if (over) {
    const worth = room.players.map((_, i) => (alive.includes(i) ? netWorth(g, i) : null));
    const best = Math.max(...alive.map((i) => worth[i]));
    return { phase: 'done', turn: null, winners: alive.filter((i) => worth[i] === best), worth };
  }
  return { phase: 'play', turn: curTurn(room), winners: null, worth: null };
}
function view(ctx) {
  const { room, idx } = ctx, g = room.g, s = status(ctx);
  return {
    stage: s.phase, turn: s.turn, yourTurn: s.phase === 'play' && s.turn === idx, state: s.phase === 'play' ? g.state : null, pending: g.pending,
    pos: g.pos, cash: g.cash, own: g.own, fund: g.fund, island: g.island, bankrupt: g.bankrupt, laps: g.laps,
    dice: g.dice, turnNo: g.turnNo, maxTurns: g.maxTurns, log: g.log.slice(-12), winners: s.winners, worth: s.worth,
    rank: s.phase === 'done' ? ranking(s.worth) : null,
    rent: BOARD.map((_, i) => rentOf(g, i)), buildCost: g.pending !== null && g.state === 'build' ? buildCost(g.pending, g.own[g.pending].lv + 1) : null,
  };
}
function turnCheck(ctx, state) {
  const s = status(ctx);
  if (s.phase !== 'play') return { error: '게임이 끝났어요', status: 409 };
  if (s.turn !== ctx.idx) return { error: '다른 사람 차례예요', status: 409 };
  if (ctx.room.g.state !== state) return { error: state === 'roll' ? '먼저 결정부터 해요' : '지금은 주사위를 굴릴 차례예요', status: 409 };
  return null;
}
const actions = {
  roll(ctx) {
    const e = turnCheck(ctx, 'roll'); if (e) return e;
    const { room, idx } = ctx, g = room.g;
    const rnd = seeded(`${room.code}:${room.round}:dice:${g.rolls++}`);
    const d = [Math.floor(rnd() * 6) + 1, Math.floor(rnd() * 6) + 1];
    g.dice = d; ctx.touchRoom = true;
    const dbl = d[0] === d[1];
    if (g.island[idx] > 0) {
      if (dbl) { g.island[idx] = 0; log(g, `더블(${d[0]}·${d[1]})로 무인도 탈출!`, idx); }
      else { g.island[idx]--; log(g, `무인도… ${g.island[idx] ? '한 차례 더 쉬어요' : '다음 차례엔 나가요'}`, idx); g.dbl = 0; endTurn(room); return null; }
    }
    if (dbl) g.dbl++; else g.dbl = 0;
    if (g.dbl >= 3) { g.pos[idx] = 7; g.island[idx] = 2; g.dbl = 0; log(g, '더블 세 번 — 무인도행', idx); endTurn(room); return null; }
    log(g, `주사위 ${d[0]}·${d[1]}${dbl ? ' 더블!' : ''}`, idx);
    moveTo(room, idx, (g.pos[idx] + d[0] + d[1]) % N);
    land(room, idx);
    if (g.state === 'roll') endTurn(room);
    return null;
  },
  buy(ctx) {
    const e = turnCheck(ctx, 'buy'); if (e) return e;
    const { room, idx } = ctx, g = room.g, i = g.pending;
    if (g.cash[idx] < sq(i).price) return { error: '돈이 모자라요', status: 409 };
    g.cash[idx] -= sq(i).price; g.own[i] = { p: idx, lv: 0 };
    log(g, `${sq(i).name} 구입 (${sq(i).price})`, idx); ctx.touchRoom = true; endTurn(room);
    return null;
  },
  build(ctx) {
    const e = turnCheck(ctx, 'build'); if (e) return e;
    const { room, idx } = ctx, g = room.g, i = g.pending, lv = g.own[i].lv + 1, c = buildCost(i, lv);
    if (g.cash[idx] < c) return { error: '돈이 모자라요', status: 409 };
    g.cash[idx] -= c; g.own[i].lv = lv;
    log(g, `${sq(i).name}에 ${LEVELS[lv]} (${c})`, idx); ctx.touchRoom = true; endTurn(room);
    return null;
  },
  skip(ctx) {
    const s = status(ctx);
    if (s.phase !== 'play' || s.turn !== ctx.idx) return { error: '다른 사람 차례예요', status: 409 };
    if (ctx.room.g.state === 'roll') return { error: '주사위를 굴려요', status: 409 };
    log(ctx.room.g, ctx.room.g.state === 'buy' ? `${sq(ctx.room.g.pending).name} 안 사요` : '건물은 다음에', ctx.idx);
    ctx.touchRoom = true; endTurn(ctx.room);
    return null;
  },
};
/* 기권 = 파산 처리 (땅은 은행으로) */
function onOut(room, idx) {
  const g = room.g;
  g.bankrupt[idx] = true; BOARD.forEach((_, i) => { if (g.own[i] && g.own[i].p === idx) g.own[i] = null; });
  log(g, '게임에서 나갔어요', idx);
  if (g.state !== 'roll' && g.pending !== null) { g.state = 'roll'; g.pending = null; g.dbl = 0; }
}

export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const g = ctx.room.g, cash = g.cash[ctx.idx];
  if (g.state === 'roll') return { act: 'roll', body: {} };
  if (g.state === 'buy') {
    const price = sq(g.pending).price;
    return { act: cash - price >= 150 || (cash - price >= 50 && rnd() < 0.5) ? 'buy' : 'skip', body: {} };
  }
  if (g.state === 'build') {
    const c = buildCost(g.pending, g.own[g.pending].lv + 1);
    return { act: cash - c >= 200 || (cash - c >= 80 && rnd() < 0.4) ? 'build' : 'skip', body: {} };
  }
  return null;
}

export const partyMarble = { setup, view, actions, bot: botMove, onOut, finished: (ctx) => status(ctx).phase === 'done' };
export const handle = (body, store, now) => handleParty(partyMarble, body, store, now);
