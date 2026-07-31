#!/usr/bin/env node
/* 브라우저 없이 게임 로직을 돌려서 런타임 오류를 잡는다.
 *   node tools/smoke.js
 * 캔버스는 가짜로 물려두고, arc/ellipse/roundRect 인자가 이상하면 잡아낸다.
 * (음수 반지름 때문에 실제로 게임이 죽은 적이 있어서 만든 장치다.)
 */
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, '..', 'evening-night', 'index.html');
const noop = () => {};
const badCalls = [];

const guarded = {
  arc: (x, y, r) => { if (!(r >= 0) || !isFinite(r)) badCalls.push('arc radius=' + r); },
  ellipse: (x, y, rx, ry) => { if (!(rx >= 0) || !(ry >= 0)) badCalls.push(`ellipse ${rx},${ry}`); },
  roundRect: (x, y, w, h) => { if (w < 0 || h < 0) badCalls.push(`roundRect ${w},${h}`); },
};
const STYLE = /^(fillStyle|strokeStyle|lineWidth|font|globalAlpha|textAlign|lineCap|globalCompositeOperation|imageSmoothingEnabled)$/;
const ctx = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createLinearGradient') return () => ({ addColorStop: noop });
    if (k === 'measureText') return () => ({ width: 10 });
    if (guarded[k]) return guarded[k];
    return typeof k === 'string' && STYLE.test(k) ? '' : noop;
  },
  set: () => true,
});

const listeners = {};
const nodes = {};
const bodyClasses = new Set();
const makeNode = (id) => nodes[id] || (nodes[id] = {
  id, innerHTML: '', style: {},
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  getContext: () => ctx,
  setPointerCapture: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
});

