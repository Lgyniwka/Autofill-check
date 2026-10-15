// ==UserScript==
// @name         Prelauncher Check
// @namespace    http://tampermonkey.net/
// @version      0.3.0
// @description  Перебор роверов: проверка prelauncher-страниц в скрытом iframe по якорям (без таймеров)
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
    const POLL_MS = 1000; // якоря появляются быстро, таймеры не нужны

    // ============ Дочерний контекст (iframe с ?plcheck=1) ============
    // Собирает состояние по якорям и шлёт результат, как только он определён.
    if (location.search.includes(CHILD_FLAG)) {
        const target = window.opener || window.parent;
        if (target && target !== window) {
            const t = setInterval(() => {
                const header = document.querySelector('.app__header');

                // Якорь 1: не загружено приложение — дальше нечего смотреть
                if (!header) return;

                const bodyText = document.body.innerText || '';

                // Якорь 2: Rover name заполнен (elements__value-init рядом с «Rover name»)
                let roverName = null;
                const nameBlocks = document.querySelectorAll('.elements__text');
                for (const block of nameBlocks) {
                    const label = block.querySelector('.elements__text-name');
                    if (label && label.textContent.trim() === 'Rover name') {
                        const span = block.querySelector('.elements__value-init span, .elements__value-loaded span');
                        if (span) roverName = span.textContent.trim();
                        break;
                    }
                }

                // Якорь 3: Command status (elements__value-loaded/-loading рядом с «Command status»)
                let cmdStatus = null;
                for (const block of nameBlocks) {
                    const label = block.querySelector('.elements__text-name');
                    if (label && label.textContent.trim() === 'Command status') {
                        const span = block.querySelector('.elements__value-loaded span, .elements__value-loading span, .elements__value-init span');
                        if (span) cmdStatus = span.textContent.trim();
                        break;
                    }
                }

                // Якорь 4: ровер недостижим по сети — решающий
                const unreachable = /network is unreachable|connection refused|no route to host|timeout/i.test(bodyText);

                // Проверяем, что состояние решающее: rover name заполнился ИЛИ status отрисовался ИЛИ сеть недоступна
                const decided = (roverName && roverName.startsWith('a')) || !!cmdStatus || unreachable;
                if (!decided) return;

                clearInterval(t);
                target.postMessage({
                    type: 'PLCHECK_RESULT',
                    host: location.hostname.split('.')[0],
                    page: header.textContent.trim() === 'Prelauncher',
                    rover: roverName,
                    status: cmdStatus,
                    unreachable,
                    branch: bodyText.includes('Current branch')
                }, '*');
            }, POLL_MS);
        }
        return;
    }

    // ============ Родитель: панель перебора ============
    let panel, input, resultsBox, runBtn, exportBtn, stopBtn;
    let running = false, stopReq = false;
    let iframe = null;
    let pendingResolve = null;
    const results = []; // {num, page, rover, status, unreachable, branch}

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
        // доступность ровера: страница отвечает И ровер ответил (не unreachable)
        const ok = r.page && !r.unreachable;
        let tag;
        if (!r.page) tag = '<b style="color:#b00">PAGE: NO</b>';
        else if (r.unreachable) tag = '<b style="color:#b00">UNREACHABLE</b>';
        else if (r.rover) tag = `<b style="color:green">OK</b> <span style="color:#999">${r.status || ''}</span>`;
        else tag = '<b style="color:#b00">NO DATA</b>';
        return `<div>a${r.num}: ${tag}`
            + ` | branch: ${r.branch ? 'YES' : 'no'}`
            + `</div>`;
    }

    function setStatus(text) {
        document.getElementById('pl-check-status').textContent = text;
    }

    function removeIframe() {
        if (iframe) { iframe.remove(); iframe = null; }
    }

    function onChildResult(e) {
        if (!e.data || e.data.type !== 'PLCHECK_RESULT' || !pendingResolve) return;
        const r = {
            num: String(e.data.host).replace(/^a(\d+)$/, '$1'),
            page: e.data.page,
            rover: e.data.rover,
            status: e.data.status,
            unreachable: e.data.unreachable,
            branch: e.data.branch
        };
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
            iframe.addEventListener('error', () => {
                results.push({ num, page: false, rover: null, status: null, unreachable: false, branch: false });
                resultsBox.insertAdjacentHTML('beforeend', `<div>a${num}: <b style="color:#b00">ERR</b> iframe не загрузился</div>`);
                removeIframe();
                const res2 = pendingResolve;
                pendingResolve = null;
                if (res2) res2();
            });
            document.body.appendChild(iframe);
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
        const ok = results.filter(r => r.page && !r.unreachable).map(r => 'a' + r.num);
        const no = results.filter(r => !(r.page && !r.unreachable)).map(r => 'a' + r.num);
        const text = ['ОК:', ok.join(', ') || '—', '', 'НЕТ:', no.join(', ') || '—'].join('\n');
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
