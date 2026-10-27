/* 여럿이 balance — POST /api/party-balance. 규칙은 전부 netlify/lib/party-balance-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-balance-core.mjs';

export default netlifyHandler('party-balance', handle);
export const config = { path: '/api/party-balance' };
