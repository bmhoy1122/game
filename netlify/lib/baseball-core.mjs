/* 숫자야구 — 각자 1~9 서로 다른 숫자 세 개를 숨기고 번갈아 맞힌다.
 *
 * 판정: 숫자와 자리가 다 맞으면 스트라이크, 숫자만 맞으면 볼, 하나도 없으면 아웃.
 * 3스트라이크면 맞힌 것.
 *
 * 공정하게: 선공이 먼저 맞히면 후공에게 마지막 한 번이 더 간다.
 *   둘 다 맞히면 무승부. 후공이 먼저 맞히면 이미 같은 횟수라 바로 끝난다.
 *   그래서 '끝났다'는 "누가 맞혔고 + 둘이 던진 횟수가 같다"로 판정한다.
 *
 * 비밀 숫자는 각자 자기 문서에만 쓴다(동시에 정해도 안 묻힌다).
 * 상대 비밀 숫자는 게임이 끝나기 전엔 응답에 절대 넣지 않는다.
 * 맞히기 기록은 공용 문서에 쓰는데, 차례제라 한 번에 한 명만 쓴다.
 * 선공은 둘이 미니게임(first-pick)으로 정한다. 기록에서 계산하니 따로 저장하지 않는다.
 */
import { handleRoom } from './room-kit.mjs';
import { pickKind, firstOf, pickView, pickThrow, pickBot } from './first-pick.mjs';

export const DIGITS = 3;
export const MAX_GUESSES = 20;        // 한 사람당. 여기까지 둘 다 못 맞히면 무승부

export function validNumber(v) {
  const s = String(v == null ? '' : v);
  if (!new RegExp(`^[1-9]{${DIGITS}}$`).test(s)) return false;
  return new Set(s).size === DIGITS;
}

export function judge(secret, guess) {
  let s = 0, b = 0;
  for (let i = 0; i < DIGITS; i++) {
    if (guess[i] === secret[i]) s++;
    else if (secret.includes(guess[i])) b++;
  }
  return { s, b };
}

function setup(room) {
  room.log = [];
}

/* 기록에서 지금 상태를 계산한다 — 저장하는 건 기록뿐이다 */
export function status(room, secrets, joined, first) {
  const n = [0, 0], hit = [false, false];
  for (const e of room.log) {
    n[e.by]++;
    if (e.s === DIGITS) hit[e.by] = true;
  }
  let phase;
  if (!joined) phase = 'wait';
  else if (first === null || first === undefined) phase = 'pick';
  else if (!secrets[0] || !secrets[1]) phase = 'setup';
  else if (((hit[0] || hit[1]) && n[0] === n[1]) || (n[0] >= MAX_GUESSES && n[1] >= MAX_GUESSES)) phase = 'done';
  else phase = 'play';

  const turn = n[0] === n[1] ? first : (n[0] < n[1] ? 0 : 1);
  let winner = null;
  if (phase === 'done') winner = hit[0] && hit[1] ? 'draw' : hit[0] ? 0 : hit[1] ? 1 : 'draw';
  // 한 명은 맞혔는데 아직 횟수가 다르다 = 다른 한 명의 마지막 기회
  const lastChance = phase === 'play' && (hit[0] || hit[1]) ? turn : null;
  return { phase, turn, winner, n, hit, lastChance };
}

const secretsOf = (ctx) => (ctx.idx === 0 ? [ctx.me.secret, ctx.other.secret] : [ctx.other.secret, ctx.me.secret]);

const statusOf = (ctx) => status(ctx.room, secretsOf(ctx), ctx.joined, ctx.joined ? firstOf(ctx) : null);

function view(ctx) {
  const { room, idx, me, other } = ctx;
  const st = statusOf(ctx);
  return {
    phase: st.phase,
    pick: pickView(ctx),
    digits: DIGITS,
    maxGuesses: MAX_GUESSES,
    mySecret: me.secret || null,
    ready: !!me.secret,
    opponentReady: !!other.secret,
    first: st.phase === 'wait' || st.phase === 'pick' ? null : firstOf(ctx),
    turn: st.turn,
    yourTurn: st.phase === 'play' && st.turn === idx,
    log: room.log.map((e) => ({ by: e.by, g: e.g, s: e.s, b: e.b })),
    lastChance: st.lastChance,
    winner: st.winner,
    // 끝나기 전에는 절대 안 보낸다
    theirSecret: st.phase === 'done' ? (other.secret || null) : null,
  };
}

const actions = {
  throw: pickThrow,
  secret(ctx) {
    const { me, other, joined, body } = ctx;
    if (!joined) return { error: '상대가 아직 안 들어왔어요', status: 409 };
    if (statusOf(ctx).phase === 'pick') return { error: '먼저 누가 먼저 할지 정해요', status: 409 };
    if (!validNumber(body.value)) return { error: '1~9 중 서로 다른 숫자 세 개를 골라주세요', status: 400 };
    // 둘 다 정하면 게임이 시작된다. 그 뒤엔 못 바꾼다.
    if (me.secret && other.secret) return { error: '이미 시작했어요', status: 409 };
    me.secret = String(body.value);
    ctx.touchMe = true;
    return null;
  },
  guess(ctx) {
    const { room, idx, other, body } = ctx;
    const st = statusOf(ctx);
    if (st.phase !== 'play') return { error: '지금은 맞힐 수 없어요', status: 409 };
    if (st.turn !== idx) return { error: '상대 차례예요', status: 409 };
    if (!validNumber(body.value)) return { error: '1~9 중 서로 다른 숫자 세 개를 넣어주세요', status: 400 };
    const g = String(body.value);
    const r = judge(other.secret, g);
    room.log.push({ by: idx, g, s: r.s, b: r.b });
    ctx.touchRoom = true;
    return null;
  },
};

/* ---- 혼자 하기 봇 (적당한 난이도) ----
 * 비밀 숫자는 무작위. 맞힐 땐 지금까지 자기 결과(스트라이크·볼)와 모순 없는 후보 중 아무거나 —
 * 사람이 머리로 하는 것과 같은 방식이라 평균 5~6번에 맞힌다 (최적 전략은 일부러 안 쓴다). */
const ALL_NUMBERS = (() => {
  const out = [];
  for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) for (let c = 1; c <= 9; c++) if (a !== b && b !== c && a !== c) out.push('' + a + b + c);
  return out;
})();
export function botMove(ctx, rnd = Math.random) {
  const st = statusOf(ctx);
  if (st.phase === 'pick') return pickBot(ctx, rnd);
  if (st.phase === 'setup') {
    if (ctx.me.secret) return null;
    return { act: 'secret', body: { value: ALL_NUMBERS[Math.floor(rnd() * ALL_NUMBERS.length)] } };
  }
  if (st.phase !== 'play' || st.turn !== ctx.idx) return null;
  const mine = ctx.room.log.filter((e) => e.by === ctx.idx);
  let cands = ALL_NUMBERS.filter((c) => mine.every((e) => { const j = judge(c, e.g); return j.s === e.s && j.b === e.b; }));
  if (!cands.length) cands = ALL_NUMBERS;
  return { act: 'guess', body: { value: cands[Math.floor(rnd() * cands.length)] } };
}

export const baseball = {
  setup, view, actions, bot: botMove,
  options: (body) => ({ pick: pickKind(body.pick) }),
  finished: (ctx) => statusOf(ctx).phase === 'done',
};

export const handle = (body, store, now) => handleRoom(baseball, body, store, now);
