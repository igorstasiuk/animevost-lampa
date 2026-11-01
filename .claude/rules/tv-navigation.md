---
paths:
  - "animevost.js"
  - "test/**"
---

# Навигация пультом (D-pad)

Фокус двигает **`Grid`** — не пространственный `Navigator` Lampa. Правила:

1. Контроллер страницы называется **`content`**: `new Grid('content', scroll)`, `Lampa.Controller.toggle('content')`. Меню/шапка/настройки/плеер возвращаются через `toggle('content')`; иначе фокус пропадает.
2. Ряды — массивы jQuery-элементов: `rows[ROW_BTNS]`, `rows[ROW_EPS]`; динамические ряды (сетка с переносом) — через `grid.layout(fn)` (пересчёт по `offsetTop` перед каждым ходом). После изменения рядов — `grid.set(rows, true)` (сохраняет текущий фокус).
3. У каждого фокусируемого элемента: `.selector`, `hover:focus` → `grid.track(el)` + `scroll.update(…)`, `hover:hover hover:touch` → `grid.track(el)`, `hover:enter` → действие. Долгое нажатие: `hover:long` (+ `contextmenu` для мыши).
4. Пустого экрана быть не должно: ошибка загрузки = экран с «Повторить»/«Назад» (`failView`), а не пустая страница.
5. Системные окна (`Lampa.Select`, `Modal`, `Input`): перед продолжением работы **сначала** `Lampa.Controller.toggle('content')` (в `onSelect` и `onBack`), иначе активным остаётся скрытый контроллер окна.
6. Выпадающий список — свой контроллер `animevost_dd` (up/down внутри, left/right/back закрывают); закрывается и при внешнем `toggle('content')` (`grid.onToggle`). Прокрутка списка — вручную через `scrollTop`, **не** `scrollIntoView` (ломает transform-скролл Lampa).
7. Асинхронные ответы (загрузка, связанные тайтлы) проверяют `destroyed` и `token`; кнопка, появляющаяся позже (сезоны), добавляется в ряд без потери фокуса.
8. Любое изменение навигации — сценарий в `test/full.js` (клавиши → ожидаемый элемент в фокусе) и прогон `npm test`. Раскладку jsdom не считает — проверять на устройстве.
