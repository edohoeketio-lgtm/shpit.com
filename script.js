/* ═══════════════════════════════════════════════════
   SHIP.IT — Interactions v2
   ═══════════════════════════════════════════════════ */
(() => {
  'use strict';

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* ── Hero typing ─────────────────────────────── */
  const typed = $('#heroTyped');
  const caret = $('#heroCaret');
  const out = $('#heroOut');
  const cmd = 'npx shp-serve';

  async function typeHero() {
    await wait(700);
    for (const ch of cmd) {
      typed.textContent += ch;
      await wait(55 + Math.random() * 40);
    }
    await wait(350);
    caret.style.display = 'none';

    const lines = [
      ['', ''],
      ['  ▸ Detecting framework…  Next.js 14', ''],
      ['  ▸ Checking local server…  port 3000', ''],
      ['  ▸ Opening tunnel…       done', ''],
      ['', ''],
      ['  ✓ Live at  ', 'out-ok', 'https://shp.it/a7x3k9', 'out-url'],
      ['  ↳ copied to clipboard', ''],
      ['  ↳ expires in 24 h', ''],
    ];

    for (const l of lines) {
      const div = document.createElement('div');
      if (l.length === 4) {
        div.innerHTML = `<span class="${l[1]}">${l[0]}</span><span class="${l[3]}">${l[2]}</span>`;
      } else {
        div.textContent = l[0];
        if (l[1]) div.className = l[1];
      }
      out.appendChild(div);
      await wait(l[0] === '' ? 60 : 120);
    }
  }
  typeHero();

  /* ── Scroll reveal ───────────────────────────── */
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const siblings = $$(`.reveal`, e.target.parentElement);
      const i = siblings.indexOf(e.target);
      setTimeout(() => e.target.classList.add('vis'), i * 60);
      io.unobserve(e.target);
    });
  }, { threshold: 0.12 });

  $$('.reveal').forEach(el => io.observe(el));

  /* ── Copy helper ─────────────────────────────── */
  const toast = $('#toast');
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1600);
  }
  function copy(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied'));
  }

  $('#heroCopy')?.addEventListener('click', () => copy('npx shp-serve'));
  $('#ctaCopy')?.addEventListener('click', () => copy('npx shp-serve'));

  /* ═══════════════════════════════════════════════
     Terminal Modal
     ═══════════════════════════════════════════════ */
  const overlay = $('#terminalModal');
  const mInput = $('#mInput');
  const mBody = $('#mTermBody');
  const logList = $('#logList');

  // status refs
  const sState = $('#sState');
  const sTunnel = $('#sTunnel');
  const sUrl = $('#sUrl');
  const sViewers = $('#sViewers');
  const sUptime = $('#sUptime');

  // action btns
  const aShip = $('#aShip');
  const aStop = $('#aStop');
  const aCopy = $('#aCopy');

  let shipping = false;
  let upInt, viewInt, upSec = 0;

  function open() {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => mInput.focus(), 350);
  }
  function close() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  $('#heroTryBtn')?.addEventListener('click', open);
  $('#navTryBtn')?.addEventListener('click', e => { e.preventDefault(); open(); });
  $('#modalClose')?.addEventListener('click', close);
  $('#overlayBg')?.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  // helpers
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function fmtTime(s) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
  function now() { return new Date().toTimeString().slice(0, 8); }

  function addLine(html) {
    const d = document.createElement('div');
    d.style.cssText = 'font-family:var(--mono);font-size:.78rem;line-height:1.85';
    d.innerHTML = html;
    mBody.appendChild(d);
    mBody.scrollTop = mBody.scrollHeight;
  }

  function addLog(msg, cls = '') {
    const d = document.createElement('div');
    d.className = 'log-row';
    d.innerHTML = `<span class="log-t">${now()}</span><span class="log-m ${cls}">${msg}</span>`;
    logList.appendChild(d);
    logList.scrollTop = logList.scrollHeight;
  }

  function setStatus(state, dotCls, tunnel, url, viewers) {
    sState.innerHTML = `<i class="sd ${dotCls}"></i>${state}`;
    sTunnel.textContent = tunnel;
    sUrl.textContent = url;
    sViewers.textContent = viewers;
  }

  async function ship() {
    if (shipping) return;
    shipping = true;
    aShip.disabled = true;
    aStop.disabled = false;

    mBody.innerHTML = '';
    logList.innerHTML = '';

    addLine(`<span style="color:var(--accent)">~ $</span> <span style="color:var(--t1)">npx shp-serve</span>`);
    addLog('command received', 'log-info');
    setStatus('Starting', 'sd-conn', '—', '—', '—');

    addLine(`<span style="color:var(--t3)">  ▸ Scanning for active local server...</span>`);
    await wait(800);
    addLine(`<span style="color:var(--t3)">  framework </span><span style="color:var(--blue)">Next.js 14</span><span style="color:var(--t3)"> detected on :3000</span>`);
    addLog('Next.js 14 auto-detected', 'log-info');

    await wait(600);
    addLine(`<span style="color:var(--grn)">  ✓ Local server detected on 127.0.0.1.</span>`);

    await wait(600);
    addLine(`<span style="color:var(--t3)">  ▸ Connecting to relay…</span>`);
    setStatus('Connecting', 'sd-conn', 'opening', '—', '—');

    await wait(1000);
    addLine(`<span style="color:var(--t3)">  tunnel ready</span>`);
    addLog('tunnel active', 'log-ok');

    await wait(500);
    const url = 'https://shp.it/a7x3k9';
    addLine('');
    addLine(`<span style="color:var(--accent)">  ✓ live at </span><span style="color:var(--blue);text-decoration:underline">${url}</span>`);
    addLine(`<span style="color:var(--t3)">  ↳ zero-config · auto-port · secured</span>`);
    addLine('');
    addLine(`<span style="color:var(--t3)">  watching for changes… (type stop to end)</span>`);

    setStatus('Live', 'sd-live', 'active', url, '0');
    addLog(`live → ${url}`, 'log-ok');

    aCopy.disabled = false;
    copy(url);

    upSec = 0;
    sUptime.textContent = '00:00';
    upInt = setInterval(() => { upSec++; sUptime.textContent = fmtTime(upSec); }, 1000);

    let v = 0;
    const names = ['alice', 'bob', 'charlie', 'dev', 'eve'];
    viewInt = setInterval(() => {
      if (!shipping || v >= 5) return;
      if (Math.random() > .45) {
        v++;
        sViewers.textContent = v;
        addLog(`${names[v - 1]} connected`, 'log-info');
      }
    }, 2800);
  }

  function stop() {
    if (!shipping) return;
    shipping = false;
    clearInterval(upInt);
    clearInterval(viewInt);

    addLine('');
    addLine(`<span style="color:var(--t3)">  tunnel closed.</span>`);
    addLog('stopped', 'log-warn');

    setStatus('Stopped', 'sd-stop', 'closed', '—', '—');
    sUptime.textContent = '—';

    aShip.disabled = false;
    aStop.disabled = true;
    aCopy.disabled = true;
  }

  mInput?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const v = mInput.value.trim().toLowerCase();
    mInput.value = '';
    if (!v) return;

    if (['shp-serve', 'npx shp-serve', 'ship', 'shpit'].includes(v)) return ship();
    if (['stop', 'exit', 'quit'].includes(v)) return stop();
    if (v === 'clear') { mBody.innerHTML = ''; return; }
    if (v === 'help') {
      addLine(`<span style="color:var(--accent)">~ $</span> help`);
      addLine(`<span style="color:var(--t3)">  (this is a simulated demo terminal)</span>`);
      addLine(`<span style="color:var(--t3)">  shp-serve</span>  <span style="color:var(--t3)">run the simulation</span>`);
      addLine(`<span style="color:var(--t3)">  stop</span>   <span style="color:var(--t3)">stop the simulation</span>`);
      addLine(`<span style="color:var(--t3)">  clear</span>  <span style="color:var(--t3)">clear window</span>`);
      addLine(``);
      addLine(`<span style="color:var(--t2)">  To use the actual tool, run in your real terminal:</span>`);
      addLine(`<span style="color:var(--accent)">  npx shp-serve</span>`);
      return;
    }

    addLine(`<span style="color:var(--accent)">~ $</span> ${esc(v)}`);
    addLine(`<span style="color:#ff5f57">  shp-serve: command not found</span>`);
    addLine(`<span style="color:var(--t3)">  (Type <span style="color:var(--t2)">help</span> to see demo commands, or use a real terminal to run <span style="color:var(--t2)">npx shp-serve</span>)</span>`);
  });

  aShip?.addEventListener('click', ship);
  aStop?.addEventListener('click', stop);
  aCopy?.addEventListener('click', () => {
    const u = sUrl.textContent;
    if (u && u !== '—') copy(u);
  });

})();
