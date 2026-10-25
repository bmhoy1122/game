#!/usr/bin/env node
/* 단어 빙고 규칙 테스트.
 *   node tools/wordbingo-smoke.js
 * netlify/lib/wordbingo-core.mjs 를 그대로 불러서 메모리 저장소를 끼운다. npm install 없이 돈다.
 */
const path = require('path');
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? ' ok ' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
const jitter = () => new Promise((r) => setTimeout(r, Math.random() * 4));
function memStore() {
  const m = new Map();
  return {
    async get(k) { await jitter(); const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async set(k, v) { await jitter(); m.set(k, JSON.stringify(v)); },
  };
}

(async () => {
  const W = await import(path.join(__dirname, '..', 'netlify/lib/wordbingo-core.mjs'));
  const { BOT_DELAY } = await import(path.join(__dirname, '..', 'netlify/lib/room-kit.mjs'));
  const { boardProblem, lineCount, norm, options, linesFor } = W;
  try {
    // 판 검사
    const nine = ['사과', '배', '포도', '딸기', '수박', '참외', '귤', '감', '키위'];
    check('3×3 판 정상', boardProblem(nine, 3) === null);
    check('빈 칸은 안 된다', /비어/.test(boardProblem([...nine.slice(0, 8), '  '], 3)));
    check('같은 단어 두 번은 안 된다 (띄어쓰기 무시)', /두 번/.test(boardProblem([...nine.slice(0, 8), '사 과'], 3)));
    check('칸 수가 다르면 안 된다', !!boardProblem(nine, 4));
    check('같은 단어 판정은 띄어쓰기·대소문자 무시', norm(' Apple 파이 ') === norm('apple파이'));
    // 줄 세기
    check('3×3 은 8줄', linesFor(3).length === 8 && linesFor(5).length === 12);
    check('첫 가로줄 지우면 1줄', lineCount(nine, new Set(['사과', '배', '포도'].map(norm)), 3) === 1);
    check('대각선도 줄', lineCount(nine, new Set(['사과', '수박', '키위'].map(norm)), 3) === 1);
    // 설정 거르기
    const o1 = options({ topic: 'custom', topicText: '  우리가   본 영화  ', size: 4, lines: 9 });
    check('직접 쓴 주제는 다듬어서', o1.topic.label === '우리가 본 영화' && o1.topic.id === 'custom');
    check('이상한 줄 수는 크기 기본값', o1.lines === 2 && o1.size === 4);
    const o2 = options({ topic: 'nope', size: 7 });
    check('이상한 주제·크기는 과일 5×5', o2.topic.id === 'fruit' && o2.size === 5 && o2.lines === 3);

    // 방 흐름
    const store = memStore();
    const call = (b) => W.handle(b, store);
    const a = (await call({ action: 'create', name: '민호', pick: 'coin', topic: 'fruit', size: 3, lines: 1 })).body;
    check('방 설정이 응답에 실린다', a.size === 3 && a.winLines === 1 && a.topic.label === '과일' && a.phase === 'wait');
    const b = (await call({ action: 'join', code: a.code, name: '지유' })).body;
    const code = a.code, tk = [a.token, b.token];
    check('랜덤 선이면 바로 단어 쓰기', b.phase === 'setup' && b.first !== null);
    check('쓰는 동안 주제 단어 목록을 준다', Array.isArray(b.suggest) && b.suggest.includes('사과'));
    const first = b.first, second = 1 - first;
    const A = ['사과', '배', '포도', '딸기', '수박', '참외', '귤', '감', '키위'];
    const B = ['키위', '망고', '체리', '레몬', '수 박', '라임', '자두', '멜론', '사 과'];
    const boards = [];
    boards[first] = A; boards[second] = B;
    const bad = await call({ action: 'ready', code, token: tk[first], board: [...A.slice(0, 8), '사과'] });
    check('같은 단어가 있는 판은 이유와 함께 거절', bad.status === 400 && /두 번/.test(bad.body.error), bad.body.error);
    // 둘이 동시에 준비
    const [r0, r1] = await Promise.all([
      call({ action: 'ready', code, token: tk[first], board: A }),
      call({ action: 'ready', code, token: tk[second], board: B }),
    ]);
    check('둘이 동시에 준비해도 둘 다 남는다', r0.status === 200 && r1.status === 200);
    const s0 = (await call({ action: 'state', code, token: tk[first] })).body;
    check('둘 다 준비하면 시작', s0.phase === 'play' && s0.yourTurn === true);
    check('상대 판은 응답에 없다', !JSON.stringify(s0).includes('망고') && s0.opponentBoard === null);
    const put = (who, i) => call({ action: 'call', code, token: tk[who], i });
    check('후공은 먼저 못 부른다', (await put(second, 0)).status === 409);
    let r = await put(first, 4);                                   // 수박 — 상대 판에 '수 박'
    check('부르면 기록되고 차례가 넘어간다', r.status === 200 && r.body.called.length === 1 && r.body.turn === second);
    check('상대 판에도 있으면 둘 다 표시', r.body.called[0].both === true && r.body.called[0].w === '수박');
    check('같은 단어는 다시 못 부른다', (await put(second, 4)).status === 409);   // B[4] = '수 박'
    check('범위 밖 칸은 거절', (await put(second, 9)).status === 400);
    r = await put(second, 1);                                      // 망고 — A 에 없다
    check('없는 단어는 둘 다 아님', r.body.called[1].both === false);
    // first: 사과(0) → 사과·수박·키위 대각선 완성 (사과는 B 에도 '사 과')
    r = await put(first, 0);
    check('아직 1줄 안 됨', r.body.phase === 'play' && r.body.lines[first] === 0);
    await put(second, 2);                                          // 체리
    r = await put(first, 8);                                       // 키위 → A 대각선(사과·수박·키위)
    // B 도 대각선이 키위·수 박·사 과 라 같은 수에 1줄 → 무승부
    check('같은 수에 둘 다 채우면 무승부', r.body.phase === 'done' && r.body.winner === 'draw', JSON.stringify(r.body.lines));
    check('띄어 쓴 단어도 같은 단어로 지워져 줄이 된다', r.body.lines[second] >= 1, JSON.stringify(r.body.lines));
    check('끝나면 상대 판이 공개된다', Array.isArray(r.body.opponentBoard) && r.body.opponentBoard.includes('망고'));
    check('끝난 뒤엔 못 부른다', (await put(second, 3)).status === 409);

    // 혼자 먼저 채우면 이긴다 — 겹치는 단어가 없는 두 판
    const ws = memStore();
    const wc = (bb) => W.handle(bb, ws);
    const x = (await wc({ action: 'create', pick: 'coin', topic: 'animal', size: 3, lines: 1 })).body;
    const y = (await wc({ action: 'join', code: x.code })).body;
    const t2 = [x.token, y.token], f2 = y.first, s2 = 1 - f2;
    const bd = []; bd[f2] = A; bd[s2] = ['곰', '여우', '늑대', '사슴', '판다', '하마', '소', '말', '양'];
    await wc({ action: 'ready', code: x.code, token: t2[0], board: bd[0] });
    await wc({ action: 'ready', code: x.code, token: t2[1], board: bd[1] });
    const p2 = (who, i) => wc({ action: 'call', code: x.code, token: t2[who], i });
    await p2(f2, 0); await p2(s2, 0); await p2(f2, 1); await p2(s2, 4);
    const w2 = (await p2(f2, 2)).body;
    check('먼저 1줄 채우면 이긴다', w2.phase === 'done' && w2.winner === f2 && w2.lines[s2] === 0, JSON.stringify(w2.lines));

    // 다시 하기 — 설정은 그대로, 판은 새로
    const re = (await call({ action: 'restart', code, token: tk[0], round: 1 })).body;
    check('다시 하면 같은 주제로 새 판', re.round === 2 && re.called.length === 0 && re.topic.label === '과일' && re.board === null);

    // 봇 방 — 사람은 직접 쓴 주제, 봇은 섞은 단어
    const bs = memStore();
    let now = 1_000_000, tok = null, bcode = null;
    const bcall = async (body, dt = 0) => { now += dt; const res = await W.handle({ ...body, token: tok, code: bcode }, bs, now); if (res.body.token) tok = res.body.token; if (res.body.code) bcode = res.body.code; return res; };
    let st = (await bcall({ action: 'create', name: '나', pick: 'rps', bot: true, topic: 'custom', topicText: '아무거나', size: 4 })).body;
    check('봇 방이 만들어진다', st.bot === true && st.size === 4 && st.winLines === 2);
    const mine = ['사과', '강아지', '김밥', '한국', '서울역', '의사', '축구', '새우깡', '바나나', '고양이', '라면', '일본', '강남', '요리사', '야구', '젤리'];
    let guard = 0;
    while (st.phase !== 'done' && guard++ < 400) {
      if (st.phase === 'pick' && st.pick && st.pick.need) await bcall({ action: 'throw', value: st.pick.need === 'pair' ? ['r', 'p'] : 'r' });
      if (st.phase === 'setup' && !st.ready) await bcall({ action: 'ready', board: mine });
      if (st.phase === 'play' && st.yourTurn) {
        const keys = new Set(st.called.map((c) => norm(c.w)));
        const i = st.board.findIndex((w) => !keys.has(norm(w)));
        await bcall({ action: 'call', i });
      }
      st = (await bcall({ action: 'state' }, BOT_DELAY + 500)).body;
    }
    check('봇 방이 끝까지 간다', st.phase === 'done', `${st.phase} ${guard}`);
    check('봇 판이 끝나고 공개된다', Array.isArray(st.opponentBoard) && st.opponentBoard.length === 16);

    // 봇끼리 비슷하게 — 무작위 합법수 상대로 여러 판 (예외·멈춤 없음)
    let finished = 0;
    for (let g = 0; g < 60; g++) {
      const ms = memStore();
      let t = 1_000_000, tk2 = null, c2 = null;
      const mc = async (body, dt = 0) => { t += dt; const res = await W.handle({ ...body, token: tk2, code: c2 }, ms, t); if (res.body.token) tk2 = res.body.token; if (res.body.code) c2 = res.body.code; return res; };
      const size = [3, 4, 5][g % 3];
      let s = (await mc({ action: 'create', pick: 'coin', bot: true, topic: ['fruit', 'animal', 'food', 'subway'][g % 4], size })).body;
      const pool = [...s.suggest || []];
      let n = 0;
      while (s.phase !== 'done' && n++ < 300) {
        if (s.phase === 'setup' && !s.ready) {
          const sug = s.suggest.slice().sort(() => Math.random() - 0.5).slice(0, size * size);
          await mc({ action: 'ready', board: sug });
        }
        if (s.phase === 'play' && s.yourTurn) {
          const keys = new Set(s.called.map((c) => norm(c.w)));
          const open = s.board.map((w, i) => (keys.has(norm(w)) ? -1 : i)).filter((i) => i >= 0);
          await mc({ action: 'call', i: open[Math.floor(Math.random() * open.length)] });
        }
        s = (await mc({ action: 'state' }, BOT_DELAY + 500)).body;
      }
      if (s.phase === 'done') finished++;
      void pool;
    }
    check('무작위 상대로 60판 전부 끝난다', finished === 60, String(finished));
  } catch (e) {
    failures++;
    console.log('FAIL  런타임 예외:', e.message);
    console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  }
  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
