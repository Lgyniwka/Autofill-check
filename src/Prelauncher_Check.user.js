// ==UserScript==
// @name         Prelauncher Check
// @namespace    http://tampermonkey.net/
// @version      0.5.0
// @description  Перебор роверов: скрытый iframe, якоря состояния без таймера ответа, живая диагностика
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
    const SHELL_TIMEOUT_MS = 8000; // Потолок ТОЛЬКО для загрузки шёлла (.app__header)

    const ERROR_RE = /network is unreachable|no route to host|connection refused|timeout|deadline exceeded|dial tcp/i;

    // ============ Дочерний контекст (iframe с ?plcheck=1) ============
    if (location.search.includes(CHILD_FLAG)) {
        const target = window.opener || window.parent;
        if (target && target !== window) {
            const start = Date.now();
            let shellSeen = false;

            // Значение блока по имени (любой класс elements__value-*)
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
                    error: (document.body && ERROR_RE.test(document.body.innerText || '')) || null
                };
            }

            const t = setInterval(() => {
                const s = snapshot();

                // живая диагностика — родитель показывает статус каждый опрос
                target.postMessage({
                    type: 'PLCHECK_STATE',
                    host: location.hostname.split('.')[0],
                    shell: s.shell,
                    rover: s.rover,
                    status: s.status,
                    error: s.error,
                    elapsed: Date.now() - start
                }, '*');

                if (s.shell) shellSeen = true;

                // якоря решающего состояния:
                // 1) бекенд ответил — заполнены Rover name или Command status
                // 2) бекенд принёс ошибку сети — текст ошибки в body
                const decided = !!s.rover || !!s.status || !!s.error;
                if (!decided) return;

                clearInterval(t);
                target.postMessage({
                    type: 'PLCHECK_RESULT',
                    host: location.hostname.split('.')[0],
                    shell: s.shell,
                    rover: s.rover,
                    status: s.status,
                    error: s.error,
                    elapsed: Date.now() - start
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
    const results = [];

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
        if (!r.shell) tag = '<b style="color:#b00">PAGE: NO</b>'; // шёлл не загрузился
        else if (r.error) tag = `<b style="color:#b00">UNREACHABLE</b> <span style="color:#999">${r.error}</span>`;
        else if (r.rover) tag = `<b style="color:green">OK</b> <span style="color:#999">${r.status || ''}</span>`;
        else tag = '<b style="color:#b00">NO DATA</b>';
        return `<div>a${r.num}: ${tag} <span style="color:#999">(${(r.elapsed / 1000).toFixed(0)}с)</span></div>`;
    }

    function setStatus(text) {
        document.getElementById('pl-check-status').textContent = text;
    }

    function removeIframe() {
        if (iframe) { iframe.remove(); iframe = null; }
    }

    function finishRow(r) {
        results.push(r);
        if (liveRow) liveRow.remove();
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
            // живая диагностика
            const line = document.createElement('div');
            line.textContent = `a${num}: ${d.shell ? (d.error ? 'ошибка сети…' : 'шёлл жив, ждём бекенда') : 'шёлл не загрузился'} (${Math.round(d.elapsed / 1000)}с)`;
            if (liveRow) liveRow.remove();
            liveRow = line;
            resultsBox.appendChild(line);
            return;
        }
        if (d.type !== 'PLCHECK_RESULT' || !pendingResolve) return;
        finishRow({ num, shell: d.shell, rover: d.rover, status: d.status, error: d.error, elapsed: d.elapsed });
    }

    function checkRobot(num) {
        return new Promise(resolve => {
            pendingResolve = resolve;
            iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;visibility:hidden;';
            iframe.src = `https://a${num}.launcher.sdc.yandex-team.ru/prelauncher/?${CHILD_FLAG}`;
            iframe.addEventListener('error', () => {
                finishRow({ num, shell: false, rover: null, status: null, error: null, elapsed: 0 });
            });
            document.body.appendChild(iframe);
            // Потолок ТОЛЬКО для шёлла: если .app__header так и не появился — страница мертва.
            // Шёлл жив → ждём якорей ответа бекенда без таймера (медленные роботы не бьются).
            setTimeout(() => {
                if (!pendingResolve) return;
                results.push({ num, shell: false, rover: null, status: null, error: null, elapsed: SHELL_TIMEOUT_MS });
                if (liveRow) liveRow.remove();
                resultsBox.insertAdjacentHTML('beforeend', `<div>a${num}: <b style="color:#b00">NO RESPOND</b> (шёлл не загрузился за ${SHELL_TIMEOUT_MS / 1000}с)</div>`);
                removeIframe();
                const res2 = pendingResolve;
                pendingResolve = null;
                res2();
            }, SHELL_TIMEOUT_MS + 2000); // +2с запаса: шёлл мог появиться, но iframe-скрипт ещё не успел отписаться
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
        const ok = results.filter(r => r.shell && !r.error).map(r => 'a' + r.num);
        const no = results.filter(r => !(r.shell && !r.error)).map(r => 'a' + r.num);
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
