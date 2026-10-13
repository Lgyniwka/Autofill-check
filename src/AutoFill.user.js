// ==UserScript==
// @name         Accounting Form AutoFill
// @namespace    https://github.com/Lgyniwka/Autofill-check
// @version      2.0
// @description  Плавающая панель + отправка комментария + переход статусов только для Замена QR
// @author       You
// @match        https://tools.sdc.yandex-team.ru/accounting-fleet-works*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/AutoFill.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/AutoFill.user.js
// ==/UserScript==

(function () {
    'use strict';

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

    // Позиция: панель появляется по центру видимой области (iframe)
    function centerPanel() {
        const w = panel.offsetWidth;
        const h = panel.offsetHeight;
        panel.style.left = Math.max(0, Math.round((window.innerWidth - w) / 2)) + 'px';
        panel.style.top = Math.max(0, Math.round((window.innerHeight - h) / 2)) + 'px';
        panel.style.right = 'auto';
    }
    centerPanel();

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