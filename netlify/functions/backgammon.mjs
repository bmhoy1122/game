/* 백개먼 — POST /api/backgammon. 규칙은 전부 netlify/lib/backgammon-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/backgammon-core.mjs';

export default netlifyHandler('couple-backgammon', handle);
export const config = { path: '/api/backgammon' };
