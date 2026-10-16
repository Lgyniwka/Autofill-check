// ==UserScript==
// @name         ST Ticket Self-Check
// @namespace    http://tampermonkey.net/
// @version      5.32
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
        'ROBOT_ELECTRIC_WIRING': 162067,
        'ROBOT_MIM': 95074,
        'ROBOT_CALIBRATION_CHECK': 181463,
        'SOFTWARE_LOGS': 116228
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


    // Итоговый комментарий через API
    async function sendPostComment(issueKey, text) {
        const body = text;
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
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const list = await getTransitions(issueKey);
            const norm = s => String(s || '').trim().toLowerCase();
            const match = (x, v) => {
                const n = norm(v);
                return norm(x.id) === n || norm(x.display) === n || norm(x.to && (x.to.key || x.to.id)) === n;
            };
            // ВАЖНО: имена принимаются в порядке приоритета — если несколько
            // переходов ведут в один статус (например, в 'treated' ведут и
            // «Передать электрикам», и «Передать механикам»), берём первое
            // совпавшее ИМЯ, а не первый попавшийся переход из списка.
            let t = null;
            for (const n of names) {
                t = list.find(x => match(x, n));
                if (t) break;
            }
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

    // Подписи пресетов = текст на кнопке AutoFill-панели
    const PRESET_LABELS = {
        mic: 'Установка жгута микрофонов',
        battery: 'Замена коннекторов АКБ',
        batteryCon: 'Замена жгута АКБ + КОН.',
        leafSprings: 'Замена рессор',
        flag: 'Замена флажка'
    };

    // Компонент главного тикета по пресету заказа запчастей
    const PRESET_COMPONENTS = {
        mic: 162067,                 // ROBOT_ELECTRIC_WIRING
        battery: 162067,
        batteryCon: 162067,
        leafSprings: 94651,          // ROBOT_SUSPENSION
        flag: 94609                  // ROBOT_BODY_FLAG
    };

    // Тег Startrek-тикета по пресету (добавляется через API, не затирает
    // существующие — POST /tags/_add, а не PATCH)
    const PRESET_TAGS = {
        leafSprings: 'speed_one'
    };

    // Код дефекта по умолчанию по пресету (если не передан с панели)
    const PRESET_DEFECTS = {
        flag: 'BD-02'
    };

    // Добавить тег тикету и вернуть итоговый список. Эндпоинта
    // /v3/.../tags/_add НЕ СУЩЕСТВУЕТ (404) — v3 меняет теги только PATCH'ем
    // (полная замена массива). PATCH с полем version API не принимает
    // («Field [version] was not found») — делаем read-modify-write.
    // Гонка не страшна: Meh добавляется триггером перехода «Обработан»,
    // который выполняется ПОСЛЕ постановки тега.
    async function addTicketTag(issueKey, tag) {
        let current = [];
        try {
            const r = await apiRequest('GET', `https://st-api.yandex-team.ru/v3/issues/${issueKey}?fields=tags`);
            if (r.data && Array.isArray(r.data.tags)) current = [...r.data.tags];
        } catch (e) {
            console.warn('[ST] GET тегов не прошёл:', e.status, String(e.text || '').slice(0, 300));
            return [];
        }
        if (current.includes(tag)) return current;
        try {
            await apiRequest('PATCH', `https://st-api.yandex-team.ru/v3/issues/${issueKey}`, { tags: [...current, tag] });
            const rv = await apiRequest('GET', `https://st-api.yandex-team.ru/v3/issues/${issueKey}?fields=tags`);
            return (rv.data && rv.data.tags) || [];
        } catch (e) {
            console.warn('[ST] PATCH тегов не прошёл:', e.status, String(e.text || '').slice(0, 300));
            throw e;
        }
    }

    async function runMicrophoneOrder(locationName, locationId, issueKey, preset, startedAt, quantity, opts) {
        startedAt = startedAt || Date.now();
        preset = preset || 'mic';
        opts = opts || {};
        const presetLabel = PRESET_LABELS[preset] || preset;
        if (opts.isBlocker) console.log('[ST] Блокер: пока флоу без изменений; закрытие тикета на осмотр — TODO');
        if (!OAUTH_TOKEN) { showTokenModal(); return; }
        if (!issueKey) { console.warn('[ST] Тикет не определён для заказа жгута'); showToast('Не определён тикет'); return; }

        try {
            // 0. «Обработан» — по скиллу: компонент + дедлайн, затем переход.
            //    Только после этого на родителе появляется кнопка «Заказать запчасти».
            console.log(`[ST] ${presetLabel}: Обработан (компонент+дедлайн)`);
            try {
                const today = new Date().toISOString().slice(0, 10);
                await apiRequest('PATCH', `https://st-api.yandex-team.ru/v3/issues/${issueKey}`, {
                    components: PRESET_COMPONENTS[preset] || COMPONENT_IDS['ROBOT_ELECTRIC_WIRING'],
                    deadline: today
                });
            } catch (e) {
                console.warn('[ST] PATCH компонента/дедлайна не прошёл:', e.status, String(e.text || '').slice(0, 300));
            }
            // Тег пресета (рессоры → speed_one): Startrek-тикет, поле «Теги»
            // в «Параметрах». Ставим ДО перехода «Обработан».
            const presetTag = PRESET_TAGS[preset];
            if (presetTag) {
                try {
                    const tagsNow = await addTicketTag(issueKey, presetTag);
                    if (tagsNow.includes(presetTag)) console.log('[ST] Тег добавлен и подтверждён:', presetTag, '| все теги:', tagsNow);
                    else console.warn('[ST] Тег НЕ виден после добавления. Текущие теги:', tagsNow);
                } catch (e) {
                    console.warn('[ST] Добавление тега не прошло:', e.status, String(e.text || '').slice(0, 300));
                }
            }
            const okTreated = await runTransition(issueKey, ['передать механикам', 'treated'], 8000);
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
            openUrl.searchParams.set('st_preset', preset);
            if (quantity) openUrl.searchParams.set('st_qty', String(quantity));

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
            await runTransition(issueKey, ['передать механикам', 'treated']);        // delieveryWaiting -> treated (вернулись из Ожидания поставки)
            await runTransition(issueKey, 'inProgress');     // treated -> inProgress (Взять в работу)
            await setSolutionViaApi(issueKey, 'CHANGE');
            await runTransition(issueKey, 'check');
            // Код дефекта: с панели (рессоры CH-01..CH-05), из PRESET_DEFECTS
            // (флажок BD-02) или '0'
            await setDefectCodeApi(issueKey, opts.defectCode ? opts.defectCode.split(' - ')[0] : (PRESET_DEFECTS[preset] || '0'));
            // Блокер (рессоры): тикет НЕ закрываем — финальный шаг пользователь
            // прожимает сам.
            if (opts.isBlocker) {
                console.log('[ST] Блокер: остановка перед закрытием — закрывает пользователь');
                showToast(presetLabel + ': блокер — закрой тикет вручную', 7000);
                return;
            }
            await runTransition(issueKey, ['closed', 'closedMeta'], 10000, { resolution: 'fixed' });
            const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
            showToast(presetLabel + ': закрыт за ' + elapsedSec + ' сек', 7000);
        } catch (e) {
            console.warn('[ST] Ошибка заказа запчастей:', e && (e.stack || e.message || e), e.status || '', String(e.text || '').slice(0, 300));
            showToast('Не удалось создать заказ запчастей: ' + String(e && (e.status || e.message) || 'err'), 7000);
        }
    }

    // =====================================================
    //  ППР: форма осмотра в новом окне + авто-закрытие подтикета
    //  «Проверить калибровки» + статусный пресет главного тикета.
    //  Перенос из standalone PPR Fast Fill (v0.48).
    //  Важно для калибровок: код дефекта НЕ ставим, резолюцию и
    //  исполнителя проставляет автоматизация SDCFLEETOPS Calibration
    //  (W32458) при закрытии — закрываем БЕЗ резолюции.
    // =====================================================
    const PPR_FORM_URL = 'https://forms.yandex-team.ru/ext/surveys/13691922/';
    const PPR_CALIB = {
        COMPONENT_ID: 181463,      // ROBOT_CALIBRATION_CHECK
        SOLUTION: 'CONFIG',
        COMMENT: 'Проверили калибровки'
    };

    // Фото из AutoFill (base64) — держим в памяти until рукопожатия с окном формы
    let pprPhoto = null;
    // Резолвер ожидания AF_PPR_DONE от окна формы
    let pprDoneResolve = null;

    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // Логин текущего пользователя (alt аватарок на странице тикета)
    function currentLogin() {
        const found = [...document.querySelectorAll('img[alt]')]
            .map(im => (im.getAttribute('alt') || '').trim())
            .find(a => /^[a-z0-9][a-z0-9._-]{1,30}$/i.test(a));
        return found || 'lgynivvka';
    }

    // Ждём подтикет «Проверить калибровки» по связям родительского тикета
    // (форма создаёт его не сразу после сабмита).
    async function findCalibrationSubticket(mainKey, timeoutMs = 60000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const r = await apiRequest('GET', `https://st-api.yandex-team.ru/v2/issues/${mainKey}/links`);
                const links = (r.data && r.data.links) || (Array.isArray(r.data) ? r.data : []) || [];
                for (const ln of links) {
                    const obj = ln.object || ln.issue || null;
                    if (!obj || !obj.key) continue;
                    const summary = (obj.summary || obj.display || '');
                    if (/Проверить калибровк/i.test(summary)) return obj.key;
                }
            } catch (e) {}
            await sleep(3000);
        }
        return null;
    }

    // АВТО-оформление работы подтикета: скрытый iframe страницы учёта
    // (?st_autowork=calibration). AutoFill сам выбирает «Проверка
    // калибровок», сохраняет и шлёт AF_CALIB_WORK_DONE.
    function doCalibWorkInHiddenIframe(calibKey, rover, timeoutMs = 90000) {
        return new Promise(resolve => {
            const url = 'https://tools.sdc.yandex-team.ru/accounting-fleet-works?rover='
                + encodeURIComponent(rover) + '&ticket=' + encodeURIComponent(calibKey)
                + '&platform=robot_r3&event_id=&st_autowork=calibration';
            const fr = document.createElement('iframe');
            fr.src = url;
            fr.style.cssText = 'position:fixed;right:-10000px;bottom:-10000px;width:900px;height:700px;border:0;opacity:0;pointer-events:none;';
            document.body.appendChild(fr);
            const t0 = Date.now();
            const onMsg = ev => {
                const d = ev.data || {};
                if (d.type === 'AF_CALIB_WORK_DONE') {
                    cleanup();
                    resolve(true);
                }
            };
            const cleanup = () => {
                window.removeEventListener('message', onMsg);
                clearInterval(iv);
                setTimeout(() => { try { fr.remove(); } catch (e) {} }, 3000);
            };
            window.addEventListener('message', onMsg);
            const iv = setInterval(() => {
                if (Date.now() - t0 > timeoutMs) { cleanup(); resolve(false); }
            }, 500);
        });
    }

    async function closeCalibrationSubticket(mainKey, rover) {
        if (!OAUTH_TOKEN) { showTokenModal(); return; }
        console.log('[ST] ППР: ищу подтикет «Проверить калибровки»…');
        showToast('ППР: ищу подтикет калибровок…', 4000);
        const calibKey = await findCalibrationSubticket(mainKey, 60000);
        if (!calibKey) {
            console.warn('[ST] Не найден подтикет «Проверить калибровки»');
            showToast('Не найден подтикет «Проверить калибровки»', 7000);
            return;
        }
        console.log('[ST] Подтикет калибровок: ' + calibKey);

        // Компонент + дедлайн + способ решения («В работе» требует Компоненты и Дедлайн)
        try {
            await apiRequest('PATCH', `https://st-api.yandex-team.ru/v3/issues/${calibKey}`,
                { components: PPR_CALIB.COMPONENT_ID, deadline: todayStr(), solutionMethod: PPR_CALIB.SOLUTION });
            console.log('[ST] Калибровки: компонент/дедлайн/способ проставлены');
        } catch (e) {
            console.warn('[ST] PATCH полей калибровок не прошёл:', e.status, String(e.text || '').slice(0, 300));
        }

        // 1. В работе (body дублирует обязательные поля перехода — как в UI-диалоге)
        await runTransition(calibKey, ['inProgress', 'В работе'], 10000, { components: PPR_CALIB.COMPONENT_ID, deadline: todayStr() });
        await sleep(300);

        // 2. Форма учёта работ — макрос /iframe/ комментарием (визуально в тикете)
        const iframeMacro = `/iframe/(src="https://tools.sdc.yandex-team.ru/accounting-fleet-works?rover=${rover}&ticket=${calibKey}&platform=robot_r3&event_id=" width="1000px" height="600px" frameborder="0")`;
        try {
            await apiRequest('POST', `https://st-api.yandex-team.ru/v2/issues/${calibKey}/comments`, { text: iframeMacro });
            console.log('[ST] Калибровки: форма учёта вставлена');
        } catch (e) {}

        // 2.1 АВТО-оформление работы «Проверка калибровок»: открываем страницу
        //     учёта скрытым iframe с st_autowork=calibration — AutoFill сам
        //     выбирает работу и сохраняет (SDGWORKS). Без оформленной работы
        //     тикет калибровок не закрывается.
        const workDone = await doCalibWorkInHiddenIframe(calibKey, rover, 90000);
        if (!workDone) {
            console.warn('[ST] Калибровки: работа не оформлена автоматически');
            showToast('Калибровки: работа не оформлена — оформи вручную, иначе тикет не закроется', 8000);
        }

        // 3. Комментарий «Проверили калибровки»
        try {
            await apiRequest('POST', `https://st-api.yandex-team.ru/v2/issues/${calibKey}/comments`,
                { text: PPR_CALIB.COMMENT });
        } catch (e) {}

        // 4. Проверка (validation)
        await runTransition(calibKey, ['validation', 'Проверка']);
        await sleep(300);

        // 5. Закрыть: матчится по КЛЮЧУ целевого статуса (to.key = closed),
        // не по display. Резолюция в body обязательна (422 без неё).
        let okClose = await runTransition(calibKey, ['closed', 'closedMeta'], 10000, { resolution: 'fixed' });
        showToast('Калибровки закрыты: ' + calibKey + (okClose ? '' : ' (переход не прошёл — проверь вручную)'), 7000);
    }

    // Ждём AF_PPR_DONE от окна формы (форма большая — даём 4 минуты)
    function waitForPprDone(timeoutMs = 240000) {
        return new Promise(resolve => {
            const t0 = Date.now();
            pprDoneResolve = () => { clearInterval(iv); pprDoneResolve = null; resolve(true); };
            const iv = setInterval(() => {
                if (Date.now() - t0 > timeoutMs) {
                    clearInterval(iv);
                    pprDoneResolve = null;
                    resolve(false);
                }
            }, 500);
        });
    }

    async function runPprOrder(payload) {
        const startedAt = (payload && payload.startedAt) || Date.now();
        const issueKey = getTicketKey();
        if (!issueKey) { showToast('Не определён тикет'); return; }
        if (!OAUTH_TOKEN) { showTokenModal(); return; }

        // Данные формы — из полей тикета
        const rover = getFieldValue('Ровер') || (payload && payload.rover) || '';
        if (!rover) { showToast('Не найден номер ровера', 7000); return; }
        const port = getFieldValue('Порт приписки') || '';
        const executor = currentLogin();
        pprPhoto = (payload && payload.photo) || null;

        console.log('[ST] ППР: ровер=' + rover + ' порт=' + port + ' исполнитель=' + executor + ' тикет=' + issueKey);

        // Открываем форму осмотра в новом окне; AutoFill там заполняет её сам
        // (r/p/e/k — как в PPR Fast Fill), фото отдаём по рукопожатию AF_PPR_READY.
        const url = new URL(PPR_FORM_URL);
        url.searchParams.set('r', rover);
        url.searchParams.set('p', port);
        url.searchParams.set('e', executor);
        url.searchParams.set('k', issueKey);
        const win = window.open(url.href, '_blank');
        if (!win) { showToast('Браузер заблокировал окно формы ППР', 7000); return; }
        showToast('Форма ППР открыта в новом окне…', 4000);

        const done = await waitForPprDone(240000);
        if (!done) {
            console.warn('[ST] Окно формы ППР не подтвердило отправку (таймаут)');
            showToast('Форма ППР: не дождались отправки', 7000);
            return;
        }
        console.log('[ST] Форма ППР отправлена');
        showToast('Форма ППР отправлена', 4000);
        await sleep(2000);
        pprPhoto = null;

        // Авто-закрытие подтикета «Проверить калибровки»
        await closeCalibrationSubticket(issueKey, rover);

        // Главный тикет ППР — пресет works.md: ROBOT_MIM, MAINTENANCE, check2, fixed
        try {
            await apiRequest('PATCH', `https://st-api.yandex-team.ru/v3/issues/${issueKey}`, {
                components: COMPONENT_IDS['ROBOT_MIM'],
                deadline: todayStr()
            });
        } catch (e) {
            console.warn('[ST] PATCH компонента/дедлайна не прошёл:', e.status, String(e.text || '').slice(0, 300));
        }
        await runTransition(issueKey, 'new', 1500);
        await runTransition(issueKey, ['передать механикам', 'treated']);
        await runTransition(issueKey, 'inProgress');
        await setSolutionViaApi(issueKey, 'MAINTENANCE');
        await runTransition(issueKey, ['check2', 'check']);
        await setDefectCodeApi(issueKey, '0');
        const closedWithRes = await runTransition(issueKey, ['closed', 'closedMeta'], 10000, { resolution: 'fixed' });
        if (!closedWithRes) {
            console.warn('[ST] Закрытие с резолюцией не прошло — пробуем без');
            await runTransition(issueKey, ['closed', 'closedMeta'], 10000);
        }
        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
        showToast('ППР робота: закрыт за ' + elapsedSec + ' сек', 7000);
    }

    // =====================================================
    //  Полный переход статусов — через API (Замена QR)
    // =====================================================
    // Резолв id компонента: справочник → API очереди (кэшируется)
    async function resolveComponentId(nameOrId) {
        if (typeof nameOrId === 'number') return nameOrId;
        if (COMPONENT_IDS[nameOrId]) return COMPONENT_IDS[nameOrId];
        try {
            const r = await apiRequest('GET', 'https://st-api.yandex-team.ru/v2/queues/SDCFLEETOPS/components');
            const list = (r.data && Array.isArray(r.data)) ? r.data : [];
            const found = list.find(c =>
                String(c.name || '').toUpperCase() === String(nameOrId).toUpperCase() ||
                String(c.key || '').toUpperCase() === String(nameOrId).toUpperCase());
            if (found) {
                COMPONENT_IDS[nameOrId] = found.id;
                console.log('[ST] Компонент найден через API:', nameOrId, '=', found.id);
                return found.id;
            }
        } catch (e) {
            console.warn('[ST] Не получил список компонентов:', e.status, String(e.text || '').slice(0, 300));
        }
        return null;
    }

    // Пресеты статусного флоу (без заказов запчастей и форм осмотра)
    const TICKET_PRESETS = {
        stickers: { component: 'ROBOT_BODY_SKIN', solution: 'CHANGE', label: 'Замена QR' },
        logsdump: { component: 'SOFTWARE_LOGS', solution: 'CONFIG', label: 'Слив логов' }
    };

    async function runTicketTransition(startedAt, presetKey) {
        startedAt = startedAt || Date.now();
        const preset = TICKET_PRESETS[presetKey] || TICKET_PRESETS.stickers;
        console.log('[ST Helper] Переход статусов (' + preset.label + ') — через API');
        const issueKey = getTicketKey();
        if (!issueKey) { console.warn('[ST] Тикет не определён'); return; }
        if (!OAUTH_TOKEN) { showTokenModal(); return; }

        // 0. Если не в «Новом» — переводим туда (если уже в Новом, перехода нет, идём дальше)
        await runTransition(issueKey, 'new', 1500);

        // 1. Компонент (id из справочника или через API очереди)
        const componentId = await resolveComponentId(preset.component);
        if (componentId) {
            await apiRequest('PATCH', `https://st-api.yandex-team.ru/v3/issues/${issueKey}`, { components: componentId })
                .catch(e => console.warn('[ST] PATCH компонента не прошёл:', e.status, String(e.text || '').slice(0, 300)));
        } else {
            console.warn('[ST] Компонент не найден:', preset.component);
        }

        // 2. Обработан (Передать механикам)
        await runTransition(issueKey, ['передать механикам', 'treated']);
        // 3. В работе (Взять в работу)
        await runTransition(issueKey, 'inProgress');
        // 4. Способ решения
        await setSolutionViaApi(issueKey, preset.solution);
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
        showToast(preset.label + ': готово за ' + elapsedSec + ' сек', 7000);
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
            const presetKey = event.data.preset || 'stickers';
            await sleep(2000);
            await runTicketTransition(startedAt, presetKey);
        }

        if (event.data.type === 'ST_HELPER_MICROPHONE_ORDER') {
            await sleep(1000);
            const p = (event.data.payload || {});
            await runMicrophoneOrder(p.locationName, p.locationId, getTicketKey(), p.preset, p.startedAt, p.quantity, { isBlocker: p.isBlocker, defectCode: p.defectCode });
        }

        // ===== ППР-флоу (перенос из PPR Fast Fill) =====

        // Кнопка «ППР» в AutoFill: фото уже в payload, открываем форму
        if (event.data.type === 'ST_HELPER_PPR_ORDER') {
            await sleep(1000);
            runPprOrder(event.data.payload || {});
        }

        // Окно формы ППР просит фото — отдаём из памяти
        if (event.data.type === 'AF_PPR_READY') {
            try { event.source.postMessage({ type: 'ST_PPR_DATA', payload: { photo: pprPhoto } }, '*'); } catch (e) {}
        }

        // Прогресс заполнения формы (ошибки — тостом)
        if (event.data.type === 'AF_PPR_PROGRESS') {
            const d = event.data;
            console.log('[ST] ППР:', d.msg, d.kind || '');
            if (d.kind === 'error') showToast('ППР: ' + d.msg, 7000);
        }

        // Форма ППР отправлена — продолжаем в тикете
        if (event.data.type === 'AF_PPR_DONE') {
            if (pprDoneResolve) pprDoneResolve();
        }

        // Консольная утилита: полный список компонентов очереди.
        // Вызов из консоли DevTools на странице st.yandex-team.ru:
        //   window.postMessage({ type: 'ST_LIST_COMPONENTS' }, '*');
        // Опционально фильтр: { type: 'ST_LIST_COMPONENTS', filter: 'robot' }
        if (event.data.type === 'ST_LIST_COMPONENTS') {
            try {
                const r = await apiRequest('GET', 'https://st-api.yandex-team.ru/v2/queues/SDCFLEETOPS/components');
                const list = (r.data && Array.isArray(r.data)) ? r.data : [];
                const flt = (event.data.filter || '').toLowerCase();
                const rows = list
                    .filter(c => !flt || String(c.name || '').toLowerCase().includes(flt))
                    .map(c => ({ id: c.id, name: c.name, key: c.key || '' }));
                console.log('[ST] Компоненты SDCFLEETOPS (' + rows.length + ' из ' + list.length + '):');
                console.table(rows);
                console.log('[ST] Справочник для COMPONENT_IDS:\n' +
                    rows.map(c => `'${c.name}': ${c.id},`).join('\n'));
            } catch (e) {
                console.warn('[ST] Не получил компоненты:', e.status, String(e.text || '').slice(0, 300));
            }
        }

        // Утилита: добавить тег тикету и проверить.
        //   window.postMessage({ type: 'ST_ADD_TAG', tag: 'speed_one', key: 'SDCFLEETOPS-395833' }, '*')
        // key не обязателен — берётся текущий тикет со страницы.
        if (event.data.type === 'ST_ADD_TAG') {
            const tag = String(event.data.tag || '').trim();
            const key = event.data.key || getTicketKey();
            if (!tag || !key) { console.warn('[ST] ST_ADD_TAG: нужен tag и key'); return; }
            try {
                const tagsNow = await addTicketTag(key, tag);
                console.log('[ST] Теги тикета ' + key + ':', tagsNow);
                if (tagsNow.includes(tag)) { showToast('Тег «' + tag + '» добавлен в ' + key, 5000); }
                else { console.warn('[ST] Тег не подтверждён'); showToast('Тег не подтвердился — смотри консоль', 7000); }
            } catch (e) {
                console.warn('[ST] ST_ADD_TAG ошибка:', e.status, String(e.text || '').slice(0, 500));
                showToast('Ошибка добавления тега: ' + String(e.status || ''), 7000);
            }
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