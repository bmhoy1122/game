/* 팀 오목 — POST /api/party-gomoku. 규칙은 전부 netlify/lib/party-gomoku-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-gomoku-core.mjs';

export default netlifyHandler('party-gomoku', handle);
export const config = { path: '/api/party-gomoku' };
