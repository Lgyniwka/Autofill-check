// ==UserScript==
// @name         QuickBase: Панель базы знаний (все сайты)
// @namespace    https://github.com/Lgyniwka/Autofill-check/blob/main/src/QuickBase.user.js
// @version      0.3.1
// @description  Плавающая кнопка-ровер (правый нижний угол) открывает панель базы знаний на любом сайте. Запасной вход: Cmd+Shift+Ё/Ctrl+~. Схема данных — в DATA ниже.
// @homepageURL  https://github.com/Lgyniwka/Autofill-check/blob/main/src/QuickBase.user.js
// @supportURL   https://github.com/Lgyniwka/Autofill-check/blob/main/src/QuickBase.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/QuickBase.user.js
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/QuickBase.user.js
// @match        *://*/*
// @run-at       document-end
// @grant        GM_setClipboard
// @grant        GM_openInTab
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
                  text: 'ВА — правое · В8 — заднее · В9 — левое',
                  value: 'ВА — правое, В8 — заднее, В9 — левое' },
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

    function matchesHotkey(e) {
        // macOS: Cmd+Shift+Ё — Cmd+Ё перехватывается системой (переключение окон).
        // Запасной вариант везде: Ctrl+Ё (Windows: Ctrl+~), системой не занимается.
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if (isMac && e.metaKey && e.shiftKey && e.code === 'Backquote' && !e.altKey && !e.ctrlKey) return true;
        if (!isMac && e.ctrlKey && e.code === 'Backquote' && !e.altKey && !e.shiftKey && !e.metaKey) return true;
        // Ctrl+Ё работает и на macOS как запасной
        if (e.ctrlKey && e.code === 'Backquote' && !e.altKey && !e.shiftKey && !e.metaKey) return true;
        return false;
    }

    function onKeydown(e) {
        if (e.code === 'Escape' && panel) {
            e.preventDefault();
            e.stopPropagation();
            closePanel();
            return;
        }
        if (matchesHotkey(e)) {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
        }
    }

    function togglePanel() {
        if (panel) closePanel();
        else openPanel();
    }

    /* ==================================================================
     *  ПЛАВАЮЩАЯ КНОПКА-РОВЕР (правый нижний угол, клик — панель)
     *  QB_ICON_URL: вставь сюда прямой URL картинки ровера (текстом),
     *  пусто — используется встроенный SVG.
     *  ПКМ по кнопке — скрыть на этой вкладке до перезагрузки.
     * ================================================================== */

    const QB_ICON_URL = 'https://avatars.mds.yandex.net/i?id=9e3268fc66a050716037551f084418f9_l-7716430-images-thumbs&n=13';

    const QB_SVG = `
        <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
            <!-- корпус -->
            <rect x="10" y="18" width="44" height="22" rx="6"
                  fill="#ffcc00" stroke="#333" stroke-width="2"/>
            <!-- «башня» с сенсором -->
            <rect x="24" y="10" width="16" height="8" rx="3"
                  fill="#333"/>
            <circle cx="50" cy="24" r="4" fill="#333"/>
            <!-- колёса -->
            <circle cx="18" cy="46" r="7"  fill="#222" stroke="#111" stroke-width="2"/>
            <circle cx="46" cy="46" r="7"  fill="#222" stroke="#111" stroke-width="2"/>
            <circle cx="18" cy="46" r="2.5" fill="#555"/>
            <circle cx="46" cy="46" r="2.5" fill="#555"/>
            <!-- «глаза» -->
            <circle cx="22" cy="26" r="2.5" fill="#333"/>
            <circle cx="34" cy="26" r="2.5" fill="#333"/>
            <!-- синяя полоса Яндекс -->
            <rect x="10" y="33" width="44" height="4" fill="#fc3f1d" opacity="0.85"/>
        </svg>`;

    function createFloatButton() {
        if (sessionStorage.getItem('qb_btn_hidden') === '1') return;

        const btn = document.createElement('div');
        btn.id = 'quickbase_btn';
        btn.title = 'QuickBase — база знаний (клик — открыть, ПКМ — скрыть)';

        btn.innerHTML = QB_ICON_URL
            ? `<img src="${QB_ICON_URL}" alt="rover" width="34" height="34">`
            : QB_SVG;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
        });

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
                right: 18px  !important;
                bottom: 18px !important;
                width: 48px; height: 48px;
                border-radius: 50%;
                background: rgba(22, 26, 35, 0.92);
                border: 1px solid #2c3345;
                box-shadow: 0 4px 14px rgba(0,0,0,.45);
                display: flex !important;
                align-items: center;
                justify-content: center;
                align-items: center;
                cursor: pointer;
                z-index: ${PANEL_Z - 1} !important;
                opacity: 0.55;
                transition: opacity .15s, transform .15s;
            }
            #quickbase_btn:hover {
                opacity: 1;
                transform: scale(1.08);
            }
            #quickbase_btn, #quickbase_btn * {
                pointer-events: none;
                user-select: none;
                -webkit-user-select: none;
            }
            #quickbase_btn { pointer-events: auto; }
            #quickbase_btn img {
                border-radius: 8px;
                object-fit: cover;
            }
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

        // Клик по фону — закрыть
        panel.addEventListener('mousedown', (e) => {
            if (e.target === panel) closePanel();
        });

        // Поиск
        const input = panel.querySelector('#qb_search');
        input.addEventListener('input', () => applyFilter(input.value));

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

            if (item.details) {
                toggleDetails(row);
                return;
            }
            if (item.link) {
                GM_openInTab(item.link, { active: true });
                return;
            }
            if (item.value) {
                GM_setClipboard(item.value);
                flash(row, '✅ Скопировано');
            }
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
                const expandIco = item.details ? '<span class="qb_expand">▸</span>' : '';
                const linkIco = item.link ? '<span class="qb_ico" data-qb-link title="Открыть ссылку">↗</span>' : '';
                const copyIco = item.value ? '<span class="qb_ico" data-qb-copy title="Скопировать">⧉</span>' : '';
                const detailsHTML = item.details
                    ? `<div class="qb_details" style="display:none">${
                          item.details.map((d) =>
                              `<div class="qb_details_row" data-qb-detail="${encode(d)}">
                                   <span class="qb_details_label">${d.label}</span>
                                   <span class="qb_details_value">${d.value}</span>
                                   <span class="qb_ico" title="Скопировать">⧉</span>
                               </div>`).join('')
                      }</div>`
                    : '';
                return `
                    <div class="qb_row" data-qb-row data-qb-item="${dataAttr}" ${item.details ? 'data-qb-has-details' : ''}>
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
                <div class="qb_section" data-qb-section>
                    <div class="qb_section_title">${section.title}</div>
                    ${rows}
                </div>`;
        }).join('');

        return `
            <style>
                #${PANEL_ID} {
                    position: fixed; inset: 0;
                    background: rgba(15, 18, 25, 0.55);
                    backdrop-filter: blur(2px);
                    z-index: ${PANEL_Z};
                    font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
                    display: flex; justify-content: center; align-items: flex-start;
                    padding: 7vh 16px 16px;
                    box-sizing: border-box;
                }
                #${PANEL_ID} .qb_box {
                    width: min(760px, 96vw); max-height: 86vh;
                    overflow-y: auto;
                    background: #161a23; color: #e6e9f0;
                    border: 1px solid #2c3345; border-radius: 12px;
                    box-shadow: 0 12px 48px rgba(0,0,0,.6);
                    padding: 14px 16px 18px;
                    box-sizing: border-box;
                }
                #${PANEL_ID} .qb_head {
                    display: flex; gap: 10px; align-items: center; margin-bottom: 10px;
                }
                #${PANEL_ID} .qb_title { font-weight: 700; font-size: 15px; }
                #${PANEL_ID} .qb_kbd {
                    margin-left: auto; font-size: 11px; color: #8b93a7;
                    background: #1d2330; border: 1px solid #2c3345;
                    border-radius: 6px; padding: 3px 7px; white-space: nowrap;
                }
                #${PANEL_ID} input#qb_search {
                    flex: 1; box-sizing: border-box;
                    background: #0f131c; color: #e6e9f0;
                    border: 1px solid #2c3345; border-radius: 8px;
                    padding: 9px 12px; font-size: 14px; outline: none;
                }
                #${PANEL_ID} input#qb_search:focus { border-color: #4c6ef5; }
                #${PANEL_ID} .qb_section { margin-top: 12px; }
                #${PANEL_ID} .qb_empty { color: #7b8395; padding: 20px 4px; font-size: 13px; text-align: center; }
                #${PANEL_ID} .qb_section_title {
                    font-size: 12px; font-weight: 700; color: #9aa3b8;
                    text-transform: uppercase; letter-spacing: .4px;
                    margin: 10px 2px 6px;
                }
                #${PANEL_ID} .qb_row {
                    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
                    padding: 7px 10px; border-radius: 8px;
                    cursor: pointer; user-select: none;
                    border: 1px solid transparent;
                }
                #${PANEL_ID} .qb_row:hover { background: #1d2330; border-color: #2c3345; }
                #${PANEL_ID} .qb_expand { color: #8b93a7; font-size: 11px; width: 10px; }
                #${PANEL_ID} .qb_label { font-size: 14px; }
                #${PANEL_ID} .qb_hint {
                    font-size: 11px; color: #8b93a7;
                    background: #1d2330; border-radius: 5px; padding: 2px 6px;
                    white-space: nowrap;
                }
                #${PANEL_ID} .qb_ico { font-size: 13px; color: #6e7890; margin-left: auto; }
                #${PANEL_ID} .qb_text {
                    flex-basis: 100%; font-size: 12px; color: #9aa3b8;
                    padding: 4px 0 0 14px;
                }
                #${PANEL_ID} .qb_details {
                    margin: 2px 8px 6px 28px;
                    background: #0f131c;
                    border: 1px solid #2c3345; border-radius: 8px;
                    overflow: hidden;
                }
                #${PANEL_ID} .qb_details_row {
                    display: flex; align-items: center; gap: 8px;
                    padding: 6px 12px; cursor: pointer; user-select: none;
                    border-top: 1px solid #1d2330;
                }
                #${PANEL_ID} .qb_details_row:first-child { border-top: none; }
                #${PANEL_ID} .qb_details_row:hover { background: #1d2330; }
                #${PANEL_ID} .qb_details_label { font-size: 12px; color: #8b93a7; min-width: 120px; }
                #${PANEL_ID} .qb_details_value { font-size: 13px; color: #e6e9f0; word-break: break-all; }
                #${PANEL_ID} .qb_row.qb_ok { border-color: #51cf66 !important; }
                #${PANEL_ID} .qb_flash {
                    margin-left: auto; font-size: 12px; color: #51cf66; white-space: nowrap;
                }
            </style>
            <div class="qb_box">
                <div class="qb_head">
                    <span class="qb_title">⚡ QuickBase — база знаний</span>
                    <span class="qb_kbd">${isMacOS() ? 'Cmd+Shift+Ё · Ctrl+Ё / Esc' : 'Ctrl+~ / Esc'}</span>
                </div>
                <input id="qb_search" type="text" placeholder="Поиск по разделам и работам…" autocomplete="off">
                <div id="qb_sections">${sectionsHTML}</div>
                <div class="qb_empty" id="qb_empty" style="display:none">Ничего не найдено</div>
            </div>`;
    }

    function encode(obj) {
        return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

    function isMacOS() {
        return navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    }

    // Глобальный перехват на capture-фазе — раньше обработчиков страницы
    window.addEventListener('keydown', onKeydown, true);
    document.addEventListener('keydown', onKeydown, true);

    // Плавающая кнопка-ровер (fallback хоткея)
    createFloatButton();
})();
