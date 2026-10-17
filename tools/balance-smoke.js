#!/usr/bin/env node
/* 이심전심 규칙을 브라우저도 서버도 없이 돌려본다.
 *   node tools/balance-smoke.js
 * netlify/lib/balance-core.mjs 를 그대로 불러서 메모리 저장소를 끼운다.
 * 저장소에 일부러 무작위 지연을 넣어서 두 요청이 실제로 엇갈리게 만든다.
 */
const path = require('path');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
};
const jitter = () => new Promise((r) => setTimeout(r, Math.random() * 4));
function memStore() {
  const m = new Map();
  return {
    async get(k) { await jitter(); const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async set(k, v) { await jitter(); m.set(k, JSON.stringify(v)); },
  };
}

(async () => {
  const { handle, QUESTIONS, PER_ROUND } = await import(path.join(__dirname, '..', 'netlify/lib/balance-core.mjs'));
  const store = memStore();
  const call = (b, now) => handle(b, store, now);

  try {
    check(`질문이 넉넉하다 (${QUESTIONS.length}개)`, QUESTIONS.length >= PER_ROUND * 6);
    check('질문이 겹치지 않는다', new Set(QUESTIONS.map((q) => q.join('|'))).size === QUESTIONS.length);
    check('보기가 버튼에 들어갈 만큼 짧다', QUESTIONS.flat().every((s) => s.length <= 12));

    const a = (await call({ action: 'create', name: '민호' })).body;
    check('방이 만들어진다', /^\d{4}$/.test(a.code) && a.phase === 'wait', a.code);
    const code = a.code, tA = a.token;
    const b = (await call({ action: 'join', code, name: '지유' })).body;
    const tB = b.token;
    check('둘째가 들어오면 바로 시작한다', b.phase === 'play' && b.qi === 0 && b.total === PER_ROUND);
    check('상대 이름이 보인다', b.opponent.name === '민호');
    check('토큰은 상대에게 안 간다', !JSON.stringify(b).includes(tA));
    check('세 번째는 막는다', (await call({ action: 'join', code, name: 'x' })).status === 409);

    const sA = (await call({ action: 'state', code, token: tA })).body;
    check('둘이 같은 질문을 본다', JSON.stringify(sA.q) === JSON.stringify(b.q), sA.q.join(' vs '));

    // 한 명만 고르면 상대 답은 안 보인다
    let r = (await call({ action: 'pick', code, token: tA, qi: 0, choice: 0 })).body;
    check('고르면 내 답이 저장된다', r.mine === 0 && r.reveal === null);
    const peek = (await call({ action: 'state', code, token: tB })).body;
    check('상대는 "골랐다"는 것만 안다', peek.theirsPicked === true && peek.reveal === null);
    check('상대 답이 응답 어디에도 없다', peek.mine === null && !('theirs' in peek));
    r = (await call({ action: 'pick', code, token: tA, qi: 0, choice: 1 })).body;
    check('상대가 고르기 전엔 바꿀 수 있다', r.mine === 1);

    check('둘 다 고르기 전엔 못 넘긴다', (await call({ action: 'next', code, token: tA, qi: 0 })).status === 409);

    r = (await call({ action: 'pick', code, token: tB, qi: 0, choice: 1 })).body;
    check('둘 다 고르면 공개된다', r.reveal && r.reveal.mine === 1 && r.reveal.theirs === 1 && r.reveal.match);
    check('공개된 뒤엔 못 바꾼다', (await call({ action: 'pick', code, token: tA, qi: 0, choice: 0 })).status === 409);
    check('없는 보기는 거절한다', (await call({ action: 'pick', code, token: tA, qi: 0, choice: 2 })).status === 400);

    // 둘이 동시에 '다음' — 한 칸만 넘어가야 한다
    const [n1, n2] = await Promise.all([
      call({ action: 'next', code, token: tA, qi: 0 }), call({ action: 'next', code, token: tB, qi: 0 }),
    ]);
    const after = (await call({ action: 'state', code, token: tA })).body;
    check('둘이 동시에 "다음"을 눌러도 한 칸만 넘어간다', n1.status === 200 && n2.status === 200 && after.qi === 1, 'qi=' + after.qi);
    check('지나간 문제는 기록에 남는다', after.history.length === 1 && after.history[0].match && after.matches === 1);

    // 동시에 고르기 — 이 구조를 만든 이유. 여러 번 엇갈려도 둘 다 남아야 한다
    let lost = 0;
    for (let qi = 1; qi < PER_ROUND; qi++) {
      const cA = qi % 2, cB = qi % 3 === 0 ? cA : 1 - cA;
      await Promise.all([
        call({ action: 'pick', code, token: tA, qi, choice: cA }),
        call({ action: 'pick', code, token: tB, qi, choice: cB }),
      ]);
      const s = (await call({ action: 'state', code, token: tB })).body;
      if (!s.reveal || s.reveal.mine !== cB || s.reveal.theirs !== cA) lost++;
      await call({ action: 'next', code, token: qi % 2 ? tA : tB, qi });
    }
    check('둘이 동시에 골라도 한쪽 답이 묻히지 않는다', lost === 0, `${PER_ROUND - 1}번 중 ${lost}번 유실`);

    const done = (await call({ action: 'state', code, token: tA })).body;
    check('10문제 끝나면 결과가 나온다', done.phase === 'done' && done.history.length === PER_ROUND);
    const expect = done.history.filter((h) => h.mine === h.theirs).length;
    check('일치 개수가 기록과 맞는다', done.matches === expect, `${done.matches}/${PER_ROUND}`);
    const doneB = (await call({ action: 'state', code, token: tB })).body;
    check('두 사람이 같은 일치 개수를 본다', doneB.matches === done.matches);
    check('끝난 뒤엔 못 고른다', (await call({ action: 'pick', code, token: tA, qi: 9, choice: 0 })).status === 409);

    // 둘이 동시에 '다시 하기' — 같은 새 판이 나와야 한다 (seeded)
    const oldQ = done.history.map((h) => h.q.join('|'));
    const [x, y] = await Promise.all([
      call({ action: 'restart', code, token: tA, round: 1 }), call({ action: 'restart', code, token: tB, round: 1 }),
    ]);
    const fresh = (await call({ action: 'state', code, token: tA })).body;
    check('둘이 동시에 다시 해도 판은 하나만 올라간다', fresh.round === 2 && x.body.round === 2 && y.body.round === 2);
    check('둘이 같은 새 질문을 본다', JSON.stringify(x.body.q) === JSON.stringify(y.body.q));
    check('새 판은 질문이 바뀐다', JSON.stringify(fresh.history) === '[]' && oldQ[0] !== fresh.q.join('|'));
    check('지난 판 답은 새 판에 안 남는다', fresh.mine === null && fresh.theirsPicked === false);

    check('남의 방은 못 본다', (await call({ action: 'state', code, token: 'nope' })).status === 403);
    check('12시간 지난 방은 사라진다',
      (await call({ action: 'state', code, token: tA }, Date.now() + 13 * 3600e3)).status === 404);
  } catch (e) {
    failures++;
    console.log('FAIL  런타임 예외:', e.message);
    console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  }
  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
