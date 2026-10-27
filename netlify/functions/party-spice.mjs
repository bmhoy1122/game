/* 여럿이 spice — POST /api/party-spice. 규칙은 전부 netlify/lib/party-spice-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-spice-core.mjs';

export default netlifyHandler('party-spice', handle);
export const config = { path: '/api/party-spice' };
