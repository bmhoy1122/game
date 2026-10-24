/* 규칙 설명 창 — 처음 해보는 사람도 읽고 바로 할 수 있게.
 * 향신료 시장 · 비밀 타일 · 탐험대 · 백개먼이 같이 쓴다.
 *
 *   const rules = Rules.mount({
 *     title: '향신료 시장 규칙',
 *     html: '<h3>…</h3><p>…</p>',          // 페이지가 쓴 설명 (섹션은 <h3>, 예시는 <div class="rl-ex">)
 *     buttons: [$('b-rules'), $('b-rules2')],  // 누르면 열리는 버튼들
 *     autoKey: 'couple-spice',             // 이 폰에서 처음 들어왔을 때 한 번 저절로 연다 (생략하면 안 연다)
 *   });
 *   rules.open();  rules.close();
 *
 * 창은 한 번만 만든다. 색은 페이지의 --pk-accent 등을 따른다(picker.js 와 같은 변수).
 * 열려 있는 동안에도 폴링·그리기는 그대로 돈다 — 게임 화면을 가리기만 한다.
 */
(function () {
  const css = `
  .rl-back{position:fixed;inset:0;z-index:50;background:rgba(20,12,8,.55);display:flex;align-items:flex-end;justify-content:center;
    padding:env(safe-area-inset-top) 0 0}
  .rl-back.rl-hide{display:none}
  .rl-sheet{background:#fff;width:100%;max-width:520px;max-height:88vh;border-radius:22px 22px 0 0;display:flex;flex-direction:column;
    box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:rlup .18s ease-out}
  @keyframes rlup{from{transform:translateY(30px);opacity:.4}to{transform:none;opacity:1}}
  .rl-head{display:flex;align-items:center;gap:10px;padding:14px 16px 10px;border-bottom:1px solid var(--pk-line,#eadfd6)}
  .rl-head b{flex:1;font-size:18px;font-weight:900;color:var(--pk-ink,#5a3a28)}
  .rl-head button{border:0;border-radius:12px;padding:8px 14px;font:inherit;font-weight:800;font-size:14px;cursor:pointer;
    background:var(--pk-soft,#f6ede6);color:var(--pk-ink,#5a3a28)}
  .rl-body{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 18px calc(22px + env(safe-area-inset-bottom));
    font-size:14.5px;line-height:1.6;color:#3f3530}
  .rl-body h3{font-size:15.5px;margin:18px 0 6px;color:var(--pk-accent,#b8562f)}
  .rl-body p{margin:6px 0}
  .rl-body ul,.rl-body ol{margin:6px 0;padding-left:20px}
  .rl-body li{margin:3px 0}
  .rl-body b{color:var(--pk-ink,#5a3a28)}
  .rl-body .rl-ex{background:var(--pk-soft,#f8f1ea);border-radius:12px;padding:10px 12px;margin:8px 0;font-size:13.5px}
  .rl-body .rl-tip{border-left:4px solid var(--pk-accent,#b8562f);padding:4px 10px;margin:8px 0;font-size:13.5px;
    color:var(--pk-ink,#5a3a28);background:#fffaf5}
  .rl-body table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0}
  .rl-body th,.rl-body td{border:1px solid var(--pk-line,#eadfd6);padding:4px 6px;text-align:center}
  .rl-body th{background:var(--pk-soft,#f8f1ea)}
  .rl-ok{display:block;width:100%;margin-top:16px;border:0;border-radius:14px;padding:14px;font:inherit;font-weight:900;font-size:16px;
    color:#fff;background:var(--pk-accent,#b8562f);cursor:pointer}
  body.rl-open{overflow:hidden}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function mount(opt) {
    const back = document.createElement('div');
    back.className = 'rl-back rl-hide';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.innerHTML = '<div class="rl-sheet"><div class="rl-head"><b></b><button type="button">닫기 ✕</button></div>' +
      '<div class="rl-body"></div></div>';
    back.querySelector('.rl-head b').textContent = opt.title || '규칙';
    const body = back.querySelector('.rl-body');
    body.innerHTML = (opt.html || '') + '<button type="button" class="rl-ok">알겠어요!</button>';
    document.body.appendChild(back);

    const open = () => { back.classList.remove('rl-hide'); document.body.classList.add('rl-open'); body.scrollTop = 0; };
    const close = () => { back.classList.add('rl-hide'); document.body.classList.remove('rl-open'); };
    back.querySelector('.rl-head button').onclick = close;
    back.querySelector('.rl-ok').onclick = close;
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    (opt.buttons || []).forEach((b) => b && b.addEventListener('click', open));

    if (opt.autoKey) {
      let seen = false;
      try { seen = localStorage.getItem(opt.autoKey + ':rules-seen') === '1'; } catch (e) {}
      if (!seen) {
        try { localStorage.setItem(opt.autoKey + ':rules-seen', '1'); } catch (e) {}
        open();
      }
    }
    return { open, close, isOpen: () => !back.classList.contains('rl-hide') };
  }

  window.Rules = { mount };
})();
