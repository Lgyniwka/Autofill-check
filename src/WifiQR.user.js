// ==UserScript==
// @name         ST Wifi QR (Launch command -> stqr.ru)
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  На лаунчере робота жмёт Launch command, читает SSID/пароль из лога, заполняет stqr.ru и создаёт статический QR (WPA2). Тест-режим пропускает шаг "Wifi password".
// @author       You
// @match        https://*.launcher.sdc.yandex-team.ru/*
// @match        https://stqr.ru/*
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/WifiQR.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/WifiQR.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =====================================================
    //  НАСТРОЙКИ
    // =====================================================
    const CONFIG = {
        // true = тестовый прогон: НЕ жмём "Wifi password", логируем распознанное, на stqr НЕ переходим автоматически
        // false = боевой: жмём "Wifi password", читаем SSID/пароль, переходим на stqr и заполняем форму
        TEST_MODE: true,

        QR_URL: 'https://stqr.ru/generator/wifi',
        SECTYPE: 'WPA2',

        AUTO_SUBMIT: true,        // на stqr после заполнения сразу кликнуть "Создать статический QR-код"

        PAUSE_SHORT: 1500,        // между нажатиями
        PAUSE_MED: 2500,
        PAUSE_WAIT_LOG: 6000,     // ждать появления данных в логе
    };

    // Ключи хранилища (между лаунчером и stqr — они в одном скрипте)
    const STORE = {
        SSID: 'wifiq_ssid',
        PASS: 'wifiq_pass',
    };

    // =====================================================
    //  УТИЛИТЫ
    // =====================================================
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function isLauncher() { return /launcher\.sdc\.yandex-team\.ru/.test(location.hostname); }
    function isQr() { return /stqr\.ru/.test(location.hostname); }

    function findByTextDeep(selector, text) {
        for (const el of document.querySelectorAll(selector)) {
            const t = (el.textContent || '').trim();
            if (t === text || t.includes(text)) return el;
        }
        return null;
    }

    async function waitElement(selector, text, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = findByTextDeep(selector, text);
            if (el) return el;
            await sleep(400);
        }
        return null;
    }

    function clickIt(node) {
        (node.closest('button') || node).click();
    }

    // Запись значения в input/select через нативный сеттер (чтобы React/надстройки заметили).
    function setNative(el, value) {
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
            : (el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function showResult(text) {
        console.log('[WifiQR] ' + text);
        const box = document.createElement('div');
        box.id = 'st-wifiqr-result';
        box.textContent = text;
        Object.assign(box.style, {
            position: 'fixed', left: '16px', bottom: '16px', zIndex: '999999',
            background: '#1f1f1f', color: '#eee', padding: '12px 16px', borderRadius: '8px',
            font: '13px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif',
            whiteSpace: 'pre-wrap', maxWidth: '80vw', boxShadow: '0 6px 24px rgba(0,0,0,.4)'
        });
        document.body.appendChild(box);
        setTimeout(() => box.remove(), 20000);
    }

    // =====================================================
    //  ЧТЕНИЕ И ПАРСИНГ ЛОГА ЛАУНЧЕРА
    // =====================================================
    // Читаем shell log: строки .elements__log-line > code > span собираем со всей страницы
    // (структура двух логов может различаться, поэтому не привязываемся к контейнеру).
    // Пустые/пробельные строки отсекаем.
    function getLogLines() {
        const lines = [];
        document.querySelectorAll('.elements__log-line > code > span, .elements__log-line > code')
            .forEach(n => {
                const t = (n.innerText || n.textContent || '').trim();
                if (t) lines.push(t);
            });
        return lines;
    }

    // Ждём появления непустых строк лога после раскрытия (подгрузка асинхронная).
    async function waitLogLines(timeoutMs = 8000) {
        const start = Date.now();
        let lines = [];
        while (Date.now() - start < timeoutMs) {
            lines = getLogLines();
            if (lines.length >= 2) break;
            await sleep(500);
        }
        return lines;
    }

    // ВАЖНО (догадка о формате): строка с SSID содержит имя вида y_sdc_* и обычно
    // оканчивается на _2ghz/_5ghz; пароль — либо в той же строке следом, либо в следующей.
    // Тест-режим выведет сырые строки лога в консоль — по ним уточним парсер под реальный формат.
    function parseWifiFromLog(lines) {
        let ssid = null, pass = null;

for (let i = 0; i < lines.length; i++) {
            const raw = lines[i].trim();

            // 1. Ищем SSID-подобную строку
            if (!ssid) {
                const m = raw.match(/^(y_sdc_[^\s]+)\s*$/i)
                    || raw.match(/(y_sdc_[A-Za-z0-9_.\-]*?)((?:_2g|_5g|_2ghz|_5ghz)?)$/i);
                if (m) {
                    ssid = (m[1] || raw).trim();
                    const after = raw.slice(raw.indexOf(ssid) + ssid.length).trim();
                    if (after && after.length >= 8) pass = after;
                    continue;
                }
            }

            // 2. Пароль — следующая непустая строка после SSID
            if (ssid && !pass) {
                const clean = raw
                    .replace(/^(pass(word)?|пароль|руй|key|psk)\s*[:=]\s*/i, '')
                    .replace(/^[•·\-––]\s*/, '')
                    .trim();
                if (clean.length >= 8 && !/^y_sdc_/i.test(clean)) { pass = clean; break; }
            }
        }

        // 3. Запасной путь: SSID не найден — берём последние 2 непустые строки
        if (!ssid && lines.length >= 2) {
            const last = lines.slice(-2).map(s => s.trim());
            if (last[0] && last[0].length >= 4) ssid = last[0];
            if (last[1] && last[1].length >= 8) pass = last[1];
        }

        return { ssid, pass };
    }

    // =====================================================
    //  ЛАУНЧЕР
    // =====================================================
    async function runOnLauncher() {
        console.log('[WifiQR] Этап: лаунчер (TEST_MODE=' + CONFIG.TEST_MODE + ')');

        // В ТЕСТЕ: пропускаем и "Launch command", и "Wifi password" — сразу читаем shell log.
        if (CONFIG.TEST_MODE) {
            console.log('[WifiQR] ТЕСТ: пропущены "Launch command" и "Wifi password" — читаем лог напрямую');
        } else {
            // 1. Launch command
            const launch = await waitElement('.elements__button-name, .sdc-button', 'Launch command', 8000);
            if (!launch) { showResult('Кнопка "Launch command" не найдена'); return; }
            clickIt(launch);
            console.log('[WifiQR] Нажата "Launch command"');
            await sleep(CONFIG.PAUSE_MED);

            // 2. Wifi password
            const wifi = await waitElement('.elements__button-name, .sdc-button', 'Wifi password', 8000);
            if (!wifi) { console.warn('[WifiQR] "Wifi password" не найдена'); }
            else { clickIt(wifi); console.log('[WifiQR] Нажата "Wifi password"'); await sleep(CONFIG.PAUSE_MED); }
        }

        // 3. Разворачиваем нужный лог (клик по ВТОРОЙ стрелке .elements__log-expand с начала страницы), ждём и читаем строки
        const expands = document.querySelectorAll('.elements__log-expand');
        const expand = expands[1] || expands[0] || null;
        if (expand) {
            clickIt(expand);
            const idx = [...expands].indexOf(expand);
            console.log('[WifiQR] Лог развёрнут (вторая стрелка .elements__log-expand, индекс=' + idx + ')');
            await sleep(CONFIG.PAUSE_MED);
        } else {
            console.warn('[WifiQR] Стрелка .elements__log-expand не найдена — читаем лог как есть');
        }
        await sleep(CONFIG.PAUSE_WAIT_LOG);
        const lines = await waitLogLines();
        console.log('[WifiQR] Строки лога:', JSON.stringify(lines, null, 2));

        const parsed = parseWifiFromLog(lines);
        console.log('[WifiQR] Распознано: SSID=', parsed.ssid, 'PASS=', parsed.pass);

        if (!parsed.ssid || (!CONFIG.TEST_MODE && !parsed.pass)) {
            showResult('Не удалось распознать данные из лога.\n\nСырые строки (скопируй мне их):\n' + lines.join('\n'));
            return;
        }

        GM_setValue(STORE.SSID, parsed.ssid);
        if (parsed.pass) GM_setValue(STORE.PASS, parsed.pass);

        if (CONFIG.TEST_MODE) {
            showResult('ТЕСТ OK.\nSSID=' + parsed.ssid
                + (parsed.pass ? '\nPASS=...' + parsed.pass.slice(-4) : '\nPASS: (нет)')
                + '\n\nДанные сохранены. Открой вручную ' + CONFIG.QR_URL);
            return;
        }

        // 4. Боевой режим — переход на stqr
        location.href = CONFIG.QR_URL;
    }

    // Универсальная плавающая кнопка запуска: работает на обеих страницах.
    // На лаунчере — прогоняет этап лаунчера; на stqr — заполняет форму и создаёт QR.
    function addLaunchButton() {
        if (document.getElementById('st-wifiqr-launch')) return;
        const btn = document.createElement('button');
        btn.id = 'st-wifiqr-launch';
        const label = isLauncher()
            ? (CONFIG.TEST_MODE ? '▶ Сгенерить QR (ТЕСТ)' : '▶ Сгенерить QR')
            : '▶ Заполнить QR';
        btn.textContent = label;
        Object.assign(btn.style, {
            position: 'fixed', right: '16px', bottom: '16px', zIndex: '999999',
            background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px',
            padding: '10px 14px', font: '13px/1.2 -apple-system,"Segoe UI",Roboto,sans-serif',
            cursor: 'pointer', boxShadow: '0 6px 24px rgba(0,0,0,.35)'
        });
        btn.addEventListener('click', () => {
            if (isLauncher()) runOnLauncher();
            else fillQrForm();
        });
        document.body.appendChild(btn);
    }

    // =====================================================
    //  stqr.ru — заполнение формы и создание QR
    // =====================================================
    async function fillQrForm() {
        const ssid = GM_getValue(STORE.SSID, '');
        const pass = GM_getValue(STORE.PASS, '');

        const ssidEl = document.getElementById('ssid') || document.querySelector('input[name="ssid"]');
        const passEl = document.getElementById('pass') || document.querySelector('input[name="pass"]');
        const secEl = document.getElementById('sectype') || document.querySelector('select[name="sectype"]');

        if (!ssidEl) { console.log('[WifiQR] stqr: поле SSID не готово, повторим чуть позже'); return false; }

        if (ssid) setNative(ssidEl, ssid);
        if (pass && passEl) setNative(passEl, pass);
        if (secEl) { secEl.value = CONFIG.SECTYPE; secEl.dispatchEvent(new Event('change', { bubbles: true })); }

        console.log('[WifiQR] stqr: заполнено SSID=' + ssid + ' PASS=' + (pass ? '...(задан)' : '(пусто)') + ' WPA2');

        if (CONFIG.AUTO_SUBMIT) {
            const go = document.getElementById('addButtonStatic')
                || document.querySelector('button[name="addButtonStatic"], [onclick*="addButtonStatic"]');
            if (go) { setTimeout(() => { go.click(); console.log('[WifiQR] stqr: нажата "Создать статический QR-код"'); }, 500); }
            else { console.warn('[WifiQR] stqr: кнопка создания QR не найдена'); }
        }
        return true;
    }

    // =====================================================
    //  СТАРТ
    // =====================================================
    if (isLauncher() || isQr()) {
        addLaunchButton();
    }
    if (isQr()) {
        // пробуем заполнить сразу (для случая, когда данные уже сохранены) и повторяем, пока форма не готова
        (async function waitAndFill() {
            for (let i = 0; i < 20; i++) {
                const done = await fillQrForm();
                if (done) break;
                await sleep(500);
            }
        })();
    }
})();