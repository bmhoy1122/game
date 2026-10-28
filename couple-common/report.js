/* 탕비실 전적 보고 (신영 메신저 lounge.html 연동) — 커플·여럿이 게임이 같이 쓴다.
 *   · ?uid=<메신저 계정 id> 로 열리면 기억해 두고(이 탭 sessionStorage), 방 만들기·들어가기에 uid 를 같이 보낸다.
 *     서버(room-kit / party-kit)가 자리마다 uid 를 적어 두고 응답(uids / players[].uid)에 돌려준다 — 비밀 아님.
 *   · 판이 끝나면(phase/stage 'done') window.opener 에 {type:'couple-result'} 를 **방·판당 한 번** 보낸다.
 *     탕비실이 그걸 받아 전적 표(lounge_game_results)에 적는다. 탕비실이 연 탭이 아니면(opener 없음) 아무 일도 없다.
 *   · 보내는 것: game, code, round, created(방 만든 시각 — 코드가 재사용돼도 다른 판으로 구분), you,
 *     players[{name, uid, bot, out, team}], winners[자리], draw, rank[{i, s, rank}] (여럿이 게임만), teams. */
window.Report = (() => {
  let uid = null;
  try {
    const q = new URLSearchParams(location.search).get('uid');
    if (q && /^[\w-]{1,48}$/.test(q)) { uid = q; sessionStorage.setItem('sy-game-uid', q); }
    else uid = sessionStorage.getItem('sy-game-uid') || null;
  } catch (e) {}
  const told = new Set();
  function send(msg) {
    if (!window.opener) return;
    const key = msg.game + ':' + msg.code + ':' + msg.round + ':' + (msg.created || 0);
    if (told.has(key)) return;
    told.add(key);
    try { window.opener.postMessage({ type: 'couple-result', ...msg }, '*'); } catch (e) {}
  }
  /* 커플(2인) 게임: st.winner 가 자리 번호 또는 'draw'. 승패가 없는 게임(이심전심)은 winner 가 없어 보내지 않는다 */
  function couple(game, S, st) {
    if (!st || st.phase !== 'done' || !S.code || typeof S.you !== 'number') return;
    const w = st.winner;
    if (w !== 'draw' && w !== 0 && w !== 1) return;
    const players = [0, 1].map((i) => ({
      name: i === S.you ? (st.name || S.name || '') : ((st.opponent && st.opponent.name) || ''),
      uid: st.uids ? st.uids[i] || null : null, bot: !!(st.bot && i === 1), out: false, team: null,
    }));
    send({ game, code: S.code, round: st.round || 1, created: st.created || 0, you: S.you, players, winners: w === 'draw' ? [0, 1] : [w], draw: w === 'draw', rank: null, teams: 0 });
  }
  /* 여럿이 게임: st.winners[] (+ st.rank[]) */
  function party(game, S, st) {
    if (!st || st.stage !== 'done' || !S.code || typeof S.you !== 'number' || !Array.isArray(st.winners)) return;
    const players = st.players.map((p) => ({ name: p.name || '', uid: p.uid || null, bot: !!p.bot, out: !!p.out, team: p.team == null ? null : p.team }));
    const alive = players.filter((p) => !p.out).length;
    send({ game, code: S.code, round: st.round || 1, created: st.created || 0, you: S.you, players, winners: st.winners, draw: st.winners.length > 1 && st.winners.length === alive, rank: st.rank || null, teams: st.teams || 0, teamWinners: st.team ? st.team.winners : null });
  }
  return { uid, couple, party };
})();
