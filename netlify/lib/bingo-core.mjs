/* 커플 빙고 — 방 상태와 규칙 전부. 저장소도 네트워크도 모른다.
 *
 * 설계 메모
 * · 폴링은 읽기 전용이다. 쓰기는 사용자가 뭔가 눌렀을 때만(만들기/들어가기/준비/부르기/다시).
 *   Netlify Blobs 에 트랜잭션이 없어서, 둘이 동시에 쓰면 한쪽이 묻힌다.
 *   번갈아 두는 게임이라 '부르기'는 애초에 한 명만 쓸 수 있고, 나머지는 눌러야 쓴다.
 * · 판(board)은 서버가 들고 있다. 그래야 서버가 줄 수를 직접 세서 승패를 판정한다.
 *   상대 판은 응답에서 빼고 보낸다 — 줄 수만 알려준다(실제 빙고에서 "두 줄!" 외치는 것과 같다).
 * · 여기엔 import 가 없다. 저장소는 handle() 의 인자로 받는다. 그래서 npm install 없이
 *   tools/bingo-smoke.js 와 tools/couple-dev.js 가 메모리 저장소를 끼워 그대로 돌릴 수 있다.
 *   @netlify/blobs 를 붙이는 건 netlify/lib/blob-handler.mjs 하나뿐이다.
 */

export const SIZE = 5;
export const WIN_LINES = 3;          // 몇 줄이면 이기나
const ROOM_TTL = 12 * 60 * 60 * 1000; // 이 시간이 지난 방은 없는 것으로 친다

/* 5×5 의 12줄 (가로 5 + 세로 5 + 대각 2) 을 인덱스로 미리 적어둔다 */
export const LINES = (() => {
  const out = [];
  for (let r = 0; r < SIZE; r++) out.push([...Array(SIZE)].map((_, c) => r * SIZE + c));
  for (let c = 0; c < SIZE; c++) out.push([...Array(SIZE)].map((_, r) => r * SIZE + c));
  out.push([...Array(SIZE)].map((_, i) => i * SIZE + i));
  out.push([...Array(SIZE)].map((_, i) => i * SIZE + (SIZE - 1 - i)));
  return out;
})();

export const CELLS = SIZE * SIZE;

export function lineCount(board, called) {
  if (!board) return 0;
  const hit = new Set(called);
  let n = 0;
  for (const line of LINES) if (line.every((i) => hit.has(board[i]))) n++;
  return n;
}

