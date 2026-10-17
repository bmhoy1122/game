/* 넷리파이 함수 껍데기 공용. 커플 게임 함수들은 전부 이걸로 감싼다.
 * 여기만 @netlify/blobs 를 안다. 규칙 파일(*-core.mjs)은 저장소를 인자로 받아서
 * npm install 없이 테스트·로컬 서버에서 그대로 돈다.
 *
 * 규칙 파일이 netlify/functions/ 가 아니라 netlify/lib/ 에 있는 이유:
 * 넷리파이는 functions 폴더 안의 파일을 하나하나 함수로 배포한다. 거기 두면
 * 핸들러 없는 파일까지 함수로 올라간다.
 */
import { getStore } from '@netlify/blobs';

export function netlifyHandler(storeName, handle) {
  const store = () => {
    const s = getStore({ name: storeName, consistency: 'strong' });
    return {
      get: (k) => s.get(k, { type: 'json' }),
      set: (k, v) => s.setJSON(k, v),
    };
  };
  return async (req) => {
    const json = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
    if (req.method !== 'POST') return json(405, { error: 'POST 만 받아요' });
    let body;
    try { body = await req.json(); } catch { return json(400, { error: '요청을 읽지 못했어요' }); }
    try {
      const r = await handle(body, store());
      return json(r.status, r.body);
    } catch (e) {
      return json(500, { error: '서버에서 문제가 생겼어요', detail: String((e && e.message) || e) });
    }
  };
}