global.document = {
  getElementById: makeNode,
  createElement: () => makeNode('_tmp'),
  addEventListener: noop,
  body: { classList: {
    add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c),
    toggle: (c, v) => { v ? bodyClasses.add(c) : bodyClasses.delete(c); },
    contains: (c) => bodyClasses.has(c),
  } },
};
global.window = global;
global.matchMedia = () => ({ matches: false });     // 데스크톱으로 가정
global.addEventListener = noop;
global.localStorage = { _d: { handed: 'R' }, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
global.Image = class { constructor() { this.complete = true; this.naturalWidth = 672; } set src(v) {} get src() { return ''; } };
global.AudioContext = class { constructor() { throw new Error('no audio in node'); } };
global.performance = { now: () => 0 };
global.requestAnimationFrame = noop;
global.CanvasRenderingContext2D = function () {};

const html = fs.readFileSync(HTML, 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const EXPOSE = `
global.__game = {
  step, render, hit, keys,
  stickHold, stickMove, stickRelease, get stick(){return stick}, mk, ART, MOBART,
  get mode(){return mode}, get player(){return player}, get ents(){return ents},
  get items(){return items}, get wprops(){return wprops}, get sceneIdx(){return sceneIdx},
  get exitOpen(){return exitOpen}, get helpOpen(){return helpOpen},
};`;
eval(script + EXPOSE);
const G = global.__game;
const { ART, MOBART } = G;

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
};
const tick = () => { G.step(); G.render(); for (const k in G.hit) G.hit[k] = false; };
const press = (k) => { G.hit[k] = true; tick(); };
const hold = (k, n) => { G.keys[k] = true; for (let i = 0; i < n; i++) tick(); G.keys[k] = false; };
const walkTo = (x, limit = 4000) => {
  for (let i = 0; i < limit; i++) {
    const p = G.player;
    G.keys.ArrowRight = p.x < x - 6; G.keys.ArrowLeft = p.x > x + 6;
    tick();
    if (Math.abs(p.x - x) < 10) break;
  }
  G.keys.ArrowRight = G.keys.ArrowLeft = false;
};
const nearestFoe = () => G.ents.find((e) => e.foe && !e.gone && e.state !== 'happy' && !e.grabbedBy);
const approachFoe = () => {
  for (let i = 0; i < 5000; i++) {
    const foe = nearestFoe(); if (!foe) return null;
    const p = G.player;
    G.keys.ArrowRight = p.x < foe.x - 26; G.keys.ArrowLeft = p.x > foe.x + 26;
    G.keys.ArrowUp = p.z > foe.z + 8; G.keys.ArrowDown = p.z < foe.z - 8;
    tick();
    if (Math.abs(p.x - foe.x) < 34 && Math.abs(p.z - foe.z) < 16) {
      G.keys.ArrowRight = G.keys.ArrowLeft = G.keys.ArrowUp = G.keys.ArrowDown = false;
      return foe;
    }
  }
  return null;
};

const png = (p) => { const b = fs.readFileSync(p); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

try {
  // 시트에 없는 행을 그리면 캐릭터가 투명해져 통째로 사라진다. alt 없이 넘어가는 행이 없어야 한다.
  const artDir = path.join(__dirname, '..', 'evening-night', 'art');
  const heroRows = png(path.join(artDir, 'hero.png')).h / ART.hero.frameH;
  const mobRows = png(path.join(artDir, 'mob.png')).h / MOBART.cell;
  const missing = [];
  for (const [k, a] of Object.entries(ART.hero.anims))
    if (a.row >= heroRows && !a.alt) missing.push('hero:' + k);
  for (const [k, s2] of Object.entries(MOBART)) {
    if (!s2 || typeof s2 !== 'object' || s2.idle === undefined) continue;
    for (const r of ['idle', 'walk', 'face'])
      if (s2[r] >= mobRows && !s2.alt) missing.push(`mob:${k}.${r}`);
  }
  check('시트에 없는 행은 전부 대체(alt)가 있다', missing.length === 0, missing.join(' '));
  check('대시·둥실 심통이 그림이 시트에 있다', heroRows >= 20 && mobRows >= 14,
    `hero ${heroRows}행 / mob ${mobRows}행`);

  // applyHand() 를 righty 선언보다 먼저 부르면 TDZ 가 try/catch 에 삼켜져 조용히 무시된다
  check('저장된 왼손/오른손 설정이 켤 때 반영된다', bodyClasses.has('righty'));

  press('Enter');
  check('타이틀에서 게임이 시작된다', G.mode === 'play');

  // 모바일 조이스틱 — 화면 기준 방향. 가짜 캔버스가 960×540 이라 중심(480,270) 반경 288.
  const SX = 480, SY = 270, SR = 288;
  const s0 = G.player.x;
  G.stickHold(SX + SR * 0.6, SY);
  for (let i = 0; i < 45; i++) tick();
  const dHalf = G.player.x - s0;
  check('조이스틱을 민 방향으로 간다', dHalf > 10 && G.player.facing === 1, 'Δx=' + Math.round(dHalf));

  const s1 = G.player.x;
  G.stickMove(SX + 20, SY);                       // 중심 근처 = 데드존
  for (let i = 0; i < 20; i++) tick();
  check('중심 근처(데드존)에서는 안 움직인다', G.stick.mx === 0 && Math.abs(G.player.x - s1) < 6);

  const s2 = G.player.x;
  G.stickMove(SX + SR, SY);                       // 끝까지 밀면 달리기
  for (let i = 0; i < 45; i++) tick();
  const dFull = G.player.x - s2;
  check('끝까지 밀면 살짝 밀 때보다 빠르다', dFull > dHalf * 1.6,
    Math.round(dHalf) + ' → ' + Math.round(dFull));

  const s3 = G.player.x;
  G.stickRelease();
  for (let i = 0; i < 20; i++) tick();
  check('손을 떼면 멈춘다', !G.stick.on && Math.abs(G.player.x - s3) < 6);

  // 둥실 심통이 — 바닥에서는 안 닿고, 점프하면 닿는다 (웨이브가 뜨기 전에 확인)
  const settle = () => { for (let i = 0; i < 80 && G.player.state !== 'idle'; i++) tick(); };
  const puff = G.mk('puff', G.player.x + 40, G.player.z);
  puff.cool = 99999;                                    // 테스트 중엔 공격(내려오기) 금지
  G.ents.push(puff);
  for (let i = 0; i < 50; i++) tick();
  check('둥실 심통이는 공중에 떠 있다', puff.y > 40, 'y=' + Math.round(puff.y));

  const m0 = puff.mood;
  for (let n = 0; n < 4; n++) { press('KeyZ'); settle(); }
  check('바닥에서 간지럽히면 안 닿는다',
    puff.mood === m0 && G.player.facing === 1 && !G.player.grabbing,
    'facing=' + G.player.facing);

  settle();
  press('Space');
  for (let i = 0; i < 6; i++) tick();
  const jy = G.player.y;
  press('KeyZ');
  for (let i = 0; i < 16; i++) tick();
  check('점프해서 간지럽히면 닿는다', puff.mood > m0,
    `y=${Math.round(jy)}, ${m0} → ${Math.round(puff.mood)}`);
  puff.gone = true; tick();
  while (G.player.y > 0) tick();
  settle();

  // 대시 — 달리는 중에 점프하면 앞으로 쭉
  G.stickHold(SX + SR, SY);
  for (let i = 0; i < 25; i++) tick();
  const wasRun = G.player.state === 'run';
  press('Space');
  const vxDash = G.player.vx, dashT = G.player.dashT;
  G.stickRelease();
  check('달리는 중 점프하면 대시가 나간다',
    wasRun && dashT > 0 && vxDash > G.player.def.sp * 2, 'vx=' + vxDash.toFixed(1));
  let air = 0; while (G.player.y > 0 && air++ < 200) tick();
  check('대시가 끝나면 착지하고 풀린다', G.player.y === 0 && G.player.dashT === 0 && air < 200);
  for (let i = 0; i < 10; i++) tick();

  hold('ArrowRight', 400);
  check('오른쪽으로 이동한다', G.player.x > 200, 'x=' + Math.round(G.player.x));
  check('웨이브가 등장한다', G.ents.filter((e) => e.foe).length > 0);

  const before = G.player.x;
  hold('ArrowLeft', 150);
  check('왼쪽으로도 되돌아간다', G.player.x < before);

  const w = G.wprops.find((v) => !v.taken);
  if (w) {
    walkTo(w.x);
    press('KeyX');
    check('X 로 소품을 줍는다', !!G.player.prop, G.player.prop || '');
    press('Space');
    check('점프하면 소품을 내려놓는다', !G.player.prop);
  } else check('소품이 배치되어 있다', false);

  approachFoe();
  for (let n = 0; n < 5; n++) { press('KeyZ'); for (let i = 0; i < 8; i++) tick(); }
  check('Z 를 짧게 누르면 간지럼만 (안 잡힘)', !G.player.grabbing);

  approachFoe();
  G.keys.KeyZ = true; G.hit.KeyZ = true;
  let f = 0; while (f < 60 && !G.player.grabbing) { tick(); f++; }
  G.keys.KeyZ = false;
  check('Z 를 꾹 누르면 안는다', !!G.player.grabbing, f + '프레임');
  press('Space');
  check('잡은 상태에서 점프 = 놓아주기', !G.player.grabbing);

  press('KeyH');
  const xh = G.player.x; hold('ArrowRight', 90);
  check('H 도움말이 열리면 게임이 멈춘다', G.helpOpen && Math.round(G.player.x) === Math.round(xh));
  press('KeyH');
  check('H 를 다시 누르면 닫힌다', !G.helpOpen);

  // 1면 클리어까지
  let guard = 0;
  while (!G.exitOpen && guard++ < 10) {
    const it = G.items.find((i) => !i.got); if (!it) break;
    walkTo(it.x, 6000);
    for (let i = 0; i < 400 && !it.got; i++) {
      const p = G.player;
      G.keys.ArrowUp = p.z > it.z + 6; G.keys.ArrowDown = p.z < it.z - 6;
      G.keys.ArrowRight = p.x < it.x - 6; G.keys.ArrowLeft = p.x > it.x + 6;
      if (i % 25 === 0) G.hit.KeyZ = true;
      tick();
    }
    G.keys.ArrowUp = G.keys.ArrowDown = G.keys.ArrowRight = G.keys.ArrowLeft = false;
  }
  check('숨은 물건 3개를 모두 찾으면 출구가 열린다', G.exitOpen);
  const scene = G.sceneIdx;
  walkTo(99999, 6000);
  check('출구로 들어가면 다음 장면으로 넘어간다', G.sceneIdx !== scene, `${scene} → ${G.sceneIdx}`);

  // 마구잡이 입력 내성
  for (let i = 0; i < 12000; i++) {
    G.keys.ArrowRight = (i % 700) < 520; G.keys.ArrowLeft = (i % 700) >= 520;
    G.keys.ArrowUp = (i % 310) < 90; G.keys.ArrowDown = (i % 310) >= 250;
    G.keys.KeyZ = (i % 40) < 16;
    if (i % 23 === 0) G.hit.KeyZ = true;
    if (i % 31 === 0) G.hit.KeyX = true;
    if (i % 97 === 0) G.hit.Space = true;
    if (i % 601 === 0) G.hit.KeyH = true;
    tick();
  }
  check('12000프레임 마구잡이 입력에도 죽지 않는다', true);
} catch (e) {
  failures++;
  console.log('FAIL  런타임 예외:', e.message);
  console.log(e.stack.split('\n').slice(1, 5).join('\n'));
}

check('캔버스 인자가 모두 정상', badCalls.length === 0, [...new Set(badCalls)].slice(0, 3).join(' | '));

console.log(failures ? `\n${failures}개 실패` : '\n전부 통과');
process.exit(failures ? 1 : 0);
