// ==UserScript==
// @name         Rover ID Switcher
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Быстрая смена номера ровера → всегда на /maintenance
// @author       You
// @match        https://tools.sdc.yandex-team.ru/rovers/*
// @match        https://tools.sdc.yandex-team.ru/rovers-old/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Rover ID Switcher-1.4.user.js
// @updateURL    https://raw.githubusercontent.com/Lgyniwka/Autofill-check/main/src/Rover ID Switcher-1.4.user.js
// ==/UserScript==

(function () {
    'use strict';

    function createInput() {
        if (document.getElementById('rover-id-switcher')) return;

        const input = document.createElement('input');
        input.id = 'rover-id-switcher';
        input.type = 'text';
        input.placeholder = 'ID';
        input.style.cssText = `
            position: fixed;
            top: 12px;
            right: 25%;
            transform: translateX(50%);
            z-index: 99999;
            width: 90px;
            height: 28px;
            padding: 0 8px;
            font-size: 14px;
            border: 1px solid #999;
            border-radius: 4px;
            background: #fff;
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
            outline: none;
        `;

        // Берём только цифры из текущего ID
        const match = location.pathname.match(/\/rovers(?:-old)?\/[a-zA-Z]?(\d+)/);
        if (match) {
            input.value = match[1];
        }

        (document.body || document.documentElement).appendChild(input);

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();

                const digits = input.value.trim().replace(/\D/g, '');
                if (!digits) return;

                const newId = 'a' + digits;

                // Определяем, rovers или rovers-old
                const base = location.pathname.includes('/rovers-old/')
                    ? '/rovers-old/'
                    : '/rovers/';

                // Всегда уходим на /maintenance
                const newUrl = `https://tools.sdc.yandex-team.ru${base}${newId}/maintenance`;

                location.href = newUrl;
            }
        });
    }

    // Быстрый фокус: Ctrl + Shift + I
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') {
            e.preventDefault();
            const input = document.getElementById('rover-id-switcher');
            if (input) {
                input.focus();
                input.select();
            }
        }
    });

    createInput();

    if (!document.body) {
        document.addEventListener('DOMContentLoaded', createInput);
    }

    // Для SPA-переходов
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            const old = document.getElementById('rover-id-switcher');
            if (old) old.remove();
            createInput();
        }
    }, 500);
})();