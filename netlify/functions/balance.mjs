/* 이심전심 — POST /api/balance. 규칙은 전부 netlify/lib/balance-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/balance-core.mjs';

export default netlifyHandler('couple-balance', handle);
export const config = { path: '/api/balance' };
