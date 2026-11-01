# AnimeVost для Lampa — рабочие правила проекта

Плагин для медиацентра Lampa: страница AnimeVost (дашборд онгоингов по дням, страница тайтла, серии, сезоны, история, отметки просмотра, выбор плеера, поиск, ряды на главной Lampa).
Один файл без сборки и зависимостей: `animevost.js` (ES5). Целевые устройства: **Android TV приставка (пульт)** — основное; плюс Mac/ПК, телефоны, другие ТВ.
Репозиторий: <https://github.com/igorstasiuk/animevost-lampa>. Пользователь общается по-русски.

## Команды

```bash
npm test                      # интеграционные тесты (jsdom + заглушка Lampa; нужен интернет)
npm run lint                  # node --check animevost.js
npm run check                 # lint + согласованность VERSION / CHANGELOG / тега
sh tools/lampa-source.sh      # скачать бандл Lampa в .cache/lampa/app.js (эталон API)
sh tools/lampa-grep.sh '<строка>' [N]   # найти в бандле Lampa и показать контекст
python3 release.py X.Y.Z --dry-run      # проверить выпуск; без --dry-run — реальный выпуск
```

## Карта animevost.js (по порядку в файле)

| Блок | Что внутри |
|---|---|
| Чистые функции | `parseAnime`, `groupByDay`, `parseSchedule`/`nextAiring`/`applySchedule` (расписание сайта, МСК), `countdownText`, `franchiseKey`/`relationLabel`/`relationKind`/`sortRelated` (сезоны), `lampaQuery`, `fmtTime`. Не зависят от Lampa, экспортируются через `module.exports` для node-тестов. |
| Storage/настройки | `setting`, `api`, `httpsify`, `setImage` (цепочка фолбэков картинок), `bigGet`/`bigSet` (IndexedDB через `Lampa.Cache`), `getMap`, `episodeHash`, `remember` |
| Сеть | `request` (+автоповтор), `loadOngoing`, `loadSchedule`/`fetchText`, `loadDashboard`, `searchAnime`, `loadRelated`, `loadAnime`, `cleanCaches` |
| Плеер | `PLAYERS`, `availablePlayers`, `choosePlayer`, `patchPlayer`/`restorePlayer`/`hookPlayer`, `applyPlayer`, `playEpisode` |
| UI | `injectStyle`, **`Grid`** (навигация пультом по рядам), `historyList`, `openAnime`, `MainComponent` (дашборд/поиск), `AnimeComponent` (страница тайтла) |
| Регистрация | `addMenu`, `addSettings`, `addGlobalSearch`, `addMainRows`, `start` |

API AnimeVost (`https://api.animevost.org/v1`, CORS открыт): `GET /last?page&quantity<=40`, `POST /search name=`, `POST /info id=`, `POST /playlist id=`. Расписания и связей между тайтлами в API нет: расписание читаем с главной animevost.org (без CORS → на Android нативный `Lampa.Reguest().native`, в браузере нужен прокси), сезоны ищем эвристикой по названию.

## Жёсткие ограничения (не нарушать)

- **ES5 и старые WebView ТВ**: без стрелочных функций, `let`/`const`, шаблонных строк, `Promise`/`fetch` (кроме промисов, которые возвращает сам Lampa), `findIndex`/`includes`/`startsWith`/`Object.assign`/`Array.from`, CSS grid и flex `gap`, `aspect-ratio`, `clamp()`. Проверка: `grep -nE "=>|\blet |\bconst |\`|\.includes\(|\.findIndex\(|gap:" animevost.js`.
- **Контроллер страницы называется `content`** (`new Grid('content', …)`, `Lampa.Controller.toggle('content')`). Меню, шапка, настройки и закрытие плеера возвращают фокус именно туда; другое имя = «фокус пропал, работает только Назад». Исключение — выпадающий список `animevost_dd`.
- **Навигация только через `Grid`** (ряды элементов, свой left/right/up/down), не через пространственный `Navigator`: он прыгает между вложенными скроллами на ТВ. Любой экран должен оставлять хотя бы один выбираемый элемент (при ошибке — «Повторить»/«Назад»).
- **Устаревшие ответы игнорировать**: в компонентах токен `token`/`destroyed` — ответ после ухода со страницы или после нового запроса не должен менять экран.
- **Не трогать глобальное состояние Lampa надолго**: подмена `Storage 'player'` — только через `patchPlayer`/`restorePlayer`; `launch_player` и `Player.callback` сбрасываются по событию Player `external`.
- **Данные из API → DOM только через `.text()`/`.attr()`**, не `.html()` (в т. ч. `Noty.show`).
- **Сигнатуры Lampa API проверять по бандлу** (`tools/lampa-grep.sh`), не по памяти: имена в бандле с суффиксами, сигнатуры меняются.

## Тесты

`npm test` = `test/full.js` (jsdom). Каждая фича/багфикс UI — новый сценарий там же (структура и хелперы описаны в шапке файла). jsdom не считает раскладку (`offsetTop = 0`), поэтому перенос строк сетки и реальные размеры проверяются только на устройстве — об этом честно писать в отчёте, а не заявлять «проверено».
Ограничения среды: локальный HTTP-сервер и протокол `file:` в браузерных инструментах могут быть запрещены — не обходить.

## Релизы и версии

- Версия: `var VERSION` в `animevost.js` = верхняя секция `CHANGELOG.md` = последний git-тег `vX.Y.Z`.
- Изменения сначала в `## [Unreleased]` файла `CHANGELOG.md` (Keep a Changelog: Добавлено/Изменено/Исправлено/Удалено), затем `python3 release.py X.Y.Z` (коммит, аннотированный тег, перенос тега `latest`, push, purge jsDelivr). SemVer: исправление — patch, фича — minor, ломающее — major.
- **Ссылки для Lampa**: `@vX.Y.Z` (мгновенно, не кешируется) или `@1` (автообновление в рамках 1.x, кеш до 12 ч CDN / 7 дней WebView). **Никогда `@latest` и `@main`** — jsDelivr кеширует их как неизменяемые/на дни, устройство остаётся на старой версии.
- Push, force-push тега `latest` и релиз — исходящие действия: перед `release.py` без `--dry-run` спросить подтверждение у пользователя.
- После выпуска сообщить пользователю хеш/тег и ссылку; на приставке нужно полностью закрыть и открыть Lampa.

## Инструменты для ускорения (`.claude/`)

- Агенты: `lampa-api-checker` (сверка вызовов Lampa API с бандлом), `tv-nav-reviewer` (ревью фокуса/пульта), `plugin-qa` (прогон и дополнение тестов), `release-manager` (подготовка и проверка выпуска).
- Скиллы: `/add-feature`, `/release`, `/test-plugin`, `/lampa-source`.
- Правила в `.claude/rules/` подгружаются по путям файлов (ES5, ТВ-навигация, Lampa API, тесты, ченджлог).
