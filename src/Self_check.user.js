// ==UserScript==
// @name         ST Ticket Self-Check
// @namespace    http://tampermonkey.net/
// @version      5.10
// @description  Самопроверка + форма учёта + комментарии. Переходы/поля/резолюция — через API Stracker
// @author       You
// @match        https://st.yandex-team.ru/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      st-api.yandex-team.ru
// @connect      forms-api.yandex-team.ru
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Self_check.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Self_check.user.js
// ==/UserScript==


(function () {
    'use strict';


    // =====================================================
    //  Токен (окно при первом запуске, сохраняем)
    // =====================================================
    const TOKEN_STORE_KEY = 'st_token';
    const TOKEN_URL = 'https://oauth.yandex-team.ru/authorize?response_type=token&client_id=5f671d781aca402ab7460fde4050267b';


    let OAUTH_TOKEN = GM_getValue(TOKEN_STORE_KEY, '');


    function saveToken(token) {
        OAUTH_TOKEN = (token || '').trim();
        if (OAUTH_TOKEN) GM_setValue(TOKEN_STORE_KEY, OAUTH_TOKEN);
    }


    function showTokenModal() {
        if (document.getElementById('st-token-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'st-token-modal';
        modal.innerHTML = `
            <div class="sttm-box">
                <div class="sttm-title">Нужен OAuth-токен для API Stracker</div>
                <div class="sttm-text">Скрипт использует API Stracker для полей, переходов статусов и резолюции.<br/>Вставь свой токен ниже.</div>
                <a class="sttm-link" href="${TOKEN_URL}" target="_blank" rel="noopener">Получить токен</a>
                <input type="password" id="sttm-input" placeholder="Вставьте access_token..." autocomplete="off" />
                <div class="sttm-error"></div>
                <div class="sttm-actions">
                    <button id="sttm-save">Сохранить</button>
                    <button id="sttm-later">Позже</button>
                </div>
            </div>
        `;
        const st = document.createElement('style');
        st.textContent = `
            #st-token-modal { position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            #st-token-modal .sttm-box { background: #1f1f1f; color: #eee; border-radius: 12px; padding: 20px 22px; width: 420px; max-width: 90%; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
            #st-token-modal .sttm-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
            #st-token-modal .sttm-text { font-size: 13px; opacity: 0.85; line-height: 1.4; margin-bottom: 12px; }
            #st-token-modal .sttm-link { display: inline-block; margin-bottom: 12px; color: #4d9fff; text-decoration: none; font-size: 13px; }
            #st-token-modal .sttm-link:hover { text-decoration: underline; }
            #st-token-modal #sttm-input { width: 100%; height: 34px; padding: 0 10px; border-radius: 6px; box-sizing: border-box; border: 1px solid #555; background: #2a2a2a; color: #eee; font-size: 13px; outline: none; }
            #st-token-modal #sttm-input:focus { border-color: #3b82f6; }
            #st-token-modal .sttm-error { color: #ef4444; font-size: 12px; min-height: 16px; margin-top: 6px; }
            #st-token-modal .sttm-actions { display: flex; gap: 10px; margin-top: 10px; }
            #st-token-modal .sttm-actions button { flex: 1; height: 34px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; }
            #st-token-modal #sttm-save { background: #3b82f6; color: #fff; }
            #st-token-modal #sttm-save:hover { background: #2563eb; }
            #st-token-modal #sttm-later { background: #444; color: #ddd; }
            #st-token-modal #sttm-later:hover { background: #555; }
        `;
        document.head.appendChild(st);
        document.body.appendChild(modal);


        const input = modal.querySelector('#sttm-input');
        const errEl = modal.querySelector('.sttm-error');
        input.focus();
        modal.querySelector('#sttm-save').addEventListener('click', () => {
            const val = input.value.trim();
            if (!val) { errEl.textContent = 'Введите токен или нажмите «Получить токен».'; return; }
            if (!/^[A-Za-z0-9_\-.]+$/.test(val)) { errEl.textContent = 'Токен содержит недопустимые символы. Проверь вставку.'; return; }
            saveToken(val);
            modal.remove();
            console.log('[ST] Токен сохранён.');
        });
        modal.querySelector('#sttm-later').addEventListener('click', () => {
            modal.remove();
            console.warn('[ST] Токен не введён — API-функции не будут работать.');
        });
    }


    // =====================================================
    //  API Stracker
    // =====================================================
    function apiRequest(method, url, body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method, url,
                headers: { 'Authorization': 'OAuth ' + OAUTH_TOKEN, 'Content-Type': 'application/json' },
                data: body ? JSON.stringify(body) : undefined,
                onload: (r) => {
                    let json = null;
                    try { json = JSON.parse(r.responseText); } catch (e) {}
                    if (r.status >= 200 && r.status < 300) resolve({ status: r.status, data: json, text: r.responseText });
                    else reject({ status: r.status, data: json, text: r.responseText });
                },
                onerror: (e) => reject({ status: 'net', text: String(e) })
            });
        });
    }


    // =====================================================
    //  API Яндекс.Форм (заказ запчастей SDCWH)
    // =====================================================
    const FORMS_API_BASE = 'https://forms-api.yandex-team.ru/v3';
    const FORMS_SUGGEST = 'https://forms-api.yandex-team.ru/form/getSuggest';

    // Форма заказа запчастей 13693051 — обязательные поля (стр.1) и ряд «Вики+Количество» для жгута микрофона
    const SPARE_FORM = {
        formId: 13693051,
        wikiSerie: '1143780',                              // Серия ROBOT_ELECTRIC_WIRING
        qty: '1',
        wikiText: '3.9 Жгут MIC Service branch',           // Позиция Вики
        fields: {
            location: 'answer_wiki_9008987764243672',      // Локация (suggest)
            robotStatus: 'answer_one_answer_9008988226731508', // Статус (radio)
            isSC: 'answer_one_answer_9008988226019256',    // Это СК? (radio)
            materialType: 'answer_choices_1908101',        // Тип ТМЦ (radio)
            productSeries: 'answer_wiki_9008976633551088', // Серия (suggest)
            wikiQuestion: 'id-question-55449060',          // Вики (suggest, ряд жгута)
            qtyQuestion: 'id-question-55449058'            // Количество (ряд жгута)
        },
        enumValues: {
            notDonor: '1788972002689',
            no: '1788971284642',
            parts: '3179563'
        }
    };

    function formsApi(request) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: request.method, url: request.url,
                headers: Object.assign({ 'Authorization': 'OAuth ' + OAUTH_TOKEN, 'Content-Type': 'application/json' }, request.headers || {}),
                data: request.body ? JSON.stringify(request.body) : undefined,
                onload: (r) => {
                    let json = null;
                    try { json = JSON.parse(r.responseText); } catch (e) {}
                    if (r.status >= 200 && r.status < 300) resolve({ status: r.status, data: json, text: r.responseText });
                    else reject({ status: r.status, data: json, text: r.responseText });
                },
                onerror: (e) => reject({ status: 'net', text: String(e) })
            });
        });
    }

    // Поиск id Suggest-позиции по тексту (поле Вики в ряду серии)
    async function formsSuggest(question, text) {
        const r = await formsApi({
            method: 'POST',
            url: FORMS_SUGGEST,
            body: { question, text, parents: null, surveyId: SPARE_FORM.formId }
        });
        const arr = Array.isArray(r.data) ? r.data : (r.data && r.data.items) || [];
        return arr.find(x => x && x.id && x.text) || arr[0] || null;
    }


    // =====================================================
    //  Поля через API
    // =====================================================
    const COMPONENT_IDS = {
        'ROBOT_BODY_SKIN': 162077,
        'ROBOT_ELECTRIC_WIRING': 162067
    };
    const THE_DEFECT_CODE_FIELD = '60df26695151a36df681d67b--theDefectCode'; // Код дефекта


    async function setComponentApi(issueKey, component) {
        const value = component || 'ROBOT_BODY_SKIN';
        const id = COMPONENT_IDS[value];
        if (!id) { console.warn('[ST] Нет id для', value); return false; }
        try {
            await apiRequest('PATCH', `https://st-api.yandex-team.ru/v3/issues/${issueKey}`, { components: id });
            console.log('[ST] Компонент установлен:', value, '=', id);
            return true;
        } catch (e) {
            console.warn('[ST] PATCH компонента не прошёл:', e.status, String(e.text || '').slice(0, 300));
            return false;
        }
    }


    async function setSolutionViaApi(issueKey, method = 'CHANGE') {
        try {
            await apiRequest('PATCH', `https://st-api.yandex-team.ru/v3/issues/${issueKey}`, { solutionMethod: method });
            console.log('[ST] Способ решения установлен:', method);
            return true;
        } catch (e) {
            console.warn('[ST] PATCH solutionMethod не прошёл:', e.status, String(e.text || '').slice(0, 300));
            return false;
        }
    }


    async function setDefectCodeApi(issueKey, code = '0') {
        try {
            await apiRequest('PATCH', `https://st-api.yandex-team.ru/v3/issues/${issueKey}`, { [THE_DEFECT_CODE_FIELD]: code });
            console.log('[ST] Код дефекта установлен:', code);
            return true;
        } catch (e) {
            console.warn('[ST] PATCH кода дефекта не прошёл:', e.status, String(e.text || '').slice(0, 300));
            return false;
        }
    }


    // Итоговый комментарий через API (с подписью Платона)
    async function sendPostComment(issueKey, text) {
        const body = text + '\n\n---\nПлатон🧑🏽‍✈️';
        try {
            await apiRequest('POST', `https://st-api.yandex-team.ru/v3/issues/${issueKey}/comments`, { text: body });
            console.log('[ST] Итоговый комментарий отправлен:', text);
            return true;
        } catch (e) {
            console.warn('[ST] Комментарий не отправлен:', e.status, String(e.text || '').slice(0, 300));
            return false;
        }
    }


    // =====================================================
    //  Переходы: список → найти по id/display (RU/EN) → POST /_execute
    // =====================================================
    async function getTransitions(issueKey) {
        try {
            const r = await apiRequest('GET', `https://st-api.yandex-team.ru/v2/issues/${issueKey}/transitions`);
            return (r.data && Array.isArray(r.data)) ? r.data : [];
        } catch (e) {
            console.warn('[ST] GET transitions ошибка:', e.status, String(e.text || '').slice(0, 300));
            return [];
        }
    }


    // accept: список вариантов совпадения.
    // лучше всего передавать целевой СТАТУС по ключу (напр. 'treated', 'inProgress', 'check', 'closed'),
    // дополнительно можно перечислить имена переходов (ru/en display) и id транзишена.
    async function runTransition(issueKey, accept, timeoutMs = 10000, body) {
        if (!OAUTH_TOKEN) { showTokenModal(); return false; }
        const names = Array.isArray(accept) ? accept : [accept];
        const norm = s => String(s || '').trim().toLowerCase();
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const list = await getTransitions(issueKey);
            const t = list.find(x => {
                const id = norm(x.id);
                const display = norm(x.display);
                const toKey = norm(x.to && (x.to.key || x.to.id));
                return names.some(n => {
                    const v = norm(n);
                    return id === v || display === v || toKey === v;
                });
            });
            if (t) {
                const url = `https://st-api.yandex-team.ru/v3/issues/${issueKey}/transitions/${t.id}/_execute`;
                const toKey = t.to && (t.to.key || t.to.id);
                console.log('[ST] Переход ' + (toKey ? '-> ' + toKey : names[0]) + ' (display=' + t.display + ')');
                try {
                    await apiRequest('POST', url, body || undefined);
                    console.log('[ST] Переход выполнен ' + (toKey ? '-> ' + toKey : names[0]) + ' (display=' + t.display + ')');
                    return true;
                } catch (e) {
                    console.warn('[ST] Переход в ' + names[0] + ' не выполнен:', e.status, String(e.text || '').slice(0, 400));
                    return false;
                }
            }
            await sleep(600);
        }
        console.warn('[ST] Переход ' + names.join('/') + ' не найден за отведённое время.');
        return false;
    }


    // =====================================================
    //  Панель самопроверки
    // =====================================================
    const panel = document.createElement('div');
    panel.id = 'st-self-check';
    panel.innerHTML = `
        <div class="sch-header">
            <span>Самопроверка</span>
            <button class="sch-toggle" title="Свернуть">▾</button>
        </div>
        <div class="sch-body">
            <div class="sch-item" id="sch-components"><span class="sch-dot"></span><span class="sch-text">Компоненты: ROBOT / LOGS</span></div>
            <div class="sch-item" id="sch-comment"><span class="sch-dot"></span><span class="sch-text">Комментарий от исполнителя</span></div>
            <div class="sch-item" id="sch-sdcwh"><span class="sch-dot"></span><span class="sch-text">Тикет запчастей (SDCWH)</span></div>
            <div class="sch-divider"></div>
            <div class="sch-form">
                <input id="sch-rover-input" type="text" placeholder="Rover ID" />
                <button id="sch-insert-btn">Вставить форму учёта</button>
            </div>
        </div>
    `;


    const style = document.createElement('style');
    style.textContent = `
        #st-self-check { position: fixed; top: 80px; right: 20px; z-index: 99999; background: #1f1f1f; color: #eee; border-radius: 10px; padding: 10px 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; box-shadow: 0 4px 20px rgba(0,0,0,0.35); min-width: 240px; user-select: none; cursor: move; }
        #st-self-check .sch-header { font-weight: 600; margin-bottom: 8px; font-size: 14px; opacity: 0.9; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        #st-self-check .sch-toggle { background: none; border: none; color: #aaa; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px; line-height: 1; }
        #st-self-check .sch-toggle:hover { color: #fff; background: #333; }
        #st-self-check.collapsed .sch-body { display: none; }
        #st-self-check.collapsed { padding-bottom: 6px; }
        #st-self-check.collapsed .sch-header { margin-bottom: 0; }
        #st-self-check .sch-item { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
        #st-self-check .sch-dot { width: 12px; height: 12px; border-radius: 50%; background: #666; flex-shrink: 0; }
        #st-self-check .sch-dot.ok { background: #22c55e; }
        #st-self-check .sch-dot.fail { background: #ef4444; }
        #st-self-check .sch-text { line-height: 1.3; }
        #st-self-check .sch-divider { height: 1px; background: #444; margin: 10px 0; }
        #st-self-check .sch-form { display: flex; flex-direction: column; gap: 6px; }
        #st-self-check #sch-rover-input { width: 100%; height: 28px; padding: 0 8px; border-radius: 5px; border: 1px solid #555; background: #2a2a2a; color: #eee; font-size: 13px; outline: none; box-sizing: border-box; }
        #st-self-check #sch-rover-input:focus { border-color: #3b82f6; }
        #st-self-check #sch-insert-btn { height: 30px; border: none; border-radius: 5px; background: #3b82f6; color: white; font-size: 13px; cursor: pointer; }
        #st-self-check #sch-insert-btn:hover { background: #2563eb; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);


    let isDragging = false, offsetX, offsetY;
    panel.addEventListener('mousedown', e => {
        if (e.target.closest('.sch-item, .sch-form, .sch-toggle')) return;
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


    // Сворачивание панели (запоминаем состояние)
    const SCH_COLLAPSE_KEY = 'st-self-check-collapsed';
    function applySchCollapse(collapsed) {
        panel.classList.toggle('collapsed', collapsed);
        const toggle = panel.querySelector('.sch-toggle');
        toggle.textContent = collapsed ? '▸' : '▾';
        toggle.title = collapsed ? 'Развернуть' : 'Свернуть';
        if (collapsed) panel.style.width = panel.getBoundingClientRect().width + 'px';
        else panel.style.width = '';
    }
    if (localStorage.getItem(SCH_COLLAPSE_KEY) === '1') applySchCollapse(true);
    panel.querySelector('.sch-toggle').addEventListener('click', e => {
        e.stopPropagation();
        const collapsed = !panel.classList.contains('collapsed');
        applySchCollapse(collapsed);
        localStorage.setItem(SCH_COLLAPSE_KEY, collapsed ? '1' : '0');
    });


    // =====================================================
    //  Проверки
    // =====================================================
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


    // =====================================================
    //  Вставка формы учёта (без изменений)
    // =====================================================
    function getTicketKey() {
        const m = location.pathname.match(/\/([A-Z0-9]+-\d+)/i);
        return m ? m[1] : null;
    }


    function clickSendButton() {
        const icon = document.querySelector('.comment-editor__send-icon');
        if (icon) { const btn = icon?.closest('button'); if (btn) { btn.click(); return true; } }
        for (const btn of document.querySelectorAll('button')) {
            if (btn.textContent.trim() === 'Отправить') { btn.click(); return true; }
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


    if (!OAUTH_TOKEN) setTimeout(showTokenModal, 500);


    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


    // =====================================================
    //  Уведомления и таймер
    // =====================================================
    function showToast(message, duration = 6000) {
        let toast = document.getElementById('st-helper-toast');
        const st = document.createElement('style');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'st-helper-toast';
            st.textContent = `#st-helper-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:999999;background:#1f1f1f;color:#eee;padding:12px 18px;border-radius:8px;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .25s;pointer-events:none;max-width:80vw;text-align:center}`;
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


    // =====================================================
    //  Заказ запчастей жгута микрофона (SDCWH через Forms API)
    //  Надёжный способ: НЕ лезем в DOM iframe, а читаем его src (там
    //  surveyId + уже подставленные скрытые answer_* поля тикета)
    //  и отправляем форму напрямую через Forms API из родителя.
    // =====================================================

    // Ждём iframe формы и вытаскиваем из его src surveyId + ВСЕ параметры prefill.
    // Важно: кроме answer_* там есть скрытые поля привязки к тикету (issue_key, rover,
    // model_objeckt, event_Id и т.п.) — без них форма не создаст тикет SDCWH.
    async function getOrderIframeData(timeoutMs = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const frame = [...document.querySelectorAll('iframe[src*="/surveys/"]')].pop();
            if (frame && frame.src) {
                try {
                    const u = new URL(frame.src);
                    const m = u.pathname.match(/\/surveys\/(\d+)/);
                    if (m) {
                        const prefill = {};
                        u.searchParams.forEach((v, k) => {
                            if (k === 'iframe') return; // служебный, не поле формы
                            prefill[k] = v;
                        });
                        // Сервер формы отдаёт контент ТОЛЬКО в iframe-режиме:
                        // без параметра iframe=1 ссылка «недоступна». Поэтому
                        // используем src КАК ЕСТЬ, лишь добавляя st_location.
                        return { surveyId: m[1], prefill, openUrl: u.href };
                    }
                } catch (e) { console.warn('[ST] Не распарсил src iframe:', e); }
            }
            await sleep(700);
        }
        return null;
    }

    // Ждём подтверждение от AutoFill, что форма в новом окне заполнена и отправлена.
    function waitForOrderWindow(timeoutMs = 60000) {
        return new Promise(resolve => {
            const t0 = Date.now();
            const onMsg = ev => {
                const d = ev.data || {};
                if (d && d.type === 'AF_ORDER_DONE') {
                    window.removeEventListener('message', onMsg);
                    clearInterval(iv);
                    resolve(true);
                }
            };
            window.addEventListener('message', onMsg);
            const iv = setInterval(() => {
                if (Date.now() - t0 > timeoutMs) {
                    window.removeEventListener('message', onMsg);
                    clearInterval(iv);
                    resolve(false);
                }
            }, 500);
        });
    }

    async function runMicrophoneOrder(locationName, locationId, issueKey) {
        if (!OAUTH_TOKEN) { showTokenModal(); return; }
        if (!issueKey) { console.warn('[ST] Тикет не определён для заказа жгута'); showToast('Не определён тикет'); return; }

        try {
            // 0. «Обработан» — по скиллу: компонент + дедлайн, затем переход.
            //    Только после этого на родителе появляется кнопка «Заказать запчасти».
            console.log('[ST] Жгут микрофона: Обработан (компонент+дедлайн)');
            try {
                const today = new Date().toISOString().slice(0, 10);
                await apiRequest('PATCH', `https://st-api.yandex-team.ru/v3/issues/${issueKey}`, {
                    components: COMPONENT_IDS['ROBOT_ELECTRIC_WIRING'],
                    deadline: today
                });
            } catch (e) {
                console.warn('[ST] PATCH компонента/дедлайна не прошёл:', e.status, String(e.text || '').slice(0, 300));
            }
            const okTreated = await runTransition(issueKey, 'treated', 8000);
            console.log('[ST] Переход в «Обработан»: ' + (okTreated ? 'выполнен' : 'не найден'));
            await sleep(1500);

            // 0.1 Переход «Заказать запчасти» (treated -> delieveryWaiting) открывает в комментарии iframe формы заказа
            const okOrder = await runTransition(issueKey, 'delieveryWaiting', 15000);
            console.log('[ST] Переход «Заказать запчасти»: ' + (okOrder ? 'выполнен' : 'не найден'));
            await sleep(2000);

            // 1. Ждём iframe формы и читаем из его src полный URL (без sandbox-метки)
            //    для открытия формы в НОВОМ ОКНЕ. В новом окне AutoFill-скрипт работает
            //    как обычный userscript и заполняет форму надёжно (DOM как на любом сайте).
            const orderData = await getOrderIframeData(30000);
            if (!orderData) { showToast('Форма заказа не появилась', 7000); return; }
            console.log('[ST] Форма заказа: openUrl', orderData.openUrl);

            // Передаём локацию через GET-параметр st_location (без гонок postMessage).
            const openUrl = new URL(orderData.openUrl);
            openUrl.searchParams.set('st_location', locationName);
            openUrl.searchParams.set('st_location_id', locationId || '');

            // Открываем в новом окне и ждём подтверждение AF_ORDER_DONE от AutoFill.
            const win = window.open(openUrl.href, '_blank');
            if (!win) { showToast('Браузер заблокировал новое окно формы', 7000); return; }
            showToast('Форма заказа открыта в новом окне…', 4000);

            const done = await waitForOrderWindow(60000);
            if (!done) {
                console.warn('[ST] Окно формы не подтвердило отправку (таймаут)');
                showToast('Форма: не дождались отправки', 7000);
                return;
            }
            console.log('[ST] Форма заказа заполнена и отправлена в окне');
            showToast('Заказ запчастей создан', 4000);

            // 5. Далее статусы: «Ожидание поставки» → «Обработан» → «В работе» → «Проверка» → «Закрыт» + итоговый комментарий
            await sleep(1500);
            await runTransition(issueKey, 'treated');        // delieveryWaiting -> treated (вернулись из Ожидания поставки)
            await runTransition(issueKey, 'inProgress');     // treated -> inProgress (Взять в работу)
            await setSolutionViaApi(issueKey, 'CHANGE');
            await runTransition(issueKey, 'check');
            await setDefectCodeApi(issueKey, '0');
            await runTransition(issueKey, ['closed', 'closedMeta'], 10000, { resolution: 'fixed' });
            showToast('Жгут микрофона: готово', 7000);
        } catch (e) {
            console.warn('[ST] Ошибка заказа запчастей:', e.status, String(e.text || '').slice(0, 500));
            showToast('Не удалось создать заказ запчастей: ' + String(e.status || 'err'), 7000);
        }
    }

    // =====================================================
    //  Полный переход статусов — через API (Замена QR)
    // =====================================================
    async function runTicketTransition(startedAt) {
        startedAt = startedAt || Date.now();
        console.log('[ST Helper] Переход статусов (Замена QR) — через API');
        const issueKey = getTicketKey();
        if (!issueKey) { console.warn('[ST] Тикет не определён'); return; }
        if (!OAUTH_TOKEN) { showTokenModal(); return; }

        // 0. Если не в «Новом» — переводим туда (если уже в Новом, перехода нет, идём дальше)
        await runTransition(issueKey, 'new', 1500);

        // 1. Компонент
        await setComponentApi(issueKey, 'ROBOT_BODY_SKIN');

        // 2. Обработан (Передать механикам)
        await runTransition(issueKey, 'treated');
        // 3. В работе (Взять в работу)
        await runTransition(issueKey, 'inProgress');
        // 4. Способ решения
        await setSolutionViaApi(issueKey, 'CHANGE');
        // 5. В проверку (ключ по памяти проекта — check2)
        await runTransition(issueKey, ['check2', 'check']);
        // 6. Код дефекта
        await setDefectCodeApi(issueKey, '0');
        // 7. Закрыть: всегда с резолюцией fixed. Ищем «Закрыть(нужный)» (closed/closedMeta),
        //    если его нет — берём обычный «Закрыть», но резолюцию всё равно ставим.
        //    Только если сам POST с резолюцией не принимается — повторяем без неё.
        const closedWithRes = await runTransition(issueKey, ['closed', 'closedMeta'], 10000, { resolution: 'fixed' });
        if (!closedWithRes) {
            console.warn('[ST] Ключ закрытия с резолюцией не найден/не прошёл — пробуем без резолюции');
            await runTransition(issueKey, ['closed', 'closedMeta'], 10000);
        }


        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log('[ST Helper] Переход статусов завершён за ' + elapsedSec + ' сек');
        showToast('Замена QR: готово за ' + elapsedSec + ' сек', 7000);
    }


    // =====================================================
    //  Сообщения из iframe
    // =====================================================
    window.addEventListener('message', async (event) => {
        if (!event.data) return;


        if (event.data.type === 'ST_HELPER_ADD_COMMENT') {
            const text = event.data.text;
            if (!text) return;
            const editor = document.querySelector('.ProseMirror.g-md-editor, .ProseMirror[contenteditable="true"]');
            if (!editor) { console.warn('Редактор комментария не найден'); return; }
            editor.focus();
            editor.innerHTML = '';
            document.execCommand('insertText', false, text);
            setTimeout(() => {
                const icon = document.querySelector('.comment-editor__send-icon');
                if (icon) { icon.closest('button')?.click(); }
                else { clickByText('Отправить'); }
            }, 400);
        }


        if (event.data.type === 'ST_HELPER_TICKET_TRANSITION') {
            const startedAt = Date.now();
            await sleep(2000);
            await runTicketTransition(startedAt);
        }

        if (event.data.type === 'ST_HELPER_MICROPHONE_ORDER') {
            await sleep(1000);
            const p = (event.data.payload || {});
            await runMicrophoneOrder(p.locationName, p.locationId, getTicketKey());
        }
    });


    function clickByText(text, timeout = 10000) {
        return new Promise(resolve => {
            const start = Date.now();
            const timer = setInterval(() => {
                for (const el of document.querySelectorAll('.g-button__text, button')) {
                    if (el.textContent.trim() === text) {
                        (el.closest('button') || el).click();
                        clearInterval(timer); resolve(true); return;
                    }
                }
                if (Date.now() - start > timeout) { clearInterval(timer); resolve(false); }
            }, 250);
        });
    }
})();