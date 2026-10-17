#!/usr/bin/env node
/* 선 정하기(가위바위보 · 묵찌빠 · 하나빼기 · 랜덤) 규칙 테스트.
 *   node tools/pick-smoke.js
 * netlify/lib/first-pick.mjs 를 그대로 부르고, 실제 방 흐름은 오목 위에서 돌려본다.
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
  const P = await import(path.join(__dirname, '..', 'netlify/lib/first-pick.mjs'));
  const G = await import(path.join(__dirname, '..', 'netlify/lib/gomoku-core.mjs'));
  const { resolve, beats } = P;

  try {
    // 가위바위보 판정
    check('바위는 가위를 이긴다', beats('r', 's') === 1 && beats('s', 'r') === -1);
    check('가위는 보를, 보는 바위를 이긴다', beats('s', 'p') === 1 && beats('p', 'r') === 1);
    check('같으면 비긴다', beats('p', 'p') === 0);

    // 가위바위보
    check('가위바위보: 비기면 아직', resolve('rps', ['r'], ['r']).winner === null);
    check('가위바위보: 비긴 뒤 이기면 끝', resolve('rps', ['r', 'p'], ['r', 'r']).winner === 0);
    check('가위바위보: 한 명만 냈으면 아직', resolve('rps', ['r'], []).winner === null);

    // 묵찌빠
    const m1 = resolve('mjb', ['r'], ['s']);
    check('묵찌빠: 첫 판 이긴 쪽이 공격', m1.winner === null && m1.attacker === 0);
    check('묵찌빠: 공격이 같은 손이면 공격 승', resolve('mjb', ['r', 'p'], ['s', 'p']).winner === 0);
    const m3 = resolve('mjb', ['r', 'r'], ['s', 'p']);
    check('묵찌빠: 다른 손에서 이긴 쪽으로 공격이 넘어간다', m3.winner === null && m3.attacker === 1);
    check('묵찌빠: 넘어간 공격이 같은 손이면 그쪽 승', resolve('mjb', ['r', 'r', 's'], ['s', 'p', 's']).winner === 1);
    check('묵찌빠: 공격 정하기 전 비김은 그냥 다시', resolve('mjb', ['r', 'r'], ['r', 's']).attacker === 0);

    // 하나빼기
    const h1 = resolve('hana', [['r', 's']], [['p', 'p']]);
    check('하나빼기: 두 손을 다 내면 두 손만 공개', h1.winner === null && h1.open && h1.step === 1);
    check('하나빼기: 남긴 손끼리 가위바위보', resolve('hana', [['r', 's'], 1], [['p', 'p'], 0]).winner === 0);
    const h3 = resolve('hana', [['r', 's'], 0], [['r', 'p'], 0]);
    check('하나빼기: 비기면 두 손부터 다시', h3.winner === null && h3.step === 2 && !h3.open);

    // 실제 방에서 — 오목 위에 올려서 본다
    for (const kind of ['rps', 'mjb', 'hana']) {
      const store = memStore();
      const call = (b) => G.handle(b, store);
      const a = (await call({ action: 'create', name: 'A', pick: kind })).body;
      const b = (await call({ action: 'join', code: a.code, name: 'B' })).body;
      check(`[${kind}] 둘이 들어오면 선 정하기부터`, b.phase === 'pick' && b.pick.kind === kind && b.pick.need);
      const tk = [a.token, b.token];
      const t = (i, value) => call({ action: 'throw', code: a.code, token: tk[i], value });

      check(`[${kind}] 엉뚱한 걸 내면 거절`, (await t(0, 'x')).status === 400);
      const first = kind === 'hana' ? ['r', 's'] : 'r';
      const r0 = (await t(0, first)).body;
      check(`[${kind}] 내 손은 나한테 보인다`, JSON.stringify(r0.pick.mineNow) === JSON.stringify(first));
      const peek = (await call({ action: 'state', code: a.code, token: tk[1] })).body;
      check(`[${kind}] 상대는 "냈다"만 안다`, peek.pick.theirsIn === true && peek.pick.mineNow === null && peek.pick.rounds.length === 0);
      const changed = kind === 'hana' ? ['p', 'p'] : 'p';
      check(`[${kind}] 상대가 내기 전엔 바꿀 수 있다`,
        JSON.stringify((await t(0, changed)).body.pick.mineNow) === JSON.stringify(changed));

      // 끝날 때까지 — 1번은 매번 지는 손을 낸다 (하나빼기는 남길 손까지)
      let s = null, guard = 0;
      const lose = { r: 's', s: 'p', p: 'r' };
      while (guard++ < 12) {
        s = (await call({ action: 'state', code: a.code, token: tk[0] })).body;
        if (s.phase !== 'pick') break;
        const need = s.pick.need;
        const mine0 = s.pick.mineNow;
        if (mine0 === null) await t(0, need === 'pair' ? ['p', 'p'] : need === 'keep' ? 0 : 'p');
        // 0번이 보를 냈으니 1번은 바위(진다). 묵찌빠 첫 판 뒤엔 같은 손(보)이면 공격(0) 승
        const atk = s.pick.attacker;
        const v1 = need === 'pair' ? ['r', 'r'] : need === 'keep' ? 0 : (kind === 'mjb' && atk === 0 ? 'p' : 'r');
        await t(1, v1);
      }
      s = (await call({ action: 'state', code: a.code, token: tk[0] })).body;
      check(`[${kind}] 정해지면 진 쪽 없이 다음으로 넘어간다`, s.phase === 'play' && s.first === 0, `선공 ${s.first}`);
      check(`[${kind}] 정해진 뒤엔 못 낸다`, (await t(1, kind === 'hana' ? ['r', 'r'] : 'r')).status === 409);
      const sB = (await call({ action: 'state', code: a.code, token: tk[1] })).body;
      check(`[${kind}] 두 사람이 같은 선공을 본다`, sB.first === s.first && sB.pick.done);
    }

    // 둘이 동시에 내도 안 묻힌다
    let lost = 0;
    for (let i = 0; i < 15; i++) {
      const store = memStore();
      const call = (b) => G.handle(b, store);
      const a = (await call({ action: 'create', pick: 'rps' })).body;
      const b = (await call({ action: 'join', code: a.code })).body;
      await Promise.all([
        call({ action: 'throw', code: a.code, token: a.token, value: 'r' }),
        call({ action: 'throw', code: a.code, token: b.token, value: 's' }),
      ]);
      const s = (await call({ action: 'state', code: a.code, token: a.token })).body;
      if (s.first !== 0) lost++;
    }
    check('둘이 동시에 내도 한쪽 손이 묻히지 않는다', lost === 0, `15번 중 ${lost}번 유실`);

    // 랜덤 — 낼 것 없이 바로
    const store = memStore();
    const call = (b) => G.handle(b, store);
    const a = (await call({ action: 'create', pick: 'coin' })).body;
    const b = (await call({ action: 'join', code: a.code })).body;
    check('랜덤은 들어오자마자 정해진다', b.phase === 'play' && (b.first === 0 || b.first === 1));
    check('모르는 방식은 가위바위보로', (await call({ action: 'create', pick: '???' })).body.pick.kind === 'rps');
  } catch (e) {
    failures++;
    console.log('FAIL  런타임 예외:', e.message);
    console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  }
  console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
  process.exit(failures ? 1 : 0);
})();
