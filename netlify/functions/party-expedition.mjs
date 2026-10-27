/* 여럿이 expedition — POST /api/party-expedition. 규칙은 전부 netlify/lib/party-expedition-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-expedition-core.mjs';

export default netlifyHandler('party-expedition', handle);
export const config = { path: '/api/party-expedition' };
