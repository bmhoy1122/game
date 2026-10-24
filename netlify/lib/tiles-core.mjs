/* 비밀 타일 (다빈치 코드 방식, 2인) — 상대 줄의 숨은 숫자를 먼저 전부 맞히면 이긴다.
 *
 * 타일 24개: 검정 0~11, 흰색 0~11. 조커는 없다(원작의 조커 규칙은 뺐다).
 * 타일 하나는 코드 k = 숫자 × 2 + (흰색이면 1). 그래서 k 로 정렬하면 바로
 * '작은 수 → 큰 수, 같은 수면 검정이 왼쪽' 줄이 된다.
 *
 * 시작: 섞어서 각자 4개, 나머지 16개는 가운데 더미. 상대에겐 색만 보인다.
 * 내 차례
 *   ① 더미에서 하나 가져온다 (검정/흰색 중 고른다 — 원작처럼 뒷면 색은 보인다. 더미가 비면 건너뜀)
 *   ② 상대의 숨은 타일 하나를 골라 숫자를 말한다
 *      맞히면 그 타일이 공개되고, 계속 맞히거나 멈출 수 있다 (멈추면 가져온 타일을 숨긴 채 내 줄에)
 *      틀리면 가져온 타일을 '공개한 채로' 내 줄에 넣고 차례 끝
 *      가져온 게 없는데 틀리면 내 숨은 타일 하나를 골라 공개한다
 *   한 차례에 최소 한 번은 맞혀야 멈출 수 있다.
 * 상대 줄이 전부 공개되면 이긴다 (내 줄이 전부 공개되면 진다).
 *
 * 저장: 손패 · 더미 · 가져온 타일은 공용 문서(room)에 둔다 — 차례제라 한 명만 쓰고, 서버만 본다.
 *   기권만 아무 때나 눌러서 자기 문서(me.resigned)에 쓴다.
 * 비밀: 상대 숨은 타일 숫자, 더미 순서, 상대가 이번에 가져온 타일 숫자 — view 에 절대 안 넣는다.
 *   타일마다 판 안에서 안 바뀌는 번호(id)가 있어서, 추측 기록은 id 로 남긴다 (숫자는 안 남긴다).
 * 후보(cands): 내 눈에 보이는 것만으로(내 타일 · 공개된 타일 · 색 · 줄 순서 · 틀린 추측) 상대 숨은 타일마다
 *   가능한 숫자를 계산해서 준다. 화면의 '도움'과 봇이 같이 쓴다. 상대 비밀은 안 쓴다.
 */
import { handleRoom, roundRng, shuffle } from './room-kit.mjs';
import { pickKind, firstOf, pickView, pickThrow, pickBot } from './first-pick.mjs';

export const MAXN = 11, START = 4, TOTAL = 24;
export const codeOf = (n, c) => n * 2 + (c === 'w' ? 1 : 0);
export const numOf = (k) => k >> 1;
export const colOf = (k) => (k & 1 ? 'w' : 'b');

function insert(hand, tile) {
  let i = 0;
  while (i < hand.length && hand[i].k < tile.k) i++;
  hand.splice(i, 0, tile);
  return i;
}

function setup(room) {
  const all = [];
  for (let k = 0; k < TOTAL; k++) all.push(k);
  shuffle(all, roundRng(room));                       // seeded — 둘이 동시에 '다시 하기'를 눌러도 같은 판
  const deal = (arr, base) => arr.sort((a, b) => a - b).map((k, i) => ({ k, id: base + i, open: false }));
  room.hands = [deal(all.slice(0, START), 0), deal(all.slice(START, START * 2), START)];
  room.deck = all.slice(START * 2);
  room.nextId = START * 2;
  room.turns = 0;           // 끝난 차례 수 → 지금 차례 = (선공 + turns) % 2
  room.stage = 'draw';      // draw → guess → (맞히면) more → … / (빈 더미에서 틀리면) reveal
  room.streak = 0;          // 이번 차례에 맞힌 수
  room.drawn = null;        // { k, id, by } 이번 차례에 가져온 타일 (아직 줄에 안 넣음)
  room.log = [];            // 공개 기록 — 숫자는 공개된 것만
}

