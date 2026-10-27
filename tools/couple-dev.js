#!/usr/bin/env node
/* 커플 게임들을 로컬에서 끝까지 돌려보는 서버.
 *   node tools/couple-dev.js        → http://localhost:8787/
 * 넷리파이 함수와 같은 규칙 파일(netlify/lib/*-core.mjs)을 쓰고 저장소만 메모리로 바꿔 끼운다.
 * 그래서 npm install 없이도 그대로 돈다. 게임마다 저장소가 따로라서 방 코드가 겹쳐도 괜찮다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const GAMES = {
  bingo: 'bingo-core.mjs', balance: 'balance-core.mjs', baseball: 'baseball-core.mjs', gomoku: 'gomoku-core.mjs',
  spice: 'spice-core.mjs', tiles: 'tiles-core.mjs', expedition: 'expedition-core.mjs', backgammon: 'backgammon-core.mjs',
  wordbingo: 'wordbingo-core.mjs',
  'party-bingo': 'party-bingo-core.mjs', 'party-spice': 'party-spice-core.mjs', 'party-expedition': 'party-expedition-core.mjs', 'party-marble': 'party-marble-core.mjs',
  'party-gomoku': 'party-gomoku-core.mjs', 'party-balance': 'party-balance-core.mjs', 'party-wordbingo': 'party-wordbingo-core.mjs',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function memStore() {                        // Netlify Blobs 자리
  const m = new Map();
  return {
    async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
  };
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function main() {
  const api = {};
  for (const [name, file] of Object.entries(GAMES)) {
    try {
      const { handle } = await import(path.join(ROOT, 'netlify/lib', file));
      api[name] = { handle, store: memStore() };
    } catch (e) {                            // 규칙 파일 하나가 깨져도 나머지 게임은 돈다
      console.log(`  (건너뜀) /api/${name} — ${String((e && e.message) || e).split('\n')[0]}`);
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/api\/([a-z-]+)$/);

    if (m) {
      const g = api[m[1]];
      if (!g) return send(res, 404, TYPES['.json'], '{"error":"없는 게임"}');
      if (req.method !== 'POST') return send(res, 405, TYPES['.json'], '{"error":"POST 만 받아요"}');
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        try {
          const r = await g.handle(JSON.parse(raw || '{}'), g.store);
          send(res, r.status, TYPES['.json'], JSON.stringify(r.body));
        } catch (e) {
          send(res, 500, TYPES['.json'], JSON.stringify({ error: String((e && e.message) || e) }));
        }
      });
      return;
    }

    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) return send(res, 403, 'text/plain', 'nope');
    fs.readFile(file, (e, data) => {
      if (e) return send(res, 404, 'text/plain; charset=utf-8', '없는 주소: ' + p);
      send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', data);
    });
  });

  server.listen(PORT, () => {
    console.log(`커플 게임 개발 서버  http://localhost:${PORT}/`);
    for (const n of Object.keys(api)) console.log(`  /api/${n}`);
    console.log('(방 상태는 메모리에만 있어서 서버를 끄면 사라집니다)');
  });
}
main();
