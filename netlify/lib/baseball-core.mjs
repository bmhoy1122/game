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
 * 선공은 방 코드 + 판 번호로 정한다(seeded) — 둘이 동시에 '다시 하기'를 눌러도 같다.
 */
import { handleRoom, roundRng } from './room-kit.mjs';

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
  room.first = roundRng(room)() < 0.5 ? 0 : 1;
  room.log = [];
}

/* 기록에서 지금 상태를 계산한다 — 저장하는 건 기록뿐이다 */
export function status(room, secrets, joined) {
  const n = [0, 0], hit = [false, false];
  for (const e of room.log) {
    n[e.by]++;
    if (e.s === DIGITS) hit[e.by] = true;
  }
  let phase;
  if (!joined) phase = 'wait';
  else if (!secrets[0] || !secrets[1]) phase = 'setup';
  else if (((hit[0] || hit[1]) && n[0] === n[1]) || (n[0] >= MAX_GUESSES && n[1] >= MAX_GUESSES)) phase = 'done';
  else phase = 'play';

  const turn = n[0] === n[1] ? room.first : (n[0] < n[1] ? 0 : 1);
  let winner = null;
  if (phase === 'done') winner = hit[0] && hit[1] ? 'draw' : hit[0] ? 0 : hit[1] ? 1 : 'draw';
  // 한 명은 맞혔는데 아직 횟수가 다르다 = 다른 한 명의 마지막 기회
  const lastChance = phase === 'play' && (hit[0] || hit[1]) ? turn : null;
  return { phase, turn, winner, n, hit, lastChance };
}

const secretsOf = (ctx) => (ctx.idx === 0 ? [ctx.me.secret, ctx.other.secret] : [ctx.other.secret, ctx.me.secret]);

function view(ctx) {
  const { room, idx, me, other, joined } = ctx;
  const st = status(room, secretsOf(ctx), joined);
  return {
    phase: st.phase,
    digits: DIGITS,
    maxGuesses: MAX_GUESSES,
    mySecret: me.secret || null,
    ready: !!me.secret,
    opponentReady: !!other.secret,
    first: room.first,
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
  secret(ctx) {
    const { me, other, joined, body } = ctx;
    if (!joined) return { error: '상대가 아직 안 들어왔어요', status: 409 };
    if (!validNumber(body.value)) return { error: '1~9 중 서로 다른 숫자 세 개를 골라주세요', status: 400 };
    // 둘 다 정하면 게임이 시작된다. 그 뒤엔 못 바꾼다.
    if (me.secret && other.secret) return { error: '이미 시작했어요', status: 409 };
    me.secret = String(body.value);
    ctx.touchMe = true;
    return null;
  },
  guess(ctx) {
    const { room, idx, other, joined, body } = ctx;
    const st = status(room, secretsOf(ctx), joined);
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

export const baseball = {
  setup, view, actions,
  finished: (ctx) => status(ctx.room, secretsOf(ctx), ctx.joined).phase === 'done',
};

export const handle = (body, store, now) => handleRoom(baseball, body, store, now);
