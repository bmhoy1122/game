/* 선 정하기 — 가위바위보 · 묵찌빠 · 하나빼기 · 랜덤.
 * 차례가 있는 게임(빙고 · 숫자야구 · 오목)이 판마다 먼저 이걸 한다.
 *
 * 둘이 동시에 내는 게임이라, 낸 손은 각자 자기 문서(me.throws)에만 쓴다.
 * 결과는 두 사람의 기록만 보고 계산한다 — 공용 문서를 아예 안 쓴다.
 * 그래서 둘이 같은 순간에 내도 한쪽이 묻히지 않고, 누가 이겼는지도 언제 물어봐도 같다.
 *
 * 상대가 이번 단계에 아직 안 냈으면 내 손을 응답에 안 넣는다 (먼저 낸 쪽이 손해 안 보게).
 * 상대가 내기 전에는 내 손을 바꿀 수 있다.
 *
 * 손: 'r' 바위 · 's' 가위 · 'p' 보
 *  rps  매 단계 한 손. 비기면 다시.
 *  mjb  첫 가위바위보 이긴 쪽이 공격. 그다음부터 같은 손이 나오면 공격이 이긴다.
 *       다르면 그 판을 이긴 쪽이 공격이 된다.
 *  hana 짝수 단계에 두 손을 내고(['r','s']), 홀수 단계에 하나를 뺀다(남길 손 0|1).
 *       남은 손끼리 가위바위보. 비기면 두 손부터 다시.
 *  coin 내는 것 없이 방 코드 + 판 번호로 바로 정한다.
 */
import { roundRng } from './room-kit.mjs';

export const KINDS = { rps: '가위바위보', mjb: '묵찌빠', hana: '하나빼기', coin: '랜덤' };
export const pickKind = (v) => (Object.prototype.hasOwnProperty.call(KINDS, v) ? v : 'rps');

const SIGNS = ['r', 's', 'p'];
const isSign = (v) => SIGNS.includes(v);
/* a 가 이기면 1, b 가 이기면 -1, 비기면 0 */
export function beats(a, b) {
  if (a === b) return 0;
  return (a === 'r' && b === 's') || (a === 's' && b === 'p') || (a === 'p' && b === 'r') ? 1 : -1;
}

/* 이번 단계에 낼 것의 모양 */
export function need(kind, step) {
  if (kind === 'hana') return step % 2 === 0 ? 'pair' : 'keep';
  return 'sign';
}
function validFor(kind, step, v) {
  const n = need(kind, step);
  if (n === 'sign') return isSign(v);
  if (n === 'pair') return Array.isArray(v) && v.length === 2 && v.every(isSign);
  return v === 0 || v === 1;
}

/* 두 사람이 낸 기록 A(0번) · B(1번) 으로 지금까지를 푼다.
   { winner: 0|1|null, step: 다음에 낼 단계, rounds: 공개된 결과들, attacker } */
export function resolve(kind, A, B) {
  A = A || []; B = B || [];
  const both = Math.min(A.length, B.length);
  const rounds = [];
  let winner = null, attacker = null;

  if (kind === 'rps') {
    for (let k = 0; k < both && winner === null; k++) {
      const r = beats(A[k], B[k]);
      rounds.push({ a: A[k], b: B[k], r });
      if (r) winner = r > 0 ? 0 : 1;
    }
    return { winner, step: rounds.length, rounds, attacker };
  }

  if (kind === 'mjb') {
    for (let k = 0; k < both && winner === null; k++) {
      const r = beats(A[k], B[k]);
      const before = attacker;
      if (attacker === null) { if (r) attacker = r > 0 ? 0 : 1; }
      else if (r === 0) winner = attacker;          // 같은 손 — 공격이 이긴다
      else attacker = r > 0 ? 0 : 1;                // 다르면 이긴 쪽이 공격
      rounds.push({ a: A[k], b: B[k], r, before, attacker });
    }
    return { winner, step: rounds.length, rounds, attacker };
  }

  if (kind === 'hana') {
    let k = 0;
    for (; k + 1 < both && winner === null; k += 2) {
      const a = A[k][A[k + 1]], b = B[k][B[k + 1]];
      const r = beats(a, b);
      rounds.push({ pa: A[k], pb: B[k], a, b, r });
      if (r) winner = r > 0 ? 0 : 1;
    }
    // 두 손은 둘 다 냈는데 아직 안 뺐으면 두 손까지만 공개한다
    const open = winner === null && k < both ? { pa: A[k], pb: B[k] } : null;
    return { winner, step: winner === null ? Math.max(k, 0) + (open ? 1 : 0) : k, rounds, attacker, open };
  }
  return { winner: null, step: 0, rounds, attacker };
}