export function validBoard(b) {
  if (!Array.isArray(b) || b.length !== CELLS) return false;
  const seen = new Set();
  for (const v of b) {
    if (!Number.isInteger(v) || v < 1 || v > CELLS || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

export function newRoom(code, now) {
  return {
    code, created: now, phase: 'wait', called: [], turn: 0, winner: null, round: 1,
    players: [null, null],      // { token, name, board, ready, seen }
  };
}

export function newPlayer(token, name) {
  return { token, name: name || '', board: null, ready: false, seen: 0 };
}

/* 한 수 두기. 막히면 { error, status } 를, 성공하면 null 을 돌려준다.
   요청이 틀린 것(400)과 지금 상태라서 안 되는 것(409)을 구분한다. */
export function applyCall(room, idx, n, now) {
  const no = (error, status) => ({ error, status });
  if (!Number.isInteger(n) || n < 1 || n > CELLS) return no('그런 숫자는 없어요', 400);
  if (room.phase !== 'play') return no('게임 중이 아니에요', 409);
  if (room.turn !== idx) return no('상대 차례예요', 409);
  if (room.called.includes(n)) return no('이미 나온 숫자예요', 409);

  room.called.push(n);
  room.lastAt = now;

  const lines = room.players.map((p) => lineCount(p && p.board, room.called));
  const done = lines.map((l) => l >= WIN_LINES);
  if (done[0] || done[1]) {
    room.phase = 'done';
    room.winner = done[0] && done[1] ? 'draw' : (done[0] ? 0 : 1);
  } else if (room.called.length >= CELLS) {
    room.phase = 'done';
    room.winner = lines[0] === lines[1] ? 'draw' : (lines[0] > lines[1] ? 0 : 1);
  } else {
    room.turn = 1 - idx;
  }
  return null;
}

/* 내 판은 주고 상대 판은 뺀다. 상대에 대해 알려주는 건 줄 수까지. */
export function publicState(room, idx) {
  const me = room.players[idx];
  const other = room.players[1 - idx];
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    called: room.called,
    last: room.called.length ? room.called[room.called.length - 1] : null,
    turn: room.turn,
    you: idx,
    yourTurn: room.phase === 'play' && room.turn === idx,
    winner: room.winner,
    board: me ? me.board : null,
    ready: !!(me && me.ready),
    lines: room.players.map((p) => lineCount(p && p.board, room.called)),
    opponent: other ? { joined: true, ready: !!other.ready, name: other.name || '' } : { joined: false, ready: false, name: '' },
    winLines: WIN_LINES,
  };
}

function code4() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

const key = (c) => `room:${c}`;
const alive = (room, now) => room && now - room.created < ROOM_TTL;

/* 저장소는 인자로 받는다. { get(key), set(key, value) } 만 쓰면 된다. */
export async function handle(body, store, now = Date.now()) {
  const act = body && body.action;
  const bad = (msg, status = 400) => ({ status, body: { error: msg } });

  if (act === 'create') {
    let code = null;
    for (let i = 0; i < 12 && !code; i++) {
      const c = code4();
      if (!alive(await store.get(key(c)), now)) code = c;
    }
    if (!code) return bad('방을 만들지 못했어요. 잠시 뒤 다시 해주세요', 503);
    const room = newRoom(code, now);
    const token = crypto.randomUUID();
    room.players[0] = newPlayer(token, body.name);
    await store.set(key(code), room);
    return { status: 200, body: { token, ...publicState(room, 0) } };
  }

  if (act === 'join') {
    const code = String(body.code || '').trim();
    const room = await store.get(key(code));
    if (!alive(room, now)) return bad('그런 방이 없어요. 코드를 다시 확인해주세요', 404);
    if (room.players[1]) {
      // 새로고침한 본인일 수 있으니 토큰이 맞으면 그대로 돌려준다
      for (let i = 0; i < 2; i++) {
        if (room.players[i] && body.token && room.players[i].token === body.token) {
          return { status: 200, body: { token: body.token, ...publicState(room, i) } };
        }
      }
      return bad('이미 두 명이 들어와 있어요', 409);
    }
    const token = crypto.randomUUID();
    room.players[1] = newPlayer(token, body.name);
    await store.set(key(code), room);
    return { status: 200, body: { token, ...publicState(room, 1) } };
  }

  // 아래부터는 방 + 내가 누구인지가 필요하다
  const code = String((body && body.code) || '').trim();
  const room = await store.get(key(code));
  if (!alive(room, now)) return bad('방이 사라졌어요. 다시 만들어주세요', 404);
  const idx = room.players.findIndex((p) => p && body.token && p.token === body.token);
  if (idx < 0) return bad('이 방의 참가자가 아니에요', 403);

  if (act === 'state') {
    return { status: 200, body: publicState(room, idx) };
  }

  if (act === 'ready') {
    if (room.phase !== 'wait') return bad('이미 시작했어요');
    if (!validBoard(body.board)) return bad('판이 이상해요');
    room.players[idx].board = body.board;
    room.players[idx].ready = true;
    if (room.players[0] && room.players[1] && room.players[0].ready && room.players[1].ready) {
      room.phase = 'play';
      room.turn = Math.random() < 0.5 ? 0 : 1;     // 선공은 운
      room.called = [];
      room.winner = null;
    }
    await store.set(key(code), room);
    return { status: 200, body: publicState(room, idx) };
  }

  if (act === 'call') {
    const err = applyCall(room, idx, body.n, now);
    if (err) return bad(err.error, err.status);
    await store.set(key(code), room);
    return { status: 200, body: publicState(room, idx) };
  }

  if (act === 'restart') {
    if (room.phase !== 'done') return bad('아직 끝나지 않았어요');
    room.phase = 'wait';
    room.called = [];
    room.winner = null;
    room.round++;
    for (const p of room.players) if (p) { p.ready = false; p.board = null; }
    await store.set(key(code), room);
    return { status: 200, body: publicState(room, idx) };
  }

  return bad('알 수 없는 요청이에요');
}
