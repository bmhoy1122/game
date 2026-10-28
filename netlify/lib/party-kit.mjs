/* 여럿이 하는 방 (2~8명) — party-bingo · party-spice · party-expedition · party-marble 가 같이 쓴다.
 * 2인용 room-kit 와 생각은 같지만 자리가 여덟까지라 따로 만들었다 (room-kit 는 손대지 않는다).
 *
 * 흐름: 방 만들기(방장, 최대 인원 정함) → 코드로 들어오기 / 방장이 AI 추가 → 방장이 '시작' → 게임 → 끝 → 다시 하기
 *
 * 저장 구조 (Blobs 에 트랜잭션이 없어서 room-kit 와 같은 원칙)
 *   room:<code>        공용 문서. 만들기 · 들어오기 · 시작 · 차례제 행동 · 다시 하기 · 기권
 *   room:<code>:p<i>   i 번 사람 문서. 그 사람만 쓴다 (빙고 판·준비 같은 '동시에 하는' 것)
 * 공용 문서를 쓰는 행동은 차례제이거나 멱등이어야 한다. 들어오기는 lobby 단계에서만 일어나고
 * 둘이 같은 순간에 들어오면 한 명이 묻힐 수 있는데(드묾), 그 사람은 '자리 확인' 실패로 다시 들어오면 된다.
 *
 * 게임이 주는 것: { setup(room), view(ctx), actions, finished(ctx), bot(ctx, rnd), options?(body), quick?: [act…] }
 *   setup 은 시작·다시 하기 때. room.first(선공 자리)는 kit 가 seeded 로 정해둔다.
 *   quick 에 든 행동(빙고 '준비' 등)은 봇 여러 명이 한 요청에 다 해도 된다. 그 외는 한 요청에 봇 하나만 (차례가 넘어가며 줄줄이 두지 않게).
 *
 * ctx: { room, idx, now, body, me, docs, n(자리 수), active(기권·탈락 아닌 자리들), touchRoom, touchMe }
 * 차례는 kit.turnSeat(room, k) — 활성 자리 중 선공부터 k 번째. 중간에 누가 빠져도 남은 사람끼리 돈다.
 *
 * 팀전 (room.teams = 0 개인전 | 2·3·4 팀) — 방장이 대기실에서 정한다. players[i].team = 0..teams-1.
 *   · 차례는 팀을 번갈아 돈다 (빨강1 → 파랑1 → 빨강2 → 파랑2 …). 인원이 적은 팀은 같은 사람이 더 자주 둔다 —
 *     팀마다 차례 수가 같아야 공평해서다.
 *   · 결과: game.teamMode 'sum'(기본) = 팀원 점수(rank 의 s) 합이 큰 팀, 'any' = 팀원 중 누구든 이긴 사람이 있는 팀.
 *     kit 가 view 에 team = { winners:[팀], scores:[팀별], rank } 를 붙인다. 자리별 winners·rank 는 그대로 둔다.
 *   · 게임이 "한 명 남으면 끝"을 볼 땐 oneSideLeft(room, seats) — 팀전이면 "한 팀만 남으면 끝".
 *   · game.teamOptions = 고를 수 있는 팀 수 (기본 [0,2,3,4]). 0 이 없으면 팀전만 되는 게임(팀 오목).
 */
import { seeded, shuffle, ROOM_TTL } from './room-kit.mjs';
export { seeded, shuffle, ROOM_TTL };

export const BOT_NAME = '🤖 AI';
export const BOT_DELAY = 900;
export const MIN_SEATS = 2, MAX_SEATS = 8;
const code4 = () => String(Math.floor(1000 + Math.random() * 9000));
const cleanName = (n) => String(n || '').trim().slice(0, 8);
const cleanUid = (u) => (typeof u === 'string' && /^[\w-]{1,48}$/.test(u) ? u : null);   // 탕비실 계정 id (전적용, 비밀 아님)
const roomKey = (c) => `room:${c}`;
const playerKey = (c, i) => `room:${c}:p${i}`;
const alive = (room, now) => room && now - room.created < ROOM_TTL;
export const roundRng = (room) => seeded(`${room.code}:${room.round}`);

