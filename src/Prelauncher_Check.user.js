// ==UserScript==
// @name         Prelauncher Check
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Перебор роверов: последовательная проверка prelauncher-страниц (.app__header "Prelauncher", блок "Current branch")
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
    const POLL_MS = 3000;
    const TIMEOUT_MS = 60000;

    // ============ Дочернее окно проверки (открывается родителем с ?plcheck=1) ============
    if (location.search.includes(CHILD_FLAG)) {
        if (window.opener) {
            const start = Date.now();
            const t = setInterval(() => {
                const header = document.querySelector('.app__header');
                if (header) {
                    clearInterval(t);
                    window.opener.postMessage({
                        type: 'PLCHECK_RESULT',
                        host: location.hostname,
                        header: (header.innerText || '').trim(),
                        branch: document.body.innerText.includes('Current branch'),
                        elapsed: Date.now() - start
                    }, '*');
                    window.close();
                } else if (Date.now() - start > TIMEOUT_MS) {
                    clearInterval(t);
                    window.opener.postMessage({
                        type: 'PLCHECK_RESULT',
                        host: location.hostname,
                        header: null,
                        branch: false,
                        elapsed: Date.now() - start
                    }, '*');
                    window.close();
                }
            }, POLL_MS);
        }
        return; // панель в окне проверки не нужна
    }

    // ============ Родитель: панель перебора ============
    let panel, input, resultsBox, runBtn, exportBtn, stopBtn;
    let running = false, stopReq = false;

    function createPanel() {
        if (document.getElementById('pl-check-panel')) return;
        panel = document.createElement('div');
        panel.id = 'pl-check-panel';
        panel.style.cssText = `
            position: fixed;
            top: 50px; right: 10px;
            z-index: 99999;
            width: 320px;
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
        document.getElementById('pl-check-close').addEventListener('click', () => panel.remove());
        exportBtn.addEventListener('click', copyReport);

        window.addEventListener('message', onChildResult);
    }

    function parseNumbers(text) {
        const seen = new Set();
        const out = [];
        for (const raw of text.match(/\d+/g) || []) {
            const n = String(parseInt(raw, 10)); // убираем ведущие нули
            if (!seen.has(n)) { seen.add(n); out.push(n); }
        }
        return out;
    }

    const results = []; // {num, header, branch, elapsed}

    function rowHtml(r) {
        return `<div>a${r.num}: ${r.header === 'Prelauncher' ? '<b style="color:green">YES</b>' : '<b style="color:#b00">NO</b>'}`
            + ` | Current branch: ${r.branch ? '<b style="color:green">YES</b>' : 'no'}`
            + ` <span style="color:#999">(${(r.elapsed / 1000).toFixed(0)}с)</span></div>`;
    }

    function setStatus(text) {
        document.getElementById('pl-check-status').textContent = text;
    }

    function onChildResult(e) {
        if (!e.data || e.data.type !== 'PLCHECK_RESULT' || !pendingResolve) return;
        const num = e.data.host.replace(/^a(\d+)\..*$/, '$1');
        const r = { num, header: e.data.header, branch: e.data.branch, elapsed: e.data.elapsed };
        results.push(r);
        resultsBox.insertAdjacentHTML('beforeend', rowHtml(r));
        if (childWin && !childWin.closed) childWin.close();
        childWin = null;
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve();
    }

    let childWin = null;
    let pendingResolve = null;

    function openChild(num) {
        return new Promise(resolve => {
            pendingResolve = resolve;
            childWin = window.open(`https://a${num}.launcher.sdc.yandex-team.ru/prelauncher/?${CHILD_FLAG}`, '_blank', 'width=400,height=300');
            // страховка: если дочернее окно не открылось (блокировщик)
            setTimeout(() => {
                if (pendingResolve) {
                    const r = { num, header: null, branch: false, elapsed: 0 };
                    results.push(r);
                    resultsBox.insertAdjacentHTML('beforeend', `<div>a${num}: <b style="color:#b00">ERR</b> окно заблокировано</div>`);
                    const res2 = pendingResolve;
                    pendingResolve = null;
                    res2();
                }
            }, TIMEOUT_MS + 5000);
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
            await openChild(nums[i]);
        }

        setStatus(stopReq ? 'Остановлено' : 'Готово');
        runBtn.disabled = false; stopBtn.disabled = true; exportBtn.disabled = false;
        running = false;
    }

    function copyReport() {
        const yes = results.filter(r => r.header === 'Prelauncher').map(r => 'a' + r.num);
        const no = results.filter(r => r.header !== 'Prelauncher').map(r => 'a' + r.num);
        const text = ['ДА:', yes.join(', ') || '—', '', 'НЕТ:', no.join(', ') || '—'].join('\n');
        navigator.clipboard.writeText(text).then(() => setStatus('Отчёт скопирован'));
    }

    createPanel();
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', createPanel);
    }
})();
