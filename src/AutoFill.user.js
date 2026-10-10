// ==UserScript==
// @name         Accounting Form AutoFill
// @namespace    https://github.com/Lgyniwka/Autofill-check
// @version      1.6
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

    const panel = document.createElement('div');
    panel.id = 'accounting-actions-panel';
    panel.innerHTML = `
        <div class="acp-header">Действия</div>
        <button class="acp-btn" data-action="stickers">Замена QR</button>
        <button class="acp-btn" data-action="ppr">ППР робота</button>
        <button class="acp-btn" data-action="microphone">Установка жгута микрофонов</button>
    `;

    const style = document.createElement('style');
    style.textContent = `
        #accounting-actions-panel {
            position: fixed; top: 20px; right: 20px; z-index: 99999;
            background: #1f1f1f; color: #eee; border-radius: 10px;
            padding: 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px; box-shadow: 0 4px 20px rgba(0,0,0,0.35);
            min-width: 210px; user-select: none; cursor: move;
        }
        #accounting-actions-panel .acp-header { font-weight: 600; margin-bottom: 8px; opacity: 0.9; cursor: move; }
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

    // Позиция
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved?.left != null) {
            panel.style.left = saved.left + 'px';
            panel.style.top = saved.top + 'px';
            panel.style.right = 'auto';
        }
    } catch (e) {}

    let isDragging = false, offsetX, offsetY;
    panel.addEventListener('mousedown', e => {
        if (e.target.classList.contains('acp-btn')) return;
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

    function doAction(btn, searchText, matchText, commentText, action) {
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
            doAction(btn, 'жгута микрофонов', 'Установка жгута микрофонов', 'Установили жгут микрофонов', action);
        }
    });
})();