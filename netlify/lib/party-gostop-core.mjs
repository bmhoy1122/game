/* 고스톱 · 맞고 (2~3명) — party-kit 위. 2명이면 맞고(7점 나야 고/스톱), 3명이면 고스톱(3점).
 *
 * 화투 48장: id 0..47, 월 = ⌊id/4⌋+1, 종류는 DEF 표(광 · 열끗 · 띠 · 피 · 쌍피). 9월 국진은 열끗으로만 센다.
 * 돌리기: 2명 = 손 10장 · 바닥 8장, 3명 = 손 7장 · 바닥 6장. 손이나 바닥에 같은 달 4장(총통)이 있으면 다시 섞는다.
 * 손에 같은 달 3장이면 흔들기(자동, ×2). 손 3장 + 바닥 1장일 때 그 달을 내면 폭탄(넷 다 가져감, ×2, 피 한 장씩 뺏음).
 *
 * 한 차례 = 손에서 한 장 내기 → 더미에서 한 장 뒤집기. 짝(같은 달)이 있으면 가져온다.
 *   · 바닥에 같은 달 2장이면 좋은 쪽을 가져오고(광 > 열끗 > 띠 > 쌍피 > 피), 3장이면 넷 다 가져오며 피 한 장씩 뺏는다(따닥).
 *   · 쪽: 낸 패가 짝이 없었는데 뒤집은 패가 같은 달 → 둘 다 가져오고 피 뺏기.
 *   · 뻑: 낸 패가 바닥 1장과 짝인데 뒤집은 패까지 같은 달 → 셋 다 바닥에 남는다(뻑 더미). 나중에 가져가는 사람이 피 뺏기.
 *   · 싹쓸이: 내 차례 끝에 바닥이 비면 피 뺏기.  피 뺏기는 상대마다 피 1장(피 없으면 쌍피, 그것도 없으면 못 뺏음).
 * 점수: 광 3장 3점(비광 끼면 2) · 4장 4점 · 5장 15점 / 열끗 5장부터 1점씩, 고도리(2·4·8 열끗) +5 /
 *       띠 5장부터 1점씩, 홍단·초단·청단 각 +3 / 피 10장부터 1점씩(쌍피는 2장).
 * 고/스톱: 점수가 났고(3점 · 맞고 7점) 지난 고 때보다 올랐으면 고르기. 1고 +1, 2고 +2, 3고부터 ×2 씩.
 *   스톱하면 끝 — 최종 = (점수 + 고) × 흔들기·폭탄 ×2 … , 진 사람마다 피박(피 점수 났는데 상대 피 6장 이하 — 피 0장이면 면제) ·
 *   광박(광 점수 났는데 상대 광 0장) · 멍박(열끗 7장 이상인데 상대 열끗 0장) 각 ×2. 고박: 3명에서 고를 불렀던 사람이 지면 그 사람이 남의 몫까지 낸다.
 *   패가 다 떨어지도록 아무도 스톱 못 하면 나가리(무승부).
 * 결과 점수(rank 의 s): 이긴 사람 = 받은 점수 합, 진 사람 = −낸 점수. 돈은 안 다룬다 — 점수만.
 * 봇: 가져올 수 있는 것 중 값 큰 것, 없으면 가장 쓸모없는 피를 버린다. 고/스톱은 남은 손패·상대 점수를 본다.
 */
import { handleParty, ranking, shuffle, seeded, roundRng } from './party-kit.mjs';

export const DEF = {
  1: ['gwang', 'tti', 'pi', 'pi'], 2: ['yeol', 'tti', 'pi', 'pi'], 3: ['gwang', 'tti', 'pi', 'pi'], 4: ['yeol', 'tti', 'pi', 'pi'],
  5: ['yeol', 'tti', 'pi', 'pi'], 6: ['yeol', 'tti', 'pi', 'pi'], 7: ['yeol', 'tti', 'pi', 'pi'], 8: ['gwang', 'yeol', 'pi', 'pi'],
  9: ['yeol', 'tti', 'pi', 'pi'], 10: ['yeol', 'tti', 'pi', 'pi'], 11: ['gwang', 'ssang', 'pi', 'pi'], 12: ['gwang', 'yeol', 'tti', 'ssang'],
};
export const month = (id) => Math.floor(id / 4) + 1;
export const kind = (id) => DEF[month(id)][id % 4];
export const BI_GWANG = 44;                                   // 12월 광
export const GODORI = [4, 12, 29];                            // 2월 꾀꼬리 · 4월 두견새 · 8월 기러기
export const TTI = { hong: [1, 5, 9], cho: [13, 17, 25], cheong: [21, 33, 37] };   // 홍단 · 초단 · 청단
const VALUE = { gwang: 5, yeol: 3, tti: 2.5, ssang: 2, pi: 1 };
export const cardValue = (id) => VALUE[kind(id)];
const piWeight = (id) => (kind(id) === 'pi' ? 1 : kind(id) === 'ssang' ? 2 : 0);
const isPi = (id) => kind(id) === 'pi' || kind(id) === 'ssang';
const best = (ids) => ids.slice().sort((a, b) => cardValue(b) - cardValue(a))[0];
export const threshold = (np) => (np <= 2 ? 7 : 3);

