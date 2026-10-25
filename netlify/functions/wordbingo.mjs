/* 단어 빙고 — POST /api/wordbingo. 규칙은 전부 netlify/lib/wordbingo-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/wordbingo-core.mjs';

export default netlifyHandler('couple-wordbingo', handle);
export const config = { path: '/api/wordbingo' };
