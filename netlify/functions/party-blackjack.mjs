/* 여럿이 blackjack — POST /api/party-blackjack. 규칙은 전부 netlify/lib/party-blackjack-core.mjs 에 있다. */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/party-blackjack-core.mjs';

export default netlifyHandler('party-blackjack', handle);
export const config = { path: '/api/party-blackjack' };
