/* 백개먼 — 표준 규칙 한 판. 더블링 큐브는 없다.
 *
 * 칸 번호는 '각자 기준'이다. 내 말은 24 → 1 로 움직이고, 1~6 칸이 내 홈이다.
 * 상대가 보는 자기 i 칸은 내 기준 25-i 칸이다.
 *   pos = [a0, a1]  — 사람마다 길이 26 배열 (자기 기준)
 *     a[1..24] 그 칸의 내 말 수 · a[25] 바(잡힌 말) · a[0] 빼낸 말
 * 처음 배치(각자 기준): 24칸 2 · 13칸 5 · 8칸 3 · 6칸 5.
 *
 * 차례: roll(주사위 둘, 서버가 seeded) → move{from,to}(한 걸음 = 주사위 하나) × n → end(확정).
 *   from 25 = 바에서 들어오기, to 0 = 빼내기.
 *   이번 차례 안에서는 undo 로 한 걸음씩 되돌린다. 차례 시작 위치(room.pos) + 쓴 걸음(room.used)을
 *   다시 놓아서 지금 판을 만든다. end 에서 room.pos 를 굳힌다.
 *   굴렸는데 둘 수 있는 수가 하나도 없으면 바로 차례가 넘어간다(로그에 남김).
 *   마지막 말을 빼낸 걸음에서 바로 끝난다 (확정 없이).
 *
 * 주사위 강제 규칙: 쓸 수 있는 만큼 다 써야 하고(maxUse), 하나만 쓸 수 있으면 큰 눈.
 *   한 걸음은 '그 걸음 뒤에도 남은 주사위를 최대로 쓸 수 있는가'로 거른다 — 모든 최대 수열의 접두어만 허락.
 *
 * 결과: 일반승 · 개먼(진 쪽이 하나도 못 뺌) · 백개먼(못 뺐고 바나 이긴 쪽 홈에 말이 남음). 배수는 표시만.
 * 숨긴 정보가 없다. 차례제라 전부 공용 문서에 쓴다. 기권만 아무 때나 눌러서 자기 문서에.
 * 선공은 미니게임(first-pick)으로 정한다. 선공도 첫 차례에 주사위 둘을 굴린다.
 */
import { handleRoom, seeded } from './room-kit.mjs';
import { pickKind, firstOf, pickView, pickThrow, pickBot } from './first-pick.mjs';

export const BAR = 25, OFF = 0;
export function startArr() {
  const a = new Array(26).fill(0);
  a[24] = 2; a[13] = 5; a[8] = 3; a[6] = 5;
  return a;
}
export const clonePos = (pos) => [pos[0].slice(), pos[1].slice()];
/* s 기준 i 칸(1~24)에 있는 상대 말 수 */
export const oppAt = (pos, s, i) => (i >= 1 && i <= 24 ? pos[1 - s][25 - i] : 0);
export const allHome = (mine) => { for (let i = 7; i <= 25; i++) if (mine[i]) return false; return true; };
export const pip = (a) => { let n = 0; for (let i = 1; i <= 25; i++) n += a[i] * i; return n; };

/* 주사위 d 하나로 갈 수 있는 걸음들 [from, to] */
export function stepsFor(pos, s, d) {
  const mine = pos[s], out = [];
  if (mine[BAR]) {
    const to = 25 - d;
    if (oppAt(pos, s, to) < 2) out.push([BAR, to]);
    return out;
  }
  const home = allHome(mine);
  for (let f = 24; f >= 1; f--) {
    if (!mine[f]) continue;
    const to = f - d;
    if (to >= 1) { if (oppAt(pos, s, to) < 2) out.push([f, to]); continue; }
    if (!home) continue;
    if (to === 0) { out.push([f, OFF]); continue; }
    // 눈이 더 크면 — 나보다 먼 말이 없을 때만 (가장 먼 말부터)
    let farther = false;
    for (let j = f + 1; j <= 6; j++) if (mine[j]) { farther = true; break; }
    if (!farther) out.push([f, OFF]);
  }
  return out;
}

/* 걸음 하나를 놓는다 (pos 를 바꾼다). 잡았으면 true */
export function applyStep(pos, s, f, to) {
  const mine = pos[s], opp = pos[1 - s];
  mine[f]--;
  if (to === OFF) { mine[OFF]++; return false; }
  mine[to]++;
  if (opp[25 - to] === 1) { opp[25 - to] = 0; opp[BAR]++; return true; }
  return false;
}