export function status(ctx) {
  const { room, docs, joined } = ctx;
  if (!joined) return { phase: 'wait', first: null };
  const first = firstOf(ctx);
  if (first === null) return { phase: 'pick', first };
  const turn = (first + room.turns) % 2;
  const allOpen = (h) => h.length > 0 && h.every((t) => t.open);
  let winner = null, reason = null;
  if (allOpen(room.hands[1])) { winner = 0; reason = 'open'; }
  else if (allOpen(room.hands[0])) { winner = 1; reason = 'open'; }
  else {
    const quit = [0, 1].filter((i) => docs[i].resigned);
    if (quit.length) { winner = 1 - quit[0]; reason = 'resign'; }
  }
  return { phase: winner === null ? 'play' : 'done', first, turn, winner, reason };
}

/* 틀린 추측 기록 { 타일 id: [숫자…] } */
export function wrongMap(room) {
  const w = {};
  for (const e of room.log) if (e.t === 'g' && !e.ok) (w[e.tid] = w[e.tid] || []).push(e.n);
  return w;
}

/* idx 가 보는 상대(1-idx) 숨은 타일 후보 { 타일 id: [숫자…] }.
 * 내 눈에 보이는 것만 쓴다: 내 줄, 내가 가져온 타일, 상대 공개 타일, 색, 줄 순서, 틀린 추측.
 * 줄은 k 가 왼쪽부터 엄격히 커진다 → 왼쪽부터 '가능한 가장 작은 값', 오른쪽부터 '가장 큰 값'을
 * 욕심껏 채우면 칸마다 [lo, hi] 가 나오고, 그 사이 남은 값은 전부 실제로 가능하다. */
export function candidates(room, idx) {
  const opp = room.hands[1 - idx];
  const seen = new Set();
  room.hands[idx].forEach((t) => seen.add(t.k));
  opp.forEach((t) => { if (t.open) seen.add(t.k); });
  if (room.drawn && room.drawn.by === idx) seen.add(room.drawn.k);
  const wrong = wrongMap(room);
  const allowed = opp.map((t) => {
    if (t.open) return [t.k];
    const bad = new Set(wrong[t.id] || []);
    const out = [];
    for (let k = t.k & 1; k < TOTAL; k += 2) if (!seen.has(k) && !bad.has(numOf(k))) out.push(k);
    return out;
  });
  const lo = [], hi = [];
  let prev = -1;
  for (let p = 0; p < opp.length; p++) {
    const v = allowed[p].find((k) => k > prev);
    lo[p] = v === undefined ? TOTAL : v; prev = lo[p];
  }
  let next = TOTAL;
  for (let p = opp.length - 1; p >= 0; p--) {
    let v = -1;
    for (const k of allowed[p]) if (k < next) v = k;
    hi[p] = v; next = v;
  }
  const out = {};
  opp.forEach((t, p) => {
    if (t.open) return;
    out[t.id] = allowed[p].filter((k) => k >= lo[p] && k <= hi[p]).map(numOf);
  });
  return out;
}

