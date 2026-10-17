#!/usr/bin/env node
/* 오목 규칙 테스트.
 *   node tools/gomoku-smoke.js
 * netlify/lib/gomoku-core.mjs 를 그대로 불러서 메모리 저장소를 끼운다.
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
  const G = await import(path.join(__dirname, '..', 'netlify/lib/gomoku-core.mjs'));
  const { N, isDoubleThree, fiveAt, makeBoard } = G;
  const B = (black, white = []) => {
    const b = new Array(N * N).fill(0);
    black.forEach(([r, c]) => (b[r * N + c] = 1));
    white.forEach(([r, c]) => (b[r * N + c] = 2));
    return b;
  };

  try {
    // 쌍삼 판정
    check('열린 삼 두 개(가로 + 세로)는 쌍삼', isDoubleThree(B([[7, 5], [7, 6], [5, 7], [6, 7]]), 7, 7));
    check('한 칸 띈 삼(X.XX)도 삼으로 친다', isDoubleThree(B([[7, 4], [7, 6], [5, 7], [6, 7]]), 7, 7));
    check('대각 띈 삼 + 가로 삼도 쌍삼', isDoubleThree(B([[5, 5], [6, 6], [8, 6], [8, 7]]), 8, 8));
    check('한쪽이 백에 막힌 셋은 삼이 아니다', !isDoubleThree(B([[7, 5], [7, 6], [5, 7], [6, 7]], [[7, 4]]), 7, 7));
    check('판 끝에 붙은 셋은 열린 삼이 아니다', !isDoubleThree(B([[0, 0], [0, 1], [2, 2], [3, 2]]), 0, 2));
    check('넷 + 삼(사삼)은 둘 수 있다', !isDoubleThree(B([[7, 4], [7, 5], [7, 6], [5, 7], [6, 7]]), 7, 7));
    check('다섯이 되면 쌍삼이어도 둘 수 있다', !isDoubleThree(B([[7, 3], [7, 4], [7, 5], [7, 6], [5, 7], [6, 7]]), 7, 7));
    check('삼 하나는 둘 수 있다', !isDoubleThree(B([[7, 5], [7, 6]]), 7, 7));

    // 다섯
    const five = makeBoard([[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6], [0, 3], [7, 7]]);
    check('가로 다섯이면 이긴다', !!fiveAt(five, 7, 7) && fiveAt(five, 7, 7).length === 5);
    const diag = makeBoard([[3, 3], [0, 0], [4, 4], [0, 1], [5, 5], [0, 2], [6, 6], [0, 9], [7, 7]]);
    check('대각 다섯도 이긴다', !!fiveAt(diag, 5, 5));
    check('넷은 아직', !fiveAt(makeBoard([[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6]]), 7, 6));

    // 방 흐름 — 랜덤으로 선 정하기를 건너뛴다
    const store = memStore();
    const call = (b) => G.handle(b, store);
    const a = (await call({ action: 'create', name: '민호', pick: 'coin' })).body;
    const b = (await call({ action: 'join', code: a.code, name: '지유' })).body;
    const code = a.code, tk = [a.token, b.token];
    check('들어오면 바로 둔다 (랜덤 선)', b.phase === 'play' && b.size === 15);
    const first = b.first, second = 1 - first;
    const sA = (await call({ action: 'state', code, token: tk[first] })).body;
    check('선공이 흑, 후공이 백', sA.myColor === 'black' && b.myColor === (first === 1 ? 'black' : 'white'));
    const put = (i, r, c) => call({ action: 'place', code, token: tk[i], r, c });

    check('후공은 먼저 못 둔다', (await put(second, 7, 7)).status === 409);
    check('판 밖은 거절', (await put(first, 15, 0)).status === 400);
    let r = (await put(first, 7, 7)).body;
    check('두면 수가 기록되고 차례가 넘어간다', r.moves.length === 1 && r.turn === second);
    check('같은 자리엔 못 둔다', (await put(second, 7, 7)).status === 409);
    check('같은 사람이 연달아 못 둔다', (await put(first, 0, 0)).status === 409);

    // 흑 쌍삼 막기 — 흑: (7,7),(7,6),(6,8),(5,8) 을 만들어 두고 (7,8) 을 노린다... 대신 고전 모양으로
    //   흑 (7,5) (7,6) (5,7) (6,7) 이 있으면 (7,7) 이 쌍삼. 위에서 (7,7) 을 이미 썼으니 새 방에서 본다.
    const s2 = memStore();
    const c2 = (bb) => G.handle(bb, s2);
    const x = (await c2({ action: 'create', pick: 'coin' })).body;
    const y = (await c2({ action: 'join', code: x.code })).body;
    const t2 = [x.token, y.token], f2 = y.first, w2 = 1 - f2;
    const p2 = (i, rr, cc) => c2({ action: 'place', code: x.code, token: t2[i], r: rr, c: cc });
    for (const [bm, wm] of [[[7, 5], [0, 0]], [[7, 6], [0, 2]], [[5, 7], [0, 4]], [[6, 7], [0, 6]]]) {
      await p2(f2, ...bm); await p2(w2, ...wm);
    }
    const blackView = (await c2({ action: 'state', code: x.code, token: t2[f2] })).body;
    check('흑 차례엔 둘 수 없는 자리를 알려준다', blackView.forbidden.some(([rr, cc]) => rr === 7 && cc === 7),
      JSON.stringify(blackView.forbidden));
    const whiteView = (await c2({ action: 'state', code: x.code, token: t2[w2] })).body;
    check('백에게는 금지 자리를 안 보낸다', whiteView.forbidden.length === 0);
    const bad = await p2(f2, 7, 7);
    check('흑은 쌍삼을 못 둔다', bad.status === 409, bad.body.error);
    await p2(f2, 10, 10);                                  // 흑은 다른 데
    // 백이 같은 모양을 만들면 백은 괜찮다
    const s3 = memStore();
    const c3 = (bb) => G.handle(bb, s3);
    const u = (await c3({ action: 'create', pick: 'coin' })).body;
    const v = (await c3({ action: 'join', code: u.code })).body;
    const t3 = [u.token, v.token], f3 = v.first, w3 = 1 - f3;
    const p3 = (i, rr, cc) => c3({ action: 'place', code: u.code, token: t3[i], r: rr, c: cc });
    await p3(f3, 0, 0);
    for (const [wm, bm] of [[[7, 5], [0, 2]], [[7, 6], [0, 4]], [[5, 7], [0, 6]], [[6, 7], [14, 14]]]) {
      await p3(w3, ...wm); await p3(f3, ...bm);
    }
    const ok3 = await p3(w3, 7, 7);
    check('백은 쌍삼을 둬도 된다', ok3.status === 200);

    // 다섯으로 끝
    const s4 = memStore();
    const c4 = (bb) => G.handle(bb, s4);
    const g = (await c4({ action: 'create', pick: 'coin' })).body;
    const h = (await c4({ action: 'join', code: g.code })).body;
    const t4 = [g.token, h.token], f4 = h.first, w4 = 1 - f4;
    const p4 = (i, rr, cc) => c4({ action: 'place', code: g.code, token: t4[i], r: rr, c: cc });
    let last;
    for (let k = 0; k < 5; k++) {
      last = (await p4(f4, 7, 3 + k)).body;
      if (last.phase === 'done') break;
      await p4(w4, 0, k * 2);
    }
    check('다섯을 만들면 이긴다', last.phase === 'done' && last.winner === f4 && last.reason === 'five');
    check('이긴 줄을 알려준다', Array.isArray(last.line) && last.line.length === 5);
    check('끝난 뒤엔 못 둔다', (await p4(w4, 9, 9)).status === 409);
    const loserView = (await c4({ action: 'state', code: g.code, token: t4[w4] })).body;
    check('진 사람도 같은 결과를 본다', loserView.winner === f4);

    // 기권 — 자기 문서에 써서 상대 수와 동시에 눌러도 안 묻힌다
    const s5 = memStore();
    const c5 = (bb) => G.handle(bb, s5);
    const m = (await c5({ action: 'create', pick: 'coin' })).body;
    const n = (await c5({ action: 'join', code: m.code })).body;
    const t5 = [m.token, n.token], f5 = n.first, w5 = 1 - f5;
    const [, rs] = await Promise.all([
      c5({ action: 'place', code: m.code, token: t5[f5], r: 7, c: 7 }),
      c5({ action: 'resign', code: m.code, token: t5[w5] }),
    ]);
    const after = (await c5({ action: 'state', code: m.code, token: t5[f5] })).body;
    check('수를 두는 순간 상대가 기권해도 둘 다 남는다',
      after.moves.length === 1 && after.phase === 'done' && after.winner === f5 && after.reason === 'resign');

    // 다시 하기 — 선 정하기부터
    const re = (await c4({ action: 'restart', code: g.code, token: t4[0], round: 1 })).body;
    check('다시 하면 판이 비워진다', re.round === 2 && re.moves.length === 0);
  } catch (e) {
    failures++;
    console.log('FAIL  런타임 예외:', e.message);
    console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  }
  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