const uniq = (a) => [...new Set(a)];
const removeOne = (a, d) => { const i = a.indexOf(d); const b = a.slice(); b.splice(i, 1); return b; };
export const expandDice = (dice) => (dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice.slice());

/* 남은 주사위 rem 으로 최대 몇 걸음 쓸 수 있나 */
export function maxLen(pos, s, rem) {
  if (!rem.length) return 0;
  let best = 0;
  for (const d of uniq(rem)) {
    const r2 = removeOne(rem, d);
    for (const [f, t] of stepsFor(pos, s, d)) {
      const p2 = clonePos(pos); applyStep(p2, s, f, t);
      const v = 1 + maxLen(p2, s, r2);
      if (v > best) { best = v; if (best === rem.length) return best; }
    }
  }
  return best;
}

/* 주사위 — 방 코드 · 판 번호 · 차례 번호로 정해진다. 되돌려도 다시 굴려도 같다 */
export function rollDice(code, round, turnNo) {
  const rnd = seeded(`${code}:${round}:${turnNo}`);
  return [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
}

/* 이번 차례의 지금 모습 */
export function turnState(room, s) {
  const pos = clonePos(room.pos);
  const used = room.used || [];
  for (const u of used) applyStep(pos, s, u.f, u.t);
  const dice = room.dice || null;
  let rem = dice ? expandDice(dice) : [];
  for (const u of used) rem = removeOne(rem, u.d);
  return { s, pos, dice, rem, used, k: used.length, M: room.maxUse || 0, start: room.pos };
}

/* 지금 둘 수 있는 걸음 [{from,to,die}] — 최대로 쓰는 수열의 접두어만 */
export function legalNow(T) {
  if (!T.dice) return [];
  const need = T.M - T.k;
  if (need <= 0) return [];
  const isDouble = T.dice[0] === T.dice[1];
  const big = Math.max(T.dice[0], T.dice[1]);
  const bigOnly = T.M === 1 && !isDouble && T.k === 0 && stepsFor(T.pos, T.s, big).length > 0;
  const out = [];
  for (const d of uniq(T.rem)) {
    if (bigOnly && d !== big) continue;
    const r2 = removeOne(T.rem, d);
    for (const [f, t] of stepsFor(T.pos, T.s, d)) {
      const p2 = clonePos(T.pos); applyStep(p2, T.s, f, t);
      if (1 + maxLen(p2, T.s, r2) === need) out.push({ from: f, to: t, die: d });
    }
  }
  return out;
}

/* 안 되는 걸음의 이유 (처음 하는 사람이 알아듣게) */
function whyNot(T, f, t) {
  const mine = T.pos[T.s];
  if (!(f >= 1 && f <= 25) || !(t >= 0 && t <= 24)) return '그런 칸이 없어요';
  if (!mine[f]) return f === BAR ? '바에 내 말이 없어요' : '그 칸에 내 말이 없어요';
  if (mine[BAR] && f !== BAR) return '잡혀서 바에 있는 말부터 상대 홈으로 들여보내야 해요';
  if (t >= f) return '말은 앞으로만 가요 (번호가 작아지는 쪽)';
  if (t !== OFF && oppAt(T.pos, T.s, t) >= 2) return '상대 말이 2개 이상 있는 칸엔 못 가요';
  if (t === OFF && !allHome(mine)) return '말 15개가 전부 홈(1~6칸)에 들어와야 빼낼 수 있어요';
  const dist = f - t;
  const remTxt = uniq(T.rem).join(', ');
  if (t === OFF) {
    if (!T.rem.some((d) => d >= dist)) return `주사위 눈(${remTxt})이 모자라요 — ${dist} 이상이 나와야 빼요`;
    if (!T.rem.includes(dist)) return '더 먼 말이 남아 있으면 큰 눈으로는 못 빼요 — 먼 말부터 옮겨요';
  } else if (!T.rem.includes(dist)) {
    return `${dist}칸은 못 가요 — 남은 주사위(${remTxt}) 하나씩 옮겨요`;
  }
  const isDouble = T.dice[0] === T.dice[1];
  if (T.M === 1 && !isDouble) return '주사위 하나만 쓸 수 있을 땐 큰 눈을 써야 해요';
  return '그렇게 옮기면 남은 주사위를 못 써요 — 주사위를 다 쓰는 다른 방법이 있어요';
}

function setup(room) {
  room.pos = [startArr(), startArr()];
  room.turnNo = 0;          // 몇 번째 차례인가 (선공의 첫 차례 = 0)
  room.dice = null;         // 이번 차례 주사위 (굴리기 전 null)
  room.used = [];           // 이번 차례에 둔 걸음 {f,t,d,h}
  room.maxUse = 0;          // 이번 차례에 꼭 써야 하는 걸음 수
  room.log = [];            // 지난 차례들 {seat, dice, moves:[{f,t,h}], pass}
}
function nextTurn(room) {
  room.turnNo++;
  room.dice = null; room.used = []; room.maxUse = 0;
}

export function status(ctx) {
  const { room, docs, joined } = ctx;
  if (!joined) return { phase: 'wait', first: null };
  const first = firstOf(ctx);
  if (first === null) return { phase: 'pick', first };
  const turn = (first + room.turnNo) % 2;
  const T = turnState(room, turn);
  let winner = null, reason = null, kind = null;
  for (const s of [0, 1]) if (T.pos[s][OFF] === 15) winner = s;
  if (winner !== null) {
    reason = 'off';
    const lo = T.pos[1 - winner];
    kind = 'single';
    if (lo[OFF] === 0) {
      kind = 'gammon';
      for (let i = 19; i <= 25; i++) if (lo[i]) kind = 'backgammon';   // 진 쪽 기준 19~24 = 이긴 쪽 홈
    }
  } else {
    const quit = [0, 1].filter((i) => docs[i].resigned);
    if (quit.length) { winner = 1 - quit[0]; reason = 'resign'; kind = 'single'; }
  }
  return { phase: winner === null ? 'play' : 'done', first, turn, T, winner, reason, kind };
}

/* 사람 s 기준 칸 번호 → 사람 v 기준 */
const toView = (p, s, v) => (s === v || p === BAR || p === OFF ? p : 25 - p);

/* 상대 말을 내 기준 칸에 놓는다. them[25] 상대 바, them[0] 상대가 빼낸 말 */
function themOf(opp) {
  const them = new Array(26).fill(0);
  for (let i = 1; i <= 24; i++) them[i] = opp[25 - i];
  them[BAR] = opp[BAR]; them[OFF] = opp[OFF];
  return them;
}

function view(ctx) {
  const { room, idx } = ctx;
  const s = status(ctx);
  const base = { phase: s.phase, pick: pickView(ctx), first: s.first };
  if (s.phase === 'wait' || s.phase === 'pick') return { ...base, me: startArr(), them: themOf(startArr()), log: [] };
  const T = s.T;
  const mine = T.pos[idx], opp = T.pos[1 - idx];
  const them = themOf(opp);
  const yourTurn = s.phase === 'play' && s.turn === idx;
  const legal = yourTurn ? legalNow(T) : [];
  const pairs = [];
  for (const m of legal) if (!pairs.some(([a, b]) => a === m.from && b === m.to)) pairs.push([m.from, m.to]);
  // 상대가 최근에 옮긴 길 (지금 옮기는 중이거나, 지난 차례)
  let trail = [];
  if (s.turn !== idx && T.used.length) trail = T.used;
  else { const last = room.log[room.log.length - 1]; if (last && last.seat !== idx) trail = last.moves; }
  const mover = 1 - idx;
  return {
    ...base,
    myColor: s.first === idx ? 'light' : 'dark',
    turn: s.turn, yourTurn, turnNo: room.turnNo,
    me: mine, them,
    pips: [pip(mine), pip(opp)],
    dice: T.dice, rem: T.rem, usedDice: T.used.map((u) => u.d), steps: T.used.length, need: T.M,
    legal: pairs,
    canUndo: yourTurn && T.used.length > 0,
    canEnd: yourTurn && !!T.dice && legal.length === 0,
    trail: trail.map((m) => ({ from: toView(m.f, mover, idx), to: toView(m.t, mover, idx), hit: !!m.h })),
    log: room.log.slice(-8).map((e) => ({ who: e.seat === idx ? 'me' : 'them', dice: e.dice, n: e.moves.length, hits: e.moves.filter((m) => m.h).length, pass: !!e.pass })),
    winner: s.winner, reason: s.reason, kind: s.kind,
    mult: s.kind === 'backgammon' ? 3 : s.kind === 'gammon' ? 2 : s.kind ? 1 : null,
  };
}

function myTurn(ctx) {
  const s = status(ctx);
  if (s.phase !== 'play') return { err: { error: '지금은 할 수 없어요', status: 409 } };
  if (s.turn !== ctx.idx) return { err: { error: '상대 차례예요', status: 409 } };
  return { s };
}

const actions = {
  throw: pickThrow,
  roll(ctx) {
    const { err } = myTurn(ctx); if (err) return err;
    const room = ctx.room;
    if (room.dice) return { error: '이미 굴렸어요 — 말을 옮겨요', status: 409 };
    room.dice = rollDice(room.code, room.round, room.turnNo);
    room.used = [];
    room.maxUse = maxLen(room.pos, ctx.idx, expandDice(room.dice));
    if (room.maxUse === 0) {                        // 갈 곳이 하나도 없다 — 바로 넘긴다
      room.log.push({ seat: ctx.idx, dice: room.dice, moves: [], pass: true });
      nextTurn(room);
    }
    ctx.touchRoom = true;
    return null;
  },
  move(ctx) {
    const { err } = myTurn(ctx); if (err) return err;
    const room = ctx.room;
    if (!room.dice) return { error: '먼저 주사위를 굴려요', status: 409 };
    const f = Number(ctx.body.from), t = Number(ctx.body.to);
    if (!Number.isInteger(f) || !Number.isInteger(t)) return { error: '그런 칸이 없어요', status: 400 };
    const T = turnState(room, ctx.idx);
    if (T.k >= T.M) return { error: '주사위를 다 썼어요 — 확정을 눌러요', status: 409 };
    const cand = legalNow(T).filter((m) => m.from === f && m.to === t);
    if (!cand.length) return { error: whyNot(T, f, t), status: 409 };
    const want = Number(ctx.body.die);
    const pick = cand.find((m) => m.die === want) || cand.reduce((a, b) => (b.die < a.die ? b : a));
    const p2 = clonePos(T.pos);
    const h = applyStep(p2, ctx.idx, f, t);
    room.used = [...T.used, { f, t, d: pick.die, h }];
    ctx.touchRoom = true;
    return null;
  },
  undo(ctx) {
    const { err } = myTurn(ctx); if (err) return err;
    const room = ctx.room;
    if (!room.used || !room.used.length) return { error: '되돌릴 게 없어요', status: 409 };
    room.used = room.used.slice(0, -1);
    ctx.touchRoom = true;
    return null;
  },
  end(ctx) {
    const { err } = myTurn(ctx); if (err) return err;
    const room = ctx.room;
    if (!room.dice) return { error: '먼저 주사위를 굴려요', status: 409 };
    const T = turnState(room, ctx.idx);
    if (legalNow(T).length) return { error: '아직 옮길 수 있어요 — 주사위를 쓸 수 있는 만큼 다 써야 해요', status: 409 };
    room.log.push({ seat: ctx.idx, dice: room.dice, moves: T.used.map((u) => ({ f: u.f, t: u.t, h: u.h })) });
    if (room.log.length > 40) room.log = room.log.slice(-40);
    room.pos = T.pos;
    nextTurn(room);
    ctx.touchRoom = true;
    return null;
  },
  resign(ctx) {
    if (status(ctx).phase !== 'play') return { error: '게임 중이 아니에요', status: 409 };
    ctx.me.resigned = true;
    ctx.touchMe = true;
    return null;
  },
};

/* ---- 혼자 하기 봇 (적당한 난이도) ----
 * 굴린 뒤 지금 위치에서 끝까지 둘 수 있는 수열을 전부 만들고(같은 결과는 하나로), 끝난 판을 평가해서
 * 가장 좋은 수열의 첫 걸음만 둔다. 다음 걸음은 다음 요청에서 다시 계산한다.
 * 평가: 핍 차이(잡으면 상대 핍이 늘어서 저절로 가산) · 블롯 노출 감점 · 칸 만들기(홈·7칸 높게) · 프라임 ·
 *   상대가 바에 있으면 내 홈이 단단할수록 가산 · 쌓아두기 감점 · 빼낸 말. 접촉이 끝난 경주면 핍과 빼내기만.
 * '적당히' — 결과 판마다 정해진 흔들림(±4핍쯤)을 더한다. 차례마다 씨앗이 같아서 걸음 사이에 계획이 안 바뀐다.
 */
const HOME_W = [0, 3, 4, 5, 7, 8, 8, 6];      // 1~7칸을 막았을 때 가산
export function evaluate(pos, s) {
  const me = pos[s], op = pos[1 - s];
  let v = (pip(op) - pip(me)) + me[OFF] * 2;
  let myBack = 0; for (let i = 25; i >= 1; i--) if (me[i]) { myBack = i; break; }
  let opBack = 25; for (let j = 25; j >= 1; j--) if (op[j]) { opBack = 25 - j; break; }   // 내 기준. 상대 바 = 0
  if (opBack >= myBack) return v + me[OFF] * 2;   // 경주 — 서로 지나쳤다
  // 상대 말 위치 (내 기준 칸, 바 = 0)
  const opSpots = [];
  if (op[BAR]) opSpots.push(0);
  for (let j = 1; j <= 24; j++) if (op[j]) opSpots.push(25 - j);
  let myHomeMade = 0, opHomeMade = 0;
  for (let i = 1; i <= 6; i++) { if (me[i] >= 2) myHomeMade++; if (op[i] >= 2) opHomeMade++; }
  let run = 0;
  for (let i = 1; i <= 24; i++) {
    const n = me[i];
    if (n >= 2) {
      v += i <= 7 ? HOME_W[i] : i >= 19 ? 2.5 : i <= 11 ? 2 : 1;
      run++; if (run >= 3) v += 3 + (run - 3) * 2;
      if (n > 3) v -= (n - 3) * 0.7;
    } else run = 0;
    if (n === 1) {
      let p = 0;
      for (const k of opSpots) { const dd = i - k; if (dd >= 1 && dd <= 6) p += 0.31; else if (dd >= 7 && dd <= 12) p += 0.1; }
      if (p > 0) v -= Math.min(p, 0.9) * (25 - i + 6) * 0.8;
    }
  }
  v += op[BAR] * (2 + myHomeMade * 2);
  v -= me[BAR] * opHomeMade * 1.5;
  return v;
}
const posKey = (pos) => pos[0].join(',') + '|' + pos[1].join(',');

/* 지금 위치에서 끝까지 두는 수열들 → 결과 판마다 첫 걸음 */
export function finals(T) {
  const out = new Map();                // key → { pos, first }
  const seen = new Set();
  const need = T.M - T.k;
  const first = legalNow(T);
  for (const m of first) {
    const p = clonePos(T.pos); applyStep(p, T.s, m.from, m.to);
    walk(p, removeOne(T.rem, m.die), need - 1, m);
  }
  function walk(pos, rem, left, firstStep) {
    const key = posKey(pos);
    if (left === 0) { if (!out.has(key)) out.set(key, { pos, first: firstStep }); return; }
    const sk = key + '#' + rem.join('');
    if (seen.has(sk)) return;
    seen.add(sk);
    for (const d of uniq(rem)) {
      const r2 = removeOne(rem, d);
      for (const [f, t] of stepsFor(pos, T.s, d)) {
        const p2 = clonePos(pos); applyStep(p2, T.s, f, t);
        if (left - 1 > 0 && maxLen(p2, T.s, r2) < left - 1) continue;
        walk(p2, r2, left - 1, firstStep);
      }
    }
  }
  return [...out.values()];
}

export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase === 'pick') return pickBot(ctx, rnd);
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const room = ctx.room;
  if (!room.dice) return { act: 'roll' };
  const T = s.T;
  if (!legalNow(T).length) return { act: 'end' };
  const salt = `${room.code}:${room.round}:${room.turnNo}:bot`;
  let best = null, bestV = -Infinity;
  for (const c of finals(T)) {
    const v = evaluate(c.pos, T.s) + (seeded(salt + posKey(c.pos))() - 0.5) * 8;
    if (v > bestV) { bestV = v; best = c; }
  }
  if (!best) { const m = legalNow(T)[0]; return { act: 'move', body: { from: m.from, to: m.to, die: m.die } }; }
  return { act: 'move', body: { from: best.first.from, to: best.first.to, die: best.first.die } };
}

export const backgammon = {
  setup, view, actions, bot: botMove,
  options: (body) => ({ pick: pickKind(body.pick) }),
  finished: (ctx) => status(ctx).phase === 'done',
};

export const handle = (body, store, now) => handleRoom(backgammon, body, store, now);
