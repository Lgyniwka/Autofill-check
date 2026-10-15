// ==UserScript==
// @name         Prelauncher Check
// @namespace    http://tampermonkey.net/
// @version      0.6.0
// @description  Перебор роверов: скрытый iframe, якоря, сетевая диагностика (probe + fetch-счётчики приложения)
// @author       You
// @match        https://*.launcher.sdc.yandex-team.ru/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Prelauncher_Check.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Prelauncher_Check.user.js
// ==/UserScript==

(function () {
    'use strict';

    const LOG = '[PLC]';
    const CHILD_FLAG = 'plcheck=1';
    const POLL_MS = 1000;
    const STATE_MS = 2000;
    const SHELL_TIMEOUT_MS = 10000;  // потолок ТОЛЬКО если шёлл не загрузился
    const BACKEND_TIMEOUT_MS = 45000; // шёлл жив, но данные не пришли
    const PROBE_MS = 5000;

    const ERROR_RE = /network is unreachable|no route to host|connection refused|deadline exceeded|dial tcp/i;

    // ============ Дочерний контекст (iframe с ?plcheck=1) ============
    if (location.search.includes(CHILD_FLAG)) {
        const target = window.opener || window.parent;
        if (target && target !== window) {
            const start = Date.now();
            console.log(LOG, 'child started', location.hostname);

            // --- диагностика сети: свой probe + счётчики fetch приложения (@grant none => контекст страницы) ---
            const origFetch = window.fetch.bind(window);
            const app = { ok: 0, fail: 0 };
            window.fetch = function () {
                return origFetch.apply(null, arguments).then(
                    res => { app.ok++; return res; },
                    err => { app.fail++; throw err; }
                );
            };
            const probe = { ok: 0, fail: 0 };
            function doProbe() {
                origFetch(location.origin + '/prelauncher/', { cache: 'no-store' })
                    .then(() => probe.ok++)
                    .catch(() => probe.fail++);
            }
            doProbe();
            setInterval(doProbe, PROBE_MS);

            function blockValue(name) {
                for (const block of document.querySelectorAll('.elements__text')) {
                    const label = block.querySelector('.elements__text-name');
                    if (label && label.textContent.trim() === name) {
                        const span = block.querySelector('.elements__text-value span');
                        if (span) {
                            const t = span.textContent.trim();
                            if (t) return t;
                        }
                        break;
                    }
                }
                return null;
            }

            function snapshot() {
                const header = document.querySelector('.app__header');
                return {
                    shell: !!header,
                    rover: blockValue('Rover name'),
                    status: blockValue('Command status'),
                    error: (document.body && ERROR_RE.test(document.body.innerText || '')) || null,
                    probeOk: probe.ok, probeFail: probe.fail,
                    appFetchOk: app.ok, appFetchFail: app.fail
                };
            }

            let lastStateSent = 0;
            const t = setInterval(() => {
                const s = snapshot();
                const now = Date.now();

                // живая диагностика родителю (не чаще STATE_MS)
                if (now - lastStateSent >= STATE_MS) {
                    lastStateSent = now;
                    target.postMessage({
                        type: 'PLCHECK_STATE', host: location.hostname.split('.')[0],
                        elapsed: now - start, s
                    }, '*');
                }

                // якорь: сеть из iframe вообще не идёт (probe дважды упал, ни одного успеха)
                const netDead = probe.fail >= 2 && probe.ok === 0;

                const decided = !!s.rover || !!s.status || !!s.error || netDead;
                const backendTimeout = now - start > BACKEND_TIMEOUT_MS;

                if (!decided && !backendTimeout) return;

                clearInterval(t);
                const error = s.error
                    ? (s.error === true ? 'backend error text' : s.error)
                    : netDead
                        ? 'NETWORK: fetch из iframe не проходит'
                        : backendTimeout
                            ? `NO DATA: шёлл жив, сеть ${probe.ok > 0 ? 'ок' : 'не проверена'}, app fetch ok/fail: ${app.ok}/${app.fail}`
                            : null;
                console.log(LOG, 'RESULT', JSON.stringify(s), `${((now - start) / 1000).toFixed(0)}s`);
                target.postMessage({
                    type: 'PLCHECK_RESULT', host: location.hostname.split('.')[0],
                    shell: s.shell, rover: s.rover, status: s.status, error,
                    elapsed: now - start,
                    probeOk: probe.ok, probeFail: probe.fail,
                    appFetchOk: app.ok, appFetchFail: app.fail
                }, '*');
            }, POLL_MS);
        }
        return;
    }

    // ============ Родитель: панель перебора ============
    let panel, input, resultsBox, runBtn, exportBtn, stopBtn, liveRow = null;
    let running = false, stopReq = false;
    let iframe = null;
    let pendingResolve = null;
    let currentNum = null;
    const lastState = {}; // num -> {elapsed, s}
    const results = [];

    function createPanel() {
        if (document.getElementById('pl-check-panel')) return;
        panel = document.createElement('div');
        panel.id = 'pl-check-panel';
        panel.style.cssText = `
            position: fixed;
            top: 50px; right: 10px;
            z-index: 99999;
            width: 360px;
            padding: 10px;
            font-size: 13px;
            font-family: Arial, sans-serif;
            border: 1px solid #999;
            border-radius: 6px;
            background: #fff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        `;
        panel.innerHTML = `
            <b>Prelauncher Check</b>
            <span id="pl-check-close" style="float:right;cursor:pointer;padding:0 4px;">✕</span><br>
            <textarea id="pl-check-input" rows="4" style="width:100%;box-sizing:border-box;margin:4px 0;" placeholder="3381 3166 3158 …"></textarea>
            <button id="pl-check-run">Проверить</button>
            <button id="pl-check-stop" disabled>Стоп</button>
            <button id="pl-check-export" disabled>Копировать отчёт</button>
            <div id="pl-check-status" style="margin:4px 0;color:#666;"></div>
            <div id="pl-check-results" style="max-height:260px;overflow:auto;"></div>
        `;
        (document.body || document.documentElement).appendChild(panel);

        input = document.getElementById('pl-check-input');
        resultsBox = document.getElementById('pl-check-results');
        runBtn = document.getElementById('pl-check-run');
        exportBtn = document.getElementById('pl-check-export');
        stopBtn = document.getElementById('pl-check-stop');

        runBtn.addEventListener('click', run);
        stopBtn.addEventListener('click', () => { stopReq = true; });
        document.getElementById('pl-check-close').addEventListener('click', teardown);
        exportBtn.addEventListener('click', copyReport);

        window.addEventListener('message', onMsg);
    }

    function parseNumbers(text) {
        const seen = new Set();
        const out = [];
        for (const raw of text.match(/\d+/g) || []) {
            const n = String(parseInt(raw, 10));
            if (!seen.has(n)) { seen.add(n); out.push(n); }
        }
        return out;
    }

    function rowHtml(r) {
        let tag;
        if (!r.shell) tag = '<b style="color:#b00">PAGE: NO</b>';
        else if (r.rover) tag = `<b style="color:green">OK</b> <span style="color:#999">${r.status || ''}</span>`;
        else if (r.error) tag = `<b style="color:#b00">NO</b> <span style="color:#999">${r.error}</span>`;
        else tag = '<b style="color:#b00">NO DATA</b>';
        const diag = r.probeOk !== undefined
            ? ` <span style="color:#999">[probe ${r.probeOk}/${r.probeFail}, app ${r.appFetchOk}/${r.appFetchFail}]</span>` : '';
        return `<div>a${r.num}: ${tag}${diag} <span style="color:#999">(${(r.elapsed / 1000).toFixed(0)}с)</span></div>`;
    }

    function setStatus(text) {
        document.getElementById('pl-check-status').textContent = text;
    }

    function removeIframe() {
        if (iframe) { iframe.remove(); iframe = null; }
    }

    function finishRow(r) {
        results.push(r);
        if (liveRow) { liveRow.remove(); liveRow = null; }
        resultsBox.insertAdjacentHTML('beforeend', rowHtml(r));
        removeIframe();
        const resolve = pendingResolve;
        pendingResolve = null;
        if (resolve) resolve();
    }

    function onMsg(e) {
        const d = e.data;
        if (!d) return;
        const num = String(d.host || '').replace(/^a(\d+)$/, '$1');

        if (d.type === 'PLCHECK_STATE' && pendingResolve) {
            lastState[num] = d;
            const s = d.s;
            const line = document.createElement('div');
            const net = s.probeFail > 0 && s.probeOk === 0 ? 'сеть из iframe не идёт' : `probe ${s.probeOk}/${s.probeFail} app ${s.appFetchOk}/${s.appFetchFail}`;
            line.textContent = `a${num}: ${s.shell ? (s.rover || s.status ? 'данные пришли' : 'шёлл жив, ждём данных') : 'шёлл не загрузился'} | ${net} (${Math.round(d.elapsed / 1000)}с)`;
            if (liveRow) liveRow.remove();
            liveRow = line;
            resultsBox.appendChild(line);
            return;
        }
        if (d.type !== 'PLCHECK_RESULT' || !pendingResolve) return;
        finishRow({
            num, shell: d.shell, rover: d.rover, status: d.status, error: d.error, elapsed: d.elapsed,
            probeOk: d.probeOk, probeFail: d.probeFail, appFetchOk: d.appFetchOk, appFetchFail: d.appFetchFail
        });
    }

    function checkRobot(num) {
        return new Promise(resolve => {
            pendingResolve = resolve;
            currentNum = num;
            removeIframe(); // страховка: не плодим зависшие iframe
            iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;visibility:hidden;';
            iframe.src = `https://a${num}.launcher.sdc.yandex-team.ru/prelauncher/?${CHILD_FLAG}`;
            iframe.addEventListener('error', () => {
                finishRow({ num, shell: false, rover: null, status: null, error: 'iframe не загрузился', elapsed: 0 });
            });
            document.body.appendChild(iframe);

            // Потолок ТОЛЬКО на шёлл: если .app__header так и не появился — страница мертва.
            // Если шёлл жив — дальше решает ребёнок (якоря или BACKEND_TIMEOUT).
            setTimeout(() => {
                if (!pendingResolve || currentNum !== num) return;
                const st = lastState[num];
                if (st && st.s && st.s.shell) return; // шёлл жив — ждём диагностику ребёнка
                finishRow({ num, shell: false, rover: null, status: null, error: 'шёлл не загрузился', elapsed: SHELL_TIMEOUT_MS });
            }, SHELL_TIMEOUT_MS + 2000);
        });
    }

    async function run() {
        if (running) return;
        const nums = parseNumbers(input.value);
        if (!nums.length) { setStatus('Нет номеров'); return; }

        running = true; stopReq = false;
        results.length = 0;
        resultsBox.innerHTML = '';
        runBtn.disabled = true; exportBtn.disabled = true; stopBtn.disabled = false;

        for (let i = 0; i < nums.length; i++) {
            if (stopReq) break;
            setStatus(`Проверяю a${nums[i]} (${i + 1}/${nums.length})…`);
            await checkRobot(nums[i]);
        }

        setStatus(stopReq ? 'Остановлено' : 'Готово');
        runBtn.disabled = false; stopBtn.disabled = true; exportBtn.disabled = false;
        running = false;
    }

    function copyReport() {
        const ok = results.filter(r => r.rover).map(r => 'a' + r.num);
        const no = results.filter(r => !r.rover).map(r => 'a' + r.num);
        const text = ['ОК:', ok.join(', ') || '—', '', 'НЕТ:', no.join(', ') || '—'].join('\n');
        navigator.clipboard.writeText(text).then(() => setStatus('Отчёт скопирован'));
    }

    function teardown() {
        stopReq = true;
        removeIframe();
        window.removeEventListener('message', onMsg);
        panel.remove();
    }

    createPanel();
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', createPanel);
    }
})();