/* 잡은 패의 점수와 내역 */
export function scoreOf(caps) {
  const gw = caps.filter((c) => kind(c) === 'gwang'), yeol = caps.filter((c) => kind(c) === 'yeol'), tti = caps.filter((c) => kind(c) === 'tti');
  const piN = caps.reduce((t, c) => t + piWeight(c), 0);
  const d = [];
  let s = 0;
  if (gw.length >= 5) { s += 15; d.push('오광 15'); }
  else if (gw.length === 4) { s += 4; d.push('사광 4'); }
  else if (gw.length === 3) { const bi = gw.includes(BI_GWANG); s += bi ? 2 : 3; d.push(bi ? '비삼광 2' : '삼광 3'); }
  if (GODORI.every((c) => yeol.includes(c))) { s += 5; d.push('고도리 5'); }
  if (yeol.length >= 5) { s += yeol.length - 4; d.push('열끗 ' + yeol.length + '장 ' + (yeol.length - 4)); }
  for (const [nm, ids] of [['홍단', TTI.hong], ['초단', TTI.cho], ['청단', TTI.cheong]]) if (ids.every((c) => tti.includes(c))) { s += 3; d.push(nm + ' 3'); }
  if (tti.length >= 5) { s += tti.length - 4; d.push('띠 ' + tti.length + '장 ' + (tti.length - 4)); }
  if (piN >= 10) { s += piN - 9; d.push('피 ' + piN + '장 ' + (piN - 9)); }
  return { score: s, detail: d, gwang: gw.length, yeol: yeol.length, tti: tti.length, pi: piN };
}

function dealOnce(code, round, salt, np) {
  const ids = shuffle([...Array(48)].map((_, i) => i), seeded(`${code}:${round}:deal${salt}`));
  const per = np <= 2 ? 10 : 7, fl = np <= 2 ? 8 : 6;
  const hands = []; let at = 0;
  for (let i = 0; i < np; i++) { hands.push(ids.slice(at, at + per).sort((a, b) => a - b)); at += per; }
  const floor = ids.slice(at, at + fl); at += fl;
  return { hands, floor, deck: ids.slice(at) };
}
const fourSame = (ids) => Object.values(ids.reduce((m, c) => ((m[month(c)] = (m[month(c)] || 0) + 1), m), {})).some((n) => n >= 4);

function setup(room) {
  const np = room.players.length;
  let d = null;
  for (let salt = 0; salt < 40; salt++) { d = dealOnce(room.code, room.round, salt, np); if (!d.hands.some(fourSame) && !fourSame(d.floor)) break; }
  const g = {
    hands: d.hands, floor: d.floor, deck: d.deck, caps: room.players.map(() => []),
    go: room.players.map(() => 0), shake: room.players.map(() => 0), lastGo: room.players.map(() => 0),
    ppuk: [], turnNo: 0, step: 'play', log: [], result: null, np,
    // 그 자리 사람 수로 '7점/3점'을 정한다 — 중간에 누가 나가도 그대로
  };
  // 흔들기(같은 달 3장) — 자동 선언
  g.hands.forEach((h, i) => { const cnt = {}; for (const c of h) cnt[month(c)] = (cnt[month(c)] || 0) + 1; for (const m in cnt) if (cnt[m] === 3) { g.shake[i]++; g.log.push({ by: i, t: 'shake', m: +m }); } });
  room.g = g;
}

