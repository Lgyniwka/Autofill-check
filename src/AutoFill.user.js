// ==UserScript==
// @name         Accounting Form AutoFill
// @namespace    https://github.com/Lgyniwka/Autofill-check
// @version      2.6
// @description  Плавающая панель + отправка комментария + переход статусов только для Замена QR
// @author       You
// @match        https://tools.sdc.yandex-team.ru/accounting-fleet-works*
// @match        https://forms.yandex-team.ru/surveys/154795*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/AutoFill.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/AutoFill.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =====================================================
    //  Заказ запчастей (форма 154795). Обрабатываем СРАЗУ и выходим,
    //  чтобы не выполнять панель и localStorage (в sandbox-iframe это упало бы).
    // =====================================================
    if (/\/surveys\/154795/.test(location.href)) {
        console.log('[AF] Режим формы заказа запчастей (154795) — ждём сообщение от родителя');

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
            try {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                setter.call(input, value);
            } catch (e) {}
            input.value = value;
            input.dispatchEvent(new Event('focus', { bubbles: true }));
            input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
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
        async function pickSuggest(input, value) {
            if (!input || !value) return false;
            setValue(input, value);
            return new Promise(resolve => {
                const t0 = Date.now();
                const iv = setInterval(() => {
                    const opts = [...document.querySelectorAll('[role="option"], li[role="option"], div[role="option"]')];
                    const target = opts.find(o => (o.textContent || '').trim().toLowerCase().includes(String(value).toLowerCase()));
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
        // Найти suggest-инпут по тексту вопроса (label), чтобы не спутать с полем локации.
        function findInputByQuestionLabel(textPart, timeout = 8000) {
            return new Promise(resolve => {
                const scan = () => {
                    for (const q of document.querySelectorAll('.Question')) {
                        const lbl = q.querySelector('.QuestionLabel, h3, .QuestionLayout-Label');
                        if (lbl && (lbl.textContent || '').toLowerCase().includes(String(textPart).toLowerCase())) {
                            const input = q.querySelector('input[role="combobox"], input[aria-label*="Для поиска"], input.g-text-input__control');
                            if (input) return input;
                        }
                    }
                    return null;
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
        async function setQuantityToOne() {
            const t0 = Date.now();
            return new Promise(resolve => {
                const iv = setInterval(() => {
                    const q = [...document.querySelectorAll('input[type="number"], input[inputmode="numeric"], input.g-text-input__control')]
                        .find(el => el.closest('.Question') && /количеств/i.test(el.closest('.Question').textContent));
                    if (q) {
                        clearInterval(iv);
                        setValue(q, '1');
                        resolve(true);
                    }
                    else if (Date.now() - t0 > 6000) { clearInterval(iv); resolve(false); }
                }, 300);
            });
        }

        async function runSpareOrderForm(locationName) {
            console.log('[AF] Заполняю форму заказа, локация =', locationName);
            try {
                // Стр.1: Локация + Статус робота + СК + Тип ТМЦ, кнопка «Далее»
                const locInput = await waitFor('#answer_wiki_9008987764243672', 12000);
                if (!locInput) { console.warn('[AF] Поле локации не найдено'); return; }
                const locPicked = await pickSuggest(locInput, locationName);
                console.log('[AF] Локация:', locPicked);
                await new Promise(r => setTimeout(r, 500));

                await pickOption('Не донор');   // Статус робота
                await new Promise(r => setTimeout(r, 300));
                await pickOption('Нет');        // Это СК?
                await new Promise(r => setTimeout(r, 300));
                await pickOption('Запчасти');   // Тип ТМЦ
                await new Promise(r => setTimeout(r, 400));

                // Далее: если кнопка есть — жмём (переход на стр.2 с Вики).
                const nextBtn = await waitForText('Далее', 4000);
                if (nextBtn) { clickEl(nextBtn); console.log('[AF] Нажали «Далее»'); await new Promise(r => setTimeout(r, 800)); }
                else { console.log('[AF] Кнопки «Далее» нет — форма одностраничная'); }

                // Стр.2: Вики (suggest «Жгут MIC Service branch») + Количество (=1).
                const wikiInput = await findInputByQuestionLabel('Вики', 8000);
                if (wikiInput) {
                    const picked = await pickSuggest(wikiInput, 'Жгут MIC Service branch');
                    console.log('[AF] Вики выбрана:', picked);
                } else {
                    console.warn('[AF] Поле «Вики» не найдено');
                }
                await new Promise(r => setTimeout(r, 400));
                await setQuantityToOne();

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
                runSpareOrderForm(d.payload.locationName);
            }
        });

        // Сценарий «новое окно»: Self_check открывает форму в отдельной вкладке
        // и передаёт локацию через GET-параметр st_location (надёжно, без гонок postMessage).
        const urlLoc = new URL(location.href).searchParams.get('st_location');
        if (urlLoc) {
            console.log('[AF] Запуск из открытого окна, локация =', urlLoc);
            if (formBusy) { console.warn('[AF] Форма уже заполняется, пропуск.'); }
            else {
                formBusy = true;
                runSpareOrderForm(urlLoc);
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
            <button class="acp-btn" data-action="ppr">ППР робота</button>
            <button class="acp-btn" data-action="microphone">Установка жгута микрофонов</button>
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
        'Тюмень': '1258671'
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
                                // Всегда отправляем комментарий
                                sendCommentToParent(commentText);

                                // Колбэк после сохранения (напр. команда заказа запчастей)
                                if (typeof onSaved === 'function') onSaved(saved);

                                // Переход статусов — ТОЛЬКО для Замена QR
                                if (action === 'stickers') {
                                    setTimeout(() => {
                                        window.parent.postMessage({
                                            type: 'ST_HELPER_TICKET_TRANSITION'
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

    panel.querySelectorAll('.acp-btn').forEach(btn => {
        btn.dataset.originalText = btn.textContent;
    });

    panel.addEventListener('click', e => {
        const btn = e.target.closest('.acp-btn');
        if (!btn) return;

        const action = btn.dataset.action;

        if (action === 'stickers') {
            doAction(btn, 'Замена наклеек', 'Замена наклеек', 'Наклеили новый QR', action);
        }
        if (action === 'ppr') {
            doAction(btn, 'ППР', 'ППР робота', 'Сделали ППР', action);
        }
        if (action === 'microphone') {
            // Сначала выбор локации заказа запчастей
            showLocationModal((locationName, locationId) => {
                doAction(btn, 'жгута микрофонов', 'Установка жгута микрофонов', 'Установили жгут микрофонов', action, () => {
                    window.parent.postMessage({
                        type: 'ST_HELPER_MICROPHONE_ORDER',
                        payload: {
                            locationName,
                            locationId
                        }
                    }, '*');
                });
            });
        }
    });
})();
