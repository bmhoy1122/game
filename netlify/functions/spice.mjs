/* 향신료 시장 — POST /api/spice. 규칙은 전부 netlify/lib/spice-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/spice-core.mjs';

export default netlifyHandler('couple-spice', handle);
export const config = { path: '/api/spice' };
