// ==UserScript==
// @name         ST Ticket Self-Check
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  Самопроверка + форма учёта + комментарии + переход статусов
// @author       You
// @match        https://st.yandex-team.ru/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Self_check.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Self_check.user.js
// ==/UserScript==

(function () {
    'use strict';

    // === Панель самопроверки ===
    const panel = document.createElement('div');
    panel.id = 'st-self-check';
    panel.innerHTML = `
        <div class="sch-header">Самопроверка</div>
        <div class="sch-item" id="sch-components">
            <span class="sch-dot"></span>
            <span class="sch-text">Компоненты: ROBOT / LOGS</span>
        </div>
        <div class="sch-item" id="sch-comment">
            <span class="sch-dot"></span>
            <span class="sch-text">Комментарий от исполнителя</span>
        </div>
        <div class="sch-item" id="sch-sdcwh">
            <span class="sch-dot"></span>
            <span class="sch-text">Тикет запчастей (SDCWH)</span>
        </div>
        <div class="sch-divider"></div>
        <div class="sch-form">
            <input id="sch-rover-input" type="text" placeholder="Rover ID" />
            <button id="sch-insert-btn">Вставить форму учёта</button>
        </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        #st-self-check {
            position: fixed; top: 80px; right: 20px; z-index: 99999;
            background: #1f1f1f; color: #eee; border-radius: 10px;
            padding: 10px 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px; box-shadow: 0 4px 20px rgba(0,0,0,0.35);
            min-width: 240px; user-select: none; cursor: move;
        }
        #st-self-check .sch-header { font-weight: 600; margin-bottom: 8px; font-size: 14px; opacity: 0.9; }
        #st-self-check .sch-item { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
        #st-self-check .sch-dot { width: 12px; height: 12px; border-radius: 50%; background: #666; flex-shrink: 0; }
        #st-self-check .sch-dot.ok { background: #22c55e; }
        #st-self-check .sch-dot.fail { background: #ef4444; }
        #st-self-check .sch-text { line-height: 1.3; }
        #st-self-check .sch-divider { height: 1px; background: #444; margin: 10px 0; }
        #st-self-check .sch-form { display: flex; flex-direction: column; gap: 6px; }
        #st-self-check #sch-rover-input {
            width: 100%; height: 28px; padding: 0 8px; border-radius: 5px;
            border: 1px solid #555; background: #2a2a2a; color: #eee; font-size: 13px; outline: none; box-sizing: border-box;
        }
        #st-self-check #sch-rover-input:focus { border-color: #3b82f6; }
        #st-self-check #sch-insert-btn {
            height: 30px; border: none; border-radius: 5px; background: #3b82f6; color: white; font-size: 13px; cursor: pointer;
        }
        #st-self-check #sch-insert-btn:hover { background: #2563eb; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    // Перетаскивание
    let isDragging = false, offsetX, offsetY;
    panel.addEventListener('mousedown', e => {
        if (e.target.closest('.sch-item, .sch-form')) return;
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
        isDragging = false;
        panel.style.cursor = 'move';
    });

    // === Проверки ===
    function getFieldValue(title) {
        const titleEl = document.querySelector(`.FieldView-Title[title="${title}"]`);
        if (!titleEl) return null;
        const container = titleEl.closest('.FieldView') || titleEl.parentElement;
        const bubble = container?.querySelector('.Bubble-Text');
        return bubble ? bubble.textContent.trim() : null;
    }

    function checkComponents() {
        const value = getFieldValue('Компоненты');
        if (!value) return false;
        const upper = value.toUpperCase();
        return upper.includes('ROBOT') || upper.includes('LOGS');
    }

    function checkExecutorComment() {
        const executor = getFieldValue('Исполнитель');
        if (!executor) return false;
        for (const comment of document.querySelectorAll('.comments article.comment')) {
            const authorEl = comment.querySelector('.comment-header__author a, .comment-header__author');
            if (!authorEl || authorEl.textContent.trim() !== executor) continue;
            const textEl = comment.querySelector('.comment-view__text .yfm, .comment-view__text');
            if (!textEl) continue;
            const text = textEl.innerText.trim();
            if (text && !(textEl.querySelector('iframe') && text.length < 10)) return true;
        }
        return false;
    }

    function checkSdcwhTicket() {
        for (const el of document.querySelectorAll('.issue-key__full-key')) {
            if (el.textContent.trim().startsWith('SDCWH-')) return true;
        }
        return /SDCWH-\d+/i.test(document.body.innerText);
    }

    function updateUI(ok1, ok2, ok3) {
        const set = (id, ok) => {
            const d = document.querySelector(`#${id} .sch-dot`);
            if (d) d.className = 'sch-dot ' + (ok ? 'ok' : 'fail');
        };
        set('sch-components', ok1);
        set('sch-comment', ok2);
        set('sch-sdcwh', ok3);
    }

    function fillRoverFromTicket() {
        const input = document.getElementById('sch-rover-input');
        if (!input || input.value.trim()) return;
        const rover = getFieldValue('Ровер');
        if (rover) input.value = rover;
    }

    function runCheck() {
        updateUI(checkComponents(), checkExecutorComment(), checkSdcwhTicket());
        fillRoverFromTicket();
    }

    // === Вставка формы учёта ===
    function getTicketKey() {
        const match = location.pathname.match(/\/([A-Z0-9]+-\d+)/i);
        return match ? match[1] : null;
    }

    function clickSendButton() {
        const icon = document.querySelector('.comment-editor__send-icon');
        if (icon) {
            const btn = icon.closest('button');
            if (btn) { btn.click(); return true; }
        }
        for (const btn of document.querySelectorAll('button')) {
            if (btn.textContent.trim() === 'Отправить') {
                btn.click(); return true;
            }
        }
        return false;
    }

    function scrollToNewComment() {
        setTimeout(() => {
            const comments = [...document.querySelectorAll('.comments article.comment')].reverse();
            const target = comments.find(c => c.querySelector('iframe[src*="accounting-fleet-works"]')) || comments[0];
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 700);
    }

    function insertAccountingForm() {
        const roverInput = document.getElementById('sch-rover-input');
        let rover = roverInput.value.trim() || getFieldValue('Ровер') || '';
        roverInput.value = rover;

        const ticket = getTicketKey();
        if (!rover) return alert('Не найден номер ровера');
        if (!ticket) return alert('Не удалось определить ключ тикета');

        const iframeCode = `/iframe/(src="https://tools.sdc.yandex-team.ru/accounting-fleet-works?rover=${rover}&ticket=${ticket}&platform=robot_r3&event_id=" width="1000px" height="600px" frameborder="0")`;

        const selectors = [
            '.comment-form textarea', '.CommentEditor textarea',
            '[data-qa="comment-editor"] textarea', '.g-text-area__control',
            'textarea[placeholder*="комментарий" i]', '.ProseMirror', '[contenteditable="true"]'
        ];

        let inserted = false;
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            if (el.tagName === 'TEXTAREA') {
                el.focus();
                el.value = (el.value ? el.value + '\n\n' : '') + iframeCode;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                inserted = true; break;
            }
            if (el.isContentEditable) {
                el.focus();
                document.execCommand('insertText', false, iframeCode);
                inserted = true; break;
            }
        }

        if (!inserted) {
            navigator.clipboard.writeText(iframeCode);
            return alert('Скопировано в буфер');
        }

        setTimeout(() => {
            const sent = clickSendButton();
            const btn = document.getElementById('sch-insert-btn');
            if (sent) {
                btn.textContent = 'Отправлено!';
                btn.style.background = '#22c55e';
                scrollToNewComment();
            } else {
                btn.textContent = 'Вставлено';
                btn.style.background = '#f59e0b';
            }
            setTimeout(() => {
                btn.textContent = 'Вставить форму учёта';
                btn.style.background = '';
            }, 2000);
        }, 400);
    }

    document.getElementById('sch-insert-btn').addEventListener('click', insertAccountingForm);

    runCheck();
    setInterval(runCheck, 2000);
    new MutationObserver(runCheck).observe(document.body, { childList: true, subtree: true });

    // =====================================================
    //  Вспомогательные функции для переходов
    // =====================================================

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function clickByText(text, timeout = 10000) {
        return new Promise(resolve => {
            const start = Date.now();
            const timer = setInterval(() => {
                for (const el of document.querySelectorAll('.g-button__text, button')) {
                    if (el.textContent.trim() === text) {
                        (el.closest('button') || el).click();
                        clearInterval(timer);
                        resolve(true);
                        return;
                    }
                }
                if (Date.now() - start > timeout) {
                    clearInterval(timer);
                    resolve(false);
                }
            }, 250);
        });
    }

    async function fillSuggest(labelText, value) {
        const labels = document.querySelectorAll('label.editable-field__label');
        let input = null;

        for (const label of labels) {
            if (label.textContent.trim() === labelText) {
                const field = label.closest('.editable-field, .screen-field');
                input = field?.querySelector('input[role="combobox"], input.g-text-input__control, input');
                if (input) break;
            }
        }

        if (!input) {
            console.warn('[ST Helper] Не найден input для', labelText);
            return false;
        }

        input.focus();
        input.click();

        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(200);

        // Ввод посимвольно
        for (const char of value) {
            nativeSetter.call(input, input.value + char);
            input.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                data: char,
                inputType: 'insertText'
            }));
            await sleep(40);
        }

        input.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(800);

        // Ищем подсказку по всей странице
        const candidates = document.querySelectorAll(
            '.g-label__content, .ToolsSuggest-ChosenContent, [class*="popup"] div, [class*="Suggest"] div, [class*="Menu"] div, li, span'
        );

        for (const el of candidates) {
            const text = el.textContent.trim();
            if (text === value || text.includes(value)) {
                el.click();
                console.log('[ST Helper] Выбрано:', text);
                await sleep(400);
                return true;
            }
        }

        // Для обычного текстового поля (Код дефекта)
        if (labelText === 'Код дефекта') {
            nativeSetter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        console.warn('[ST Helper] Подсказка не найдена для', value);
        return false;
    }

    async function runTicketTransition() {
        console.log('[ST Helper] Запуск перехода статусов (Замена QR)');

        // 1. Новый (если есть)
        await clickByText('Новый', 3000);
        await sleep(800);

        // 2. Передать механикам
        const toMechanics = await clickByText('Передать механикам', 6000);
        if (toMechanics) {
            await sleep(1500);

            let filled = await fillSuggest('Компоненты', 'ROBOT_BODY_SKIN');
            if (!filled) {
                await sleep(800);
                filled = await fillSuggest('Компоненты', 'ROBOT_BODY_SKIN');
            }

            await sleep(600);
            await clickByText('Продолжить');
            await sleep(1600);
        }

        // 3. Взять в работу
        await clickByText('Взять в работу', 6000);
        await sleep(1000);

        // 4. В проверку
        const toReview = await clickByText('В проверку', 6000);
        if (!toReview) {
            console.warn('Кнопка «В проверку» не найдена');
            return;
        }
        await sleep(1300);

        await fillSuggest('Компоненты', 'ROBOT_BODY_SKIN');
        await sleep(400);
        await fillSuggest('Способ решения', 'CHANGE');
        await sleep(400);

        await clickByText('Продолжить');
        await sleep(1600);

        // 5. Закрыть (нужный)
        await clickByText('Закрыть (нужный)', 6000);
        await sleep(1300);

        // 6. Финальный диалог — Код дефекта
        await fillSuggest('Код дефекта', '0');
        await sleep(400);

        await clickByText('Продолжить');
        console.log('[ST Helper] Переход статусов завершён');
    }

    // =====================================================
    //  Сообщения из iframe
    // =====================================================

    window.addEventListener('message', async (event) => {
        if (!event.data) return;

        // Комментарий
        if (event.data.type === 'ST_HELPER_ADD_COMMENT') {
            const text = event.data.text;
            if (!text) return;

            const editor = document.querySelector('.ProseMirror.g-md-editor, .ProseMirror[contenteditable="true"]');
            if (!editor) {
                console.warn('Редактор комментария не найден');
                return;
            }

            editor.focus();
            editor.innerHTML = '';
            document.execCommand('insertText', false, text);

            setTimeout(() => {
                const icon = document.querySelector('.comment-editor__send-icon');
                if (icon) {
                    icon.closest('button')?.click();
                } else {
                    clickByText('Отправить');
                }
            }, 400);
        }

        // Переход статусов (только от Замена QR)
        if (event.data.type === 'ST_HELPER_TICKET_TRANSITION') {
            await sleep(2000);
            await runTicketTransition();
        }
    });
})();