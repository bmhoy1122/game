/* 커플 빙고 — POST /api/bingo. 규칙은 전부 netlify/lib/bingo-core.mjs 에 있다.
 * 저장소 이름이 -v2 인 이유: 공용 방(room-kit)으로 옮기면서 저장 모양이 바뀌었다.
 * 옛 방이 남아 있으면 새 코드가 읽다가 깨지니, 새 이름으로 시작한다 (옛 방은 어차피 12시간이면 끝). */
import { netlifyHandler } from '../lib/blob-handler.mjs';
import { handle } from '../lib/bingo-core.mjs';

export default netlifyHandler('couple-bingo-v2', handle);
export const config = { path: '/api/bingo' };
