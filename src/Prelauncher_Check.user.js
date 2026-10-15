// ==UserScript==
// @name         Prelauncher Check
// @namespace    http://tampermonkey.net/
// @version      0.9.0
// @description  Перебор роверов: скрытые iframe пачками по 5, вердикт по API /prelauncher/cmd-status (200=OK, 502+dial=мёртв)
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
    const SHELL_TIMEOUT_MS = 12000; // страница/хост вообще не отвечают
    const FETCH_RETRY_MS = 10000;   // сколько ретраить фетч-ошибки до вердикта
    const BATCH_SIZE = 5;

    const UNREACHABLE_RE = /connect: network is unreachable/;

    // ============ Дочерний контекст (iframe с ?plcheck=1) ============
    // Вердикт по API: GET /prelauncher/cmd-status
    //   200 -> робот жив; ответ с "connect: network is unreachable" -> мёртв;
    //   фетч-ошибки -> ретраи; не прошло -> по правилу пользователя считаем живым.
    if (location.search.includes(CHILD_FLAG)) {
        const target = window.opener || window.parent;
        if (target && target !== window) {
            const start = Date.now();
            console.log(LOG, 'child started', location.hostname);
            let done = false;

            async function probe() {
                try {
                    const r = await fetch('/prelauncher/cmd-status', { cache: 'no-store' });
                    const text = await r.text();
                    if (UNREACHABLE_RE.test(text) || (r.status >= 500 && UNREACHABLE_RE.test(text))) {
                        return { verdict: 'unreachable', status: r.status, text: text.slice(0, 120) };
                    }
                    // 200 или любой другой ответ сервера — прелаунчер на роботе отвечает
                    let value = null;
                    try { value = JSON.parse(text).value; } catch (e) { value = text.slice(0, 120); }
                    return { verdict: 'ok', status: r.status, value };
                } catch (e) {
                    return { verdict: 'fetch-error', error: String(e && e.message || e) };
                }
            }

            (async function () {
                while (!done) {
                    const p = await probe();
                    const elapsed = Date.now() - start;

                    if (p.verdict === 'ok' || p.verdict === 'unreachable') {
                        done = true;
                        console.log(LOG, 'RESULT', p.verdict, p.status, p.value || p.text, `${(elapsed / 1000).toFixed(0)}s`);
                        target.postMessage({
                            type: 'PLCHECK_RESULT',
                            host: location.hostname.split('.')[0],
                            ok: p.verdict === 'ok',
                            status: p.value,
                            unreachable: p.verdict === 'unreachable',
                            apiStatus: p.status,
                            apiText: p.text || p.error || null,
                            elapsed
                        }, '*');
                        return;
                    }

                    // фетч-ошибки: ретраим до FETCH_RETRY_MS, дальше по правилу «остальное = ОК»
                    if (Date.now() - start > FETCH_RETRY_MS) {
                        done = true;
                        console.log(LOG, 'RESULT ok (fetch errors only, presumed alive)', p.error, `${(elapsed / 1000).toFixed(0)}s`);
                        target.postMessage({
                            type: 'PLCHECK_RESULT',
                            host: location.hostname.split('.')[0],
                            ok: true,
                            status: null,
                            unreachable: false,
                            apiStatus: 0,
                            apiText: 'fetch error: ' + p.error + ' (presumed alive)',
                            elapsed
                        }, '*');
                        return;
                    }
                    await new Promise(res => setTimeout(res, POLL_MS));
                }
            })();
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
        if (r.unreachable) tag = `<b style="color:#b00">UNREACHABLE</b> <span style="color:#999">${r.apiText || ''}</span>`;
        else if (r.ok) tag = `<b style="color:green">OK</b> <span style="color:#999">${r.status || (r.apiText ? r.apiText.slice(0, 40) : '')}</span>`;
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
            num, ok: d.ok, status: d.status, unreachable: d.unreachable,
            apiStatus: d.apiStatus, apiText: d.apiText, elapsed: d.elapsed
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
                finishRobot(num, { num, ok: false, status: null, unreachable: false, apiStatus: 0, apiText: 'iframe error', elapsed: 0 });
            });
            document.body.appendChild(iframe);

            // хост вообще не отвечает (нет даже iframe-контекста для probe)
            st.timer = setTimeout(() => {
                finishRobot(num, { num, ok: false, status: null, unreachable: false, apiStatus: 0, apiText: 'no response', elapsed: SHELL_TIMEOUT_MS });
            }, SHELL_TIMEOUT_MS);
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
        for (let i = 0; i < total; i += BATCH_SIZE) {
            if (stopReq) break;
            const batch = nums.slice(i, i + BATCH_SIZE);
            setStatus(`Пачка ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(total / BATCH_SIZE)}: a${batch.join(', a')}…`);
            await Promise.all(batch.map(n => checkRobot(n)));
        }

        setStatus(stopReq ? `Остановлено (${results.length}/${total})` : `Готово (${results.length}/${total})`);
        runBtn.disabled = false; stopBtn.disabled = true; exportBtn.disabled = false;
        running = false;
    }

    function copyReport() {
        const ok = results.filter(r => r.ok).map(r => 'a' + r.num);
        const no = results.filter(r => !r.ok).map(r => 'a' + r.num);
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