/* 차례 — 활성 자리 중 선공부터 turnNo 번째 (팀전 없음이라 kit turnSeat 와 같은 식) */
function seatOf(room, k) {
  const act = room.players.map((_, i) => i).filter((i) => !(room.out && room.out[i]));
  if (!act.length) return null;
  let s = act.indexOf(room.first); if (s < 0) s = act.findIndex((i) => i > room.first); if (s < 0) s = 0;
  return act[(s + k) % act.length];
}
export function status(ctx) {
  const { room, active } = ctx, g = room.g;
  if (g.result) return { phase: 'done', turn: null, step: null };
  if (active.length <= 1) { // 다 나가면 남은 사람 승 (점수 0 이라도)
    return { phase: 'done', turn: null, step: null, forfeit: active[0] };
  }
  return { phase: 'play', turn: seatOf(room, g.turnNo), step: g.step };
}
const pushLog = (g, e) => { g.log.push(e); if (g.log.length > 30) g.log.splice(0, g.log.length - 30); };

/* 상대들에게서 피 한 장씩 */
function stealPi(g, room, idx, times, why) {
  let got = 0;
  for (let t = 0; t < times; t++) {
    for (let j = 0; j < room.players.length; j++) {
      if (j === idx || (room.out && room.out[j])) continue;
      const caps = g.caps[j];
      let k = caps.findIndex((c) => kind(c) === 'pi'); if (k < 0) k = caps.findIndex((c) => kind(c) === 'ssang');
      if (k < 0) continue;
      g.caps[idx].push(caps.splice(k, 1)[0]); got++;
    }
  }
  if (times) pushLog(g, { by: idx, t: why, n: got });
}

/* 패 하나를 바닥과 맞춰 가져오기 — 돌려주는 것: 가져온 id 들(없으면 [] 로 바닥에 둔다), steal 횟수 */
function matchFloor(g, id, floorOverride) {
  const floor = floorOverride || g.floor, m = month(id);
  const same = floor.filter((c) => month(c) === m);
  if (!same.length) return { take: [], left: null, steal: 0 };
  if (same.length === 1) return { take: [id, same[0]], left: null, steal: 0 };
  if (same.length === 2) { const b = best(same); return { take: [id, b], left: same.find((c) => c !== b), steal: 0 }; }
  const ppuk = g.ppuk.includes(m);
  return { take: [id, ...same], left: null, steal: 1, ppuk };
}
const removeAll = (arr, ids) => { for (const c of ids) { const k = arr.indexOf(c); if (k >= 0) arr.splice(k, 1); } };

