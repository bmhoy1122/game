/* 여럿이 seotda — POST /api/party-seotda. 규칙은 전부 netlify/lib/party-seotda-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-seotda-core.mjs';

export default netlifyHandler('party-seotda', handle);
export const config = { path: '/api/party-seotda' };
