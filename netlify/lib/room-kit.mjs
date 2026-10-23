/* 커플 게임 공용 방 — 만들기 · 들어가기 · 누구인지 확인 · 다시 하기 · 만료.
 * 게임마다 다른 건 game 객체로 받는다: { setup, actions, view, finished, options? }.
 * options(body) 는 방을 만들 때 한 번만 불린다 — 만든 사람이 고른 설정(예: 선 정하기 방식).
 *
 * 저장 구조 — Netlify Blobs 에 트랜잭션이 없어서 이렇게 나눴다.
 *   room:<code>      공용 문서. 만들기 · 들어가기 · 차례제 행동 · 다시 하기만 쓴다
 *   room:<code>:p0   0번 사람 문서. 0번만 쓴다
 *   room:<code>:p1   1번 사람 문서. 1번만 쓴다
 *
 * 이심전심의 '고르기'나 숫자야구의 '비밀 숫자'처럼 둘이 같은 순간에 누르는 행동은
 * 각자 자기 문서에만 쓴다. 그래서 동시에 눌러도 한쪽이 묻히지 않는다.
 * 공용 문서를 쓰는 행동은 차례제(한 명만 쓸 수 있음)이거나, 둘이 동시에 써도
 * 같은 값이 되게(멱등) 만든다. 판마다 정하는 무작위가 전부 seeded 인 이유다 —
 * 둘이 동시에 '다시 하기'를 눌러도 같은 질문 · 같은 선공이 나온다.
 *
 * 사람 문서에는 판 번호(round)가 붙는다. 판 번호가 다르면 빈 문서로 친다.
 * 그래서 '다시 하기'는 공용 문서만 고치면 되고, 남의 문서를 지울 일이 없다.
 */
export const ROOM_TTL = 12 * 60 * 60 * 1000;

/* 혼자 하기 — 1번 자리에 AI 가 앉는다 (bmhoy1122/messenger 탕비실 요청, 2026-10).
 * 방을 만들 때 body.bot 이면 players[1] = { bot:true } (token 없음 → 아무도 그 자리로 못 들어온다).
 * 봇은 사람의 요청(state 폴링 포함)을 처리할 때 움직인다 — 마지막 변화(lastAt)에서 BOT_DELAY 가
 * 지났을 때 한 번에 한 행동. 폴링이 1.4초라 사람 눈엔 1~3초 뒤 두는 것처럼 보인다.
 * 게임은 bot(ctx) 로 '지금 할 행동' { act, body } 을 돌려주고(없으면 null), 실제 적용은 그 게임의
 * actions[act] 가 그대로 한다 — 봇도 규칙 검사를 똑같이 받는다. 봇 방은 사람이 한 명뿐이라
 * 폴링 중 쓰기가 생겨도 묻힐 상대가 없다. */
export const BOT_NAME = '🤖 AI';
export const BOT_DELAY = 900;
export const isBotRoom = (room) => !!(room && room.players && room.players[1] && room.players[1].bot);