const actions = {
  play(ctx) {
    const { room, idx, body } = ctx, g = room.g, s = status(ctx);
    if (s.phase !== 'play') return { error: '이미 끝났어요', status: 409 };
    if (s.turn !== idx) return { error: '다른 사람 차례예요', status: 409 };
    if (s.step !== 'play') return { error: '먼저 고/스톱을 골라요', status: 409 };
    const id = body.card, hand = g.hands[idx];
    if (!Number.isInteger(id) || !hand.includes(id)) return { error: '손에 없는 패예요', status: 400 };
    const m = month(id);
    let steal = 0, got = [];
    const sameInHand = hand.filter((c) => month(c) === m), sameOnFloor = g.floor.filter((c) => month(c) === m);
    removeAll(hand, [id]);
    let pending = null, alone = false;
    if (sameInHand.length === 3 && sameOnFloor.length === 1) {
      // 폭탄 — 손의 셋 다 던져 넷을 가져온다
      removeAll(hand, sameInHand);
      got.push(...sameInHand, sameOnFloor[0]); removeAll(g.floor, sameOnFloor);
      g.shake[idx]++; steal++; pushLog(g, { by: idx, t: 'bomb', m });
    } else {
      const r = matchFloor(g, id);
      if (!r.take.length) { g.floor.push(id); alone = true; }
      else { pending = r; if (r.steal) { steal++; if (r.ppuk) g.ppuk = g.ppuk.filter((x) => x !== m); pushLog(g, { by: idx, t: r.ppuk ? 'ppukget' : 'ddadak', m }); } }
    }
    // 뒤집기
    const flip = g.deck.pop();
    let flipped = null;
    if (flip !== undefined) {
      flipped = flip;
      const fm = month(flip);
      if (alone && fm === m) {                                          // 쪽
        removeAll(g.floor, [id]); got.push(id, flip); steal++; pushLog(g, { by: idx, t: 'jjok', m });
      } else if (pending && pending.take.length === 2 && fm === m) {
        if (pending.left !== null) {                                    // 바닥 2장 + 손 + 뒤집기 = 따닥
          got.push(...pending.take, pending.left, flip); removeAll(g.floor, [pending.take[1], pending.left]); steal++; pushLog(g, { by: idx, t: 'ddadak', m });
        } else {                                                        // 뻑 — 셋 다 바닥에
          g.floor.push(id, flip); if (!g.ppuk.includes(m)) g.ppuk.push(m); pushLog(g, { by: idx, t: 'ppuk', m });
        }
        pending = null;
      } else {
        if (pending) { got.push(...pending.take); removeAll(g.floor, pending.take); pending = null; }
        const r2 = matchFloor(g, flip);
        if (!r2.take.length) g.floor.push(flip);
        else { got.push(...r2.take); removeAll(g.floor, r2.take); if (r2.steal) { steal++; if (r2.ppuk) g.ppuk = g.ppuk.filter((x) => x !== fm); pushLog(g, { by: idx, t: r2.ppuk ? 'ppukget' : 'ddadak', m: fm }); } }
      }
    } else if (pending) { got.push(...pending.take); removeAll(g.floor, pending.take); }
    g.caps[idx].push(...got);
    const anyLeft = g.deck.length > 0 || g.hands.some((h) => h.length);
    if (!g.floor.length && got.length && anyLeft) { steal++; pushLog(g, { by: idx, t: 'sweep' }); }
    if (steal) stealPi(g, room, idx, steal, 'steal');
    pushLog(g, { by: idx, t: 'play', card: id, flip: flipped, got });
    // 점수 났나
    ctx.touchRoom = true;
    const sc = scoreOf(g.caps[idx]).score, th = threshold(g.np);
    if (sc >= th && sc > g.lastGo[idx]) { g.step = 'gostop'; return null; }
    advance(ctx);
    return null;
  },
  go(ctx) {
    const { room, idx } = ctx, g = room.g, s = status(ctx);
    if (s.phase !== 'play' || s.turn !== idx || s.step !== 'gostop') return { error: '지금은 고를 못 해요', status: 409 };
    if (!g.hands[idx].length) return { error: '손패가 없어서 스톱만 돼요', status: 409 };
    g.go[idx]++; g.lastGo[idx] = scoreOf(g.caps[idx]).score; g.step = 'play';
    pushLog(g, { by: idx, t: 'go', n: g.go[idx] });
    ctx.touchRoom = true;
    advance(ctx);
    return null;
  },
  stop(ctx) {
    const { room, idx } = ctx, g = room.g, s = status(ctx);
    if (s.phase !== 'play' || s.turn !== idx || s.step !== 'gostop') return { error: '지금은 스톱을 못 해요', status: 409 };
    g.result = settle(room, idx);
    pushLog(g, { by: idx, t: 'stop' });
    ctx.touchRoom = true;
    return null;
  },
};
/* 다음 차례. 모두 손패가 비면 나가리 */
function advance(ctx) {
  const { room } = ctx, g = room.g;
  g.turnNo++;
  // 폭탄으로 손패가 먼저 떨어진 사람은 건너뛴다
  for (let guard = 0; guard < 8; guard++) { const t = seatOf(room, g.turnNo); if (t === null || g.hands[t].length) break; g.turnNo++; }
  if (!g.hands.some((h, i) => h.length && !(room.out && room.out[i]))) {
    g.result = { nagari: true, winner: null, scores: room.players.map(() => 0), lines: ['나가리 — 아무도 스톱하지 못했어요'] };
    pushLog(g, { by: null, t: 'nagari' });
  }
}
/* 스톱 — 점수 정산 */
export function settle(room, w) {
  const g = room.g, np = room.players.length, ws = scoreOf(g.caps[w]);
  let pts = ws.score + Math.min(g.go[w], 2);
  if (g.go[w] >= 3) pts *= 2 ** (g.go[w] - 2);
  pts *= 2 ** g.shake[w];
  const lines = [...ws.detail];
  if (g.go[w]) lines.push(g.go[w] + '고');
  if (g.shake[w]) lines.push('흔들기·폭탄 ×' + 2 ** g.shake[w]);
  const pays = room.players.map(() => 0), tags = room.players.map(() => []);
  for (let l = 0; l < np; l++) {
    if (l === w || (room.out && room.out[l])) continue;
    const ls = scoreOf(g.caps[l]);
    let p = pts;
    if (ws.pi >= 10 && ls.pi > 0 && ls.pi <= 6) { p *= 2; tags[l].push('피박'); }
    if (ws.gwang >= 3 && ls.gwang === 0) { p *= 2; tags[l].push('광박'); }
    if (ws.yeol >= 7 && ls.yeol === 0) { p *= 2; tags[l].push('멍박'); }
    pays[l] = p;
  }
  // 고박 — 3명에서 고 불렀던 사람이 졌으면 그 사람이 다 낸다
  const goLosers = room.players.map((_, i) => i).filter((i) => i !== w && !(room.out && room.out[i]) && g.go[i] > 0);
  if (np >= 3 && goLosers.length === 1) {
    const gl = goLosers[0], total = pays.reduce((a, b) => a + b, 0);
    for (let l = 0; l < np; l++) if (l !== w) pays[l] = l === gl ? total : 0;
    tags[gl].push('고박');
  }
  const scores = pays.map((p, i) => (i === w ? pays.reduce((a, b) => a + b, 0) : -p));
  if (room.out) room.out.forEach((o, i) => { if (o) scores[i] = null; });
  return { nagari: false, winner: w, base: ws.score, pts, pays, tags, scores, lines };
}

