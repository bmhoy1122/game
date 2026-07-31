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
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
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
  get mode(){return mode}, get player(){return player}, get ents(){return ents},
  get items(){return items}, get wprops(){return wprops}, get sceneIdx(){return sceneIdx},
  get exitOpen(){return exitOpen}, get helpOpen(){return helpOpen},
};`;
eval(script + EXPOSE);
const G = global.__game;

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

try {
  press('Enter');
  check('타이틀에서 게임이 시작된다', G.mode === 'play');

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
