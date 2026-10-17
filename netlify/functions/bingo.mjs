/* 커플 빙고 — POST /api/bingo. 규칙은 전부 netlify/lib/bingo-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/bingo-core.mjs';

export default netlifyHandler('couple-bingo', handle);
export const config = { path: '/api/bingo' };