function view(ctx) {
  const { room, idx, active } = ctx, g = room.g, s = status(ctx);
  const done = s.phase === 'done';
  let result = g.result;
  if (done && !result && s.forfeit !== undefined) result = { nagari: false, forfeit: true, winner: s.forfeit, scores: room.players.map((_, i) => (i === s.forfeit ? 1 : room.out[i] ? null : 0)), lines: ['상대가 모두 나갔어요'] };
  const scores = g.caps.map((c) => scoreOf(c));
  return {
    stage: done ? 'done' : 'play', turn: s.turn, yourTurn: s.phase === 'play' && s.turn === idx, step: s.step,
    hand: g.hands[idx], handCounts: g.hands.map((h) => h.length), floor: g.floor, deck: g.deck.length,
    caps: g.caps, scores: scores.map((x) => x.score), details: scores.map((x) => x.detail), go: g.go, shake: g.shake, ppuk: g.ppuk,
    threshold: threshold(g.np), lastGo: g.lastGo, turnNo: g.turnNo, log: g.log.slice(-14),
    result: done ? result : null,
    winners: done ? (result.nagari ? active : [result.winner]) : null,
    rank: done ? ranking(result.scores) : null,
    allHands: done ? g.hands : null,
  };
}

/* 봇 */
export function botMove(ctx, rnd) {
  const { room, idx } = ctx, g = room.g, s = status(ctx);
  if (s.phase !== 'play' || s.turn !== idx) return null;
  const r = rnd || seeded(`${room.code}:${room.round}:${g.turnNo}:${idx}`);
  const hand = g.hands[idx];
  if (s.step === 'gostop') {
    const my = scoreOf(g.caps[idx]).score, th = threshold(g.np);
    const oppMax = Math.max(...g.caps.map((c, j) => (j === idx || (room.out && room.out[j]) ? -1 : scoreOf(c).score)));
    if (!hand.length || hand.length <= 1 || oppMax >= th - 1 || my >= th + 5 || g.go[idx] >= 3) return { act: 'stop' };
    return { act: r() < 0.6 ? 'go' : 'stop' };
  }
  let bestId = null, bestSc = -Infinity;
  for (const id of hand) {
    const m = month(id), same = g.floor.filter((c) => month(c) === m), inHand = hand.filter((c) => month(c) === m).length;
    let sc;
    if (inHand === 3 && same.length === 1) sc = 20 + cardValue(same[0]);
    else if (same.length === 3) sc = 10 + same.reduce((t, c) => t + cardValue(c), 0);
    else if (same.length) sc = cardValue(id) + cardValue(best(same)) + (same.length === 2 ? 0.5 : 0);
    else sc = -cardValue(id) - (inHand === 2 ? 1 : 0);          // 버리기 — 값 작은 것부터, 짝이 손에 있으면 아깝다
    sc += r() * 0.4;
    if (sc > bestSc) { bestSc = sc; bestId = id; }
  }
  return { act: 'play', body: { card: bestId } };
}

export const partyGostop = {
  setup, view, actions, bot: botMove, maxSeats: 3, teamOptions: [0],
  finished: (ctx) => status(ctx).phase === 'done',
};
export const handle = (body, store, now) => handleParty(partyGostop, body, store, now);
