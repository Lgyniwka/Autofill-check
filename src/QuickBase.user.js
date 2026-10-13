// ==UserScript==
// @name         QuickBase: Панель базы знаний (все сайты)
// @namespace    local
// @version      0.2.0
// @description  Горячая клавиша Cmd+Ё (macOS) / Ctrl+~ (Windows) — открывает панель со справочниками и ссылками на любой странице браузера. Схема данных — в DATA ниже.
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
        // Cmd+Ё (macOS) / Ctrl+~ (Windows) — физическая клавиша ~ (Backquote)
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const mod = isMac ? e.metaKey : e.ctrlKey;
        return mod && e.code === 'Backquote' && !e.altKey && !e.shiftKey;
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
                    <span class="qb_kbd">${isMacOS() ? 'Cmd+Ё / Esc' : 'Ctrl+~ / Esc'}</span>
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
})();