/* 누가 먼저인가 — 아직 안 정해졌으면 null */
export function firstOf(ctx) {
  const kind = ctx.room.opts && ctx.room.opts.pick;
  if (kind === 'coin') return roundRng(ctx.room)() < 0.5 ? 0 : 1;
  const [d0, d1] = ctx.docs;
  return resolve(pickKind(kind), d0.throws, d1.throws).winner;
}

/* 화면에 줄 것. me/them 기준으로 돌려서 준다 */
export function pickView(ctx) {
  const kind = pickKind(ctx.room.opts && ctx.room.opts.pick);
  const { idx } = ctx;
  if (kind === 'coin') {
    return { kind, label: KINDS[kind], first: firstOf(ctx), done: true, rounds: [], need: null };
  }
  const A = ctx.docs[0].throws || [], B = ctx.docs[1].throws || [];
  const r = resolve(kind, A, B);
  const mine = idx === 0 ? A : B, theirs = idx === 0 ? B : A;
  const meAt = (o) => (idx === 0 ? o.a : o.b), themAt = (o) => (idx === 0 ? o.b : o.a);
  const step = r.step;
  return {
    kind, label: KINDS[kind],
    first: r.winner,                        // 0|1 (방 기준 번호) — 클라이언트는 you 와 비교한다
    done: r.winner !== null,
    attacker: r.attacker,                   // 묵찌빠: 지금 공격하는 사람 (방 기준)
    need: r.winner === null ? need(kind, step) : null,
    step,
    rounds: r.rounds.map((o) => (kind === 'hana'
      ? { me: meAt(o), them: themAt(o), mePair: idx === 0 ? o.pa : o.pb, themPair: idx === 0 ? o.pb : o.pa, r: idx === 0 ? o.r : -o.r }
      : { me: meAt(o), them: themAt(o), r: idx === 0 ? o.r : -o.r, attacker: o.attacker, before: o.before })),
    open: r.open ? { me: idx === 0 ? r.open.pa : r.open.pb, them: idx === 0 ? r.open.pb : r.open.pa } : null,
    // 이번 단계 — 내 손은 나한테만, 상대는 냈는지만
    mineNow: mine.length > step ? mine[step] : null,
    theirsIn: theirs.length > step,
  };
}

/* 손 내기. 게임의 actions 에 throw 로 붙인다 */
export function pickThrow(ctx) {
  const kind = pickKind(ctx.room.opts && ctx.room.opts.pick);
  if (!ctx.joined) return { error: '상대가 아직 안 들어왔어요', status: 409 };
  if (kind === 'coin') return { error: '랜덤이라 낼 게 없어요', status: 409 };
  const A = ctx.docs[0].throws || [], B = ctx.docs[1].throws || [];
  const r = resolve(kind, A, B);
  if (r.winner !== null) return { error: '이미 정해졌어요', status: 409 };
  const mine = (ctx.me.throws || []).slice();
  const theirs = ctx.other.throws || [];
  const v = ctx.body.value;
  // 지금 단계 = 둘 중 덜 낸 쪽. 내가 아직이면 새로 내고(상대가 먼저 냈어도 된다),
  // 나만 냈고 상대가 아직이면 바꾼다.
  const cur = Math.min(mine.length, theirs.length);
  let at;
  if (mine.length === cur) at = cur;
  else if (mine.length === cur + 1 && theirs.length === cur) at = cur;
  else return { error: '상대가 낼 때까지 기다려주세요', status: 409 };
  if (!validFor(kind, at, v)) {
    return { error: need(kind, at) === 'pair' ? '두 손을 골라주세요' : need(kind, at) === 'keep' ? '남길 손을 골라주세요' : '가위 · 바위 · 보 중 하나를 골라주세요', status: 400 };
  }
  mine[at] = v;
  ctx.me.throws = mine;
  ctx.touchMe = true;
  return null;
}
