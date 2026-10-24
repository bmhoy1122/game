/* 비밀 타일 — POST /api/tiles. 규칙은 전부 netlify/lib/tiles-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/tiles-core.mjs';

export default netlifyHandler('couple-tiles', handle);
export const config = { path: '/api/tiles' };
