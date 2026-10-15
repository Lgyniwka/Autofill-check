// ==UserScript==
// @name         Spare Parts Order Panel
// @namespace    https://github.com/Lgyniwka/Autofill-check
// @version      0.1
// @description  Автономный заказ запчастей (SDCWH): панель появляется в тикете после перехода «Заказать запчасти» (когда в комментариях видим iframe формы 13693051). Классический диалог пресета/локации, локация сокращена до «Рободоставка Арма». Форма заполняется в новом окне и отправляется. БЕЗ заполнения/закрытия тикета — флоу тикета остаётся за командой.
// @author       You
// @match        https://st.yandex-team.ru/*
// @match        https://forms.yandex-team.ru/surveys/154795*
// @match        https://forms.yandex-team.ru/surveys/13693051*
// @match        https://forms.yandex-team.ru/ext/surveys/13693051*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Spare_Order.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Spare_Order.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[SO]';
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // =====================================================
    //  РЕЖИМ ФОРМЫ: окно формы заказа 13693051/154795.
    //  Заполняем по GET-параметрам st_location/st_preset/st_qty,
    //  отправляем и закрываем окно. (Логика перенесена из
    //  AutoFill.user.js, режим «Заказ запчастей».)
    // =====================================================
    if (/\/surveys\/(154795|13693051)/.test(location.href)) {
        console.log(TAG, 'Режим формы заказа запчастей');

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
        function pickRadioByName(name, value, label) {
            const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
            if (!el) return false;
            el.click();
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(TAG, 'Радио «' + (label || value) + '»: клик по id');
            return true;
        }
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
        // Suggest: вставляем текст (execCommand триггерит реактовский саджест),
        // ждём попап popup-<id поля>, кликаем опцию полной серией событий
        // с координатами; фолбэк — ArrowDown + Enter.
        async function pickSuggest(input, value) {
            if (!input || !value) return false;
            setValue(input, value);
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
                            const inpNow = document.getElementById(input.id);
                            const holder = (inpNow && inpNow.closest('.Question')) || document;
                            const hasChip = !!holder.querySelector('[class*="SelectedItem"], [class*="Chip"]');
                            const inpCleared = inpNow && inpNow.value === '';
                            const inpChanged = inpNow && inpNow.value !== String(value);
                            let applied = hasChip || inpCleared || inpChanged;
                            if (!applied && inpNow) {
                                console.warn(TAG, 'Клик по опции саджеста не применился — ArrowDown+Enter');
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

        // Пресеты заказа (перенесены из AutoFill без изменений)
        const SPARE_PRESETS = {
            mic: {
                seriesQuery: 'robot_electric_wiring', seriesChip: 'ROBOT_ELECTRIC_WIRING',
                wikiText: 'Жгут MIC Service branch', qty: '1'
            },
            battery: {
                seriesQuery: 'robot_electric_wiring', seriesChip: 'ROBOT_ELECTRIC_WIRING',
                wikiText: '3.9 Переходник для АКБ 1.5 Battery extender', qty: '2'
            },
            batteryCon: {
                seriesQuery: 'robot_electric_wiring', seriesChip: 'ROBOT_ELECTRIC_WIRING',
                wikiText: '3.9 Battery Harness', qty: '1',
                extraRow: { wikiText: '3.9 Переходник для АКБ 1.5 Battery extender', qty: '2' }
            },
            flag: {
                seriesQuery: 'body_flag', seriesChip: 'ROBOT_BODY_FLAG',
                wikiText: '3.9 Флажок в сборе // 900671 // 3640130XNU60A', qty: '1',
                skAnswer: 'Нет'
            },
            leafSprings: {
                seriesQuery: 'robot_suspension', seriesChip: 'ROBOT_SUSPENSION',
                wikiText: 'Рессора для R 3.9  // НЕТ КОДА 1С //', qty: '1',
                skAnswer: 'Нет'
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
            const qty = String(qtyOverride || preset.qty);
            console.log(TAG, 'Заполняю форму заказа, пресет =', presetKey, 'локация =', locationName, 'кол-во =', qty);
            try {
                // Стр.1: Локация + Статус робота + СК + Тип ТМЦ
                const locInput = await waitFor('#answer_wiki_9008987764243672', 12000);
                if (!locInput) { console.warn(TAG, 'Поле локации не найдено'); return; }
                const locPicked = await pickSuggest(locInput, locationName);
                console.log(TAG, 'Локация:', locPicked);
                await sleep(600);

                if (!pickRadioByName('answer_one_answer_9008988226731508', '1788972002689', 'Не донор'))
                    await pickOption('Не донор');
                await sleep(300);
                const skAnswer = preset.skAnswer || 'Да';
                const skPicked = await pickOptionIn(document, skAnswer);
                if (!skPicked) console.warn(TAG, 'Опция «' + skAnswer + '» (Это СК) не найдена');
                await sleep(300);
                if (!pickRadioByName('answer_choices_1908101', '3179563', 'Запчасти'))
                    await pickOption('Запчасти');
                await sleep(800);

                // Серия компонент (появляется после выбора «Запчасти»)
                const seriesInput = await waitFor('#answer_wiki_9008976633551088', 8000);
                if (!seriesInput) { console.warn(TAG, 'Поле «Серия компонент» не найдено'); return; }
                let seriesPicked = await pickSuggest(seriesInput, preset.seriesQuery);
                if (!seriesPicked) {
                    console.warn(TAG, 'Серия: первая попытка не удалась, повтор');
                    seriesPicked = await pickSuggest(seriesInput, preset.seriesChip);
                }
                let seriesOk = false;
                const chipRe = new RegExp(preset.seriesChip, 'i');
                for (let i = 0; i < 10; i++) {
                    const holder = seriesInput.closest('.Question') || document;
                    if (chipRe.test(holder.textContent || '')) { seriesOk = true; break; }
                    await sleep(400);
                }
                console.log(TAG, 'Серия:', seriesPicked, 'видна в поле:', seriesOk);
                if (!seriesOk) { console.warn(TAG, 'Серия не применилась — останавливаемся'); return; }
                await sleep(800);

                const nextBtn = await waitForText('Далее', 4000);
                if (nextBtn) { clickEl(nextBtn); console.log(TAG, 'Нажали «Далее»'); await sleep(1200); }
                else { console.log(TAG, 'Кнопки «Далее» нет — страница с Вики уже видна'); }

                // Стр.2: Вики + Количество
                const wikiInput = await findInputByQuestionLabel('Вики', 8000);
                if (wikiInput) {
                    let picked = await pickSuggest(wikiInput, preset.wikiText);
                    console.log(TAG, 'Вики выбрана:', picked, preset.wikiText);
                    let wikiOk = false;
                    for (let i = 0; i < 10; i++) {
                        const holder = wikiInput.closest('.Question');
                        if (wikiInput.value === '' || (holder && holder.querySelector('[class*="SelectedItem"], [class*="Chip"]'))) { wikiOk = true; break; }
                        await sleep(400);
                    }
                    if (!wikiOk) {
                        console.warn(TAG, 'Вики не применилась — повтор клавиатурой');
                        wikiInput.focus();
                        wikiInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
                        await sleep(250);
                        ['keydown', 'keypress', 'keyup'].forEach(t =>
                            wikiInput.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
                        await sleep(600);
                    }
                    console.log(TAG, 'Вики применилась:', wikiOk);
                } else {
                    console.warn(TAG, 'Поле «Вики» не найдено');
                }
                await sleep(400);
                await setQuantity(qty);

                // Вторая позиция ряда (жгут АКБ + КОН)
                if (preset.extraRow) {
                    await sleep(500);
                    const moreBtn = await waitForText('Ещё', 5000);
                    if (moreBtn) {
                        clickEl(moreBtn);
                        console.log(TAG, 'Нажали «Ещё» — добавлен второй ряд');
                        await sleep(1000);
                        const wiki2 = await findInputByQuestionLabel('Вики', 8000, true);
                        if (wiki2) {
                            const p2 = await pickSuggest(wiki2, preset.extraRow.wikiText);
                            console.log(TAG, 'Вторая Вики:', p2, preset.extraRow.wikiText);
                        } else { console.warn(TAG, 'Второе поле «Вики» не найдено'); }
                        await sleep(400);
                        await setQuantity(preset.extraRow.qty, true);
                        await sleep(500);
                        const next2 = await waitForText('Далее', 3000);
                        if (next2) { clickEl(next2); console.log(TAG, 'Нажали «Далее»'); await sleep(1000); }
                    } else {
                        console.warn(TAG, 'Кнопка «Ещё» не найдена — остаёмся с одной позицией');
                    }
                }

                await sleep(400);
                const send = await waitForText('Отправить', 8000);
                if (send) { clickEl(send); console.log(TAG, 'Нажали «Отправить»'); }
                else { console.warn(TAG, 'Кнопка «Отправить» не найдена'); }

                await sleep(1500);
                try {
                    if (window.opener) window.opener.postMessage({ type: 'SO_ORDER_DONE' }, '*');
                } catch (e) { console.warn(TAG, 'Не смог уведомить родителя:', e); }
                console.log(TAG, 'Заказ запчастей отправлен, закрываю окно');
                setTimeout(() => { try { window.close(); } catch (e) {} }, 600);
            } catch (e) {
                console.warn(TAG, 'Ошибка заполнения формы заказа:', e);
            }
        }

        // Запуск из нового окна: параметры st_location/st_preset/st_qty
        const urlParams = new URL(location.href).searchParams;
        const urlLoc = urlParams.get('st_location');
        if (urlLoc) {
            const presetKey = urlParams.get('st_preset') || 'mic';
            const urlQty = urlParams.get('st_qty');
            console.log(TAG, 'Запуск из открытого окна, пресет =', presetKey, 'локация =', urlLoc, 'кол-во =', urlQty);
            runSpareOrderForm(urlLoc, presetKey, urlQty);
        }

        return; // форма заказа обработана — дальше не идём
    }

    // =====================================================
    //  РЕЖИМ ТИКЕТА: панель появляется ТОЛЬКО после того, как в
    //  комментариях тикета виден iframe формы заказа запчастей
    //  (т.е. после прожатия перехода «Заказать запчасти»).
    //  Диалог: пресет → (кол-во для рессор) → локация
    //  (сокращена до «Рободоставка Арма»). Затем читаем src
    //  iframe, открываем форму в новом окне со st_* параметрами.
    //  Статусы/учёт работ НЕ трогаем — это флоу команды.
    // =====================================================
    if (!/(SDCFLEETOPS|SDCWH|SDDWH)-\d+/.test(location.href)) {
        // Не страница тикета — панель не запускаем. (Защита от запуска на главных страницах.)
        return;
    }
    console.log(TAG, 'Режим тикета — слежу за формой заказа в комментариях');

    const LOCATION_NAME = 'Рободоставка Арма';
    const LOCATION_ID = '1258532';
    // iframe формы заказа в комментарии: содержит /surveys/154795 или 13693051,
    // либо createTicket-ссылку формы заказа SDCWH.
    const ORDER_FORM_RE = /(\/surveys\/(154795|13693051))|(queue=SDCWH&_form=69f09e6409d73f65e3017c82)/;

    function showToast(message, duration = 6000) {
        let toast = document.getElementById('so-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'so-toast';
            const st = document.createElement('style');
            st.textContent = `#so-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:999999;background:#1f1f1f;color:#eee;padding:12px 18px;border-radius:8px;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .25s;pointer-events:none;max-width:80vw;text-align:center}`;
            document.head.appendChild(st);
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.transition = 'none';
        toast.style.opacity = '0';
        void toast.offsetWidth;
        toast.style.transition = 'opacity .25s';
        toast.style.opacity = '1';
        clearTimeout(toast._t);
        toast._t = setTimeout(() => { toast.style.opacity = '0'; }, duration);
    }

    function findOrderIframe() {
        const frames = [...document.querySelectorAll('iframe')];
        return frames.reverse().find(f => f.src && ORDER_FORM_RE.test(f.src)) || null;
    }

    // ---------- Модалки (классические, из AutoFill) ----------
    function showModal(titleText, buttons, onPick) {
        const overlayId = 'so-modal-' + Date.now();
        const overlay = document.createElement('div');
        overlay.id = overlayId;
        const list = buttons.map(i => `<button class="so-btn" data-v="${i.v}" ${i.hint ? `title="${i.hint}"` : ''}>${i.label}</button>`).join('');
        overlay.innerHTML = `
            <div class="so-box">
                <div class="so-head"><span>${titleText}</span><button class="so-close">✕</button></div>
                <div class="so-list">${list}</div>
            </div>
        `;
        const style = document.createElement('style');
        style.textContent = `
            #${overlayId} { position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            #${overlayId} .so-box { background: #1f1f1f; color: #eee; border-radius: 12px; padding: 16px 18px; width: 360px; max-width: 92%; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
            #${overlayId} .so-head { font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
            #${overlayId} .so-close { background: none; border: none; color: #aaa; cursor: pointer; font-size: 16px; line-height: 1; }
            #${overlayId} .so-close:hover { color: #fff; }
            #${overlayId} .so-list { overflow: auto; display: flex; flex-direction: column; gap: 4px; }
            #${overlayId} .so-btn { border: none; border-radius: 6px; padding: 8px 10px; background: #2a2a2a; color: #eee; font-size: 13px; text-align: left; cursor: pointer; }
            #${overlayId} .so-btn:hover { background: #3b82f6; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        overlay.querySelector('.so-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => {
            const btn = e.target.closest('.so-btn');
            if (!btn) return;
            overlay.remove();
            onPick(btn.dataset.v);
        });
    }

    // Диалог локации — сокращён до единственной «Рободоставка Арма»
    function showLocationModal(onPick) {
        showModal('Локация и парк заказа запчастей', [{ v: LOCATION_NAME, label: LOCATION_NAME }], name => onPick(name, LOCATION_ID));
    }

    function pickQuantity(onPick) {
        showModal('Сколько заказываем?', ['1', '2', '3', '4', '5', '6'].map(v => ({ v, label: v })), onPick);
    }

    // ---------- Плавающая панель ----------
    let panelShown = false;
    let handled = new Set(); // src iframe, для которых панель уже показывали

    const PRESET_BUTTONS = [
        { v: 'mic', label: 'Жгут микрофона' },
        { v: 'battery', label: 'Коннекторы АКБ (×2)' },
        { v: 'batteryCon', label: 'Жгут АКБ + КОН.' },
        { v: 'flag', label: 'Флажок' },
        { v: 'leafSprings', label: 'Рессоры' }
    ];

    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'so-order-panel';
        panel.innerHTML = `
            <div class="sop-header">
                <span>Заказ запчастей</span>
                <button class="sop-hide" title="Скрыть">✕</button>
            </div>
            <div class="sop-note">Локация: ${LOCATION_NAME}</div>
            <div class="sop-body">
                ${PRESET_BUTTONS.map(b => `<button class="sop-btn" data-preset="${b.v}">${b.label}</button>`).join('')}
            </div>
        `;
        const style = document.createElement('style');
        style.textContent = `
            #so-order-panel { position: fixed; right: 16px; top: 90px; z-index: 99999; background: #1f1f1f; color: #eee; border-radius: 10px; padding: 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; box-shadow: 0 4px 20px rgba(0,0,0,0.35); min-width: 200px; user-select: none; }
            #so-order-panel .sop-header { font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
            #so-order-panel .sop-hide { background: none; border: none; color: #aaa; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px; line-height: 1; }
            #so-order-panel .sop-hide:hover { color: #fff; background: #333; }
            #so-order-panel .sop-note { font-size: 11px; opacity: 0.7; margin-bottom: 6px; }
            #so-order-panel .sop-btn { display: block; width: 100%; margin: 4px 0; padding: 7px 10px; border: none; border-radius: 6px; background: #3b82f6; color: white; font-size: 13px; cursor: pointer; text-align: left; transition: background 0.15s; }
            #so-order-panel .sop-btn:hover { background: #2563eb; }
            #so-order-panel .sop-btn.success { background: #22c55e; }
        `;
        document.head.appendChild(style);
        panel.querySelector('.sop-hide').addEventListener('click', () => {
            panel.remove();
            // Панель скрыли вручную — не показывать снова для этого же iframe
            const fr = findOrderIframe();
            if (fr) handled.add(fr.src);
            panelShown = false;
        });
        panel.addEventListener('click', e => {
            const btn = e.target.closest('.sop-btn');
            if (!btn) return;
            const preset = btn.dataset.preset;
            startOrderFlow(preset);
        });
        return panel;
    }

    function ensurePanelInDom(panel, style) {
        if (!document.body) return;
        if (!style.isConnected) document.head.appendChild(style);
        if (!document.getElementById('so-order-panel')) {
            document.body.appendChild(panel);
        }
    }

    // ---------- Флоу заказа: диалог → новое окно → ждём SO_ORDER_DONE ----------
    let flowBusy = false;

    function startOrderFlow(preset) {
        if (flowBusy) { showToast('Заказ уже оформляется…'); return; }
        const askQty = preset === 'leafSprings';
        const presetLabel = (PRESET_BUTTONS.find(b => b.v === preset) || {}).label || preset;

        const askLocation = (qtyOverride) => {
            // Классический диалог: локация/парк — сокращено до Рободоставка Арма
            showLocationModal((locationName, locationId) => {
                openOrderWindow(preset, locationName, locationId, qtyOverride, presetLabel);
            });
        };
        if (askQty) pickQuantity(qty => askLocation(qty));
        else askLocation(null);
    }

    function openOrderWindow(preset, locationName, locationId, qty, presetLabel) {
        const frame = findOrderIframe();
        if (!frame || !frame.src) { showToast('Форма заказа не найдена в комментариях', 7000); return; }
        const openUrl = new URL(frame.src);
        if (!ORDER_FORM_RE.test(openUrl.href)) { showToast('iframe не похож на форму заказа', 7000); return; }
        openUrl.searchParams.delete('iframe');
        openUrl.searchParams.set('st_location', locationName);
        openUrl.searchParams.set('st_location_id', locationId || '');
        openUrl.searchParams.set('st_preset', preset);
        if (qty) openUrl.searchParams.set('st_qty', String(qty));

        console.log(TAG, 'Открываю форму заказа:', openUrl.href);
        const win = window.open(openUrl.href, '_blank');
        if (!win) { showToast('Браузер заблокировал новое окно формы', 7000); return; }
        flowBusy = true;
        showToast('Форма заказа открыта в новом окне (' + presetLabel + ')…', 4000);

        // Ждём SO_ORDER_DONE из окна формы (таймаут 90с)
        const t0 = Date.now();
        const onMsg = ev => {
            const d = ev.data || {};
            if (d.type === 'SO_ORDER_DONE') {
                window.removeEventListener('message', onMsg);
                clearInterval(iv);
                flowBusy = false;
                showToast('Заказ запчастей создан (' + presetLabel + ')');
                console.log(TAG, 'Форма заказа заполнена и отправлена в окне');
            }
        };
        window.addEventListener('message', onMsg);
        const iv = setInterval(() => {
            if (Date.now() - t0 > 90000) {
                window.removeEventListener('message', onMsg);
                clearInterval(iv);
                flowBusy = false;
                showToast('Форма: не дождались отправки (90с)', 7000);
            }
        }, 500);
    }

    // ---------- Слежение за появлением формы заказа в комментариях ----------
    function checkForOrderForm() {
        const fr = findOrderIframe();
        if (!fr || !fr.src) return;
        if (handled.has(fr.src)) return;
        handled.add(fr.src);
        if (panelShown || document.getElementById('so-order-panel')) return;
        panelShown = true;
        const panel = buildPanel();
        // style уже внутри buildPanel создан, но для страховки пересоздаём ссылку
        const styleEl = [...document.querySelectorAll('style')].pop();
        document.body.appendChild(panel);
        showToast('Прожат «Заказать запчасти» — панель заказа запчастей открыта', 5000);
        new MutationObserver(() => ensurePanelInDom(panel, styleEl))
            .observe(document.documentElement, { childList: true, subtree: true });
    }

    const obs = new MutationObserver(() => checkForOrderForm());
    obs.observe(document.documentElement, { childList: true, subtree: true });
    checkForOrderForm();
})();
