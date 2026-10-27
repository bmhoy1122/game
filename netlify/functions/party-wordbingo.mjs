/* 여럿이 단어 빙고 — POST /api/party-wordbingo. 규칙은 전부 netlify/lib/party-wordbingo-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-wordbingo-core.mjs';

export default netlifyHandler('party-wordbingo', handle);
export const config = { path: '/api/party-wordbingo' };