function view(ctx) {
  const { room, idx } = ctx;
  const s = status(ctx);
  const done = s.phase === 'done';
  const pub = (t, mine) => ({ id: t.id, c: colOf(t.k), open: t.open, n: mine || t.open || done ? numOf(t.k) : null });
  const play = s.phase === 'play';
  const d = room.drawn;
  return {
    phase: s.phase,
    pick: pickView(ctx),
    first: s.first === undefined ? null : s.first,
    turn: play ? s.turn : null,
    yourTurn: play && s.turn === idx,
    stage: play ? room.stage : null,
    streak: room.streak,
    fresh: room.turns === 0 && room.log.length === 0,
    mine: room.hands[idx].map((t) => pub(t, true)),
    theirs: room.hands[1 - idx].map((t) => pub(t, false)),
    deckB: room.deck.filter((k) => !(k & 1)).length,
    deckW: room.deck.filter((k) => k & 1).length,
    // 가져온 타일 — 내 거면 숫자까지, 상대 거면 색만
    drawn: d ? (d.by === idx ? { by: d.by, c: colOf(d.k), n: numOf(d.k) } : { by: d.by, c: colOf(d.k), n: null }) : null,
    log: room.log,
    wrong: wrongMap(room),
    cands: play ? candidates(room, idx) : {},
    winner: s.winner === undefined ? null : s.winner,
    reason: s.reason || null,
  };
}

function endTurn(room) {
  room.turns++;
  room.streak = 0;
  room.drawn = null;
  room.stage = room.deck.length ? 'draw' : 'guess';
}
function myTurnErr(ctx) {
  const s = status(ctx);
  if (s.phase !== 'play') return { error: '지금은 게임 중이 아니에요', status: 409 };
  if (s.turn !== ctx.idx) return { error: '상대 차례예요', status: 409 };
  return null;
}
const STAGE_MSG = {
  draw: '먼저 가운데 더미에서 타일을 하나 가져와요',
  guess: '상대 타일을 골라 숫자를 맞혀봐요',
  more: '더 맞히거나 멈출 수 있어요',
  reveal: '틀려서 내 숨은 타일 하나를 골라 공개해야 해요',
};

