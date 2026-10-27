/* 여럿이 marble — POST /api/party-marble. 규칙은 전부 netlify/lib/party-marble-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-marble-core.mjs';

export default netlifyHandler('party-marble', handle);
export const config = { path: '/api/party-marble' };
