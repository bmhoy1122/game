/* 숫자야구 — POST /api/baseball. 규칙은 전부 netlify/lib/baseball-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/baseball-core.mjs';

export default netlifyHandler('couple-baseball', handle);
export const config = { path: '/api/baseball' };
