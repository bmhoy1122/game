#!/usr/bin/env node
/* 커플 빙고를 로컬에서 끝까지 돌려보는 서버.
 *   node tools/bingo-dev.js            → http://localhost:8787/couple-bingo/
 * 넷리파이 함수와 같은 규칙 파일(netlify/functions/bingo-core.mjs)을 쓰고,
 * 저장소만 메모리로 바꿔 끼운다. 그래서 npm install 없이도 그대로 돈다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const mem = new Map();                       // Netlify Blobs 자리
const store = {
  async get(k) { const v = mem.get(k); return v === undefined ? null : JSON.parse(v); },
  async set(k, v) { mem.set(k, JSON.stringify(v)); },
};

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function main() {
  const { handle } = await import(path.join(ROOT, 'netlify/functions/bingo-core.mjs'));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/api/bingo') {
      if (req.method !== 'POST') return send(res, 405, TYPES['.json'], '{"error":"POST 만 받아요"}');
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        try {
          const r = await handle(JSON.parse(raw || '{}'), store);
          send(res, r.status, TYPES['.json'], JSON.stringify(r.body));
        } catch (e) {
          send(res, 500, TYPES['.json'], JSON.stringify({ error: String(e && e.message || e) }));
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
    console.log(`커플 빙고 개발 서버  http://localhost:${PORT}/couple-bingo/`);
    console.log('(방 상태는 메모리에만 있어서 서버를 끄면 사라집니다)');
  });
}
main();
