/* 선 정하기 화면 — 빙고 · 숫자야구 · 오목이 같이 쓴다.
 * 규칙은 netlify/lib/first-pick.mjs 가 정답이고, 여기는 그리기만 한다.
 *
 *   const chooser = Picker.chooser(el);           // 방 만들 때 방식 고르기 → chooser.get()
 *   const pk = Picker.mount(el, { onThrow, onDone });
 *   pk.update(st.pick, { you, meName, youName, extra });
 *
 * 버튼은 한 번만 만들고 상태만 갈아끼운다. 폴링 때마다 다시 만들면 누르는 도중에
 * 버튼이 바뀌어서 탭이 씹힌다. 색은 페이지의 --pk-accent 등을 따른다.
 */
(function () {
  const SIGN = { r: ['✊', '바위'], s: ['✌️', '가위'], p: ['✋', '보'] };
  const KINDS = [['rps', '가위바위보'], ['mjb', '묵찌빠'], ['hana', '하나빼기'], ['coin', '랜덤']];
  const RULE = {
    rps: '이긴 사람이 먼저 해요. 비기면 다시!',
    mjb: '가위바위보로 공격을 정하고, 공격이 상대랑 같은 걸 내면 이겨요. 다르면 이긴 쪽이 공격.',
    hana: '두 손을 내고, 상대 두 손을 본 다음 하나를 빼요. 남은 손끼리 가위바위보.',
    coin: '랜덤으로 정했어요.',
  };
  const PREF = 'couple-pick-kind';

  const css = `
  .pk-chips{display:flex;gap:6px;flex-wrap:wrap}
  .pk-chips button{flex:1;min-width:70px;padding:10px 6px;font-size:13px;border-radius:12px;
    background:var(--pk-soft,#f6e6ee);color:var(--pk-ink,#8a3f63);border:2px solid transparent}
  .pk-chips button.on{border-color:var(--pk-accent,#e8577e);background:#fff;color:var(--pk-accent,#e8577e)}
  .pk{display:flex;flex-direction:column;gap:12px;text-align:center}
  .pk-title{font-size:18px;font-weight:900;color:var(--pk-ink,#8a3f63)}
  .pk-rule{font-size:12.5px;font-weight:700;color:var(--pk-mute,#a36084);line-height:1.45}
  .pk-log{display:flex;flex-direction:column;gap:6px}
  .pk-log div{background:var(--pk-soft,#fbf2f6);border-radius:12px;padding:8px 10px;font-size:14px;font-weight:800;
    color:var(--pk-ink,#7a3f60)}
  .pk-log b{font-size:20px;vertical-align:-2px}
  .pk-log .w{color:var(--pk-accent,#d4446e)}
  .pk-attack{border-radius:14px;padding:11px;font-weight:900;font-size:15px}
  .pk-attack.me{background:linear-gradient(135deg,#fff3c4,#ffd98a);color:#7a5320}
  .pk-attack.you{background:#eceaf6;color:#6b6890}
  .pk-ask{font-size:15px;font-weight:900;color:var(--pk-ink,#7a3f60)}
  .pk-hands{display:flex;gap:10px}
  .pk-hands button,.pk-keep button{flex:1;border-radius:18px;padding:14px 4px 10px;background:var(--pk-soft,#fdf3f7);
    border:3px solid transparent;font-size:15px;font-weight:800;color:var(--pk-ink,#7a3f60);line-height:1.2}
  .pk-hands button i,.pk-keep button i{display:block;font-style:normal;font-size:42px;line-height:1.1}
  .pk-hands button.on,.pk-keep button.on{border-color:var(--pk-accent,#e8577e);background:#fff}
  .pk-hands button:disabled,.pk-keep button:disabled{opacity:.4}
  .pk-slots{display:flex;justify-content:center;gap:10px}
  .pk-slots div{width:64px;height:64px;border-radius:16px;border:2px dashed var(--pk-line,#e6c9d8);
    display:flex;align-items:center;justify-content:center;font-size:36px;background:#fff}
  .pk-them{font-size:13px;font-weight:800;color:var(--pk-mute,#a36084)}
  .pk-them b{font-size:24px;vertical-align:-4px;letter-spacing:2px}
  .pk-status{font-size:13.5px;font-weight:800;color:var(--pk-mute,#a36084);min-height:18px}
  .pk-done .big{font-size:30px;font-weight:900;color:var(--pk-accent,#d4446e);margin:4px 0}
  .pk-done .sm{font-size:13px;font-weight:800;color:var(--pk-mute,#a36084);margin-bottom:12px}
  .pk-hide{display:none!important}
  .pk-dots::after{content:'';animation:pkd 1.2s steps(4,end) infinite}
  @keyframes pkd{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // 받침이 있으면 a(은·이·과), 없으면 b(는·가·와). 영어·숫자로 끝나면 읽는 소리로 본다 —
  // 'AI'(에이아이)는 받침 없음, 'Tom'(톰)·'7'(칠)은 받침 있음. 모르는 글자만 '이(가)' 로 둘 다 쓴다.
  function jo(w, a, b) {
    const s = String(w).trim();
    const ch = s.slice(-1), c = ch.charCodeAt(0);
    let batchim;
    if (c >= 0xac00 && c <= 0xd7a3) batchim = (c - 0xac00) % 28 !== 0;
    else if (/[0-9]/.test(ch)) batchim = '013678'.includes(ch);        // 영 일 삼 육 칠 팔
    else if (/[a-z]/i.test(ch)) batchim = 'lmnr'.includes(ch.toLowerCase());   // 엘 엠 엔 알
    else return w + a + '(' + b + ')';
    return w + (batchim ? a : b);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const h = (k) => (SIGN[k] ? SIGN[k][0] : '?');
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  /* 방 만들 때 고르는 칩 */
  function chooser(root) {
    let cur = 'rps';
    try { const v = localStorage.getItem(PREF); if (KINDS.some(([k]) => k === v)) cur = v; } catch (e) {}
    const box = el('div', 'pk-chips');
    const btns = KINDS.map(([k, label]) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.onclick = () => { cur = k; try { localStorage.setItem(PREF, k); } catch (e) {} draw(); };
      box.appendChild(b);
      return [k, b];
    });
    function draw() { btns.forEach(([k, b]) => b.classList.toggle('on', k === cur)); }
    root.appendChild(box);
    draw();
    return { get: () => cur };
  }

  /* 선 정하기 화면 */
  function mount(root, opts) {
    const box = el('div', 'pk');
    const title = el('div', 'pk-title');
    const rule = el('div', 'pk-rule');
    const log = el('div', 'pk-log');
    const attack = el('div', 'pk-attack pk-hide');
    const ask = el('div', 'pk-ask');
    const them = el('div', 'pk-them pk-hide');
    const slots = el('div', 'pk-slots pk-hide', '<div></div><div></div>');
    const hands = el('div', 'pk-hands');
    const keep = el('div', 'pk-keep pk-hands pk-hide');
    const go = el('button', 'primary pk-hide', '두 손 내기');
    const status = el('div', 'pk-status');
    const done = el('div', 'pk-done pk-hide', '<div class="big"></div><div class="sm"></div>');
    const ok = el('button', 'primary', '좋아요');
    done.appendChild(ok);
    [title, rule, log, attack, ask, them, slots, hands, keep, go, status, done].forEach((x) => box.appendChild(x));
    root.appendChild(box);

    let pick = null, ctx = {}, pair = [], stepKey = null;
    const handBtns = ['s', 'r', 'p'].map((k) => {
      const b = el('button', '', '<i>' + SIGN[k][0] + '</i>' + SIGN[k][1]);
      b.type = 'button';
      b.onclick = () => {
        if (!pick || pick.done) return;
        if (pick.need === 'sign') { if (pick.mineNow !== k) opts.onThrow(k); return; }
        if (pick.need === 'pair') { if (pair.length >= 2) pair = []; pair.push(k); draw(); }
      };
      hands.appendChild(b);
      return [k, b];
    });
    const keepBtns = [0, 1].map((i) => {
      const b = el('button', '');
      b.type = 'button';
      b.onclick = () => { if (pick && pick.need === 'keep' && pick.mineNow !== i) opts.onThrow(i); };
      keep.appendChild(b);
      return b;
    });
    go.onclick = () => { if (pair.length === 2) opts.onThrow(pair.slice()); };
    ok.onclick = () => opts.onDone && opts.onDone();

    function roundLine(o) {
      const me = esc(ctx.meName), you = esc(ctx.youName);
      const res = o.r > 0 ? '<span class="w">내가 이겼어요</span>' : o.r < 0 ? esc(jo(ctx.youName, '이', '가')) + ' 이겼어요' : '비겼어요';
      if (pick.kind === 'hana') {
        return me + ' <b>' + o.mePair.map(h).join('') + '</b>→<b>' + h(o.me) + '</b> : <b>' + h(o.them) + '</b>←<b>' +
          o.themPair.map(h).join('') + '</b> ' + you + '<br>' + res;
      }
      let tail = res;
      if (pick.kind === 'mjb') {
        if (o.before !== null && o.before !== undefined && o.r === 0) tail = '같은 손!';
        else if (o.attacker !== null && o.attacker !== undefined) {
          tail = (o.attacker === ctx.you ? '<span class="w">내가 공격</span>' : esc(ctx.youName) + ' 공격');
          if (o.before === null || o.before === undefined) tail = res + ' → ' + tail;
        } else tail = '비겼어요';
      }
      return me + ' <b>' + h(o.me) + '</b> : <b>' + h(o.them) + '</b> ' + you + ' → ' + tail;
    }

    function draw() {
      if (!pick) return;
      title.textContent = '선 정하기 · ' + pick.label;
      rule.textContent = RULE[pick.kind] || '';
      const hide = (x, v) => x.classList.toggle('pk-hide', !!v);

      if (pick.done) {
        [attack, ask, them, slots, hands, keep, go, status, log].forEach((x) => hide(x, true));
        hide(log, !pick.rounds.length);
        hide(done, false);
        const meFirst = pick.first === ctx.you;
        done.querySelector('.big').textContent = meFirst ? '🎉 내가 먼저!' : jo(ctx.youName, '이', '가') + ' 먼저!';
        done.querySelector('.sm').textContent = ctx.extra ? ctx.extra(meFirst) : '';
        log.innerHTML = pick.rounds.slice(-3).map((o) => '<div>' + roundLine(o) + '</div>').join('');
        return;
      }
      hide(done, true);
      hide(log, !pick.rounds.length);
      log.innerHTML = pick.rounds.slice(-3).map((o) => '<div>' + roundLine(o) + '</div>').join('');

      // 묵찌빠 — 누가 공격인지
      hide(attack, pick.kind !== 'mjb');
      if (pick.kind === 'mjb') {
        if (pick.attacker === null || pick.attacker === undefined) { attack.className = 'pk-attack you'; attack.textContent = '먼저 가위바위보로 공격을 정해요'; }
        else if (pick.attacker === ctx.you) { attack.className = 'pk-attack me'; attack.textContent = '⚔️ 내가 공격! ' + jo(ctx.youName, '과', '와') + ' 같은 걸 내면 내가 먼저'; }
        else { attack.className = 'pk-attack you'; attack.textContent = '🛡️ ' + jo(ctx.youName, '이', '가') + ' 공격! 다른 걸 내야 해요'; }
      }

      const key = (ctx.round || 0) + ':' + pick.step;
      if (key !== stepKey) { stepKey = key; pair = []; }

      const need = pick.need;
      hide(hands, need === 'keep');
      hide(slots, need !== 'pair');
      hide(go, need !== 'pair');
      hide(keep, need !== 'keep');
      hide(them, need !== 'keep');
      ask.textContent = need === 'pair' ? '두 손을 골라요' : need === 'keep' ? '남길 손을 골라요 (하나 빼기!)' : '하나 골라요';

      if (need === 'sign') {
        handBtns.forEach(([k, b]) => { b.classList.toggle('on', pick.mineNow === k); b.disabled = false; });
      } else if (need === 'pair') {
        const shown = pair.length ? pair : (pick.mineNow || []);
        [...slots.children].forEach((s, i) => (s.textContent = shown[i] ? h(shown[i]) : ''));
        handBtns.forEach(([, b]) => { b.classList.remove('on'); b.disabled = false; });
        go.disabled = pair.length !== 2;
        go.textContent = pick.mineNow ? '이걸로 바꾸기' : '두 손 내기';
      } else if (need === 'keep') {
        const mine = (pick.open && pick.open.me) || [];
        keepBtns.forEach((b, i) => {
          b.innerHTML = '<i>' + h(mine[i]) + '</i>' + (i === 0 ? '왼손 남기기' : '오른손 남기기');
          b.classList.toggle('on', pick.mineNow === i);
        });
        them.innerHTML = esc(ctx.youName) + ' 두 손 <b>' + ((pick.open && pick.open.them) || []).map(h).join(' ') + '</b>';
      }

      const sent = pick.mineNow !== null && pick.mineNow !== undefined;
      status.innerHTML = sent
        ? (pick.theirsIn ? '공개 중…' : '<span class="pk-dots">냈어요! ' + esc(jo(ctx.youName, '을', '를')) + ' 기다려요 (바꿔도 돼요)</span>')
        : (pick.theirsIn ? esc(jo(ctx.youName, '은', '는')) + ' 벌써 냈어요 👀' : '');
    }

    return { update(p, c) { pick = p; ctx = c || {}; draw(); } };
  }

  window.Picker = { mount, chooser, SIGN, jo };
})();
