/* 오목 — POST /api/gomoku. 규칙은 전부 netlify/lib/gomoku-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/gomoku-core.mjs';

export default netlifyHandler('couple-gomoku', handle);
export const config = { path: '/api/gomoku' };
