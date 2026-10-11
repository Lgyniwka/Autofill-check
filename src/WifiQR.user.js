// ==UserScript==
// @name         WifiQR: Робот → QR-код
// @namespace    local
// @version      1.9
// @description  Читает SSID и пароль Wi-Fi робота из shell-лога лаунчера, генерирует статический QR-код в фоновой вкладке (stqr.ru) и даёт копнуть ссылку/картинку QR
// @match        https://*.launcher.sdc.yandex-team.ru/*
// @match        https://stqr.ru/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        TEST_MODE: false,            // false = боевой режим (переход на stqr, авто-клик)
        AUTO_SUBMIT: true,           // true = автоматически жать "Создать статический QR-код"
        BACKGROUND_TAB: true,        // true = открывать stqr в фоновой вкладке (без переключения фокуса)
        CLOSE_BG_TAB: true,          // true = автоматически закрыть фоновую вкладку после захвата QR
        QR_URL: 'https://stqr.ru/generator/wifi',
        SECTYPE: 'WPA2',
        // таймауты / паузы (мс)
        PAUSE_SMALL: 1000,
        PAUSE_MED: 2500,
        PAUSE_WAIT_LOG: 1200,
        WAIT_ELEMENT_TIMEOUT: 15000, // сколько ждать появления кнопки после предыдущего шага
        WAIT_LINES_TIMEOUT: 12000,   // сколько ждать появления строк лога после раскрытия
        QR_WATCH_MS: 1000            // период опроса готовности QR
    };

    const STORE = {
        SSID: 'wifiq_ssid',
        PASS: 'wifiq_pass',
        QR_LINK: 'wifiq_qr_link',
        QR_IMG: 'wifiq_qr_img'
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const isLauncher = () => /launcher\.sdc\.yandex-team\.ru/.test(location.host);
    const isQr = () => location.host === 'stqr.ru';

    GM_addStyle('#st-wifiqr-result{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:1000000;max-width:520px;padding:16px 18px;background:#111;color:#fff;border:1px solid #555;border-radius:10px;font:13px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif;white-space:pre-wrap;box-shadow:0 10px 40px rgba(0,0,0,.5);}#st-wifiqr-close{position:absolute;top:6px;right:10px;cursor:pointer;color:#aaa;font-size:16px;}'
        + '#st-wifiqr-panel{position:fixed;right:16px;bottom:16px;z-index:999999;display:flex;flex-direction:column;gap:6px;background:rgba(20,20,20,.92);border:1px solid #444;border-radius:10px;padding:8px;box-shadow:0 8px 30px rgba(0,0,0,.45);}'
        + '#st-wifiqr-launch{background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:10px 14px;font:600 13px/1.2 -apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;}'
        + '#st-wifiqr-launch:hover{background:#2f6fe0;}'
        + '#st-wifiqr-copy-row{display:flex;align-items:center;gap:6px;}'
        + '#st-wifiqr-copy-row button{background:#2a2a2a;color:#e6e6e6;border:1px solid #4d4d4d;border-radius:6px;padding:5px 8px;font:12px/1 -apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;}'
        + '#st-wifiqr-copy-row button:hover{border-color:#7aa2ff;color:#fff;}'
        + '#st-wifiqr-copied{color:#4ade80;font:12px/1 -apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;transition:opacity .3s;}'
        + '#st-wifiqr-copied.show{opacity:1;}');

    function showResult(text) {
        const box = document.createElement('div');
        box.id = 'st-wifiqr-result';
        box.innerHTML = '<span id="st-wifiqr-close">✕</span>' + text.replace(/</g, '&lt;');
        box.querySelector('#st-wifiqr-close').addEventListener('click', () => box.remove());
        document.body.appendChild(box);
        setTimeout(() => box.remove(), 30000);
        console.log('[WifiQR]', text.replace(/\n/g, ' | '));
    }

    function clickIt(el) {
        el.click();
        try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    }

    function waitElement(selector, text, timeoutMs) {
        return new Promise(resolve => {
            const start = Date.now();
            function scan() {
                const els = [...document.querySelectorAll(selector)];
                const found = els.find(e => (e.textContent || '').includes(text));
                if (found) { resolve(found); return; }
                if (Date.now() - start > timeoutMs) { resolve(null); return; }
                setTimeout(scan, 200);
            }
            scan();
        });
    }

    function setNative(el, value) {
        const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Читаем shell log со всей страницы (строки .elements__log-line > code > span).
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
    async function waitLogLines(timeoutMs) {
        const tmo = timeoutMs || CONFIG.WAIT_LINES_TIMEOUT;
        const start = Date.now();
        let lines = [];
        while (Date.now() - start < tmo) {
            lines = getLogLines();
            if (lines.length >= 2) break;
            await sleep(500);
        }
        return lines;
    }

    function parseWifiFromLog(lines) {
        let ssid = null, pass = null;

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i].trim();

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

            if (ssid && !pass) {
                const clean = raw
                    .replace(/^(pass(word)?|пароль|руй|key|psk)\s*[:=]\s*/i, '')
                    .replace(/^[•·\-––]\s*/, '')
                    .trim();
                if (clean.length >= 8 && !/^y_sdc_/i.test(clean)) { pass = clean; break; }
            }
        }

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

        if (CONFIG.TEST_MODE) {
            console.log('[WifiQR] ТЕСТ: пропущены "Launch command" и "Wifi password" — читаем лог напрямую');
        } else {
            // 1. Launch command
            const launch = await waitElement('.elements__button-name, .sdc-button', 'Launch command', CONFIG.WAIT_ELEMENT_TIMEOUT);
            if (!launch) { showResult('Кнопка "Launch command" не найдена'); return; }
            clickIt(launch);
            console.log('[WifiQR] Нажата "Launch command"');
            await sleep(CONFIG.PAUSE_MED);

            // 2. Wifi password (появляется с задержкой после предыдущего шага)
            const wifi = await waitElement('.elements__button-name, .sdc-button', 'Wifi password', CONFIG.WAIT_ELEMENT_TIMEOUT);
            if (!wifi) { console.warn('[WifiQR] "Wifi password" не найдена'); }
            else { clickIt(wifi); console.log('[WifiQR] Нажата "Wifi password"'); await sleep(CONFIG.PAUSE_MED); }
        }

        // 3. Разворачиваем нужный лог (вторая стрелка), ждём и читаем строки
        const expands = document.querySelectorAll('.elements__log-expand');
        const expand = expands[1] || expands[0] || null;
        if (expand) {
            clickIt(expand);
            const idx = [...expands].indexOf(expand);
            console.log('[WifiQR] Лог развёрнут (вторая стрелка .elements__log-expand, индекс=' + idx + ')');
            await sleep(CONFIG.PAUSE_SMALL);
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
        // сбрасываем прошлый QR, чтобы старые копии не остались висеть
        GM_setValue(STORE.QR_LINK, '');
        GM_setValue(STORE.QR_IMG, '');

        if (CONFIG.TEST_MODE) {
            showResult('ТЕСТ OK.\nSSID=' + parsed.ssid
                + (parsed.pass ? '\nPASS=...' + parsed.pass.slice(-4) : '\nPASS: (нет)'));
            return;
        }

        // 4. Переход на stqr (фоновая вкладка направляет работу, не переводя фокус)
        console.log('[WifiQR] Открываю ' + CONFIG.QR_URL + ' (фоновая вкладка=' + CONFIG.BACKGROUND_TAB + ')');
        if (CONFIG.BACKGROUND_TAB && typeof GM_openInTab === 'function') {
            GM_openInTab(CONFIG.QR_URL, { active: false, insert: true });
        } else {
            location.href = CONFIG.QR_URL;
        }
    }

    // =====================================================
    //  stqr.ru — заполнение формы, создание QR и захват результата
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

    // Ждём появления поля #copy-input и картинки QR после генерации, сохраняем их в GM
    function startGeneratorCapture() {
        if (window.__wifiqrCaptureStarted) return;
        window.__wifiqrCaptureStarted = true;
        const iv = setInterval(() => {
            const input = document.getElementById('copy-input');
            if (!input || !input.value) return;
            const img = document.querySelector('img[src*="/qrcodes/"]');
            if (!img) return;
            clearInterval(iv);
            const link = new URL(input.value, location.origin).href;
            const imgSrc = new URL(img.getAttribute('src'), location.origin).href;
            GM_setValue(STORE.QR_LINK, link);
            GM_setValue(STORE.QR_IMG, imgSrc);
            console.log('[WifiQR] stqr: QR захвачен.');
            console.log('[WifiQR]   ссылка:', link);
            console.log('[WifiQR]   картинка:', imgSrc);
            // Автозакрытие фоновой вкладки (данные уже в GM — на лаунчере доступны кнопки копирования)
            if (CONFIG.CLOSE_BG_TAB) {
                console.log('[WifiQR] stqr: закрываю фоновую вкладку через 1.2 c');
                setTimeout(() => { try { window.close(); } catch (e) { console.warn('[WifiQR] stqr: не удалось закрыть вкладку:', e); } }, 1200);
            }
        }, CONFIG.QR_WATCH_MS);
    }

    // =====================================================
    //  Плавающая панель: кнопка запуска + две копирующие кнопки QR
    // =====================================================
    function notifyCopied() {
        const c = document.getElementById('st-wifiqr-copied');
        if (!c) return;
        c.classList.add('show');
        setTimeout(() => c.classList.remove('show'), 1600);
    }

    async function copyImage(absUrl) {
        const blob = await new Promise((res, rej) => GM_xmlhttpRequest({
            method: 'GET', url: absUrl, responseType: 'blob',
            onload: r => res(r.response), onerror: () => rej(new Error('download failed'))
        }));
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': blob })]);
        } catch (e) {
            // бэк-упал до PNG через canvas, если браузер не кладёт svg в буфер
            const png = await svgBlobToPng(blob);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        }
    }

    function svgBlobToPng(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = 512; c.height = 512;
                c.getContext('2d').drawImage(img, 0, 0, 512, 512);
                URL.revokeObjectURL(url);
                c.toBlob(b => (b ? resolve(b) : reject(new Error('no png'))), 'image/png');
            };
            img.onerror = reject;
            img.src = url;
        });
    }

    function addLaunchButton() {
        if (document.getElementById('st-wifiqr-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'st-wifiqr-panel';

        // Главная кнопка
        const btn = document.createElement('button');
        btn.id = 'st-wifiqr-launch';
        btn.textContent = isLauncher()
            ? (CONFIG.TEST_MODE ? '▶ Сгенерить QR (ТЕСТ)' : '▶ Сгенерить QR')
            : '▶ Заполнить QR';
        btn.addEventListener('click', () => {
            if (isLauncher()) runOnLauncher();
            else fillQrForm();
        });

        // Ряд копирования: "Картинка QR" (в буфер картинку) и "Ссылка на QR" (в буфер ссылку),
        // вся подпись — кнопка; справа — уведомление об успешном копировании.
        const copyRow = document.createElement('div');
        copyRow.id = 'st-wifiqr-copy-row';
        copyRow.style.display = 'none';

        const bImg = document.createElement('button');
        bImg.id = 'st-wifiqr-copy-img';
        bImg.textContent = '🖼 Картинка QR';
        bImg.title = 'Скопировать картинку QR в буфер';
        bImg.addEventListener('click', async () => {
            const img = GM_getValue(STORE.QR_IMG, '');
            if (!img) { alert('QR-картинка ещё не готова — дождись генерации.'); return; }
            try {
                await copyImage(img);
                notifyCopied();
            } catch (e) {
                console.error('[WifiQR] копирование картинки не удалось, копирую ссылку:', e);
                await navigator.clipboard.writeText(img).catch(() => {});
                notifyCopied();
            }
        });

        const bLink = document.createElement('button');
        bLink.id = 'st-wifiqr-copy-link';
        bLink.textContent = '🔗 Ссылка на QR';
        bLink.title = 'Скопировать ссылку на QR в буфер';
        bLink.addEventListener('click', async () => {
            const link = GM_getValue(STORE.QR_LINK, '');
            if (!link) { alert('Ссылка на QR ещё не готова — дождись генерации.'); return; }
            await navigator.clipboard.writeText(link).catch(e => console.error(e));
            notifyCopied();
        });

        const copied = document.createElement('span');
        copied.id = 'st-wifiqr-copied';
        copied.textContent = '✓ Скопировано';

        copyRow.append(bImg, bLink, copied);
        panel.append(btn, copyRow);
        document.body.appendChild(panel);

        // На лаунчере следим за появлением QR в общем хранилище и показываем кнопки копирования
        if (isLauncher()) startQrWatcher();
        if (isQr()) startGeneratorCapture();
    }

    // Периодически показываем/прячем ряд копирования, когда QR готов
    function startQrWatcher() {
        if (window.__wifiqrWatcherStarted) return;
        window.__wifiqrWatcherStarted = true;
        setInterval(() => {
            const row = document.getElementById('st-wifiqr-copy-row');
            if (!row) return;
            const link = GM_getValue(STORE.QR_LINK, '');
            row.style.display = link ? 'flex' : 'none';
        }, CONFIG.QR_WATCH_MS);
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
            for (let i = 0; i < 40; i++) {
                const done = await fillQrForm();
                if (done) break;
                await sleep(500);
            }
        })();
    }
})();