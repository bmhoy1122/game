/* 여럿이 하는 게임 공용 화면 — party-bingo · party-spice · party-expedition · party-marble 가 같이 쓴다.
 *
 *   Party.init({
 *     game: 'bingo',                       // POST /api/party-bingo, 저장 키 party-bingo
 *     title: '여럿이 빙고', emoji: '🔢', sub: '한 줄 소개',
 *     rules: { title, html },              // 규칙 설명 (couple-common/rules.js)
 *     maxDefault: 4,
 *     render(st, el, P),                   // 게임 화면 그리기 (play 단계). el = #game. P = Party 핸들
 *   })
 * 서버가 주는 공통 상태: code · round · you · host · phase(lobby|play) · max · players[{name,bot,out,me}] · first
 * 게임 상태는 그 뒤에 섞여 온다 (stage: setup|play|done, turn, yourTurn, winners, rank …).
 *
 * 홈(이름·인원·AI·만들기·들어가기) → 대기실(코드·사람들·AI 넣기·시작) → 게임(#game) → 끝(순위·다시 하기)
 * 폴링 1.4초(화면 숨기면 3.2초). 버튼 DOM 은 한 번만 만든다. ?name= ?code= ?bot=1 과 tellOpener 는 커플 게임과 같다.
 */
(function () {
  const POLL_MS = 1400, POLL_SLOW_MS = 3200;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* 이름 뒤 조사 — 받침 보고 은/는 · 이/가. 영어·숫자·이모지로 끝나면 읽는 소리로 */
  function jo(name, a, b) {
    const s = String(name || '').replace(/[\s\u{1F300}-\u{1FAFF}☀-➿]+$/u, '');
    const ch = s[s.length - 1] || '';
    let batchim;
    if (/[가-힣]/.test(ch)) batchim = (ch.charCodeAt(0) - 0xac00) % 28 !== 0;
    else if (/[0-9]/.test(ch)) batchim = '013678'.includes(ch);      // 영·일·삼·육·칠·팔 은 받침
    else if (/[a-z]/i.test(ch)) batchim = /[lmnr]/i.test(ch) ? true : false;
    else batchim = false;
    return name + (batchim ? a : b);
  }
  const COLORS = ['#e8507f', '#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#eb5757', '#00b5ad', '#8d6e63'];

  const css = `
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html,body{margin:0;min-height:100%;font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;color:var(--ink,#2b2b33)}
  body{background:var(--bg,#2b3a55);padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom);display:flex;justify-content:center;overflow-x:hidden}
  #app{width:100%;max-width:var(--maxw,520px);padding:14px 12px 28px;display:flex;flex-direction:column;gap:10px}
  h1{margin:2px 0 0;font-size:24px;letter-spacing:-.4px;color:#fff;text-align:center;text-shadow:0 2px 10px rgba(0,0,0,.35)}
  .sub{margin:0;text-align:center;color:#fff;opacity:.9;font-size:13px;font-weight:600;min-height:18px}
  .card{background:rgba(255,255,255,.96);border-radius:18px;padding:14px;box-shadow:0 10px 30px rgba(0,0,0,.22)}
  .card h2{margin:0 0 8px;font-size:14px;color:var(--mute,#6b7280);font-weight:800}
  button{font:inherit;font-weight:800;border:0;border-radius:13px;padding:12px 14px;cursor:pointer;touch-action:manipulation;transition:transform .06s,opacity .15s;color:var(--ink,#2b2b33);background:var(--soft,#eef2f7)}
  button:active{transform:scale(.97)} button:disabled{opacity:.4;cursor:default}
  .primary{background:var(--accent,#2f80ed);color:#fff;width:100%;font-size:16px;box-shadow:0 6px 16px rgba(0,0,0,.2)}
  .ghost{background:var(--soft,#eef2f7);color:var(--ink,#2b2b33);width:100%}
  .big-rules{background:linear-gradient(135deg,#ffd166,#f4a259);color:#5a2a10;width:100%;font-size:15px}
  input,select{font:inherit;width:100%;padding:12px;border-radius:12px;border:2px solid var(--line,#dfe4ea);background:#fff;color:var(--ink,#2b2b33);font-weight:700;text-align:center}
  input:focus,select:focus{outline:0;border-color:var(--accent,#2f80ed)}
  #code{letter-spacing:10px;font-size:24px;font-weight:900;padding-left:10px}
  .row{display:flex;gap:8px;align-items:center} .row>*{flex:1}
  .lbl{font-size:12px;font-weight:700;color:var(--mute,#6b7280);margin:8px 0 4px}
  .codebox{text-align:center;background:var(--soft,#eef2f7);border-radius:14px;padding:12px}
  .codebox .n{font-size:38px;font-weight:900;letter-spacing:8px;color:var(--accent,#2f80ed);padding-left:8px}
  .codebox .t{font-size:12px;font-weight:700;color:var(--mute,#6b7280)}
  .plist{display:flex;flex-direction:column;gap:6px;margin:8px 0}
  .pl{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:var(--soft,#eef2f7);font-weight:700;font-size:14px}
  .pl .dot{width:14px;height:14px;border-radius:50%;flex:none}
  .pl .tag{font-size:11px;color:var(--mute,#6b7280);font-weight:700;margin-left:auto}
  .top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .chip{display:flex;align-items:center;gap:5px;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,.9);font-size:12px;font-weight:800;color:var(--ink,#2b2b33);border:2px solid transparent}
  .chip .dot{width:10px;height:10px;border-radius:50%} .chip.turn{border-color:#ffd166;box-shadow:0 0 0 3px rgba(255,209,102,.35)} .chip.out{opacity:.45;text-decoration:line-through}
  .chip.me{background:#fff8e0}
  .leave{background:none;color:#fff;opacity:.85;font-size:12px;font-weight:700;padding:6px 10px;text-decoration:underline;margin-left:auto}
  .small-rules{background:rgba(255,255,255,.9);color:#5a2a10;font-size:12px;padding:6px 10px;border-radius:999px}
  .banner{border-radius:12px;padding:10px 12px;font-weight:800;font-size:14px;background:#fff8e0;color:#7a4a00;text-align:center}
  .banner.me{background:var(--accent,#2f80ed);color:#fff}
  .dots::after{content:'…';animation:dots 1.2s steps(4,end) infinite} @keyframes dots{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}}
  .err{background:#fde8e8;color:#9b1c1c;border-radius:12px;padding:8px 12px;font-size:13px;font-weight:700;text-align:center}
  .hide{display:none!important}
  .result{text-align:center} .result .big{font-size:22px;font-weight:900;margin:6px 0}
  .rank{display:flex;flex-direction:column;gap:5px;margin:8px 0} .rank .r{display:flex;gap:8px;align-items:center;padding:7px 10px;border-radius:10px;background:var(--soft,#eef2f7);font-weight:700;font-size:14px}
  .rank .r b{min-width:30px} .rank .r .sc{margin-left:auto;font-weight:900}
  .log{font-size:12px;color:var(--mute,#6b7280);line-height:1.5;max-height:120px;overflow:auto}
  .log b{color:var(--ink,#2b2b33)}
  .toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#1c2430;color:#fff;padding:10px 14px;border-radius:12px;font-size:13px;font-weight:700;z-index:40;box-shadow:0 10px 26px rgba(0,0,0,.3);max-width:92%}
  `;

  function init(cfg) {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const API = '/api/party-' + cfg.game, SAVE = 'party-' + cfg.game;
    const app = document.getElementById('app');
    app.innerHTML = `
      <h1>${esc(cfg.emoji || '')} ${esc(cfg.title)}</h1>
      <p class="sub" id="pt-sub">${esc(cfg.sub || '')}</p>
      <div class="top hide" id="pt-top"></div>
      <div class="err hide" id="pt-err"></div>
      <section class="card hide" id="pt-home">
        ${cfg.rules ? '<button type="button" class="big-rules" id="pt-rules1">📖 규칙 읽기 (처음이면 먼저!)</button><div style="height:10px"></div>' : ''}
        <h2>방 만들기</h2>
        <input id="pt-name" maxlength="8" placeholder="내 이름 (선택)" autocomplete="off">
        <div class="row"><div><div class="lbl">최대 인원</div><select id="pt-max"></select></div><div><div class="lbl">AI 상대</div><select id="pt-bots"></select></div></div>
        <div style="height:10px"></div>
        <button type="button" class="primary" id="pt-create">새 방 만들기</button>
        <div style="height:8px"></div>
        <button type="button" class="ghost" id="pt-solo">🤖 혼자 하기 (AI 상대와 바로 시작)</button>
        <h2 style="margin-top:18px">코드로 들어가기</h2>
        <input id="code" inputmode="numeric" maxlength="4" placeholder="0000" autocomplete="off">
        <div style="height:8px"></div>
        <button type="button" class="ghost" id="pt-join">들어가기</button>
      </section>
      <section class="card hide" id="pt-lobby">
        <div class="codebox"><div class="t">방 코드 — 같이 할 사람에게 알려줘요</div><div class="n" id="pt-code"></div><div class="t" id="pt-cnt"></div></div>
        <div class="plist" id="pt-plist"></div>
        <div class="row" id="pt-hostrow"><button type="button" id="pt-addbot">🤖 AI 넣기</button><button type="button" id="pt-rmbot">AI 빼기</button></div>
        <div style="height:8px"></div>
        <button type="button" class="primary" id="pt-start">시작하기</button>
        <p class="sub" id="pt-wait" style="color:var(--mute);margin-top:8px"></p>
      </section>
      <section class="hide" id="pt-game" style="display:flex;flex-direction:column;gap:10px"></section>
      <section class="card hide result" id="pt-result">
        <div class="big" id="pt-winner"></div>
        <div class="rank" id="pt-rank"></div>
        <div id="pt-final"></div>
        <button type="button" class="primary" id="pt-again">다시 하기</button>
        <div style="height:6px"></div>
        <button type="button" class="ghost" id="pt-home2">홈으로</button>
      </section>`;
    const $ = (id) => document.getElementById(id);
    for (let m = 2; m <= 8; m++) $('pt-max').insertAdjacentHTML('beforeend', `<option value="${m}" ${m === (cfg.maxDefault || 4) ? 'selected' : ''}>${m}명</option>`);
    for (let b = 0; b <= 7; b++) $('pt-bots').insertAdjacentHTML('beforeend', `<option value="${b}">${b ? b + '명' : '없음'}</option>`);

    let S = { code: null, token: null, you: null, name: '' };
    let st = null, timer = null, busy = false, toldCode = null, toastT = null;
    const gameEl = $('pt-game');
    const P = {
      esc, jo, COLORS, color: (i) => COLORS[i % COLORS.length],
      get st() { return st; }, get S() { return S; }, $,
      name: (i) => (st && st.players[i] ? st.players[i].name || ('플레이어' + (i + 1)) : '?'),
      me: () => (st && st.players[S.you] ? st.players[S.you].name : S.name) || '나',
      act: (action, extra) => act(async () => adopt(await api(action, extra))),
      toast, err,
    };
    const rules = cfg.rules && window.Rules ? Rules.mount({ title: cfg.rules.title || '규칙', html: cfg.rules.html, buttons: [$('pt-rules1')], autoKey: SAVE }) : null;

    async function api(action, extra) {
      const body = { action, code: S.code, token: S.token, ...(extra || {}) };
      let res;
      try { res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
      catch (e) { throw new Error('인터넷이 끊긴 것 같아요'); }
      let data = {};
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) { if (res.status === 404 && !data.error) throw new Error('서버를 찾지 못했어요. 넷리파이에 올린 주소로 열어주세요'); throw new Error(data.error || '요청이 실패했어요 (' + res.status + ')'); }
      return data;
    }
    function adopt(data) {
      if (data.left) { forget(); render(); return; }
      if (data.token) S.token = data.token;
      if (data.code) S.code = data.code;
      if (typeof data.you === 'number') S.you = data.you;
      st = data; tellOpener(); save(); render();
    }
    function tellOpener() {
      if (!S.code || toldCode === S.code || !window.opener) return;
      toldCode = S.code;
      try { window.opener.postMessage({ type: 'couple-room', game: SAVE, code: S.code, you: S.you, name: S.name, bot: !!(st && st.bot && st.players.length === 2) }, '*'); } catch (e) {}
    }
    const save = () => { try { localStorage.setItem(SAVE, JSON.stringify({ code: S.code, token: S.token, name: S.name })); } catch (e) {} };
    function forget() { try { localStorage.removeItem(SAVE); } catch (e) {} S = { code: null, token: null, you: null, name: S.name }; st = null; stopPoll(); }
    function err(msg) { const e = $('pt-err'); e.textContent = msg; e.classList.remove('hide'); clearTimeout(err.t); err.t = setTimeout(() => e.classList.add('hide'), 3500); }
    function toast(msg) { let t = document.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 2500); }
    async function act(fn) { if (busy) return; busy = true; try { await fn(); } catch (e) { err(e.message || String(e)); } finally { busy = false; } }

    function stopPoll() { clearTimeout(timer); timer = null; }
    function poll() {
      stopPoll();
      if (!S.code) return;
      timer = setTimeout(async () => {
        const tok = S.token;
        try { const d = await api('state'); if (S.token === tok) adopt(d); } catch (e) {}
        poll();
      }, document.visibilityState === 'visible' ? POLL_MS : POLL_SLOW_MS);
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.code) act(async () => adopt(await api('state'))); });

    function show(id) {
      ['pt-home', 'pt-lobby', 'pt-game', 'pt-result'].forEach((s) => $(s).classList.toggle('hide', s !== id));
      $('pt-top').classList.toggle('hide', id === 'pt-home');
    }
    function renderTop() {
      const top = $('pt-top');
      top.innerHTML = st.players.map((p, i) => `<span class="chip${p.me ? ' me' : ''}${st.turn === i && st.stage === 'play' ? ' turn' : ''}${p.out ? ' out' : ''}"><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span>${esc(p.name || '플레이어' + (i + 1))}${i === st.host ? ' 👑' : ''}</span>`).join('')
        + (cfg.rules ? '<button type="button" class="small-rules" id="pt-rules2">📖</button>' : '') + '<button type="button" class="leave" id="pt-leave">' + (st.phase === 'lobby' ? '나가기' : '기권하고 나가기') + '</button>';
      if (cfg.rules && rules) $('pt-rules2').onclick = rules.open;
      $('pt-leave').onclick = leave;
    }
    function render() {
      $('pt-err').classList.add('hide');
      if (!st) { show('pt-home'); $('pt-sub').textContent = cfg.sub || ''; return; }
      renderTop();
      if (st.phase === 'lobby') {
        show('pt-lobby');
        $('pt-sub').textContent = '방 ' + st.code + ' · 사람을 모으는 중';
        $('pt-code').textContent = st.code;
        $('pt-cnt').textContent = st.players.length + ' / ' + st.max + '명' + (st.players.length < 2 ? ' · 두 명은 있어야 시작해요' : '');
        $('pt-plist').innerHTML = st.players.map((p, i) => `<div class="pl"><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span>${esc(p.name || '플레이어' + (i + 1))}${p.bot ? ' 🤖' : ''}<span class="tag">${i === st.host ? '방장' : p.me ? '나' : ''}</span></div>`).join('');
        const host = st.host === S.you;
        $('pt-hostrow').classList.toggle('hide', !host); $('pt-start').classList.toggle('hide', !host);
        $('pt-start').disabled = st.players.length < 2;
        $('pt-wait').textContent = host ? '' : jo(P.name(st.host), '이', '가') + ' 시작하면 바로 열려요 (이 화면을 켜두세요)';
        poll(); return;
      }
      if (st.stage === 'done') {
        show('pt-result');
        const w = (st.winners || []).map((i) => P.name(i));
        $('pt-sub').textContent = '방 ' + st.code + ' · ' + st.round + '판 끝';
        $('pt-winner').textContent = (st.winners && st.winners.includes(S.you) ? '🎉 ' : '') + (w.length > 1 ? w.join(' · ') + ' 공동 우승' : w[0] + ' 우승');
        $('pt-rank').innerHTML = (st.rank || []).map((r) => `<div class="r"><b>${r.rank}등</b><span class="dot" style="width:10px;height:10px;border-radius:50%;background:${COLORS[r.i % COLORS.length]}"></span>${esc(P.name(r.i))}${r.i === S.you ? ' (나)' : ''}<span class="sc">${r.s}</span></div>`).join('');
        $('pt-final').innerHTML = cfg.final ? cfg.final(st, P) : '';
        $('pt-again').classList.toggle('hide', st.players[S.you] && st.players[S.you].out);
        poll(); return;
      }
      show('pt-game');
      $('pt-sub').textContent = '방 ' + st.code + ' · ' + st.round + '판';
      try { cfg.render(st, gameEl, P); } catch (e) { err('화면 오류: ' + (e.message || e)); console.error(e); }
      poll();
    }

    /* 버튼 */
    const nameNow = () => { S.name = $('pt-name').value.trim(); return S.name; };
    $('pt-create').onclick = () => act(async () => { nameNow(); adopt(await api('create', { name: S.name, max: +$('pt-max').value, bots: +$('pt-bots').value, ...(cfg.options ? cfg.options() : {}) })); });
    $('pt-solo').onclick = () => act(async () => { nameNow(); adopt(await api('create', { name: S.name, max: Math.max(2, +$('pt-max').value), bot: true, ...(cfg.options ? cfg.options() : {}) })); });
    $('pt-join').onclick = () => act(async () => { const c = $('code').value.trim(); if (!/^\d{4}$/.test(c)) throw new Error('네 자리 숫자를 넣어주세요'); nameNow(); S.code = c; adopt(await api('join', { code: c, name: S.name })); });
    ['pt-name', 'code'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $(id === 'code' ? 'pt-join' : 'pt-create').click(); }));
    $('pt-addbot').onclick = () => P.act('addbot'); $('pt-rmbot').onclick = () => P.act('removebot'); $('pt-start').onclick = () => P.act('start');
    $('pt-again').onclick = () => P.act('restart', { round: st.round });
    $('pt-home2').onclick = () => { forget(); render(); };
    function leave() {
      if (!st) return;
      if (st.phase === 'lobby') { if (st.host === S.you) { if (!confirm('방장이 나가면 이 방은 그대로 남아요(12시간 뒤 사라짐). 나갈까요?')) return; forget(); render(); return; } act(async () => adopt(await api('leave'))); return; }
      if (st.stage === 'done' || (st.players[S.you] && st.players[S.you].out)) { forget(); render(); return; }
      if (!confirm('기권하고 나갈까요? 남은 사람들끼리 계속 해요')) return;
      act(async () => { try { await api('resign'); } catch (e) {} forget(); render(); });
    }

    /* 시작 */
    (async function boot() {
      show('pt-home');
      const q = new URLSearchParams(location.search);
      const urlCode = q.get('code'), urlName = (q.get('name') || '').trim().slice(0, 8), urlBot = q.get('bot') === '1';
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(SAVE) || 'null'); } catch (e) {}
      if (saved && saved.name) { S.name = saved.name; $('pt-name').value = saved.name; }
      if (urlName && !$('pt-name').value) { S.name = urlName; $('pt-name').value = urlName; }
      if (saved && saved.code && saved.token && (!urlCode || urlCode === saved.code) && !urlBot) {
        S.code = saved.code; S.token = saved.token;
        try { adopt(await api('state')); return; } catch (e) { forget(); }
      }
      if (urlBot) { history.replaceState(null, '', location.pathname); render(); $('pt-solo').click(); return; }
      if (urlCode && /^\d{4}$/.test(urlCode)) { $('code').value = urlCode; $('pt-sub').textContent = '초대받은 방 ' + urlCode + ' · 이름을 넣고 들어가요'; }
      render();
    })();
    window.__party = P;                      // 테스트·디버그용 핸들 (P.st 로 지금 상태)
    return P;
  }
  window.Party = { init, esc, jo, COLORS };
})();
