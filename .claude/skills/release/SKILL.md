---
name: release
description: Выпуск новой версии плагина AnimeVost: ченджлог, SemVer, тег vX.Y.Z, перенос latest, push, ссылки для Lampa. Используй, когда просят выпустить версию, запушить обновление или дать ссылку для приставки.
disable-model-invocation: true
---

# Выпуск версии

Push, force-push тега `latest` и publish — исходящие действия. Реальный запуск `release.py` только после подтверждения пользователя.

1. **Состояние**: `git status -sb`, `git log --oneline $(git describe --tags --abbrev=0)..HEAD`. Дерево должно быть чистым, ветка `main`.
2. **Зелёные проверки**: `npm run lint && npm test`.
3. **Ченджлог**: раздел `## [Unreleased]` в `CHANGELOG.md` описывает все пользовательские изменения (дополни по `git log`). Можно делегировать агенту `release-manager`.
4. **Версия по SemVer**: исправления — patch, новые фичи — minor, ломающие (формат данных, удалённые настройки) — major.
5. **Сухой прогон**: `python3 release.py X.Y.Z --dry-run`.
6. **Подтверждение пользователя** на выпуск (push + force-push `latest`).
7. **Выпуск**: `python3 release.py X.Y.Z` — версия в коде, секция в CHANGELOG, коммит `Release vX.Y.Z`, аннотированный тег с заметками, перенос `latest`, push, purge jsDelivr.
8. **Проверка**: `python3 release.py --check`; `curl -sI https://cdn.jsdelivr.net/gh/igorstasiuk/animevost-lampa@vX.Y.Z/animevost.js` — 200, размер совпадает с `wc -c animevost.js`.
9. **Сообщить пользователю** ссылки: `@vX.Y.Z` (мгновенно) и `@1` (автообновление, кеш до 12 ч CDN / 7 дней WebView). **Не `@latest`/`@main`.** На приставке: удалить старый плагин → добавить ссылку → полностью закрыть и открыть Lampa; версия видна в Настройки → AnimeVost.
