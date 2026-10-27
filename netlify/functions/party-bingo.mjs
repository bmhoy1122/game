/* 여럿이 bingo — POST /api/party-bingo. 규칙은 전부 netlify/lib/party-bingo-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-bingo-core.mjs';

export default netlifyHandler('party-bingo', handle);
export const config = { path: '/api/party-bingo' };
