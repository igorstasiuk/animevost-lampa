---
paths:
  - "animevost.js"
---

# Lampa API — сверяй с исходниками

Не полагайся на память: в бандле Lampa имена с суффиксами (`open$5`, `update$f`), сигнатуры меняются между версиями.

1. Перед использованием нового вызова: `sh tools/lampa-grep.sh '<кусок>' 25` (бандл кешируется в `.cache/lampa/app.js`, при отсутствии скачивается).
2. Ищи фиксированной строкой: `function collectionFocus`, `Controller.add('content'`, `function open$5(`.
3. Выясни: сигнатуру, что происходит при ошибке/отсутствии, какие поля читает (например `Select.show`: `title/subtitle/selected/value`, `onSelect/onBack`), есть ли побочный эффект на глобальное состояние.
4. Опциональные API (`ContentRows`, `Search.addSource`, `Cache`, `Modal`, `Timeline.listener`) — оборачивай в проверку наличия и `try/catch`: их отсутствие не должно ломать плагин.
5. Если вызов нельзя проверить без живого устройства — так и пиши в отчёте и в CHANGELOG-заметке, не заявляй «работает».
6. Подвижные части: `Lampa.Storage.get` приводит строки `'true'/'false'`/числа к типам; `Lampa.Cache.getData(..., life_time)` с life_time ≠ -1 может не разрешиться — всегда `-1`.
