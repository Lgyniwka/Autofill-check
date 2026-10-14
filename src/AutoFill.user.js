// ==UserScript==
// @name         Accounting Form AutoFill
// @namespace    https://github.com/Lgyniwka/Autofill-check
// @version      2.26
// @description  Плавающая панель + отправка комментария + переход статусов. Пресеты: QR, ППР (форма осмотра), жгут микрофонов, АКБ
// @author       You
// @match        https://tools.sdc.yandex-team.ru/accounting-fleet-works*
// @match        https://forms.yandex-team.ru/surveys/154795*
// @match        https://forms.yandex-team.ru/surveys/13693051*
// @match        https://forms.yandex-team.ru/ext/surveys/13693051*
// @match        https://forms.yandex-team.ru/surveys/13691922*
// @match        https://forms.yandex-team.ru/ext/surveys/13691922*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/AutoFill.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/AutoFill.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =====================================================
    //  Форма осмотра ППР (13691922) — перенос логики standalone
    //  PPR Fast Fill. Self_check открывает форму в новом окне с
    //  GET-параметрами r (робот), p (порт), e (исполнитель),
    //  k (ключ тикета). Фото — по рукопожатию postMessage
    //  (AF_PPR_READY -> ST_PPR_DATA). После «Отправить» шлём
    //  AF_PPR_DONE и закрываем окно.
    // =====================================================
    if (/\/surveys\/13691922/.test(location.href)) {
        console.log('[AF-PPR] Режим формы осмотра ППР');
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        const FIELDS = {
            robot: 'answer_choices_992399',
            port: 'answer_choices_992376',
            executor: 'answer_choices_990084',
            date: 'answer_date_990086',
            photo: 'answer_files_990097'
        };
        const CLEAN = {
            answer_choices_997442: '1557619',
            answer_choices_995784: '1555246',
            answer_choices_1020989: '1598535',
            answer_choices_990241: '1546256',
            answer_choices_990265: '1546261',
            answer_choices_990290: '1546298',
            answer_choices_990312: '1546319',
            answer_choices_990387: '1546443',
            answer_choices_991172: '1548311',
            answer_choices_991377: '1548526',
            answer_choices_991401: '1548614',
            answer_choices_991429: '1548646',
            answer_choices_991433: '1548648',
            answer_choices_991452: '1548665',
            answer_choices_991460: '1548669',
            answer_choices_991550: '1548787',
            answer_choices_991567: '1548848',
            answer_choices_991351: '1548455',
            answer_choices_991363: '1548469'
        };
        const KEY_FIELD = 'answer_short_text_992404';
        const ERROR_TEXT = 'Не удалось загрузить данные.';
        const SUGGEST_URL = '/form/getSuggest';
        const GLOBAL_COOLDOWN = 6000;
        const RETRY_SLOT_MS = 40000;

        // ---------- Саджест-движок (408-коундоуны, стабильные опции) ----------
        const netByField = {};
        const activeField = { id: null };
        let globalPauseUntil = 0;
        const justTimedOut = (fieldId, ms = 4000) => Date.now() - (netByField[fieldId] || 0) < ms;
        const committed = {};

        function markCommitted(fieldId) { committed[fieldId] = true; }

        try {
            const xo = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (m, u) {
                this.__suggest__ = typeof u === 'string' && u.indexOf(SUGGEST_URL) !== -1;
                return xo.apply(this, arguments);
            };
            const xs = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function () {
                if (this.__suggest__) this.addEventListener('loadend', () => {
                    if (this.status === 408) {
                        if (activeField.id && !isGood(activeField.id)) {
                            netByField[activeField.id] = Date.now();
                            globalPauseUntil = Date.now() + GLOBAL_COOLDOWN;
                        }
                    }
                });
                return xs.apply(this, arguments);
            };
        } catch (e) {}

        function clickBtn(el) {
            ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(t =>
                el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })));
        }
        function checkRadio(name, value) {
            const input = document.querySelector('input[type=radio][name="' + name + '"][value="' + value + '"]');
            if (!input) return false;
            const label = input.closest('label');
            if (label) clickBtn(label); else input.click();
            return true;
        }
        function setText(name, value) {
            const el = document.querySelector('input[name="' + name + '"], textarea[name="' + name + '"]');
            if (!el) return false;
            const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        function readOptions(input) {
            const popupId = input.getAttribute('aria-controls');
            const popup = popupId ? document.getElementById(popupId) : null;
            return popup ? Array.from(popup.querySelectorAll('[role="option"]')) : [];
        }
        function fieldHasError(input) {
            const box = (input.closest('.g-question, [class*="question"], [data-testid*="quest"], [class*="SuggestQuestion"]')) || input.parentElement || input;
            return box && box.textContent.includes(ERROR_TEXT);
        }
        function closeDropdown(input) { input.blur(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
        function triggerSearch(input, text) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true }));
            return new Promise(r => setTimeout(() => {
                if (input.value === '') { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); }
                r();
            }, 120));
        }
        async function respectCooldown() {
            while (Date.now() < globalPauseUntil) {
                if (activeField.id && isGood(activeField.id)) { globalPauseUntil = 0; break; }
                await sleep(500);
            }
        }
        async function waitOptions(input, fieldId, timeoutMs = 2500) {
            const start = Date.now(); let lastSig = '', stableSince = 0;
            while (Date.now() - start < (justTimedOut(fieldId) ? 4000 : timeoutMs)) {
                await respectCooldown();
                if (justTimedOut(fieldId)) continue;
                if (fieldHasError(input)) { await sleep(400); continue; }
                const opts = readOptions(input); const sig = opts.map(o => o.textContent.trim()).join('|');
                if (opts.length && sig === lastSig) {
                    if (!stableSince) stableSince = Date.now();
                    else if (Date.now() - stableSince >= 500) return { ok: true, options: opts };
                } else { lastSig = sig; stableSince = 0; }
                await sleep(250);
            }
            return { ok: false, options: [] };
        }
        function pickFrom(options, query) {
            const q2 = query.trim().toLowerCase(); const norm = o => o.textContent.trim().toLowerCase();
            const exact = options.find(o => norm(o) === q2); if (exact) return exact;
            const starts = options.find(o => norm(o).startsWith(q2)); if (starts) return starts;
            const contains = options.filter(o => norm(o).includes(q2)); return contains.length === 1 ? contains[0] : null;
        }
        async function refillOnce(fieldId, text) {
            const input = document.getElementById(fieldId); if (!input) return 'nofield';
            await respectCooldown();
            activeField.id = fieldId;
            closeDropdown(input);
            await sleep(200);
            input.focus();
            await triggerSearch(input, text);
            const res = await waitOptions(input, fieldId);
            const opt = (res.ok && res.options.length) ? pickFrom(res.options, text) : null;
            if (!opt) { activeField.id = null; delete committed[fieldId]; return 'nooption'; }
            clickBtn(opt);
            activeField.id = null;

            const t = Date.now();
            let got = false;
            while (Date.now() - t < 4000) {
                await respectCooldown();
                const expanded = input.getAttribute('aria-expanded');
                const val = input.value && input.value.replace(/[\u2066\u2068\u2069]/g, '').trim();
                if (expanded === 'false' && val) { got = true; break; }
                await sleep(150);
            }
            if (!got) { delete committed[fieldId]; return 'nocommit'; }

            const t2 = Date.now();
            let clean = false;
            while (Date.now() - t2 < 4000) {
                await respectCooldown();
                if (!input.getAttribute('aria-invalid')) { clean = true; break; }
                await sleep(250);
            }
            if (!clean) { delete committed[fieldId]; return 'nocommit'; }

            markCommitted(fieldId);
            netByField[fieldId] = 0;
            return 'ok';
        }
        async function refillUntil(fieldId, text, label) {
            const input = document.getElementById(fieldId);
            if (!input || !text) return true;
            if (committed[fieldId]) return true;
            const start = Date.now();
            let attempt = 0;
            while (Date.now() - start < RETRY_SLOT_MS) {
                attempt++;
                activeField.id = fieldId;
                report('Выбираю ' + label + ' (попытка ' + attempt + ')…');
                const status = await refillOnce(fieldId, text);
                if (status === 'ok' && committed[fieldId]) {
                    report('Заполнено: ' + label);
                    await sleep(700);
                    return true;
                }
                activeField.id = null;
                delete committed[fieldId];
                await respectCooldown();
                await sleep(1000);
            }
            report('Ошибка: ' + label + ' не выбран за 40с', 'error');
            return false;
        }
        function isGood(fieldId) {
            const el = document.getElementById(fieldId);
            if (!el) return false;
            if (!committed[fieldId]) return false;
            const raw = el.value && el.value.replace(/[\u2066\u2068\u2069]/g, '');
            return !!raw && !el.getAttribute('aria-invalid');
        }
        function isDateGood() {
            const el = document.getElementById(FIELDS.date);
            if (!el || el.getAttribute('aria-invalid')) return false;
            return !!el.value && el.value.replace(/[\u2066\u2068\u2069]/g, '') !== 'ДД.ММ.ГГГГ';
        }
        async function fillDate() {
            const input = document.getElementById(FIELDS.date);
            if (!input) return false;
            if (isDateGood()) return true;
            await respectCooldown();
            const dateBox = input.closest('.g-date-date-picker, .g-text-input') || input.parentElement;
            const btn = dateBox && dateBox.querySelector('button[aria-label="Календарь"]');
            if (!btn) return false;
            clickBtn(btn);
            for (let i = 0; i < 20; i++) {
                await sleep(150);
                const today = document.querySelector('.g-date-calendar__button_current');
                if (today) { clickBtn(today); await sleep(150); const close = document.querySelector('button[aria-label="Закрыть"]'); if (close) clickBtn(close); return isDateGood(); }
            }
            return false;
        }
        // ---------- Фото из памяти родителя ----------
        function dataUrlToFile(dataUrl, name) {
            const [meta, b64] = dataUrl.split(',');
            const mime = (meta.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return new File([arr], name, { type: mime });
        }
        function photoBadgeExists() {
            return !!document.querySelector('.FileQuestion-Files .FileBadge, .FileQuestion-Files [class*="FileBadge"]');
        }
        async function fillPhoto(stored) {
            const el = document.querySelector('input[name="' + FIELDS.photo + '"]');
            if (!el) return { ok: false, why: 'nofield' };
            if (!stored) return { ok: false, why: 'nostore' };
            if (photoBadgeExists()) { report('Фото уже на месте'); return { ok: true, why: 'already' }; }
            const file = dataUrlToFile(stored.data, stored.name);
            const dt = new DataTransfer();
            dt.items.add(file);
            el.files = dt.files;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            for (let i = 0; i < 10; i++) {
                await sleep(350);
                if (photoBadgeExists()) { report('Фото добавлено'); return { ok: true, why: 'uploaded' }; }
            }
            return { ok: false, why: 'rejected' };
        }
        function findNextBtn() {
            return Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Далее');
        }
        function findSubmitBtn() {
            return Array.from(document.querySelectorAll('button[type="submit"], button')).find(b => b.textContent.trim() === 'Отправить');
        }
        function hasSubmit() {
            return Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Отправить');
        }

        function report(msg, kind) {
            console.log('[AF-PPR]', msg);
            try { if (window.opener) window.opener.postMessage({ type: 'AF_PPR_PROGRESS', msg, kind: kind || '' }, '*'); } catch (e) {}
        }

        // Рукопожатие: просим у родителя фото (base64 из памяти Self_check), ждём до 20с.
        function requestPhotoFromOpener() {
            return new Promise(resolve => {
                const t0 = Date.now();
                let done = false;
                const onMsg = ev => {
                    const d = ev.data || {};
                    if (d.type === 'ST_PPR_DATA') {
                        done = true;
                        window.removeEventListener('message', onMsg);
                        resolve((d.payload && d.payload.photo) || null);
                    }
                };
                window.addEventListener('message', onMsg);
                const ping = () => { try { if (window.opener) window.opener.postMessage({ type: 'AF_PPR_READY' }, '*'); } catch (e) {} };
                ping();
                const iv = setInterval(() => {
                    if (done) { clearInterval(iv); return; }
                    if (Date.now() - t0 > 20000) { clearInterval(iv); window.removeEventListener('message', onMsg); resolve(null); return; }
                    ping();
                }, 1000);
            });
        }

        // ---------- Автозапуск ----------
        const params = new URLSearchParams(location.search);
        const P = { robot: params.get('r'), port: params.get('p'), executor: params.get('e'), key: params.get('k') };

        if (P.robot || P.port || P.executor || P.key) {
            let started = false, ticks = 0;
            const ready = setInterval(async () => {
                ticks++;
                if (started) { clearInterval(ready); return; }
                if (!document.getElementById(FIELDS.robot)) {
                    if (ticks > 150) { clearInterval(ready); report('Ошибка: форма не загрузилась', 'error'); }
                    return;
                }
                clearInterval(ready);
                started = true;
                try {
                    await sleep(400);

                    report('Старт заполнения…');
                    const okR = await refillUntil(FIELDS.robot, P.robot, 'робота');
                    const okP = await refillUntil(FIELDS.port, P.port, 'порт');
                    const okE = await refillUntil(FIELDS.executor, P.executor, 'исполнителя');
                    if (!okR || !okP || !okE) { report('Ошибка: поля не заполнены. Перезапусти.', 'error'); return; }

                    await fillDate();

                    const photo = await requestPhotoFromOpener();
                    if (photoBadgeExists()) {
                        report('Фото уже на месте, продолжаю…');
                    } else {
                        const ph = await fillPhoto(photo);
                        if (!ph.ok) {
                            report('Фото не подставилось автоматически — добавь ВРУЧНУЮ и подожди, продолжу сам…', 'error');
                            // Ждём ручной добавки фото до 3 минут, затем продолжаем сами.
                            const t0 = Date.now();
                            while (!photoBadgeExists() && Date.now() - t0 < 180000) await sleep(1000);
                            if (photoBadgeExists()) report('Фото добавлено вручную — продолжаю', 'done');
                            else report('Фото так и не добавлено (3 мин) — продолжаю без него', 'error');
                        }
                    }

                    let guard = 0;
                    let submitted = false;
                    while (guard++ < 60) {
                        for (const [name, value] of Object.entries(CLEAN)) {
                            if (document.querySelector('input[type=radio][name="' + name + '"]')) checkRadio(name, value);
                        }
                        if (document.querySelector('input[name="' + KEY_FIELD + '"], textarea[name="' + KEY_FIELD + '"]')) {
                            if (P.key) setText(KEY_FIELD, P.key);
                        }
                        await sleep(400);
                        if (!submitted && hasSubmit()) {
                            const submit = findSubmitBtn();
                            if (submit) {
                                clickBtn(submit);
                                submitted = true;
                                report('Форма отправлена, закрываю окно…', 'done');
                                try { if (window.opener) window.opener.postMessage({ type: 'AF_PPR_DONE' }, '*'); } catch (e) {}
                                setTimeout(() => { try { window.close(); } catch (e) {} }, 800);
                            } else {
                                report('Готово: форма заполнена, но кнопка не найдена.', 'done');
                            }
                            return;
                        }
                        const next = findNextBtn();
                        if (!next) { report('Финал: «Далее» больше нет', 'done'); return; }
                        clickBtn(next);
                        await sleep(900);
                    }
                    report('Ошибка: не прошли все страницы (лимит)', 'error');
                } catch (err) {
                    report('Ошибка: ' + err.message, 'error');
                }
            }, 500);
        }

        return; // форма ППР обработана — дальше не идём
    }

    // =====================================================
    //  Заказ запчастей (форма. Фронт в трекере отдаёт iframe по 154795,
    //  но внутри он редиректит на каноническую 13693051. Поэтому матчим обе.
    //  Обрабатываем СРАЗУ и выходим, чтобы не выполнять панель и localStorage
    //  (в sandbox-iframe это упало бы).
    // =====================================================
    if (/\/surveys\/(154795|13693051)/.test(location.href)) {
        console.log('[AF] Режим формы заказа запчастей — ждём сообщение от родителя');

        function waitFor(sel, timeout = 8000) {
            return new Promise(resolve => {
                const el = document.querySelector(sel);
                if (el) return resolve(el);
                const t0 = Date.now();
                const iv = setInterval(() => {
                    const e = document.querySelector(sel);
                    if (e) { clearInterval(iv); resolve(e); }
                    else if (Date.now() - t0 > timeout) { clearInterval(iv); resolve(null); }
                }, 300);
            });
        }
        function waitForText(text, timeout = 8000) {
            return new Promise(resolve => {
                const find = () => [...document.querySelectorAll('button, option, div[role=option], li')].find(e => (e.textContent || '').trim() === text);
                const el = find();
                if (el) return resolve(el);
                const t0 = Date.now();
                const iv = setInterval(() => {
                    const e = find();
                    if (e) { clearInterval(iv); resolve(e); }
                    else if (Date.now() - t0 > timeout) { clearInterval(iv); resolve(null); }
                }, 300);
            });
        }
        function clickEl(el) { if (el) el.click(); }
        function setValue(input, value) {
            input.focus();
            try { input.select(); } catch (e) {}
            let ok = false;
            try { ok = document.execCommand('insertText', false, value); } catch (e) {}
            if (!ok || input.value !== value) {
                try {
                    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                    setter.call(input, value);
                } catch (e) { input.value = value; }
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // Надёжный клик по radio: напрямую по name+value (id опций известны).
        function pickRadioByName(name, value, label) {
            const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
            if (!el) return false;
            el.click();
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[AF] Радио «' + (label || value) + '»: клик по id');
            return true;
        }
        // Выбрать опцию/режим по подстроке текста (для радио и саджестов).
        async function pickOption(labelContains) {
            const t0 = Date.now();
            return new Promise(resolve => {
                const iv = setInterval(() => {
                    const opts = [...document.querySelectorAll('label[class*="Option"], [role="option"], li[role="option"], .g-radio-group__option')];
                    const target = opts.find(o => (o.textContent || '').toLowerCase().includes(String(labelContains).toLowerCase()));
                    if (target) { clearInterval(iv); target.click(); resolve(true); }
                    else if (Date.now() - t0 > 6000) { clearInterval(iv); resolve(false); }
                }, 300);
            });
        }
        // Suggest: вставляем текст (execCommand триггерит реактовский саджест),
        // ждём попап popup-<id поля> (YC-формы: div[role=option].g-list__item),
        // кликаем опцию полной серией событий с координатами; fallback — Enter.
        async function pickSuggest(input, value) {
            if (!input || !value) return false;
            setValue(input, value);
            // Вики-тексты содержат двойные пробелы («1.5  Battery extender») —
            // нормализуем, иначе includes не находит опцию.
            const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
            const t0 = Date.now();
            return new Promise(resolve => {
                const iv = setInterval(() => {
                    const popup = document.getElementById('popup-' + input.id);
                    const opts = popup
                        ? [...popup.querySelectorAll('[role="option"]')]
                        : [...document.querySelectorAll('[role="option"]')].filter(o => o.offsetParent !== null);
                    const target = opts.find(o => norm(o.textContent) === norm(value))
                        || opts.find(o => norm(o.textContent).includes(norm(value)));
                    if (target) {
                        clearInterval(iv);
                        const r = target.getBoundingClientRect();
                        const ev = { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
                        try { target.dispatchEvent(new PointerEvent('pointerdown', ev)); } catch (e) {}
                        try { target.dispatchEvent(new MouseEvent('mousedown', ev)); } catch (e) {}
                        try { target.dispatchEvent(new PointerEvent('pointerup', ev)); } catch (e) {}
                        try { target.dispatchEvent(new MouseEvent('mouseup', ev)); } catch (e) {}
                        try { target.dispatchEvent(new MouseEvent('click', ev)); } catch (e) {}
                        setTimeout(() => {
                            // Проверяем, ПРИМЕНИЛСЯ ли выбор, а не просто наличие текста.
                            // Признаки выбора: поле ОЧИЩЕНО и/или в вопросе появился чипс.
                            const inpNow = document.getElementById(input.id);
                            const holder = (inpNow && inpNow.closest('.Question')) || document;
                            const hasChip = !!holder.querySelector('[class*="SelectedItem"], [class*="Chip"]');
                            const inpCleared = inpNow && inpNow.value === '';
                            const inpChanged = inpNow && inpNow.value !== String(value);
                            let applied = hasChip || inpCleared || inpChanged;
                            if (!applied && inpNow) {
                                // Клик не сработал: текст так и висит в поле, позиция
                                // НЕ выбрана. Фолбэк — клавиатура: ArrowDown (подсветит
                                // верхнюю опцию отфильтрованного списка) + Enter.
                                console.warn('[AF] Клик по опции саджеста не применился — ArrowDown+Enter');
                                inpNow.focus();
                                inpNow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
                                inpNow.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
                                setTimeout(() => {
                                    ['keydown', 'keypress', 'keyup'].forEach(t =>
                                        inpNow.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
                                }, 250);
                            }
                            resolve(true);
                        }, 450);
                    }
                    else if (Date.now() - t0 > 7000) { clearInterval(iv); resolve(false); }
                }, 300);
            });
        }

        async function pickOptionIn(container, labelContains) {
            const t0 = Date.now();
            return new Promise(resolve => {
                const iv = setInterval(() => {
                    const opts = [...(container || document).querySelectorAll('label[class*="Option"], [role="option"], .g-radio-group__option')];
                    const target = opts.find(o => (o.textContent || '').toLowerCase().includes(String(labelContains).toLowerCase()));
                    if (target) { clearInterval(iv); target.click(); resolve(true); }
                    else if (Date.now() - t0 > 6000) { clearInterval(iv); resolve(false); }
                }, 300);
            });
        }
        // Найти suggest-инпут по тексту вопроса (label). takeLast — брать ПОСЛЕДНИЙ
        // найденный (у второго ряда серии id полей дублируются).
        function findInputByQuestionLabel(textPart, timeout = 8000, takeLast = false) {
            return new Promise(resolve => {
                const scan = () => {
                    const found = [];
                    for (const q of document.querySelectorAll('.Question')) {
                        const lbl = q.querySelector('.QuestionLabel, h3, .QuestionLayout-Label');
                        if (lbl && (lbl.textContent || '').toLowerCase().includes(String(textPart).toLowerCase())) {
                            const input = q.querySelector('input[role="combobox"], input[aria-label*="Для поиска"], input.g-text-input__control');
                            if (input) found.push(input);
                        }
                    }
                    if (!found.length) return null;
                    return takeLast ? found[found.length - 1] : found[0];
                };
                const el = scan();
                if (el) return resolve(el);
                const t0 = Date.now();
                const iv = setInterval(() => {
                    const e = scan();
                    if (e) { clearInterval(iv); resolve(e); }
                    else if (Date.now() - t0 > timeout) { clearInterval(iv); resolve(null); }
                }, 300);
            });
        }
        // Пресеты заказа запчастей: серия компонент, Вики-позиция, количество
        const SPARE_PRESETS = {
            mic: {
                seriesQuery: 'robot_electric_wiring', seriesChip: 'ROBOT_ELECTRIC_WIRING',
                wikiText: 'Жгут MIC Service branch', qty: '1'
            },
            // Замена коннекторов АКБ: заказ — переходник Battery extender ×2
            battery: {
                seriesQuery: 'robot_electric_wiring', seriesChip: 'ROBOT_ELECTRIC_WIRING',
                wikiText: '3.9 Переходник для АКБ 1.5 Battery extender', qty: '2'
            },
            // Жгут АКБ + КОНнектор: жгут меняется ТОЛЬКО ОДИН — Battery Harness ×1
            batteryCon: {
                seriesQuery: 'robot_electric_wiring', seriesChip: 'ROBOT_ELECTRIC_WIRING',
                wikiText: '3.9 Battery Harness', qty: '1',
                // + вторая позиция по кнопке «Ещё»: два переходника
                extraRow: { wikiText: '3.9 Переходник для АКБ 1.5 Battery extender', qty: '2' }
            },
            // Замена рессор: кол-во динамическое (qtyOverride из st_qty),
            // в комментарии и заказе — точное число рессор
            leafSprings: {
                seriesQuery: 'robot_suspension', seriesChip: 'ROBOT_SUSPENSION',
                wikiText: 'Рессора для R 3.9  // НЕТ КОДА 1С //', qty: '1'
            }
        };

        async function setQuantity(value, takeLast = false) {
            const t0 = Date.now();
            return new Promise(resolve => {
                const iv = setInterval(() => {
                    const all = [...document.querySelectorAll('input[type="number"], input[inputmode="numeric"], input.g-text-input__control')]
                        .filter(el => el.closest('.Question') && /количеств/i.test(el.closest('.Question').textContent));
                    const q = takeLast ? all[all.length - 1] : all[0];
                    if (q) {
                        clearInterval(iv);
                        setValue(q, value);
                        resolve(true);
                    }
                    else if (Date.now() - t0 > 6000) { clearInterval(iv); resolve(false); }
                }, 300);
            });
        }

        async function runSpareOrderForm(locationName, presetKey, qtyOverride) {
            const preset = SPARE_PRESETS[presetKey] || SPARE_PRESETS.mic;
            const qty = String(qtyOverride || preset.qty); // динамическое кол-во (рессоры)
            console.log('[AF] Заполняю форму заказа, пресет =', presetKey, 'локация =', locationName, 'кол-во =', qty);
            try {
                // Стр.1: Локация + Статус робота + СК + Тип ТМЦ, кнопка «Далее»
                const locInput = await waitFor('#answer_wiki_9008987764243672', 12000);
                if (!locInput) { console.warn('[AF] Поле локации не найдено'); return; }
                const locPicked = await pickSuggest(locInput, locationName);
                console.log('[AF] Локация:', locPicked);
                await new Promise(r => setTimeout(r, 600));

                // Радио — напрямую по name+value (id опций выверены), fallback по тексту
                if (!pickRadioByName('answer_one_answer_9008988226731508', '1788972002689', 'Не донор'))
                    await pickOption('Не донор');
                await new Promise(r => setTimeout(r, 300));
                if (!pickRadioByName('answer_one_answer_9008988226019256', '1788971284642', 'Нет'))
                    await pickOption('Нет');
                await new Promise(r => setTimeout(r, 300));
                if (!pickRadioByName('answer_choices_1908101', '3179563', 'Запчасти'))
                    await pickOption('Запчасти');
                await new Promise(r => setTimeout(r, 800));

                // «Серия компонент» появляется после выбора «Запчасти».
                const seriesInput = await waitFor('#answer_wiki_9008976633551088', 8000);
                if (!seriesInput) { console.warn('[AF] Поле «Серия компонент» не найдено'); return; }
                let seriesPicked = await pickSuggest(seriesInput, preset.seriesQuery);
                if (!seriesPicked) {
                    console.warn('[AF] Серия: первая попытка не удалась, повтор');
                    seriesPicked = await pickSuggest(seriesInput, preset.seriesChip);
                }
                // Верификация: выбранная серия появляется в чипсах поля
                let seriesOk = false;
                const chipRe = new RegExp(preset.seriesChip, 'i');
                for (let i = 0; i < 10; i++) {
                    const holder = seriesInput.closest('.Question') || document;
                    if (chipRe.test(holder.textContent || '')) { seriesOk = true; break; }
                    await new Promise(r => setTimeout(r, 400));
                }
                console.log('[AF] Серия:', seriesPicked, 'видна в поле:', seriesOk);
                if (!seriesOk) { console.warn('[AF] Серия не применилась — останавливаемся'); return; }
                await new Promise(r => setTimeout(r, 800));

                // Далее: переход на стр.2 с Вики.
                const nextBtn = await waitForText('Далее', 4000);
                if (nextBtn) { clickEl(nextBtn); console.log('[AF] Нажали «Далее»'); await new Promise(r => setTimeout(r, 1200)); }
                else { console.log('[AF] Кнопки «Далее» нет — страница с Вики уже видна'); }

                // Стр.2: Вики (suggest по пресету) + Количество (из пресета).
                const wikiInput = await findInputByQuestionLabel('Вики', 8000);
                if (wikiInput) {
                    let picked = await pickSuggest(wikiInput, preset.wikiText);
                    console.log('[AF] Вики выбрана:', picked, preset.wikiText);
                    // Верификация на уровне флоу: чипс/поле очищено, иначе —
                    // вторая попытка клавиатурной навигацией.
                    let wikiOk = false;
                    for (let i = 0; i < 10; i++) {
                        const holder = wikiInput.closest('.Question');
                        if (wikiInput.value === '' || (holder && holder.querySelector('[class*="SelectedItem"], [class*="Chip"]'))) { wikiOk = true; break; }
                        await new Promise(r => setTimeout(r, 400));
                    }
                    if (!wikiOk) {
                        console.warn('[AF] Вики не применилась — повтор клавиатурой');
                        wikiInput.focus();
                        wikiInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
                        await new Promise(r => setTimeout(r, 250));
                        ['keydown', 'keypress', 'keyup'].forEach(t =>
                            wikiInput.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
                        await new Promise(r => setTimeout(r, 600));
                    }
                    console.log('[AF] Вики применилась:', wikiOk);
                } else {
                    console.warn('[AF] Поле «Вики» не найдено');
                }
                await new Promise(r => setTimeout(r, 400));
                await setQuantity(qty);

                // Вторая позиция ряда (пресет «+ КОН»): кнопка «Ещё» → новый ряд
                // (id полей дублируются — берём ПОСЛЕДНИЕ Вики и Количество).
                if (preset.extraRow) {
                    await new Promise(r => setTimeout(r, 500));
                    const moreBtn = await waitForText('Ещё', 5000);
                    if (moreBtn) {
                        clickEl(moreBtn);
                        console.log('[AF] Нажали «Ещё» — добавлен второй ряд');
                        await new Promise(r => setTimeout(r, 1000));
                        const wiki2 = await findInputByQuestionLabel('Вики', 8000, true);
                        if (wiki2) {
                            const p2 = await pickSuggest(wiki2, preset.extraRow.wikiText);
                            console.log('[AF] Вторая Вики:', p2, preset.extraRow.wikiText);
                        } else { console.warn('[AF] Второе поле «Вики» не найдено'); }
                        await new Promise(r => setTimeout(r, 400));
                        await setQuantity(preset.extraRow.qty, true);
                        // После второй позиции — «Далее» (если есть), затем «Отправить».
                        await new Promise(r => setTimeout(r, 500));
                        const next2 = await waitForText('Далее', 3000);
                        if (next2) { clickEl(next2); console.log('[AF] Нажали «Далее»'); await new Promise(r => setTimeout(r, 1000)); }
                    } else {
                        console.warn('[AF] Кнопка «Ещё» не найдена — остаёмся с одной позицией');
                    }
                }

                await new Promise(r => setTimeout(r, 400));
                const send = await waitForText('Отправить', 8000);
                if (send) { clickEl(send); console.log('[AF] Нажали «Отправить»'); }
                else { console.warn('[AF] Кнопка «Отправить» не найдена'); }

                // Даём форме время уйти и сообщаем родителю, затем закрываем окно.
                await new Promise(r => setTimeout(r, 1500));
                try {
                    if (window.opener) window.opener.postMessage({ type: 'AF_ORDER_DONE' }, '*');
                } catch (e) { console.warn('[AF] Не смог уведомить родителя:', e); }
                console.log('[AF] Заказ запчастей отправлен, закрываю окно');
                setTimeout(() => { try { window.close(); } catch (e) {} }, 600);
            } catch (e) {
                console.warn('[AF] Ошибка заполнения формы заказа:', e);
            }
        }

        let formBusy = false;
        window.addEventListener('message', ev => {
            const d = ev.data || {};
            if (d && d.type === 'ST_ORDER_SPARE_PARTS' && d.payload && d.payload.locationName) {
                if (formBusy) { console.warn('[AF] Форма уже заполняется, пропуск.'); return; }
                formBusy = true;
                ev.source && ev.source.postMessage && ev.source.postMessage({ type: 'AF_ORDER_RECEIVED' }, '*');
                runSpareOrderForm(d.payload.locationName, d.payload.preset, d.payload.quantity);
            }
        });

        // Сценарий «новое окно»: Self_check открывает src-ссылку iframe в отдельной вкладке
        // и передаёт локацию (st_location) и пресет (st_preset) GET-параметрами.
        const urlParams = new URL(location.href).searchParams;
        const urlLoc = urlParams.get('st_location');
        if (urlLoc) {
            const presetKey = urlParams.get('st_preset') || 'mic';
            const urlQty = urlParams.get('st_qty');
            console.log('[AF] Запуск из открытого окна, пресет =', presetKey, 'локация =', urlLoc, 'кол-во =', urlQty);
            if (formBusy) { console.warn('[AF] Форма уже заполняется, пропуск.'); }
            else {
                formBusy = true;
                runSpareOrderForm(urlLoc, presetKey, urlQty);
            }
        }

        return; // форма заказа обработана — дальше не идём
    }

    const STORAGE_KEY = 'accounting-panel-position';
    const COLLAPSE_KEY = 'accounting-panel-collapsed';

    const panel = document.createElement('div');
    panel.id = 'accounting-actions-panel';
    panel.innerHTML = `
        <div class="acp-header">
            <span>Действия</span>
            <button class="acp-toggle" title="Свернуть">▾</button>
        </div>
        <div class="acp-body">
            <button class="acp-btn" data-action="stickers">Замена QR</button>
            <button class="acp-btn" data-action="logsdump">Слив логов</button>
            <button class="acp-btn" data-action="ppr">ППР робота</button>
            <button class="acp-btn" data-action="microphone">Установка жгута микрофонов</button>
            <button class="acp-btn" data-action="battery">Замена коннекторов АКБ</button>
            <button class="acp-btn" data-action="batteryCon">Замена жгута АКБ + КОН.</button>
            <button class="acp-btn" data-action="leafSprings">Замена рессор</button>
        </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        #accounting-actions-panel {
            position: fixed; margin: 0; z-index: 99999;
            background: #1f1f1f; color: #eee; border-radius: 10px;
            padding: 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px; box-shadow: 0 4px 20px rgba(0,0,0,0.35);
            min-width: 210px; user-select: none; cursor: move;
        }
        #accounting-actions-panel .acp-header { font-weight: 600; margin-bottom: 8px; opacity: 0.9; cursor: move; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        #accounting-actions-panel .acp-toggle { background: none; border: none; color: #aaa; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px; line-height: 1; }
        #accounting-actions-panel .acp-toggle:hover { color: #fff; background: #333; }
        #accounting-actions-panel.collapsed .acp-body { display: none; }
        #accounting-actions-panel.collapsed { padding-bottom: 6px; }
        #accounting-actions-panel.collapsed .acp-header { margin-bottom: 0; }
        #accounting-actions-panel .acp-btn {
            display: block; width: 100%; margin: 4px 0; padding: 7px 10px;
            border: none; border-radius: 6px; background: #3b82f6; color: white;
            font-size: 13px; cursor: pointer; text-align: left; transition: background 0.15s;
        }
        #accounting-actions-panel .acp-btn:hover { background: #2563eb; }
        #accounting-actions-panel .acp-btn.success { background: #22c55e; }
        #accounting-actions-panel .acp-btn.warning { background: #f59e0b; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    // Страховка: если SPA перерисует body или скрипт запустился раньше,
    // чем body готов — пересоздаём панель, чтобы она не терялась
    function ensurePanelInDom() {
        if (!document.body) return;
        if (!style.isConnected) document.head.appendChild(style);
        if (!document.getElementById('accounting-actions-panel')) {
            document.body.appendChild(panel);
        }
    }
    ensurePanelInDom();
    new MutationObserver(function () {
        ensurePanelInDom();
    }).observe(document.documentElement, { childList: true, subtree: true });

    // Позиция: центрируем ТОЛЬКО при первой установке (нет сохранённой позиции).
    // После перетаскивания позиция сохраняется и больше не сбрасывается.
    let savedPos = null;
    try {
        savedPos = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {}
    if (savedPos && savedPos.left != null) {
        panel.style.left = savedPos.left + 'px';
        panel.style.top = savedPos.top + 'px';
        panel.style.right = 'auto';
    } else {
        const w = panel.offsetWidth;
        const h = panel.offsetHeight;
        panel.style.left = Math.max(0, Math.round((window.innerWidth - w) / 2)) + 'px';
        panel.style.top = Math.max(0, Math.round((window.innerHeight - h) / 2)) + 'px';
        panel.style.right = 'auto';
    }

    let isDragging = false, offsetX, offsetY;
    panel.addEventListener('mousedown', e => {
        if (e.target.closest('.acp-btn, .acp-toggle')) return;
        isDragging = true;
        offsetX = e.clientX - panel.getBoundingClientRect().left;
        offsetY = e.clientY - panel.getBoundingClientRect().top;
        panel.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        panel.style.left = (e.clientX - offsetX) + 'px';
        panel.style.top = (e.clientY - offsetY) + 'px';
        panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        panel.style.cursor = 'move';
        const rect = panel.getBoundingClientRect();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
    });

    function applyCollapse(collapsed) {
        panel.classList.toggle('collapsed', collapsed);
        const toggle = panel.querySelector('.acp-toggle');
        toggle.textContent = collapsed ? '▸' : '▾';
        toggle.title = collapsed ? 'Развернуть' : 'Свернуть';
        if (collapsed) panel.style.width = panel.getBoundingClientRect().width + 'px';
        else panel.style.width = '';
    }

    if (localStorage.getItem(COLLAPSE_KEY) === '1') applyCollapse(true);
    panel.querySelector('.acp-toggle').addEventListener('click', e => {
        e.stopPropagation();
        const collapsed = !panel.classList.contains('collapsed');
        applyCollapse(collapsed);
        localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    });

    function forceSetValue(input, value) {
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.value = value;
        input.dispatchEvent(new Event('focus', { bubbles: true }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function clickSaveButton() {
        for (const b of document.querySelectorAll('button')) {
            if (b.textContent.trim() === 'Сохранить сделанные работы') {
                b.click();
                return true;
            }
        }
        return false;
    }

    function sendCommentToParent(text) {
        window.parent.postMessage({
            type: 'ST_HELPER_ADD_COMMENT',
            text: text
        }, '*');
    }

    // =====================================================
    //  Локации заказа запчастей SDCWH (id из spare_parts_form)
    // =====================================================
    const SPARE_PART_LOCATIONS = {
        'Рободоставка Арма': '1258532',
        'Рободоставка Шарапово': '1258533',
        'Рободоставка Мытищи': '1258534',
        'Рободоставка Мурино': '1258535',
        'Рободоставка Иннополис': '1258536',
        'ТП Роко-лаб СПБ-1': '1258537',
        'СПБ ЮГ | ТП КР Транспорт СПБ-1': '1258538',
        'Казань | ТП Аргамак КЗН-1': '1258539',
        'Нижний Новгород | ТП Аргамак НН-1': '1258540',
        'МСК Север | ТП Север ИП Лупета МСК-1': '1258541',
        'МСК Юг | ТП ЮГ (Люберцы) Континент МСК-1': '1258542',
        'ТП Некст МСК-1': '1258543',
        'МСК Запад | ТП Запад Роботехнологии МСК-1': '1258544',
        'Воронеж | ТП МК Авто ( Воронеж)': '1258545',
        'Тюмень': '1258671',
        'Рободоставка Новый Уренгой': '1259163',
        '17': '1294998',
        '18': '1301726'
    };

    function showLocationModal(onPick) {
        const overlay = document.createElement('div');
        overlay.id = 'acp-location-modal';
        const list = Object.keys(SPARE_PART_LOCATIONS)
            .map(name => `<button class="acp-loc-btn" data-loc="${name}">${name}</button>`)
            .join('');
        overlay.innerHTML = `
            <div class="acp-loc-box">
                <div class="acp-loc-head"><span>Выбери локацию для заказа запчастей</span><button class="acp-loc-close">✕</button></div>
                <div class="acp-loc-list">${list}</div>
            </div>
        `;
        const style = document.createElement('style');
        style.textContent = `
            #acp-location-modal { position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            #acp-location-modal .acp-loc-box { background: #1f1f1f; color: #eee; border-radius: 12px; padding: 16px 18px; width: 360px; max-width: 92%; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
            #acp-location-modal .acp-loc-head { font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
            #acp-location-modal .acp-loc-close { background: none; border: none; color: #aaa; cursor: pointer; font-size: 16px; line-height: 1; }
            #acp-location-modal .acp-loc-close:hover { color: #fff; }
            #acp-location-modal .acp-loc-list { overflow: auto; display: flex; flex-direction: column; gap: 4px; }
            #acp-location-modal .acp-loc-btn { border: none; border-radius: 6px; padding: 8px 10px; background: #2a2a2a; color: #eee; font-size: 13px; text-align: left; cursor: pointer; }
            #acp-location-modal .acp-loc-btn:hover { background: #3b82f6; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        overlay.querySelector('.acp-loc-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => {
            const btn = e.target.closest('.acp-loc-btn');
            if (!btn) return;
            const name = btn.dataset.loc;
            overlay.remove();
            onPick(name, SPARE_PART_LOCATIONS[name]);
        });
    }

    // Универсальная модалка выбора из списка (для рессор: работа, кол-во)
    function showPickModal(titleText, items, onPick) {
        const overlay = document.createElement('div');
        overlay.id = 'acp-pick-modal';
        const list = items.map(i => `<button class="acp-loc-btn" data-v="${i}">${i}</button>`).join('');
        overlay.innerHTML = `
            <div class="acp-loc-box">
                <div class="acp-loc-head"><span>${titleText}</span><button class="acp-loc-close">✕</button></div>
                <div class="acp-loc-list">${list}</div>
            </div>
        `;
        const style = document.createElement('style');
        style.textContent = `
            #acp-pick-modal { position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            #acp-pick-modal .acp-loc-box { background: #1f1f1f; color: #eee; border-radius: 12px; padding: 16px 18px; width: 360px; max-width: 92%; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
            #acp-pick-modal .acp-loc-head { font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
            #acp-pick-modal .acp-loc-close { background: none; border: none; color: #aaa; cursor: pointer; font-size: 16px; line-height: 1; }
            #acp-pick-modal .acp-loc-close:hover { color: #fff; }
            #acp-pick-modal .acp-loc-list { overflow: auto; display: flex; flex-direction: column; gap: 4px; }
            #acp-pick-modal .acp-loc-btn { border: none; border-radius: 6px; padding: 8px 10px; background: #2a2a2a; color: #eee; font-size: 13px; text-align: left; cursor: pointer; }
            #acp-pick-modal .acp-loc-btn:hover { background: #3b82f6; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        overlay.querySelector('.acp-loc-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => {
            const btn = e.target.closest('.acp-loc-btn');
            if (!btn) return;
            const val = btn.dataset.v;
            overlay.remove();
            onPick(val);
        });
    }

    function doAction(btn, searchText, matchText, commentText, action, onSaved) {
        const input = document.querySelector('input[placeholder="Добавить работы"]');
        if (!input) return alert('Поле не найдено');

        forceSetValue(input, searchText);

        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            const items = document.querySelectorAll('.WorkSuggestItem-Name');

            for (const item of items) {
                if (item.textContent.includes(matchText)) {
                    item.click();
                    clearInterval(timer);

                    setTimeout(() => {
                        const saved = clickSaveButton();
                        btn.classList.add(saved ? 'success' : 'warning');
                        btn.textContent = saved ? 'Сохранено!' : 'Выбрано';

                        if (saved) {
                            setTimeout(() => {
                                // Всегда отправляем комментарий (кроме авторежима без текста)
                                if (commentText) { sendCommentToParent(commentText); }

                                // Колбэк после сохранения (напр. команда заказа запчастей)
                                if (typeof onSaved === 'function') onSaved(saved);

                                // Переход статусов — для пресетов без заказов/форм
                                if (action === 'stickers' || action === 'logsdump') {
                                    setTimeout(() => {
                                        window.parent.postMessage({
                                            type: 'ST_HELPER_TICKET_TRANSITION',
                                            preset: action
                                        }, '*');
                                    }, 1500);
                                }
                            }, 600);
                        }

                        setTimeout(() => {
                            btn.classList.remove('success', 'warning');
                            btn.textContent = btn.dataset.originalText;
                        }, 2000);
                    }, 400);
                    return;
                }
            }

            if (attempts > 20) {
                clearInterval(timer);
                alert(`Подсказка «${matchText}» не найдена`);
            }
        }, 300);
    }

    // =====================================================
    //  Авторежим оформления работы: Self_check открывает страницу
    //  учёта (обычно скрытым iframe) с параметром st_autowork=<ключ>
    //  — мы сами выбираем работу, сохраняем и сообщаем родителю.
    //  (используется для авто-оформления «Проверка калибровок»
    //  в подтикете калибровок при ППР-флоу)
    // =====================================================
    const WORK_AUTOS = {
        calibration: { search: 'калибров', match: 'Проверка калибровок' }
    };

    (function autoworkMode() {
        const key = new URLSearchParams(location.search).get('st_autowork');
        if (!key) return;
        const cfg = WORK_AUTOS[key];
        if (!cfg) { console.warn('[AF] st_autowork: неизвестный ключ', key); return; }
        console.log('[AF] Авторежим работы:', key);
        let ticks = 0;
        const iv = setInterval(() => {
            ticks++;
            if (ticks > 120) { clearInterval(iv); console.warn('[AF] Авторежим: поле работ не появилось'); return; }
            const input = document.querySelector('input[placeholder="Добавить работы"]');
            if (!input) return;
            clearInterval(iv);
            const fake = document.createElement('button');
            doAction(fake, cfg.search, cfg.match, '', null, () => {
                console.log('[AF] Авторежим: работа оформлена, сообщаю родителю');
                try {
                    (window.parent !== window ? window.parent : window.opener)
                        .postMessage({ type: 'AF_CALIB_WORK_DONE', work: key }, '*');
                } catch (e) {}
                setTimeout(() => { try { window.close(); } catch (e) {} }, 800);
            });
        }, 500);
    })();

    panel.querySelectorAll('.acp-btn').forEach(btn => {
        btn.dataset.originalText = btn.textContent;
    });

    panel.addEventListener('click', e => {
        const btn = e.target.closest('.acp-btn');
        if (!btn) return;

        const action = btn.dataset.action;
        // Метка нажатия кнопки — для таймера в итоговом уведомлении
        const pressTs = Date.now();

        if (action === 'stickers') {
            doAction(btn, 'Замена наклеек', 'Замена наклеек', 'Наклеили новый QR', action);
        }
        if (action === 'logsdump') {
            doAction(btn, 'работа с тикетами SDCLOGSCONTROL', 'Контроль слива логов с роботов, работа с тикетами SDCLOGSCONTROL', 'Слили логи', action);
        }
        if (action === 'ppr') {
            // ППР: сначала РУЧНОЙ выбор фото робота, затем стандартный doAction
            // («ППР робота» + комментарий) и команда Self_check открыть форму
            // осмотра 13691922 в новом окне. Фото уйдёт родителю в память (base64)
            // и оттуда будет вставлено в file-инпут формы.
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.style.display = 'none';
            fileInput.addEventListener('change', () => {
                const f = fileInput.files && fileInput.files[0];
                if (!f) return;
                const rd = new FileReader();
                rd.onload = () => {
                    doAction(btn, 'ППР', 'ППР робота', 'Сделали ППР', action, () => {
                        window.parent.postMessage({
                            type: 'ST_HELPER_PPR_ORDER',
                            payload: {
                                photo: { name: f.name, data: rd.result },
                                startedAt: pressTs
                            }
                        }, '*');
                    });
                };
                rd.readAsDataURL(f);
            });
            document.body.appendChild(fileInput);
            fileInput.click();
            setTimeout(() => { try { fileInput.remove(); } catch (e) {} }, 60000);
        }
        if (action === 'microphone') {
            // Сначала выбор локации заказа запчастей
            showLocationModal((locationName, locationId) => {
                doAction(btn, 'жгута микрофонов', 'Установка жгута микрофонов', 'Установили жгут микрофонов', action, () => {
                    window.parent.postMessage({
                        type: 'ST_HELPER_MICROPHONE_ORDER',
                        payload: {
                            locationName,
                            locationId,
                            preset: 'mic',
                            startedAt: pressTs
                        }
                    }, '*');
                });
            });
        }
        if (action === 'battery') {
            // Замена коннекторов АКБ: та же схема, пресет battery
            showLocationModal((locationName, locationId) => {
                doAction(btn, 'замена жгута АКБ', 'R3.9 Замена жгута АКБ', 'Заменили жгуты АКБ', action, () => {
                    window.parent.postMessage({
                        type: 'ST_HELPER_MICROPHONE_ORDER',
                        payload: {
                            locationName,
                            locationId,
                            preset: 'battery',
                            startedAt: pressTs
                        }
                    }, '*');
                });
            });
        }
        if (action === 'batteryCon') {
            // Замена жгута АКБ + коннектор: в заказе ДВЕ позиции (жгут + переходник)
            showLocationModal((locationName, locationId) => {
                doAction(btn, 'замена жгута АКБ', 'R3.9 Замена жгута АКБ', 'Заменили жгуты АКБ', action, () => {
                    window.parent.postMessage({
                        type: 'ST_HELPER_MICROPHONE_ORDER',
                        payload: {
                            locationName,
                            locationId,
                            preset: 'batteryCon',
                            startedAt: pressTs
                        }
                    }, '*');
                });
            });
        }
        if (action === 'leafSprings') {
            // Замена рессор: 1) работа в учёте (4 варианта), 2) точное кол-во
            // для заказа (может не совпадать с работой — в учёте шаг 1/2/4/6),
            // 3) локация. Комментарий «Заменили N рессор» — по заказному кол-ву.
            showPickModal('Какая работа в учёте?', ['Замена 1 рессоры', 'Замена 2х рессор', 'Замена 4-х рессор', 'Замена 6-ти рессор'], workName => {
                showPickModal('Сколько рессор заказываем?', ['1', '2', '3', '4', '5', '6'], quantity => {
                    showLocationModal((locationName, locationId) => {
                        doAction(btn, 'рессор', workName, 'Заменили ' + quantity + ' рессор', action, () => {
                            window.parent.postMessage({
                                type: 'ST_HELPER_MICROPHONE_ORDER',
                                payload: {
                                    locationName,
                                    locationId,
                                    preset: 'leafSprings',
                                    quantity,
                                    startedAt: pressTs
                                }
                            }, '*');
                        });
                    });
                });
            });
        }
    });
})();