const actions = {
  throw: pickThrow,
  draw(ctx) {
    const e = myTurnErr(ctx); if (e) return e;
    const { room, idx, body } = ctx;
    if (room.stage !== 'draw') return { error: room.drawn ? '이번 차례엔 이미 가져왔어요' : STAGE_MSG[room.stage], status: 409 };
    const c = body.c === 'w' || body.c === 'b' ? body.c : null;
    const i = c ? room.deck.findIndex((k) => colOf(k) === c) : 0;
    if (i < 0 || !room.deck.length) return { error: (c === 'w' ? '흰' : '검정') + ' 타일이 더미에 없어요', status: 409 };
    const k = room.deck.splice(i, 1)[0];
    room.drawn = { k, id: room.nextId++, by: idx };
    room.stage = 'guess';
    room.log.push({ t: 'draw', by: idx, c: colOf(k) });
    ctx.touchRoom = true;
    return null;
  },
  guess(ctx) {
    const e = myTurnErr(ctx); if (e) return e;
    const { room, idx, body } = ctx;
    if (room.stage !== 'guess' && room.stage !== 'more') return { error: STAGE_MSG[room.stage], status: 409 };
    const tid = body.tid, n = body.n;
    if (!Number.isInteger(n) || n < 0 || n > MAXN) return { error: '0~11 중 숫자를 골라주세요', status: 400 };
    const opp = room.hands[1 - idx];
    const tile = opp.find((t) => t.id === tid);
    if (!tile || tile.open) return { error: '상대의 숨은 타일(?)을 골라주세요', status: 400 };
    if ((wrongMap(room)[tid] || []).includes(n)) return { error: '그 타일엔 이미 틀렸던 숫자예요', status: 409 };
    const ok = numOf(tile.k) === n;
    room.log.push({ t: 'g', by: idx, tid, n, ok });
    if (ok) {
      tile.open = true;
      room.streak++;
      room.stage = 'more';
      if (opp.every((t) => t.open) && room.drawn) {      // 이겼다 — 가져온 타일은 숨긴 채 줄에
        insert(room.hands[idx], { k: room.drawn.k, id: room.drawn.id, open: false });
        room.drawn = null;
      }
    } else if (room.drawn) {
      insert(room.hands[idx], { k: room.drawn.k, id: room.drawn.id, open: true });
      room.log.push({ t: 'miss', by: idx, tid: room.drawn.id, n: numOf(room.drawn.k), c: colOf(room.drawn.k) });
      endTurn(room);
    } else if (room.hands[idx].some((t) => !t.open)) {
      room.stage = 'reveal';
    } else {
      endTurn(room);
    }
    ctx.touchRoom = true;
    return null;
  },
  stop(ctx) {
    const e = myTurnErr(ctx); if (e) return e;
    const { room, idx } = ctx;
    if (room.stage !== 'more') {
      return { error: room.stage === 'guess' ? '한 번은 맞혀야 멈출 수 있어요' : STAGE_MSG[room.stage], status: 409 };
    }
    let tid = null;
    if (room.drawn) { insert(room.hands[idx], { k: room.drawn.k, id: room.drawn.id, open: false }); tid = room.drawn.id; }
    room.log.push({ t: 'stop', by: idx, tid });
    endTurn(room);
    ctx.touchRoom = true;
    return null;
  },
  reveal(ctx) {
    const e = myTurnErr(ctx); if (e) return e;
    const { room, idx, body } = ctx;
    if (room.stage !== 'reveal') return { error: '지금은 내 타일을 공개할 때가 아니에요', status: 409 };
    const tile = room.hands[idx].find((t) => t.id === body.tid);
    if (!tile || tile.open) return { error: '내 줄에서 아직 숨은 타일을 골라주세요', status: 400 };
    tile.open = true;
    room.log.push({ t: 'reveal', by: idx, tid: tile.id, n: numOf(tile.k), c: colOf(tile.k) });
    endTurn(room);
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
 * 상대 숨은 타일마다 후보(candidates — 사람 화면의 '도움'과 같은 계산)를 세고,
 * 후보가 가장 적은 타일을 골라 그중 아무 숫자나 말한다.
 * 맞히면 후보가 1~2개인 타일이 남아 있으면 계속, 아니면 멈춘다.
 * 더미에선 남은 수가 많은 색을 조금 더 자주 고른다. 빈 더미에서 틀리면 아무 숨은 타일이나 공개. */
export function botMove(ctx, rnd = Math.random) {
  const s = status(ctx);
  if (s.phase === 'pick') return pickBot(ctx, rnd);
  if (s.phase !== 'play' || s.turn !== ctx.idx) return null;
  const { room, idx } = ctx;
  if (room.stage === 'draw') {
    const nb = room.deck.filter((k) => !(k & 1)).length, nw = room.deck.length - nb;
    return { act: 'draw', body: { c: rnd() * (nb + nw) < nb ? 'b' : 'w' } };
  }
  if (room.stage === 'reveal') {
    const hid = room.hands[idx].filter((t) => !t.open);
    return { act: 'reveal', body: { tid: hid[Math.floor(rnd() * hid.length)].id } };
  }
  const cands = candidates(room, idx);
  let best = [], min = Infinity;
  for (const t of room.hands[1 - idx]) {
    if (t.open) continue;
    let c = cands[t.id];
    if (!c || !c.length) {                       // 계산이 틀렸을 리는 없지만, 멈추지 않게
      const bad = wrongMap(room)[t.id] || [];
      c = [...Array(MAXN + 1).keys()].filter((n) => !bad.includes(n));
    }
    if (c.length < min) { min = c.length; best = [[t, c]]; }
    else if (c.length === min) best.push([t, c]);
  }
  if (!best.length) return room.stage === 'more' ? { act: 'stop', body: {} } : null;
  if (room.stage === 'more' && min > 2) return { act: 'stop', body: {} };
  const [t, c] = best[Math.floor(rnd() * best.length)];
  return { act: 'guess', body: { tid: t.id, n: c[Math.floor(rnd() * c.length)] } };
}

export const tiles = {
  setup, view, actions, bot: botMove,
  options: (body) => ({ pick: pickKind(body.pick) }),
  finished: (ctx) => status(ctx).phase === 'done',
};

export const handle = (body, store, now) => handleRoom(tiles, body, store, now);