export const activeSeats = (room) => room.players.map((_, i) => i).filter((i) => !(room.out && room.out[i]));
/* 활성 자리 중 선공(room.first)부터 k 번째 — 선공이 빠졌으면 그 다음 자리부터 */
export function turnSeat(room, k) {
  const act = activeSeats(room);
  if (!act.length) return null;
  if (room.teams) { const o = teamOrder(room, act); return o[k % o.length]; }
  let start = act.indexOf(room.first);
  if (start < 0) start = act.findIndex((i) => i > room.first); if (start < 0) start = 0;
  return act[(start + k) % act.length];
}
/* ---- 팀 ---- */
export const TEAM_NAMES = ['빨강팀', '파랑팀', '초록팀', '노랑팀'];
export const TEAM_COLORS = ['#e5484d', '#2f6fed', '#2ea44f', '#e3a008'];
export const teamOf = (room, i) => (room.teams && room.players[i] ? room.players[i].team : null);
const teamOptions = (game) => game.teamOptions || [0, 2, 3, 4];
/* 지금 사람이 가장 적은 팀 (같으면 앞 팀) */
function smallestTeam(room) {
  const cnt = Array(room.teams).fill(0);
  room.players.forEach((p) => { if (p && Number.isInteger(p.team) && p.team < room.teams) cnt[p.team]++; });
  return cnt.indexOf(Math.min(...cnt));
}
function setTeams(room, n) {
  room.teams = n;
  room.players.forEach((p, i) => { if (n) p.team = i % n; else delete p.team; });
}
/* seats 가 한 명뿐이거나(개인전) 다 같은 팀이면(팀전) — 더 겨룰 상대가 없다 */
export function oneSideLeft(room, seats) {
  if (seats.length <= 1) return true;
  if (!room.teams) return false;
  return new Set(seats.map((i) => teamOf(room, i))).size <= 1;
}
/* 팀전 차례 순서 — 선공의 팀부터, 팀마다 한 명씩 번갈아. 한 바퀴 = 팀 수 × 가장 큰 팀 인원 */
function teamOrder(room, act) {
  const teams = [...Array(room.teams)].map((_, t) => act.filter((i) => teamOf(room, i) === t)).filter((m) => m.length);
  if (!teams.length) return act;
  // 선공이 기권해도 선공의 팀부터 — 그 팀의 다음 자리 사람이 이어받는다 (안 그러면 팀 번갈기가 한 번 어긋난다)
  const firstTeam = teamOf(room, room.first);
  let ft = teams.findIndex((m) => teamOf(room, m[0]) === firstTeam);
  if (ft < 0) ft = 0;
  const rot = [...teams.slice(ft), ...teams.slice(0, ft)];
  const lead = rot[0];
  let li = lead.findIndex((i) => i >= room.first);
  if (li < 0) li = 0;
  rot[0] = [...lead.slice(li), ...lead.slice(0, li)];
  const width = Math.max(...rot.map((m) => m.length)), order = [];
  for (let r = 0; r < width; r++) for (const m of rot) order.push(m[r % m.length]);
  return order;
}
function teamResult(room, gv, mode) {
  const T = room.teams, members = [...Array(T)].map((_, t) => room.players.map((_, i) => i).filter((i) => teamOf(room, i) === t));
  const alive = members.map((m) => m.some((i) => !(room.out && room.out[i])));
  let scores;
  if (mode === 'any') scores = members.map((m, t) => (alive[t] ? (m.some((i) => (gv.winners || []).includes(i)) ? 1 : 0) : null));
  else {
    const byI = {}; (gv.rank || []).forEach((r) => { byI[r.i] = r.s; });
    scores = members.map((m, t) => (alive[t] ? m.reduce((a, i) => a + (typeof byI[i] === 'number' ? byI[i] : 0), 0) : null));
  }
  const rank = ranking(scores);
  const best = rank.length ? rank[0].s : null;
  return { winners: rank.filter((r) => r.s === best).map((r) => r.i), scores, rank, members, mode };
}

