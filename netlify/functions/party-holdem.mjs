/* 여럿이 holdem — POST /api/party-holdem. 규칙은 전부 netlify/lib/party-holdem-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-holdem-core.mjs';

export default netlifyHandler('party-holdem', handle);
export const config = { path: '/api/party-holdem' };
