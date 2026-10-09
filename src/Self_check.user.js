// ==UserScript==
// @name         ST Ticket Self-Check
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Самопроверка + вставка формы учёта + автоотправка + центрирование
// @author       You
// @match        https://st.yandex-team.ru/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Self_check.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Self_check.user.js
// ==/UserScript==

(function () {
    'use strict';

    // === Создаём панель ===
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

    // Стили
    const style = document.createElement('style');
    style.textContent = `
        #st-self-check {
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 99999;
            background: #1f1f1f;
            color: #eee;
            border-radius: 10px;
            padding: 10px 14px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.35);
            min-width: 240px;
            user-select: none;
            cursor: move;
        }
        #st-self-check .sch-header {
            font-weight: 600;
            margin-bottom: 8px;
            font-size: 14px;
            opacity: 0.9;
        }
        #st-self-check .sch-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 6px 0;
        }
        #st-self-check .sch-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #666;
            flex-shrink: 0;
        }
        #st-self-check .sch-dot.ok {
            background: #22c55e;
        }
        #st-self-check .sch-dot.fail {
            background: #ef4444;
        }
        #st-self-check .sch-text {
            line-height: 1.3;
        }
        #st-self-check .sch-divider {
            height: 1px;
            background: #444;
            margin: 10px 0;
        }
        #st-self-check .sch-form {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        #st-self-check #sch-rover-input {
            width: 100%;
            height: 28px;
            padding: 0 8px;
            border-radius: 5px;
            border: 1px solid #555;
            background: #2a2a2a;
            color: #eee;
            font-size: 13px;
            outline: none;
            box-sizing: border-box;
        }
        #st-self-check #sch-rover-input:focus {
            border-color: #3b82f6;
        }
        #st-self-check #sch-insert-btn {
            height: 30px;
            border: none;
            border-radius: 5px;
            background: #3b82f6;
            color: white;
            font-size: 13px;
            cursor: pointer;
            transition: background 0.15s;
        }
        #st-self-check #sch-insert-btn:hover {
            background: #2563eb;
        }
        #st-self-check #sch-insert-btn:active {
            background: #1d4ed8;
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    // === Перетаскивание ===
    let isDragging = false;
    let offsetX, offsetY;

    panel.addEventListener('mousedown', (e) => {
        if (e.target.closest('.sch-item') || e.target.closest('.sch-form')) return;
        isDragging = true;
        offsetX = e.clientX - panel.getBoundingClientRect().left;
        offsetY = e.clientY - panel.getBoundingClientRect().top;
        panel.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        panel.style.left = (e.clientX - offsetX) + 'px';
        panel.style.top = (e.clientY - offsetY) + 'px';
        panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        panel.style.cursor = 'move';
    });

    // === Вспомогательные функции ===
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

        const comments = document.querySelectorAll('.comments article.comment');
        for (const comment of comments) {
            const authorEl = comment.querySelector('.comment-header__author a, .comment-header__author');
            if (!authorEl) continue;

            const author = authorEl.textContent.trim();
            if (author !== executor) continue;

            const textEl = comment.querySelector('.comment-view__text .yfm, .comment-view__text');
            if (!textEl) continue;

            const text = textEl.innerText.trim();
            const hasOnlyIframe = textEl.querySelector('iframe') && text.length < 10;

            if (text && !hasOnlyIframe) {
                return true;
            }
        }
        return false;
    }

    // Проверка наличия тикета SDCWH
    function checkSdcwhTicket() {
        // Ищем по классу issue-key__full-key
        const keys = document.querySelectorAll('.issue-key__full-key');
        for (const el of keys) {
            if (el.textContent.trim().startsWith('SDCWH-')) {
                return true;
            }
        }

        // Запасной вариант — поиск по тексту на всей странице
        const allText = document.body.innerText;
        return /SDCWH-\d+/i.test(allText);
    }

    function updateUI(okComponents, okComment, okSdcwh) {
        const compDot = document.querySelector('#sch-components .sch-dot');
        const commentDot = document.querySelector('#sch-comment .sch-dot');
        const sdcwhDot = document.querySelector('#sch-sdcwh .sch-dot');

        if (compDot) compDot.className = 'sch-dot ' + (okComponents ? 'ok' : 'fail');
        if (commentDot) commentDot.className = 'sch-dot ' + (okComment ? 'ok' : 'fail');
        if (sdcwhDot) sdcwhDot.className = 'sch-dot ' + (okSdcwh ? 'ok' : 'fail');
    }

    function fillRoverFromTicket() {
        const input = document.getElementById('sch-rover-input');
        if (!input || input.value.trim()) return;

        const rover = getFieldValue('Ровер');
        if (rover) {
            input.value = rover;
        }
    }

    function runCheck() {
        updateUI(
            checkComponents(),
            checkExecutorComment(),
            checkSdcwhTicket()
        );
        fillRoverFromTicket();
    }

    // === Вставка + отправка + центрирование ===
    function getTicketKey() {
        const match = location.pathname.match(/\/([A-Z0-9]+-\d+)/i);
        return match ? match[1] : null;
    }

    function clickSendButton() {
        const sendIcon = document.querySelector('.comment-editor__send-icon');
        if (sendIcon) {
            const btn = sendIcon.closest('button');
            if (btn) {
                btn.click();
                return true;
            }
        }

        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent.trim() === 'Отправить') {
                btn.click();
                return true;
            }
        }
        return false;
    }

    function scrollToNewComment() {
        setTimeout(() => {
            const comments = document.querySelectorAll('.comments article.comment');
            let target = null;

            for (let i = comments.length - 1; i >= 0; i--) {
                const comment = comments[i];
                if (comment.querySelector('iframe[src*="accounting-fleet-works"]') ||
                    comment.textContent.includes('accounting-fleet-works')) {
                    target = comment;
                    break;
                }
            }

            if (!target && comments.length) {
                target = comments[comments.length - 1];
            }

            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }
        }, 700);
    }

    function insertAccountingForm() {
        const roverInput = document.getElementById('sch-rover-input');
        let rover = roverInput.value.trim();

        if (!rover) {
            rover = getFieldValue('Ровер') || '';
            roverInput.value = rover;
        }

        const ticket = getTicketKey();

        if (!rover) {
            alert('Не найден номер ровера. Укажи его вручную.');
            return;
        }
        if (!ticket) {
            alert('Не удалось определить ключ тикета');
            return;
        }

        const iframeCode = `/iframe/(src="https://tools.sdc.yandex-team.ru/accounting-fleet-works?rover=${rover}&ticket=${ticket}&platform=robot_r3&event_id=" width="1000px" height="600px" frameborder="0")`;

        const selectors = [
            '.comment-form textarea',
            '.CommentEditor textarea',
            '[data-qa="comment-editor"] textarea',
            '.g-text-area__control',
            'textarea[placeholder*="комментарий" i]',
            'textarea[placeholder*="Comment" i]',
            '.ProseMirror',
            '[contenteditable="true"]'
        ];

        let inserted = false;

        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;

            if (el.tagName === 'TEXTAREA') {
                el.focus();
                el.value = (el.value ? el.value + '\n\n' : '') + iframeCode;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                inserted = true;
                break;
            }

            if (el.isContentEditable) {
                el.focus();
                document.execCommand('insertText', false, iframeCode);
                inserted = true;
                break;
            }
        }

        if (!inserted) {
            navigator.clipboard.writeText(iframeCode).then(() => {
                alert('Форма скопирована в буфер. Вставь вручную и нажми Отправить.');
            });
            return;
        }

        setTimeout(() => {
            const sent = clickSendButton();

            const btn = document.getElementById('sch-insert-btn');
            if (sent) {
                btn.textContent = 'Отправлено!';
                btn.style.background = '#22c55e';
                scrollToNewComment();
            } else {
                btn.textContent = 'Вставлено (нажми Отправить)';
                btn.style.background = '#f59e0b';
            }

            setTimeout(() => {
                btn.textContent = 'Вставить форму учёта';
                btn.style.background = '';
            }, 2000);
        }, 400);
    }

    document.getElementById('sch-insert-btn').addEventListener('click', insertAccountingForm);

    // === Запуск ===
    runCheck();
    setInterval(runCheck, 2000);

    const observer = new MutationObserver(() => runCheck());
    observer.observe(document.body, { childList: true, subtree: true });

    // === Приём сообщений из iframe формы учёта ===
window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'ST_HELPER_ADD_COMMENT') return;

    const text = event.data.text;
    if (!text) return;

    // Ищем редактор комментария
    const editor = document.querySelector('.ProseMirror.g-md-editor, .ProseMirror[contenteditable="true"]');
    if (!editor) {
        console.warn('Редактор комментария не найден');
        return;
    }

    editor.focus();

    // Очищаем и вставляем текст
    editor.innerHTML = '';
    document.execCommand('insertText', false, text);

    // Небольшая пауза и жмём "Отправить"
    setTimeout(() => {
        const sendIcon = document.querySelector('.comment-editor__send-icon');
        if (sendIcon) {
            const btn = sendIcon.closest('button');
            if (btn) btn.click();
            return;
        }

        // Запасной поиск
        for (const b of document.querySelectorAll('button')) {
            if (b.textContent.trim() === 'Отправить') {
                b.click();
                break;
            }
        }
    }, 400);
});
})();
