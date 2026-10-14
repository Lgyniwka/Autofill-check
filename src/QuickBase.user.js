// ==UserScript==
// @name         QuickBase: Панель базы знаний (все сайты)
// @namespace    https://github.com/Lgyniwka/Autofill-check/blob/main/src/QuickBase.user.js
// @version      0.12.1
// @description  Панель базы знаний. Работы по роботу: открытые тикеты, приоритет из Startrek (кружки: красный блокер, оранжевый критичный, жёлтый средний), копирование названий вместе с цветными кружками-эмодзи. Вход кнопкой-ровером.
// @homepageURL  https://github.com/Lgyniwka/Autofill-check/blob/main/src/QuickBase.user.js
// @supportURL   https://github.com/Lgyniwka/Autofill-check/blob/main/src/QuickBase.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/QuickBase.user.js
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/QuickBase.user.js
// @match        *://*/*
// @run-at       document-end
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      tools.sdc.yandex-team.ru
// @connect      st.yandex-team.ru
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    /* ==================================================================
     *  ДАННЫЕ (схема задаётся вручную — правь этот блок)
     *
     *  Раздел: { title: 'Название', items: [ ... ] }
     *
     *  Элемент:  { label: '...'       — заголовок строки
     *              hint:  '...'       — серая подсказка справа (опц.)
     *              value: '...'      — текст для копирования по клику (опц.)
     *              link:  'https://' — ссылка: клик открывает в новой вкладке (опц.)
     *              text:  '...'      — текст-пояснение, виден всегда (опц.)
     *              details: [ {label, value} ]  — список, раскрывается по клику, каждый пункт копируется (опц.)
     *             }
     * ================================================================== */

    const DATA = [
        {
            title: '📖 Инструкции',
            items: [
                { label: 'Скрипты Tampermonkey',
                  link: 'https://wiki.yandex-team.ru/users/lgynivvka/baza-znanijj-moja-po-suf/skripty-tampermonkey/' },
                { label: 'Коды дефектов',
                  link: 'https://wiki.yandex-team.ru/users/nlomonosov/kody-defektov/' },
                { label: 'Портал обучения парков',
                  link: 'https://yandex-robot.ispring.ru/courses',
                  hint: 'клик — логин/пароль',
                  details: [
                      { label: 'Логин',  value: 'ura.zum' },
                      { label: 'Пароль', value: 'ISpring123' },
                  ] },
                { label: 'Инструкция по ремонту кабеля бутлида (PDF)',
                  link: 'https://wiki.yandex-team.ru/users/lgynivvka/baza-znanijj-moja-po-suf/instrukcii-bez-viki/.files/instrukcijaporemontuvchkabeljakamerybootlid-1.pdf' },
            ],
        },
        {
            title: '💡 Информация',
            items: [
                { label: 'Параметры калибровочной ветки',
                  hint: 'клик — параметры',
                  details: [
                      { label: 'branch',               value: 'tags/releases/sdg/pipeline/robot/2026-07-13-robot-55-rev17' },
                      { label: 'toplevel parameters',   value: '--lanes-map=ci/maps/head' },
                      { label: 'tags',                 value: 'reservation_id_2036825' },
                  ] },
                { label: 'Ошибки MCU',
                  details: [
                      { label: 'ВА', value: 'правое' },
                      { label: 'В8', value: 'заднее' },
                      { label: 'В9', value: 'левое' },
                  ] },
                { label: 'Цифры оси Z лидара',
                  value: '0.6725999713' },
            ],
        },
        {
            title: '🔗 Ссылки',
            items: [
                { label: 'Смена оклейки в СУФ',
                  link: 'https://suf.sdc.yandex-team.ru/?mode=service_forms&ll=37.571273%2C55.741921&z=11.03&form=set_sticker' },
            ],
        },
    ];

    /* ==================================================================
     *  ДВИЖОК ПАНЕЛИ (править не обязательно)
     * ================================================================== */

    const PANEL_ID = 'quickbase_panel';
    const PANEL_Z = 2147483000;

    let panel = null;

    function togglePanel() {
        if (panel) closePanel();
        else openPanel();
    }

    /* ==================================================================
     *  ПЛАВАЮЩАЯ КНОПКА-РОВЕР (перетаскивается, клик — панель)
     *  Иконка — встроенный SVG (без внешних ссылок, не протухает).
     *  QB_ICON_URL — опционально: свой URL картинки, пусто = SVG.
     *  ЛКМ-клик — открыть панель · перетаскивание — двигать (запоминается)
     *  ПКМ — скрыть на этой вкладке до перезагрузки.
     * ================================================================== */

    const QB_ICON_URL = '';

    // Ровер Яндекса, вид сбоку: серый корпус, жёлтый бренд, лидар, 3 колеса, фара
    const QB_SVG = `
        <svg viewBox="0 0 64 64" width="36" height="36" aria-hidden="true">
            <!-- лидар на крыше -->
            <rect x="27" y="8"  width="10" height="5" rx="1.5" fill="#2b2f3a"/>
            <rect x="25" y="12" width="14" height="3" rx="1.5" fill="#3a3f4a"/>
            <!-- корпус -->
            <rect x="6"  y="14" width="52" height="26" rx="9"
                  fill="#eef0f4" stroke="#2b2f3a" stroke-width="2.5"/>
            <!-- шов крышки корпуса -->
            <line x1="10" y1="22" x2="54" y2="22" stroke="#c6cbd6" stroke-width="2"/>
            <!-- жёлтая брендовая полоса -->
            <rect x="6" y="31" width="52" height="6" fill="#ffcc00"/>
            <!-- решётка вентиляции -->
            <rect x="12" y="25" width="16" height="4" rx="2" fill="#d7dbe2"/>
            <!-- фара спереди -->
            <circle cx="52" cy="27" r="2.6" fill="#2b2f3a"/>
            <circle cx="52" cy="27" r="1.1" fill="#9fd8ff"/>
            <!-- сенсор-«глаз» у переднего края -->
            <rect x="46" y="25" width="3" height="4" rx="1" fill="#2b2f3a"/>
            <!-- колёса: три по борту -->
            <rect x="12" y="39" width="8"  height="4" fill="#2b2f3a" rx="1"/>
            <rect x="28" y="39" width="8"  height="4" fill="#2b2f3a" rx="1"/>
            <rect x="44" y="39" width="8"  height="4" fill="#2b2f3a" rx="1"/>
            <circle cx="16" cy="46" r="5"   fill="#22252e" stroke="#111" stroke-width="1.5"/>
            <circle cx="32" cy="46" r="5"   fill="#22252e" stroke="#111" stroke-width="1.5"/>
            <circle cx="48" cy="46" r="5"   fill="#22252e" stroke="#111" stroke-width="1.5"/>
            <circle cx="16" cy="46" r="1.7" fill="#6b7280"/>
            <circle cx="32" cy="46" r="1.7" fill="#6b7280"/>
            <circle cx="48" cy="46" r="1.7" fill="#6b7280"/>
        </svg>`;

    const BTN_POS_KEY = 'qb_btn_pos';

    function btnLoadPos() {
        const vw = window.innerWidth, vh = window.innerHeight;
        try {
            const p = JSON.parse(localStorage.getItem(BTN_POS_KEY));
            if (p && typeof p.x === 'number' && typeof p.y === 'number') {
                return clampPos(p, vw, vh);
            }
        } catch (e) { /* ignore */ }
        return { x: vw - 66, y: vh - 66 }; // правый нижний угол по умолчанию
    }

    function clampPos(p, vw, vh) {
        const S = 48; // размер кнопки
        return {
            x: Math.min(Math.max(p.x, 8), Math.max(vw - S - 8, 8)),
            y: Math.min(Math.max(p.y, 8), Math.max(vh - S - 8, 8)),
        };
    }

    function btnApplyPos(btn, p) {
        btn.style.left = p.x + 'px';
        btn.style.top = p.y + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
    }

    function createFloatButton() {
        if (sessionStorage.getItem('qb_btn_hidden') === '1') return;

        const btn = document.createElement('div');
        btn.id = 'quickbase_btn';
        btn.title = 'QuickBase — база знаний (клик — открыть, тащить — переместить, ПКМ — скрыть)';

        btn.innerHTML = QB_ICON_URL
            ? `<img src="${QB_ICON_URL}" alt="rover" width="34" height="34">`
            : QB_SVG;

        let pos = btnLoadPos();
        btnApplyPos(btn, pos);

        // --- Перетаскивание (pointer events: мышь + тач) с отличием от клика ---
        let drag = null;

        btn.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            drag = { startX: e.clientX, startY: e.clientY, moved: false };
            btn.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        btn.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (!drag.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                drag.moved = true;
                drag.origX = pos.x;
                drag.origY = pos.y;
                btn.classList.add('qb_dragging');
            }
            if (drag.moved) {
                pos = clampPos({ x: drag.origX + dx, y: drag.origY + dy },
                               window.innerWidth, window.innerHeight);
                btnApplyPos(btn, pos);
            }
        });

        const endDrag = (e) => {
            if (!drag) return;
            if (drag.moved) {
                try { localStorage.setItem(BTN_POS_KEY, JSON.stringify(pos)); } catch (err) { /* ignore */ }
                btn.classList.remove('qb_dragging');
            } else {
                togglePanel(); // это был клик, не драг
            }
            drag = null;
        };
        btn.addEventListener('pointerup', endDrag);
        btn.addEventListener('pointercancel', endDrag);

        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            sessionStorage.setItem('qb_btn_hidden', '1');
            btn.remove();
        });

        const style = document.createElement('style');
        style.textContent = `
            #quickbase_btn {
                position: fixed !important;
                width: 38px; height: 38px;
                border-radius: 50%;
                background: rgba(22, 26, 35, 0.92);
                border: 1px solid #2c3345;
                box-shadow: 0 4px 14px rgba(0,0,0,.45);
                display: flex !important;
                align-items: center;
                justify-content: center;
                cursor: grab;
                touch-action: none;
                z-index: ${PANEL_Z - 1} !important;
                opacity: 0.35;
                transition: opacity .15s, transform .15s, width .15s, height .15s;
            }
            #quickbase_btn:hover, #quickbase_btn:focus {
                opacity: 1; transform: scale(1.15); z-index: ${PANEL_Z} !important;
            }
            #quickbase_btn.qb_dragging {
                cursor: grabbing;
                opacity: 1;
                transform: none;
                box-shadow: 0 8px 24px rgba(0,0,0,.6);
            }
            #quickbase_btn, #quickbase_btn * {
                pointer-events: none;
                user-select: none;
                -webkit-user-select: none;
            }
            #quickbase_btn { pointer-events: auto; }
            #quickbase_btn img { border-radius: 8px; object-fit: cover; }
        `;
        document.documentElement.appendChild(style);
        document.documentElement.appendChild(btn);
    }

    function closePanel() {
        if (!panel) return;
        panel.remove();
        panel = null;
    }

    function openPanel() {
        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = buildHTML();
        document.documentElement.appendChild(panel);

        // --- Позиция панели: из localStorage или центр сверху ---
        const box = panel.querySelector('.qb_box');
        const PANEL_POS_KEY = 'qb_panel_pos';
        let ppos;
        try {
            ppos = JSON.parse(localStorage.getItem(PANEL_POS_KEY));
        } catch (e) { ppos = null; }
        if (!ppos || typeof ppos.x !== 'number') {
            ppos = { x: Math.max(8, (window.innerWidth - Math.min(460, window.innerWidth * 0.94)) / 2), y: Math.round(window.innerHeight * 0.08) };
        }
        applyPanelPos();

        function applyPanelPos() {
            const w = box.offsetWidth, h = box.offsetHeight;
            const x = Math.min(Math.max(ppos.x, 4), Math.max(window.innerWidth - w - 4, 4));
            const y = Math.min(Math.max(ppos.y, 4), Math.max(window.innerHeight - Math.min(h, window.innerHeight * 0.86) - 4, 4));
            box.style.left = x + 'px';
            box.style.top = y + 'px';
        }

        // --- Перетаскивание панели за шапку ---
        const head = panel.querySelector('.qb_head');
        let pdrag = null;
        head.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.qb_close')) return; // крестик не хватает
            pdrag = { startX: e.clientX, startY: e.clientY, x: ppos.x, y: ppos.y };
            head.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        head.addEventListener('pointermove', (e) => {
            if (!pdrag) return;
            ppos = {
                x: pdrag.x + (e.clientX - pdrag.startX),
                y: pdrag.y + (e.clientY - pdrag.startY),
            };
            applyPanelPos();
        });
        const endPanelDrag = () => {
            if (!pdrag) return;
            try { localStorage.setItem(PANEL_POS_KEY, JSON.stringify(ppos)); } catch (err) { /* ignore */ }
            pdrag = null;
        };
        head.addEventListener('pointerup', endPanelDrag);
        head.addEventListener('pointercancel', endPanelDrag);

        // Кнопка ✕ — закрытие (клик по сайту панель больше не закрывает)
        panel.querySelector('.qb_close').addEventListener('click', closePanel);

        // Поиск
        const input = panel.querySelector('#qb_search');
        input.addEventListener('input', () => applyFilter(input.value));

        // --- Работы по роботу: ввод номера без «a», грузим список открытых работ ---
        const robotInput = panel.querySelector('#qb_robot_input');
        const robotGo = panel.querySelector('#qb_robot_go');
        const robotResults = panel.querySelector('#qb_robot_results');

        // Ввод: разрешаем только цифры (букву a в начале игнорируем)
        robotInput.addEventListener('input', () => {
            const cleaned = robotInput.value.replace(/^a+/i, '').replace(/\D/g, '');
            if (robotInput.value !== cleaned) robotInput.value = cleaned;
        });
        robotInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') loadRobotTasks();
        });
        robotGo.addEventListener('click', loadRobotTasks);

        function loadRobotTasks() {
            const num = robotInput.value.trim();
            if (!num) {
                robotResults.innerHTML = '<div class="qb_robot_status">Введи номер робота, например 1580</div>';
                return;
            }
            const API = 'https://tools.sdc.yandex-team.ru/api';
            robotResults.innerHTML = '<div class="qb_robot_status">Ищу a' + num + '…</div>';

            // Шаг 1: имя a{num} -> VIN (/vehicles/?name=)
            GM_xmlhttpRequest({
                method: 'GET',
                url: API + '/vehicles/?name=a' + num,
                timeout: 15000,
                headers: { 'Accept': 'application/json' },
                onload: (res) => {
                    let data;
                    try { data = JSON.parse(res.responseText); } catch (err) { data = null; }
                    const rover = data && Array.isArray(data.results)
                        ? data.results.find((r) => (r.name || '').toLowerCase() === ('a' + num).toLowerCase()) || data.results[0]
                        : null;
                    if (!rover || !rover.vin) {
                        robotResults.innerHTML = '<div class="qb_robot_status">⚠ Робот a' + num + ' не найден (HTTP ' + res.status + ')</div>';
                        return;
                    }
                    // Шаг 2: работы по VIN
                    robotResults.innerHTML = '<div class="qb_robot_status">Загружаю работы по a' + num + ' (' + rover.vin + ')…</div>';
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: API + '/rovers/' + rover.vin + '/issues/',
                        timeout: 15000,
                        headers: { 'Accept': 'application/json' },
                        onload: (res2) => renderRobotTasks(num, res2.responseText, res2.status),
                        onerror: () => {
                            robotResults.innerHTML = '<div class="qb_robot_status">⚠ Не удалось загрузить (сеть)</div>';
                        },
                        ontimeout: () => {
                            robotResults.innerHTML = '<div class="qb_robot_status">⚠ Таймаут запроса</div>';
                        },
                    });
                },
                onerror: () => {
                    robotResults.innerHTML = '<div class="qb_robot_status">⚠ Не удалось загрузить (сеть)</div>';
                },
                ontimeout: () => {
                    robotResults.innerHTML = '<div class="qb_robot_status">⚠ Таймаут запроса</div>';
                },
            });
        }

        function renderRobotTasks(num, text, status) {
            let data;
            try { data = JSON.parse(text); } catch (err) { data = null; }

            // Приходим из JSON API: {maintenance: [...], incidents: [...]}
            let tasks = (data && Array.isArray(data.maintenance)) ? data.maintenance : null;
            if (!tasks) {
                robotResults.innerHTML = '<div class="qb_robot_status">⚠ API вернул не JSON (HTTP ' + status + '). Ответ: ' + text.slice(0, 120) + '</div>';
                return;
            }
            console.log('[QuickBase] issues API answer:', data);

            // Показываем только ОТКРЫТЫЕ работы (resolved/resolution пуст)
            tasks = tasks.filter((it) => {
                const resolved = it.resolved || it.resolved_at || it.resolution || it.done;
                return !resolved;
            }).map((it) => {
                const key = it.key || (it.ticket && (it.ticket.key || it.ticket))
                    || (it.startrek_ticket && (it.startrek_ticket.key || it.startrek_ticket)) || '';
                const link = it.url || (it.ticket && it.ticket.url) || (key ? 'https://st.yandex-team.ru/' + key : '');
                return {
                    key: typeof key === 'string' ? key : '',
                    link: link,
                    summary: it.summary || it.name || it.title || '',
                    created: (it.created || it.created_at || '').toString().slice(0, 10),
                    priority: it.priority || (it.ticket && it.ticket.priority) || it.startrek_priority || '',
                };
            }).filter((t) => t.key);

            if (!tasks.length) {
                robotResults.innerHTML = '<div class="qb_robot_status">Открытых работ по a' + num + ' не найдено</div>';
                return;
            }
            robotResults.innerHTML =
                '<div class="qb_robot_status">Открытых работ по a' + num + ': ' + tasks.length +
                ' <span class="qb_copy_all" title="Скопировать названия всех работ">⧉ копировать названия</span></div>' +
                tasks.map((t, idx) =>
                    `<div class="qb_task" data-qb-task="${encode(t)}">
                        <span class="qb_task_pr" data-qb-pr="${idx}" style="background:${priorityColor(t.priority)}" title="Приоритет: ${t.priority || 'загружаю…'}"></span>
                        <span class="qb_task_key">${t.key}</span>
                        <span class="qb_task_date">${t.created}</span>
                        <span class="qb_task_summary">${t.summary}</span>
                    </div>`).join('');
            robotResults.querySelector('.qb_copy_all').addEventListener('click', (e) => {
                e.stopPropagation();
                // Каждая строка: цветной кружок (эмодзи) + название работы
                GM_setClipboard(tasks.map((t) =>
                    (PR_EMOJI[t.priority] || '⚪') + ' ' + t.summary
                ).filter((line) => line.trim().length > 1).join('\n'));
                const el = e.target;
                el.textContent = '✅ Скопировано';
                setTimeout(() => { el.textContent = '⧉ копировать названия'; }, 1200);
            });
            robotResults.querySelectorAll('[data-qb-task]').forEach((el) => {
                el.addEventListener('click', () => {
                    const t = decode(el.dataset.qbTask);
                    GM_openInTab(t.link, { active: true });
                });
            });

            // Приоритет из Startrek
            const PR_EMOJI = { blocker: '🔴', critical: '🟠', major: '🟡' };
            tasks.forEach((t, idx) => {
                const dot = robotResults.querySelector(`[data-qb-pr="${idx}"]`);
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'https://st.yandex-team.ru/' + t.key,
                    timeout: 20000,
                    onload: (res) => {
                        let pr = '';
                        const m = (res.responseText || '').match(/Bubble-priority_priority_([a-z]+)/)
                            || (res.responseText || '').match(/Bubble-Icon_priority_([a-z]+)/);
                        if (m) pr = m[1];
                        t.priority = pr; // кружок учитывается и при копировании
                        if (dot) {
                            dot.style.background = priorityColor(pr);
                            dot.title = 'Приоритет: ' + (pr || 'не найден');
                        }
                    },
                    onerror: () => { if (dot) dot.title = 'Приоритет: ошибка загрузки'; },
                    ontimeout: () => { if (dot) dot.title = 'Приоритет: таймаут'; },
                });
            });
        }

        // Клик по строке: копирование / ссылка / раскрытие details
        panel.addEventListener('click', (e) => {
            const dRow = e.target.closest('[data-qb-detail]');
            if (dRow) {
                GM_setClipboard(decode(dRow.dataset.qbDetail).value);
                flash(dRow, '✅ Скопировано');
                return;
            }

            const row = e.target.closest('[data-qb-row]');
            if (!row) return;
            const item = decode(row.dataset.qbItem);

            // Иконка ↗ — всегда открывает ссылку
            if (e.target.closest('[data-qb-link]')) {
                if (item.link) GM_openInTab(item.link, { active: true });
                return;
            }

            // Любая строка с доп. данными — разворачивается
            if (item.details || item.value) {
                toggleDetails(row);
                return;
            }
            if (item.link) {
                GM_openInTab(item.link, { active: true });
            }
        });

        // Клик по заголовку секции — развернуть/свернуть.
        // По умолчанию ВСЁ свёрнуто; запоминаются только развёрнутые.
        const EXPANDED_KEY = 'qb_expanded_sections';
        const loadExpanded = () => {
            try { return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY)) || []); }
            catch (e) { return new Set(); }
        };
        const saveExpanded = (set) => {
            try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...set])); } catch (err) { /* ignore */ }
        };
        panel.querySelectorAll('[data-qb-section]').forEach((sec) => {
            const title = sec.querySelector('[data-qb-section-toggle]');
            const body = sec.querySelector('.qb_section_body');
            const name = sec.dataset.qbTitle;
            if (!loadExpanded().has(name)) {
                body.style.display = 'none';
                title.querySelector('.qb_expand').textContent = '▸';
            }
            title.addEventListener('click', () => {
                const isCollapsed = body.style.display === 'none';
                body.style.display = isCollapsed ? '' : 'none';
                title.querySelector('.qb_expand').textContent = isCollapsed ? '▾' : '▸';
                const set = loadExpanded();
                if (isCollapsed) set.add(name); else set.delete(name);
                saveExpanded(set);
            });
        });

        input.focus();
    }

    function toggleDetails(row) {
        const block = row.nextElementSibling;
        if (!block || !block.classList.contains('qb_details')) return;
        const open = block.style.display !== 'none';
        block.style.display = open ? 'none' : '';
        row.querySelector('.qb_expand').textContent = open ? '▸' : '▾';
    }

    function buildHTML() {
        const sectionsHTML = DATA.map((section) => {
            const rows = section.items.map((item) => {
                const dataAttr = encode(item);
                // Разворачиваемая — любая строка с доп. данными (details и/или value), а не только с details
                const hasExtra = !!(item.details || item.value);
                // Блок доп. данных: из details, либо из одиночного value
                const extraRows = item.details
                    ? item.details
                    : [{ label: 'Значение', value: item.value }];
                const expandIco = hasExtra ? '<span class="qb_expand">▸</span>' : '';
                const linkIco = item.link ? '<span class="qb_ico" data-qb-link title="Открыть ссылку">↗</span>' : '';
                const copyIco = item.value ? '<span class="qb_ico" data-qb-copy title="Скопировать">⧉</span>' : '';
                const detailsHTML = hasExtra
                    ? `<div class="qb_details" style="display:none">${
                          extraRows.map((d) =>
                              `<div class="qb_details_row" data-qb-detail="${encode(d)}">
                                   <span class="qb_details_label">${d.label}</span>
                                   <span class="qb_details_value">${d.value}</span>
                                   <span class="qb_ico" title="Скопировать">⧉</span>
                               </div>`).join('')
                      }</div>`
                    : '';
                return `
                    <div class="qb_row" data-qb-row data-qb-item="${dataAttr}" ${hasExtra ? 'data-qb-has-details' : ''}>
                        ${expandIco}
                        <span class="qb_label">${item.label}</span>
                        ${item.hint ? `<span class="qb_hint">${item.hint}</span>` : ''}
                        ${linkIco}
                        ${copyIco}
                        ${item.text ? `<div class="qb_text">${item.text}</div>` : ''}
                    </div>
                    ${detailsHTML}`;
            }).join('');
            return `
                <div class="qb_section" data-qb-section data-qb-title="${section.title}">
                    <div class="qb_section_title" data-qb-section-toggle>
                        <span class="qb_expand">▾</span>
                        <span>${section.title}</span>
                    </div>
                    <div class="qb_section_body">${rows}</div>
                </div>`;
        }).join('');

        return `
            <style>
                #${PANEL_ID} {
                    position: fixed; inset: 0;
                    background: none;
                    z-index: ${PANEL_Z};
                    font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
                    box-sizing: border-box;
                    pointer-events: none; /* клики уходят на сайт */
                }
                #${PANEL_ID} .qb_box {
                    position: fixed;
                    pointer-events: auto; /* клики работают только внутри панели */
                    width: min(460px, 94vw); max-height: 86vh;
                    overflow-y: auto;
                    background: #161a23; color: #e6e9f0;
                    border: 1px solid #2c3345; border-radius: 12px;
                    box-shadow: 0 12px 48px rgba(0,0,0,.6);
                    padding: 14px 16px 18px;
                    box-sizing: border-box;
                }
                #${PANEL_ID} .qb_head {
                    display: flex; gap: 10px; align-items: center; margin: -4px -6px 8px;
                    padding: 6px; border-radius: 8px;
                    cursor: move; user-select: none; -webkit-user-select: none;
                    touch-action: none;
                }
                #${PANEL_ID} .qb_head:hover { background: #1d2330; }
                #${PANEL_ID} .qb_close {
                    margin-left: auto; cursor: pointer; color: #8b93a7; font-size: 12px;
                    padding: 2px 7px; border-radius: 5px; flex: none;
                }
                #${PANEL_ID} .qb_close:hover { color: #fff; background: #c92a2a; }
                #${PANEL_ID} .qb_title { font-weight: 700; font-size: 13px; }
                #${PANEL_ID} input#qb_search {
                    flex: 1; box-sizing: border-box;
                    background: #0f131c; color: #e6e9f0;
                    border: 1px solid #2c3345; border-radius: 8px;
                    padding: 6px 10px; font-size: 12px; outline: none;
                }
                #${PANEL_ID} input#qb_search:focus { border-color: #4c6ef5; }
                #${PANEL_ID} .qb_robot {
                    display: flex; gap: 6px; margin-top: 8px;
                }
                #${PANEL_ID} input#qb_robot_input {
                    flex: 1; box-sizing: border-box;
                    background: #0f131c; color: #e6e9f0;
                    border: 1px solid #2c3345; border-radius: 8px;
                    padding: 6px 10px; font-size: 12px; outline: none;
                }
                #${PANEL_ID} input#qb_robot_input:focus { border-color: #51cf66; }
                #${PANEL_ID} #qb_robot_go {
                    cursor: pointer; user-select: none; flex: none;
                    background: #1d2330; border: 1px solid #2c3345; border-radius: 8px;
                    padding: 5px 9px; font-size: 12px;
                }
                #${PANEL_ID} #qb_robot_go:hover { background: #262e40; }
                #${PANEL_ID} .qb_robot_status { color: #8b93a7; font-size: 11px; margin: 6px 2px; }
                #${PANEL_ID} .qb_copy_all {
                    cursor: pointer; user-select: none; color: #74c0fc;
                    background: #1d2330; border: 1px solid #2c3345; border-radius: 5px;
                    padding: 1px 6px; margin-left: 6px;
                }
                #${PANEL_ID} .qb_copy_all:hover { background: #262e40; }
                #${PANEL_ID} .qb_task {
                    display: flex; align-items: baseline; gap: 8px;
                    padding: 5px 8px; border-radius: 7px; cursor: pointer;
                    border: 1px solid #1d2330; margin: 4px 0;
                }
                #${PANEL_ID} .qb_task:hover { background: #1d2330; border-color: #2c3345; }
                #${PANEL_ID} .qb_task_key { font-weight: 700; font-size: 11px; color: #74c0fc; white-space: nowrap; }
                #${PANEL_ID} .qb_task_pr {
                    flex: none; width: 9px; height: 9px; border-radius: 50%;
                    background: #495057; align-self: center;
                }
                #${PANEL_ID} .qb_task_date { font-size: 10px; color: #6e7890; white-space: nowrap; }
                #${PANEL_ID} .qb_task_summary { font-size: 11.5px; color: #e6e9f0; }
                #${PANEL_ID} .qb_section { margin-top: 8px; }
                #${PANEL_ID} .qb_empty { color: #7b8395; padding: 14px 4px; font-size: 12px; text-align: center; }
                #${PANEL_ID} .qb_section_title {
                    display: flex; align-items: center; gap: 4px;
                    font-size: 10px; font-weight: 700; color: #9aa3b8;
                    text-transform: uppercase; letter-spacing: .4px;
                    margin: 8px 2px 4px;
                    cursor: pointer; user-select: none; -webkit-user-select: none;
                }
                #${PANEL_ID} .qb_section_title:hover { color: #e6e9f0; }
                #${PANEL_ID} .qb_row {
                    display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
                    padding: 5px 8px; border-radius: 7px;
                    cursor: pointer; user-select: none;
                    border: 1px solid transparent;
                }
                #${PANEL_ID} .qb_row:hover { background: #1d2330; border-color: #2c3345; }
                #${PANEL_ID} .qb_expand { color: #8b93a7; font-size: 10px; width: 10px; }
                #${PANEL_ID} .qb_label { font-size: 12.5px; }
                #${PANEL_ID} .qb_hint {
                    font-size: 10px; color: #8b93a7;
                    background: #1d2330; border-radius: 4px; padding: 1px 5px;
                    white-space: nowrap;
                }
                #${PANEL_ID} .qb_ico { font-size: 11px; color: #6e7890; margin-left: auto; }
                #${PANEL_ID} .qb_text {
                    flex-basis: 100%; font-size: 11px; color: #9aa3b8;
                    padding: 3px 0 0 12px;
                }
                #${PANEL_ID} .qb_details {
                    margin: 2px 6px 4px 22px;
                    background: #0f131c;
                    border: 1px solid #2c3345; border-radius: 7px;
                    overflow: hidden;
                }
                #${PANEL_ID} .qb_details_row {
                    display: flex; align-items: center; gap: 6px;
                    padding: 4px 10px; cursor: pointer; user-select: none;
                    border-top: 1px solid #1d2330;
                }
                #${PANEL_ID} .qb_details_row:first-child { border-top: none; }
                #${PANEL_ID} .qb_details_row:hover { background: #1d2330; }
                #${PANEL_ID} .qb_details_label { font-size: 10px; color: #8b93a7; min-width: 90px; }
                #${PANEL_ID} .qb_details_value { font-size: 11.5px; color: #e6e9f0; word-break: break-all; }
                #${PANEL_ID} .qb_row.qb_ok { border-color: #51cf66 !important; }
                #${PANEL_ID} .qb_flash {
                    margin-left: auto; font-size: 10px; color: #51cf66; white-space: nowrap;
                }
            </style>
            <div class="qb_box">
                <div class="qb_head">
                    <span class="qb_title">⚡ QuickBase — база знаний</span>
                    <span class="qb_close" title="Закрыть">✕</span>
                </div>
                <input id="qb_search" type="text" placeholder="Поиск по разделам и работам…" autocomplete="off">
                <div class="qb_robot">
                    <input id="qb_robot_input" type="text" inputmode="numeric"
                           placeholder="Работы по роботу — номер без «a», напр. 1580" autocomplete="off">
                    <span id="qb_robot_go">🔍</span>
                </div>
                <div id="qb_robot_results"></div>
                <div id="qb_sections">${sectionsHTML}</div>
                <div class="qb_empty" id="qb_empty" style="display:none">Ничего не найдено</div>
            </div>`;
    }

    function encode(obj) {
        return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // Цвет приоритета: блокер — красный, критичный — оранжевый, средний — жёлтый, остальные — серый
    function priorityColor(p) {
        const v = (p === undefined || p === null ? '' : String(p)).toLowerCase();
        if (!v) return '#495057';
        if (v.includes('blocker') || v.includes('блокер') || v === '5') return '#fa5252';      // красный
        if (v.includes('crit') || v.includes('крит') || v === '4') return '#ff922b';           // оранжевый
        if (v.includes('major') || v.includes('средн') || v.includes('med') || v === '3') return '#fcc419'; // жёлтый
        return '#495057';
    }

    function decode(str) {
        try {
            str = str.replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(decodeURIComponent(escape(atob(str))));
        } catch (e) {
            return {};
        }
    }

    function applyFilter(q) {
        q = q.trim().toLowerCase();
        const loadExpanded = () => {
            try { return new Set(JSON.parse(localStorage.getItem('qb_expanded_sections')) || []); }
            catch (e) { return new Set(); }
        };
        const sections = panel.querySelectorAll('[data-qb-section]');
        let total = 0;
        sections.forEach((sec) => {
            let visibleInSection = 0;
            sec.querySelectorAll('[data-qb-row]').forEach((row) => {
                const item = decode(row.dataset.qbItem);
                let hay = (item.label + ' ' + (item.hint || '') + ' ' + (item.value || '') + ' ' + (item.text || '')).toLowerCase();
                if (item.details) {
                    hay += ' ' + item.details.map((d) => d.label + ' ' + d.value).join(' ');
                }
                const show = !q || hay.includes(q);
                row.style.display = show ? '' : 'none';
                // details-блок прячем вместе со строкой
                if (row.hasAttribute('data-qb-has-details')) {
                    const block = row.nextElementSibling;
                    if (block && block.classList.contains('qb_details') && !show) block.style.display = 'none';
                }
                if (show) visibleInSection++;
            });
            sec.style.display = visibleInSection ? '' : 'none';
            // При поиске — раскрыть свёрнутые секции с попаданиями; при пустом запросе — вернуть состояние
            const body = sec.querySelector('.qb_section_body');
            const arrow = sec.querySelector('[data-qb-section-toggle] .qb_expand');
            if (q && visibleInSection) {
                body.style.display = '';
                if (arrow) arrow.textContent = '▾';
            } else if (!q) {
                const isCollapsed = !loadExpanded().has(sec.dataset.qbTitle);
                body.style.display = isCollapsed ? 'none' : '';
                if (arrow) arrow.textContent = isCollapsed ? '▸' : '▾';
            }
            total += visibleInSection;
        });
        panel.querySelector('#qb_empty').style.display = total ? 'none' : '';
    }

    function flash(row, text) {
        const old = row.querySelector('.qb_flash');
        if (old) old.remove();
        const span = document.createElement('span');
        span.className = 'qb_flash';
        span.textContent = text;
        row.appendChild(span);
        row.classList.add('qb_ok');
        setTimeout(() => {
            span.remove();
            row.classList.remove('qb_ok');
        }, 1200);
    }

    createFloatButton();
})();
