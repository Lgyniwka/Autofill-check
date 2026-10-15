// ==UserScript==
// @name         Prelauncher Check
// @namespace    http://tampermonkey.net/
// @version      0.8.0
// @description  Перебор роверов: скрытые iframe пачками по 5. Правило: "connect: network is unreachable" → мёртв, остальное → ОК
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
    const SHELL_TIMEOUT_MS = 10000;
    const DATA_TIMEOUT_MS = 30000;
    const BATCH_SIZE = 5;

    const UNREACHABLE_RE = /connect: network is unreachable/;

    // ============ Дочерний контекст (iframe с ?plcheck=1) ============
    if (location.search.includes(CHILD_FLAG)) {
        const target = window.opener || window.parent;
        if (target && target !== window) {
            const start = Date.now();
            console.log(LOG, 'child started', location.hostname);

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

            const t = setInterval(() => {
                const header = document.querySelector('.app__header');
                if (!header) return;

                const bodyText = document.body.innerText || '';
                const unreachable = UNREACHABLE_RE.test(bodyText);
                const rover = blockValue('Rover name');
                const status = blockValue('Command status');
                const dataTimeout = Date.now() - start > DATA_TIMEOUT_MS;

                if (!unreachable && !rover && !status && !dataTimeout) return;

                clearInterval(t);
                console.log(LOG, 'RESULT', unreachable ? 'UNREACHABLE' : 'OK', rover, status, `${((Date.now() - start) / 1000).toFixed(0)}s`);
                target.postMessage({
                    type: 'PLCHECK_RESULT',
                    host: location.hostname.split('.')[0],
                    shell: true,
                    rover,
                    status,
                    unreachable,
                    elapsed: Date.now() - start
                }, '*');
            }, POLL_MS);
        }
        return;
    }

    // ============ Родитель: панель перебора (пачки по BATCH_SIZE) ============
    let panel, input, resultsBox, runBtn, exportBtn, stopBtn;
    let running = false, stopReq = false;
    const inflight = {}; // num -> {iframe, resolve, timer}
    const results = [];

    function createPanel() {
        if (document.getElementById('pl-check-panel')) return;
        panel = document.createElement('div');
        panel.id = 'pl-check-panel';
        panel.style.cssText = `
            position: fixed;
            top: 50px; right: 10px;
            z-index: 99999;
            width: 340px;
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
        if (r.unreachable) tag = '<b style="color:#b00">UNREACHABLE</b>';
        else if (r.rover) tag = `<b style="color:green">OK</b> <span style="color:#999">${r.status || ''}</span>`;
        else if (r.shell) tag = '<b style="color:green">OK</b> <span style="color:#999">без данных</span>';
        else tag = '<b style="color:#b00">PAGE: NO</b>';
        return `<div>a${r.num}: ${tag} <span style="color:#999">(${(r.elapsed / 1000).toFixed(0)}с)</span></div>`;
    }

    function setStatus(text) {
        document.getElementById('pl-check-status').textContent = text;
    }

    function finishRobot(num, r) {
        const st = inflight[num];
        if (!st) return;
        if (st.iframe) st.iframe.remove();
        if (st.timer) clearTimeout(st.timer);
        delete inflight[num];
        results.push(r);
        resultsBox.insertAdjacentHTML('beforeend', rowHtml(r));
        st.resolve();
    }

    function onMsg(e) {
        const d = e.data;
        if (!d || d.type !== 'PLCHECK_RESULT') return;
        const num = String(d.host || '').replace(/^a(\d+)$/, '$1');
        if (!inflight[num]) return;
        finishRobot(num, {
            num, shell: d.shell, rover: d.rover, status: d.status,
            unreachable: d.unreachable, elapsed: d.elapsed
        });
    }

    function checkRobot(num) {
        return new Promise(resolve => {
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;visibility:hidden;';
            iframe.src = `https://a${num}.launcher.sdc.yandex-team.ru/prelauncher/?${CHILD_FLAG}`;

            const st = { iframe, resolve, timer: null };
            inflight[num] = st;

            iframe.addEventListener('error', () => {
                finishRobot(num, { num, shell: false, rover: null, status: null, unreachable: false, elapsed: 0 });
            });
            document.body.appendChild(iframe);

            // шёлл-потолок: хост не отдал SPA → PAGE: NO
            st.timer = setTimeout(() => {
                finishRobot(num, { num, shell: false, rover: null, status: null, unreachable: false, elapsed: SHELL_TIMEOUT_MS });
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

        const total = nums.length;
        let done = 0;
        for (let i = 0; i < total; i += BATCH_SIZE) {
            if (stopReq) break;
            const batch = nums.slice(i, i + BATCH_SIZE);
            setStatus(`Пачка ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(total / BATCH_SIZE)}: a${batch.join(', a')}…`);
            await Promise.all(batch.map(n => checkRobot(n)));
            done = Math.min(i + BATCH_SIZE, total);
        }

        setStatus(stopReq ? `Остановлено (${results.length}/${total})` : `Готово (${results.length}/${total})`);
        runBtn.disabled = false; stopBtn.disabled = true; exportBtn.disabled = false;
        running = false;
    }

    function copyReport() {
        const ok = results.filter(r => r.shell && !r.unreachable).map(r => 'a' + r.num);
        const no = results.filter(r => !r.shell || r.unreachable).map(r => 'a' + r.num);
        const text = ['ОК:', ok.join(', ') || '—', '', 'НЕТ:', no.join(', ') || '—'].join('\n');
        navigator.clipboard.writeText(text).then(() => setStatus('Отчёт скопирован'));
    }

    function teardown() {
        stopReq = true;
        for (const num of Object.keys(inflight)) {
            const st = inflight[num];
            if (st.iframe) st.iframe.remove();
            if (st.timer) clearTimeout(st.timer);
        }
        window.removeEventListener('message', onMsg);
        panel.remove();
    }

    createPanel();
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', createPanel);
    }
})();