/* 문자열 → 0~1 난수 생성기 (FNV-1a 로 씨앗을 만들고 mulberry32 로 돌린다) */
export function seeded(str) {
  let h = 2166136261 >>> 0;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export const roundRng = (room) => seeded(`${room.code}:${room.round}`);

const roomKey = (c) => `room:${c}`;
const playerKey = (c, i) => `room:${c}:p${i}`;
const alive = (room, now) => room && now - room.created < ROOM_TTL;
const code4 = () => String(Math.floor(1000 + Math.random() * 9000));
const cleanName = (n) => String(n || '').trim().slice(0, 8);

export async function handleRoom(game, body, store, now = Date.now()) {
  const act = body && body.action;
  const bad = (error, status = 400) => ({ status, body: { error } });

  // 방 + 두 사람 문서를 읽어서 이번 요청의 맥락을 만든다
  async function load(room, idx) {
    const [d0, d1] = await Promise.all([store.get(playerKey(room.code, 0)), store.get(playerKey(room.code, 1))]);
    const fresh = (d) => (d && d.round === room.round ? d : { round: room.round });
    const docs = [fresh(d0), fresh(d1)];
    const ctx = {
      room, idx, now, body: body || {},
      me: docs[idx], other: docs[1 - idx], docs,
      joined: !!(room.players[0] && room.players[1]),
      touchRoom: false, touchMe: false,
    };
    return ctx;
  }
  function view(ctx) {
    const o = ctx.room.players[1 - ctx.idx];
    const me = ctx.room.players[ctx.idx];
    return {
      code: ctx.room.code, round: ctx.room.round, you: ctx.idx, bot: isBotRoom(ctx.room),
      name: me ? me.name : '',
      opponent: o ? { joined: true, name: o.name } : { joined: false, name: '' },
      ...game.view(ctx),
    };
  }
  const ok = (ctx, extra) => ({ status: 200, body: { ...(extra || {}), ...view(ctx) } });

  // 봇 차례 — 사람의 요청을 처리하기 전에 한 행동만. 바꾼 게 있으면 true
  async function botTurn(room) {
    if (!isBotRoom(room) || !game.bot) return false;
    if (now - (room.lastAt || 0) < BOT_DELAY) return false;
    const b = await load(room, 1);
    if (game.finished(b)) return false;
    const mv = game.bot(b);
    if (!mv || !game.actions[mv.act]) return false;
    b.body = mv.body || {};
    if (game.actions[mv.act](b)) return false;       // 규칙에 걸리면 이번엔 쉰다
    room.lastAt = now;
    if (b.touchMe) await store.set(playerKey(room.code, 1), b.me);
    await store.set(roomKey(room.code), room);        // lastAt 과 (차례제 행동이면) 공용 문서
    return true;
  }

  if (act === 'create') {
    let code = null;
    for (let i = 0; i < 12 && !code; i++) {
      const c = code4();
      if (!alive(await store.get(roomKey(c)), now)) code = c;
    }
    if (!code) return bad('방을 만들지 못했어요. 잠시 뒤 다시 해주세요', 503);
    const token = crypto.randomUUID();
    const room = { code, created: now, round: 1, players: [{ token, name: cleanName(body.name) }, null] };
    room.opts = game.options ? game.options(body || {}) : {};
    if (body.bot && game.bot) { room.players[1] = { token: null, name: BOT_NAME, bot: true }; room.lastAt = now; }
    game.setup(room);
    await store.set(roomKey(code), room);
    return ok(await load(room, 0), { token });
  }

  if (act === 'join') {
    const code = String(body.code || '').trim();
    const room = await store.get(roomKey(code));
    if (!alive(room, now)) return bad('그런 방이 없어요. 코드를 다시 확인해주세요', 404);
    const back = room.players.findIndex((p) => p && body.token && p.token === body.token);
    if (back >= 0) return ok(await load(room, back), { token: body.token });   // 새로고침한 본인
    if (isBotRoom(room)) return bad('AI 와 혼자 하는 방이라 들어갈 수 없어요', 409);
    if (room.players[1]) return bad('이미 두 명이 들어와 있어요', 409);
    const token = crypto.randomUUID();
    room.players[1] = { token, name: cleanName(body.name) };
    await store.set(roomKey(code), room);
    return ok(await load(room, 1), { token });
  }

  // 아래부터는 방 + 내가 누구인지가 필요하다
  const code = String((body && body.code) || '').trim();
  const room = await store.get(roomKey(code));
  if (!alive(room, now)) return bad('방이 사라졌어요. 다시 만들어주세요', 404);
  const idx = room.players.findIndex((p) => p && body.token && p.token === body.token);
  if (idx < 0) return bad('이 방의 참가자가 아니에요', 403);
  await botTurn(room);                              // 봇 방이면 봇이 먼저 (지난 폴링 뒤 할 일)
  const ctx = await load(room, idx);

  if (act === 'state') return ok(ctx);

  if (act === 'restart') {
    // 상대가 먼저 눌러서 이미 새 판이면 그냥 지금 상태를 준다
    if (Number(body.round) !== room.round) return ok(ctx);
    if (!game.finished(ctx)) return bad('아직 끝나지 않았어요');
    room.round++;
    game.setup(room);                              // seeded — 동시에 눌러도 같은 판이 된다
    if (isBotRoom(room)) room.lastAt = now;
    await store.set(roomKey(code), room);
    return ok(await load(room, idx));
  }

  const fn = game.actions[act];
  if (!fn) return bad('알 수 없는 요청이에요');
  const err = fn(ctx);
  if (err) return bad(err.error, err.status || 400);
  if (isBotRoom(room)) { room.lastAt = now; ctx.touchRoom = true; }   // 봇은 이 시각부터 BOT_DELAY 뒤에 움직인다
  if (ctx.touchMe) await store.set(playerKey(code, idx), ctx.me);
  if (ctx.touchRoom) await store.set(roomKey(code), room);
  return ok(ctx);
}