export const botSeats = (room) => room.players.map((p, i) => (p && p.bot ? i : -1)).filter((i) => i >= 0);
const isBot = (room, i) => !!(room.players[i] && room.players[i].bot);

export async function handleParty(game, body, store, now = Date.now()) {
  const act = body && body.action;
  const bad = (error, status = 400) => ({ status, body: { error } });

  async function load(room, idx) {
    const raw = await Promise.all(room.players.map((_, i) => store.get(playerKey(room.code, i))));
    const docs = raw.map((d) => (d && d.round === room.round ? d : { round: room.round }));
    return {
      room, idx, now, body: body || {}, me: docs[idx], docs, n: room.players.length, active: activeSeats(room),
      touchRoom: false, touchMe: false,
    };
  }
  function view(ctx) {
    const { room, idx } = ctx;
    const base = {
      code: room.code, round: room.round, created: room.created, you: idx, host: room.host, phase: room.phase, max: room.max,
      bot: room.players.some((p) => p.bot),
      players: room.players.map((p, i) => ({ name: p.name, bot: !!p.bot, out: !!(room.out && room.out[i]), me: i === idx, team: room.teams ? p.team : null, uid: p.uid || null })),
      first: room.phase === 'play' ? room.first : null,
      teams: room.teams || 0, teamOptions: teamOptions(game),
    };
    if (room.phase === 'lobby') return base;
    const gv = game.view(ctx);
    if (room.teams && gv.stage === 'done') gv.team = teamResult(room, gv, game.teamMode || 'sum');
    return { ...base, ...gv };
  }
  const ok = (ctx, extra) => ({ status: 200, body: { ...(extra || {}), ...view(ctx) } });

  function begin(room) {
    room.phase = 'play';
    room.out = room.players.map(() => false);
    room.first = activeSeats(room)[Math.floor(roundRng(room)() * room.players.length)];
    room.lastAt = now;
    game.setup(room);
  }
  async function botTurn(room) {
    if (room.phase !== 'play' || !game.bot || !botSeats(room).length) return;
    if (now - (room.lastAt || 0) < BOT_DELAY) return;
    let touched = false;
    for (const b of botSeats(room)) {
      if (room.out && room.out[b]) continue;
      const c = await load(room, b);
      if (game.finished(c)) break;
      const mv = game.bot(c);
      if (!mv || !game.actions[mv.act]) continue;
      c.body = mv.body || {};
      if (game.actions[mv.act](c)) continue;                 // 규칙에 걸리면 이 봇은 이번엔 쉰다
      touched = true;
      if (c.touchMe) await store.set(playerKey(room.code, b), c.me);
      if (!(game.quick || []).includes(mv.act)) break;        // 차례를 넘기는 행동은 한 요청에 하나만
    }
    if (touched) { room.lastAt = now; await store.set(roomKey(room.code), room); }
  }

  if (act === 'create') {
    let code = null;
    for (let i = 0; i < 12 && !code; i++) { const c = code4(); if (!alive(await store.get(roomKey(c)), now)) code = c; }
    if (!code) return bad('방을 만들지 못했어요. 잠시 뒤 다시 해주세요', 503);
    let max = Number(body.max); if (!Number.isInteger(max)) max = 4;
    max = Math.max(MIN_SEATS, Math.min(MAX_SEATS, max));
    const token = crypto.randomUUID();
    const room = { code, created: now, round: 1, max, phase: 'lobby', host: 0, players: [{ token, name: cleanName(body.name), uid: cleanUid(body.uid) }], out: [], lastAt: now };
    room.opts = game.options ? game.options(body || {}) : {};
    const tn = Number(body.teams), opts = teamOptions(game);
    room.teams = opts.includes(tn) ? tn : opts.includes(0) ? 0 : opts[0];
    if (room.teams) room.players[0].team = 0;
    let bots = Math.max(0, Math.min(MAX_SEATS - 1, Number(body.bots) || 0));
    if (body.bot) { bots = Math.max(1, bots); if (max < bots + 1) { max = bots + 1; room.max = max; } }   // 혼자 하기 — AI 수만큼 자리를 늘린다
    for (let i = 0; i < bots && room.players.length < max; i++) {
      room.players.push({ token: null, name: BOT_NAME + (i ? ' ' + (i + 1) : ''), bot: true });
      if (room.teams) room.players[room.players.length - 1].team = smallestTeam(room);
    }
    // 바로 시작하는데 사람이 팀 수보다 적으면 빈 팀이 생긴다 — 팀전만 되는 게임이 아니면 개인전으로
    if (body.bot && room.teams && room.players.length < room.teams) setTeams(room, opts.includes(0) ? 0 : room.teams);
    if (body.bot && room.players.length >= MIN_SEATS) begin(room);          // 탕비실·홈 '혼자 하기' — AI 들과 바로 시작
    await store.set(roomKey(code), room);
    return ok(await load(room, 0), { token });
  }

  if (act === 'join') {
    const code = String(body.code || '').trim();
    const room = await store.get(roomKey(code));
    if (!alive(room, now)) return bad('그런 방이 없어요. 코드를 다시 확인해주세요', 404);
    const back = room.players.findIndex((p) => p && body.token && p.token === body.token);
    if (back >= 0) return ok(await load(room, back), { token: body.token });
    if (room.phase !== 'lobby') return bad('이미 시작한 방이에요', 409);
    if (room.players.length >= room.max) return bad(`자리가 다 찼어요 (${room.max}명)`, 409);
    const token = crypto.randomUUID();
    room.players.push({ token, name: cleanName(body.name), uid: cleanUid(body.uid) });
    if (room.teams) room.players[room.players.length - 1].team = smallestTeam(room);
    await store.set(roomKey(code), room);
    return ok(await load(room, room.players.length - 1), { token });
  }

  const code = String((body && body.code) || '').trim();
  const room = await store.get(roomKey(code));
  if (!alive(room, now)) return bad('방이 사라졌어요. 다시 만들어주세요', 404);
  const idx = room.players.findIndex((p) => p && body.token && p.token === body.token);
  if (idx < 0) return bad('이 방의 참가자가 아니에요', 403);
  await botTurn(room);
  const ctx = await load(room, idx);

  if (act === 'state') return ok(ctx);

  if (act === 'start') {
    if (idx !== room.host) return bad('방장만 시작할 수 있어요', 403);
    if (room.phase !== 'lobby') return bad('이미 시작했어요', 409);
    if (room.players.length < MIN_SEATS) return bad('두 명은 있어야 시작해요. 코드를 알려주거나 AI 를 넣어요', 409);
    if (room.teams) {
      const empty = [...Array(room.teams)].findIndex((_, t) => !room.players.some((p) => p.team === t));
      if (empty >= 0) return bad(`${TEAM_NAMES[empty]}에 아무도 없어요. 사람을 옮기거나 AI 를 넣어요`, 409);
    }
    begin(room);
    await store.set(roomKey(code), room);
    return ok(await load(room, idx));
  }
  if (act === 'addbot') {
    if (idx !== room.host) return bad('방장만 AI 를 넣을 수 있어요', 403);
    if (room.phase !== 'lobby') return bad('시작한 뒤엔 못 넣어요', 409);
    if (room.players.length >= room.max) return bad('자리가 다 찼어요', 409);
    const k = botSeats(room).length;
    room.players.push({ token: null, name: BOT_NAME + (k ? ' ' + (k + 1) : ''), bot: true });
    if (room.teams) room.players[room.players.length - 1].team = smallestTeam(room);
    await store.set(roomKey(code), room);
    return ok(await load(room, idx));
  }
  if (act === 'removebot') {
    if (idx !== room.host) return bad('방장만 뺄 수 있어요', 403);
    if (room.phase !== 'lobby') return bad('시작한 뒤엔 못 빼요', 409);
    const last = botSeats(room).pop();
    if (last === undefined) return bad('AI 가 없어요', 409);
    room.players.splice(last, 1);
    await store.set(roomKey(code), room);
    return ok(await load(room, idx));
  }
  if (act === 'teams' || act === 'setteam' || act === 'shuffleteams') {
    if (idx !== room.host) return bad('팀은 방장이 정해요', 403);
    if (room.phase !== 'lobby') return bad('시작한 뒤엔 팀을 못 바꿔요', 409);
    if (act === 'teams') {
      const n = Number(body.n);
      if (!teamOptions(game).includes(n)) return bad('그렇게는 팀을 못 나눠요', 400);
      setTeams(room, n);
    } else if (act === 'setteam') {
      const seat = Number(body.seat), t = Number(body.team);
      if (!room.teams) return bad('개인전이에요', 409);
      if (!room.players[seat] || !Number.isInteger(t) || t < 0 || t >= room.teams) return bad('그런 자리나 팀은 없어요', 400);
      room.players[seat].team = t;
    } else {
      if (!room.teams) return bad('개인전이에요', 409);
      const seats = shuffle(room.players.map((_, i) => i), Math.random);   // 대기실은 방장 혼자 쓰니 seeded 가 아니어도 된다
      seats.forEach((i, k) => { room.players[i].team = k % room.teams; });
    }
    await store.set(roomKey(code), room);
    return ok(await load(room, idx));
  }
  if (act === 'leave') {
    if (room.phase !== 'lobby') return bad('게임 중엔 기권으로 나가요', 409);
    if (idx === room.host) return bad('방장은 나갈 수 없어요 (방은 12시간 뒤 사라져요)', 409);
    room.players.splice(idx, 1);
    await store.set(roomKey(code), room);
    return { status: 200, body: { left: true } };
  }
  if (act === 'resign') {
    if (room.phase !== 'play') return bad('게임 중이 아니에요', 409);
    if (room.out[idx]) return bad('이미 나갔어요', 409);
    room.out[idx] = true;
    if (game.onOut) game.onOut(room, idx);
    room.lastAt = now;
    await store.set(roomKey(code), room);
    return ok(await load(room, idx));
  }
  if (act === 'restart') {
    if (room.phase !== 'play') return bad('아직 시작 전이에요', 409);
    if (Number(body.round) !== room.round) return ok(ctx);           // 남이 먼저 눌렀으면 지금 상태
    if (!game.finished(ctx)) return bad('아직 끝나지 않았어요');
    room.round++;
    begin(room);
    await store.set(roomKey(code), room);
    return ok(await load(room, idx));
  }

  if (room.phase !== 'play') return bad('아직 시작 전이에요', 409);
  if (room.out[idx]) return bad('기권한 뒤엔 할 수 없어요', 409);
  const fn = game.actions[act];
  if (!fn) return bad('알 수 없는 요청이에요');
  const err = fn(ctx);
  if (err) return bad(err.error, err.status || 400);
  if (botSeats(room).length) { room.lastAt = now; ctx.touchRoom = true; }
  if (ctx.touchMe) await store.set(playerKey(code, idx), ctx.me);
  if (ctx.touchRoom) await store.set(roomKey(code), room);
  return ok(ctx);
}

/* 끝났을 때 순위 — scores[i](null 이면 빠진 사람) 큰 순. 같은 점수는 같은 등수 */
export function ranking(scores) {
  const rows = scores.map((s, i) => ({ i, s })).filter((r) => r.s !== null && r.s !== undefined).sort((a, b) => b.s - a.s);
  let rank = 0, prev = null;
  rows.forEach((r, k) => { if (r.s !== prev) { rank = k + 1; prev = r.s; } r.rank = rank; });
  return rows;
}
