/* 탐험대 — POST /api/expedition. 규칙은 전부 netlify/lib/expedition-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/expedition-core.mjs';

export default netlifyHandler('couple-expedition', handle);
export const config = { path: '/api/expedition' };
