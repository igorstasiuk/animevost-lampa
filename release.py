#!/usr/bin/env python3
"""Выпуск версии плагина: версия в коде + CHANGELOG + git-тег + публикация.

    ./release.py 1.1.0              # выпустить версию (коммит, тег v1.1.0, push)
    ./release.py 1.1.0 --dry-run    # показать, что будет сделано, ничего не менять
    ./release.py 1.1.0 --no-push    # коммит и тег локально, без push
    ./release.py --check            # проверить согласованность VERSION / CHANGELOG / тега

Тег `latest` — подвижный: после каждого выпуска переносится на новую версию
(force-push тега), ссылка @latest всегда ведёт на последнюю версию. jsDelivr кеширует
подвижные теги (CDN до 12 ч, браузер/WebView до 7 дней), поэтому для мгновенного
обновления на устройстве используй ссылку с конкретным тегом @vX.Y.Z.

Перед выпуском опиши изменения в разделе «## [Unreleased]» файла CHANGELOG.md
(подзаголовки «### Добавлено», «### Изменено», «### Исправлено», «### Удалено»).
"""
import datetime
import os
import re
import shutil
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(ROOT, "animevost.js")
CHANGELOG = os.path.join(ROOT, "CHANGELOG.md")
REPO = "igorstasiuk/animevost-lampa"
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def run(*cmd, check=True):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if check and r.returncode:
        sys.exit("Ошибка: %s\n%s%s" % (" ".join(cmd), r.stdout, r.stderr))
    return r.stdout.strip()


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def ver_key(v):
    return tuple(int(x) for x in v.split("."))


def code_version():
    m = re.search(r"var VERSION = '(\d+\.\d+\.\d+)';", read(PLUGIN))
    if not m:
        sys.exit("В animevost.js не найден «var VERSION = '…';»")
    return m.group(1)


def last_tag():
    tags = [t[1:] for t in run("git", "tag", "--list", "v*").split() if SEMVER.match(t[1:])]
    return max(tags, key=ver_key) if tags else None


def changelog_top():
    m = re.search(r"^## \[(\d+\.\d+\.\d+)\]", read(CHANGELOG), re.M)
    return m.group(1) if m else None


def unreleased_body(text):
    m = re.search(r"^## \[Unreleased\]\n(.*?)(?=^## \[|\Z)", text, re.M | re.S)
    return m.group(1).strip() if m else ""


def section_body(text, version):
    m = re.search(r"^## \[%s\][^\n]*\n(.*?)(?=^## \[|^\[Unreleased\]:|\Z)" % re.escape(version), text, re.M | re.S)
    return m.group(1).strip() if m else ""


def purge(ref):
    url = "https://purge.jsdelivr.net/gh/%s@%s/animevost.js" % (REPO, ref)
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            print("jsDelivr purge @%s: HTTP %s" % (ref, r.status))
    except Exception as e:  # сеть не критична для выпуска
        print("jsDelivr purge @%s не удался: %s" % (ref, e))


def check():
    code, top, tag = code_version(), changelog_top(), last_tag()
    print("VERSION в коде:      ", code)
    print("Верх CHANGELOG:      ", top)
    print("Последний git-тег:   ", tag)
    latest = run("git", "rev-list", "-n1", "latest", check=False)
    expected = run("git", "rev-list", "-n1", "v%s" % tag, check=False) if tag else ""
    print("Тег latest → коммит: ", latest[:7] or "нет", "(ожидается %s)" % (expected[:7] or "—"))
    ok = code == top == tag and bool(latest) and latest == expected
    print("OK" if ok else "РАСХОЖДЕНИЕ: версия в коде, ченджлог, последний тег и latest должны совпадать после выпуска")
    return 0 if ok else 1


def release(version, dry, push):
    if not SEMVER.match(version):
        sys.exit("Версия должна быть вида X.Y.Z, получено: %s" % version)
    prev = last_tag()
    if prev and ver_key(version) <= ver_key(prev):
        sys.exit("Версия %s не больше последнего тега v%s" % (version, prev))
    if run("git", "rev-parse", "--abbrev-ref", "HEAD") != "main":
        sys.exit("Выпускать нужно с ветки main")
    if run("git", "status", "--porcelain", "--untracked-files=no"):
        sys.exit("Есть незакоммиченные изменения — закоммить или убери их перед выпуском")

    text = read(CHANGELOG)
    body = unreleased_body(text)
    if not body:
        sys.exit("Раздел [Unreleased] в CHANGELOG.md пуст — опиши изменения")

    today = datetime.date.today().isoformat()
    print("Версия: %s → %s (%s)" % (prev or "—", version, today))
    print("Изменения:\n" + "\n".join("  " + l for l in body.splitlines()))
    if dry:
        print("\n--dry-run: ничего не изменено")
        return

    # 1. версия в коде
    code = read(PLUGIN)
    code = re.sub(r"var VERSION = '\d+\.\d+\.\d+';", "var VERSION = '%s';" % version, code, count=1)
    write(PLUGIN, code)
    if shutil.which("node"):
        run("node", "--check", PLUGIN)

    # 2. CHANGELOG: Unreleased → новая секция + ссылки сравнения
    text = text.replace("## [Unreleased]\n", "## [Unreleased]\n\n## [%s] - %s\n" % (version, today), 1)
    text = re.sub(r"^\[Unreleased\]: .*$", "[Unreleased]: https://github.com/%s/compare/v%s...HEAD" % (REPO, version), text, flags=re.M)
    link = "[%s]: https://github.com/%s/compare/v%s...v%s" % (version, REPO, prev, version) if prev else \
           "[%s]: https://github.com/%s/releases/tag/v%s" % (version, REPO, version)
    text = re.sub(r"^(\[Unreleased\]: .*)$", r"\1\n" + link.replace("\\", "\\\\"), text, count=1, flags=re.M)
    write(CHANGELOG, text)

    # 3. коммит + аннотированный тег с заметками из ченджлога
    run("git", "add", "animevost.js", "CHANGELOG.md")
    run("git", "commit", "-m", "Release v%s" % version)
    notes = "AnimeVost для Lampa v%s\n\n%s\n" % (version, section_body(read(CHANGELOG), version))
    run("git", "tag", "-a", "v%s" % version, "-m", notes)
    run("git", "tag", "-f", "latest", "v%s^{commit}" % version)
    print("Создан коммит, тег v%s и перенесён тег latest" % version)

    # 4. публикация
    if push:
        run("git", "push", "origin", "main")
        run("git", "push", "origin", "v%s" % version)
        run("git", "push", "--force", "origin", "refs/tags/latest")
        print("Запушены main, тег v%s и latest" % version)
        purge("latest")
        if shutil.which("gh"):
            run("gh", "release", "create", "v%s" % version, "--title", "v%s" % version, "--notes", section_body(read(CHANGELOG), version))
            print("Создан GitHub Release")
    else:
        print("--no-push: выполни `git push origin main v%s` вручную" % version)

    print("\nСсылки для Lampa (Настройки → Расширения → Добавить плагин):")
    print("  закреплённая (обновится сразу): https://cdn.jsdelivr.net/gh/%s@v%s/animevost.js" % (REPO, version))
    print("  всегда последняя (кеш до 12 ч): https://cdn.jsdelivr.net/gh/%s@latest/animevost.js" % REPO)


def main(argv):
    if "--check" in argv:
        sys.exit(check())
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1:
        print(__doc__)
        sys.exit(2)
    release(args[0].lstrip("v"), "--dry-run" in argv, "--no-push" not in argv)


if __name__ == "__main__":
    main(sys.argv[1:])
