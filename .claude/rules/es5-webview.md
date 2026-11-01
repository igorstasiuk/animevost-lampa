---
paths:
  - "animevost.js"
---

# ES5 и старые WebView телевизоров

`animevost.js` исполняется в WebView Android TV / Tizen / webOS (Chrome 45+ минимум, часто старше). Пиши как в соседнем коде:

- Только `var`, `function () {}`, строки через `+`. Нельзя: `=>`, `let`, `const`, шаблонные строки, деструктуризация, spread, классы, `for…of`.
- Нельзя методы ES6+: `findIndex`, `find`, `includes`, `startsWith`, `endsWith`, `padStart`, `Object.assign` (используй `$.extend`), `Object.values/entries`, `Array.from`. Цикл `for` вместо `findIndex`. `Promise`/`fetch` — нет (сеть: `$.ajax` через `request()`); промисы Lampa (`Lampa.Cache`) только потреблять через `.then`/`['catch']`.
- CSS: без `display:grid`, `gap` у flex, `aspect-ratio`, `clamp()`, `min()`/`max()`, переменных `var(--x)`, `:is()`. Раскладка — flex-wrap + проценты/em + `@media (max-width)`; пропорции — трюк `height:0; padding-top:%`. Отступы — `margin`, не `gap`.
- Эмодзи/символы вроде ⏱ ✓ ▾ могут не отрисоваться на старых ТВ — не делай на них единственную подсказку смысла.
- После правок: `npm run lint` и сканер `grep -nE "=>|\blet |\bconst |\`|\.includes\(|\.findIndex\(|Object\.assign|Array\.from|gap:" animevost.js` — должен быть пуст.
