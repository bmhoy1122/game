/* 커플 빙고 — Netlify 함수 껍데기. 규칙은 전부 bingo-core.mjs 에 있다.
 * 이 파일만 @netlify/blobs 를 안다. POST /api/bingo 하나로 다 받는다.
 */
import { getStore } from '@netlify/blobs';
import { handle } from './bingo-core.mjs';

function blobStore() {
  const s = getStore({ name: 'couple-bingo', consistency: 'strong' });
  return {
    get: (k) => s.get(k, { type: 'json' }),
    set: (k, v) => s.setJSON(k, v),
  };
}

export default async (req) => {
  const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
  if (req.method !== 'POST') return json(405, { error: 'POST 만 받아요' });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: '요청을 읽지 못했어요' }); }
  try {
    const r = await handle(body, blobStore());
    return json(r.status, r.body);
  } catch (e) {
    return json(500, { error: '서버에서 문제가 생겼어요', detail: String((e && e.message) || e) });
  }
};

export const config = { path: '/api/bingo' };
