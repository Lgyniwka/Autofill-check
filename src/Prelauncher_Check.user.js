// ==UserScript==
// @name         Prelauncher Check
// @namespace    http://tampermonkey.net/
// @version      0.2.0
// @description  Перебор роверов: последовательная проверка prelauncher-страниц в скрытом iframe (.app__header "Prelauncher", "Current branch")
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
    const FALLBACK_MS = TIMEOUT_MS + 5000;

    // ============ Дочерний контекст (iframe с ?plcheck=1) ============
    if (location.search.includes(CHILD_FLAG)) {
        const target = window.opener || window.parent;
        if (target && target !== window) {
            const start = Date.now();
            const t = setInterval(() => {
                const header = document.querySelector('.app__header');
                if (header) {
                    clearInterval(t);
                    target.postMessage({
                        type: 'PLCHECK_RESULT',
                        host: location.hostname,
                        header: (header.innerText || '').trim(),
                        branch: document.body.innerText.includes('Current branch'),
                        elapsed: Date.now() - start
                    }, '*');
                } else if (Date.now() - start > TIMEOUT_MS) {
                    clearInterval(t);
                    target.postMessage({
                        type: 'PLCHECK_RESULT',
                        host: location.hostname,
                        header: null,
                        branch: false,
                        elapsed: Date.now() - start
                    }, '*');
                }
            }, POLL_MS);
        }
        return; // панель в iframe проверки не нужна
    }

    // ============ Родитель: панель перебора ============
    let panel, input, resultsBox, runBtn, exportBtn, stopBtn;
    let running = false, stopReq = false;
    let iframe = null;
    let pendingResolve = null;
    const results = []; // {num, header, branch, elapsed}

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
        document.getElementById('pl-check-close').addEventListener('click', teardown);
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

    function rowHtml(r) {
        return `<div>a${r.num}: ${r.header === 'Prelauncher' ? '<b style="color:green">YES</b>' : '<b style="color:#b00">NO</b>'}`
            + ` | Current branch: ${r.branch ? '<b style="color:green">YES</b>' : 'no'}`
            + ` <span style="color:#999">(${(r.elapsed / 1000).toFixed(0)}с)</span></div>`;
    }

    function setStatus(text) {
        document.getElementById('pl-check-status').textContent = text;
    }

    function removeIframe() {
        if (iframe) { iframe.remove(); iframe = null; }
    }

    function onChildResult(e) {
        if (!e.data || e.data.type !== 'PLCHECK_RESULT' || !pendingResolve) return;
        const num = String(e.data.host).replace(/^a(\d+)\..*$/, '$1');
        const r = { num, header: e.data.header, branch: e.data.branch, elapsed: e.data.elapsed };
        results.push(r);
        resultsBox.insertAdjacentHTML('beforeend', rowHtml(r));
        removeIframe();
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve();
    }

    function checkRobot(num) {
        return new Promise(resolve => {
            pendingResolve = resolve;
            iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;visibility:hidden;';
            iframe.src = `https://a${num}.launcher.sdc.yandex-team.ru/prelauncher/?${CHILD_FLAG}`;
            document.body.appendChild(iframe);
            // страховка: iframe не загрузился / скрипт в нём не выполнился (X-Frame-Options и т.п.)
            setTimeout(() => {
                if (pendingResolve) {
                    results.push({ num, header: null, branch: false, elapsed: 0 });
                    resultsBox.insertAdjacentHTML('beforeend', `<div>a${num}: <b style="color:#b00">ERR</b> iframe не загрузился</div>`);
                    removeIframe();
                    const res2 = pendingResolve;
                    pendingResolve = null;
                    res2();
                }
            }, FALLBACK_MS);
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
        const yes = results.filter(r => r.header === 'Prelauncher').map(r => 'a' + r.num);
        const no = results.filter(r => r.header !== 'Prelauncher').map(r => 'a' + r.num);
        const text = ['ДА:', yes.join(', ') || '—', '', 'НЕТ:', no.join(', ') || '—'].join('\n');
        navigator.clipboard.writeText(text).then(() => setStatus('Отчёт скопирован'));
    }

    function teardown() {
        stopReq = true;
        removeIframe();
        window.removeEventListener('message', onChildResult);
        panel.remove();
    }

    createPanel();
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', createPanel);
    }
})();
