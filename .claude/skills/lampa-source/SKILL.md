---
name: lampa-source
description: Найти в исходниках Lampa реализацию функции или формат параметров (Controller, Select, Scroll, Timeline, Player, Cache, SettingsApi, ContentRows и т.д.). Используй перед вызовом любого Lampa API, в котором не уверен, и при отладке «в заглушке работает, в Lampa нет».
---

# Исходники Lampa как эталон

Бандл: `.cache/lampa/app.js` (~2.3 МБ, не в git). Скачать/обновить: `sh tools/lampa-source.sh`.

**Поиск**: `sh tools/lampa-grep.sh '<строка>' [строк_после]` — фиксированная строка (не regexp), печатает до 8 вхождений с контекстом.
- Имена в бандле с суффиксами: `function open$5(`, `function update$f(`, `function view$1(`. Ищи по куску (`function collectionFocus`, `Controller.add('content'`, `ContentRows.add(`).
- Не читай файл целиком — только нужные фрагменты (`sed -n 'A,Bp' .cache/lampa/app.js | cut -c1-140`).

**Что выяснять**: сигнатуру и порядок аргументов; какие поля объекта читаются; что при ошибке/отсутствии (промис без `reject`, `life_time ≠ -1`); побочные эффекты (`launch_player`, `Storage 'player'`, активный контроллер, `Controller.toggle('content')`); где API вызывается самой Lampa (например `Select.hide` → `windowClose`).

**Известные факты (проверены по бандлу)**
- Меню/шапка/настройки/закрытие плеера возвращают фокус через `Controller.toggle('content')`; компоненты Lampa регистрируют контроллер `content`.
- `Controller.collectionFocus(target, html)`: если `target.offsetParent === null` — целится в первый `.selector`. Enter без своего `enter` в контроллере → `hover:enter` на активном элементе.
- `Player.callback` вызывается только при закрытии встроенного плеера; внешний плеер даёт событие `Player.listener 'external'`. `launch_player` сбрасывается только при закрытии встроенного (`Player.runas('')` — вручную).
- Playlist-элемент: `callback` вызывается при автопереходе на серию.
- `Lampa.Cache.getData('other', key, -1)` → `Promise<value|null>`; `rewriteData` → `Promise`.
- `Timeline.view(hash)` → `{hash, percent, time, duration, handler}`; `Timeline.update({hash, percent, time, duration})`; `Timeline.listener` — `follow/remove('update')`.
- `ContentRows.add({name, title, index, screen:['main'], call(params, screen) → function(call){ call({results, title}) }})`.
- `Search.open({input})` открывает поиск с предзаполненным запросом, закрытие возвращает `toggle('content')`.
