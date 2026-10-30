/* 여럿이 gostop — POST /api/party-gostop. 규칙은 전부 netlify/lib/party-gostop-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-gostop-core.mjs';

export default netlifyHandler('party-gostop', handle);
export const config = { path: '/api/party-gostop' };
