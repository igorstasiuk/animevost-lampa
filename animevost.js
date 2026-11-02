/*!
 * AnimeVost for Lampa
 * Отдельная страница: дашборд онгоингов по дням недели, список серий,
 * запоминание прогресса/таймкода, выбор плеера.
 * API: https://api.animevost.org/v1
 */
(function () {
    'use strict';

    var VERSION = '1.3.0';
    var DEFAULT_API = 'https://api.animevost.org/v1';
    var DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    var MONTHS = { 'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3, 'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7, 'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11 };
    var CACHE_TTL = 30 * 60 * 1000;

    /* ------------------------------------------------------------------ */
    /*  Pure helpers (без зависимостей от Lampa — можно тестировать в node) */
    /* ------------------------------------------------------------------ */

    function dayIndex(date) {
        return (date.getDay() + 6) % 7; // 0 = понедельник
    }

    // "Рус / Eng [1-5 из 12+] [6 серия - 8 ноября]" -> структура
    function parseAnime(a, now) {
        now = now || new Date();
        var raw = a.title || '';
        var br = raw.indexOf(' [');
        var name = br > -1 ? raw.slice(0, br) : raw;
        var tags = br > -1 ? raw.slice(br) : '';
        var parts = name.split(' / ');

        var item = {
            id: a.id,
            ru: parts[0] || name,
            en: parts.slice(1).join(' / '),
            description: (a.description || '').replace(/<[^>]*>/g, ''),
            genre: a.genre || '',
            year: a.year || '',
            type: a.type || '',
            director: a.director || '',
            rating: a.rating || 0,
            votes: a.votes || 0,
            poster: a.urlImagePreview || '',
            current: 0,
            total: 0,
            plus: false,
            nextEp: '',
            nextDate: null,
            airAt: 0,
            airExact: false,
            airTime: '',
            airMin: -1,
            day: -1,
            ongoing: false
        };

        var prog = tags.match(/\[(\d+)(?:-(\d+))?\s+из\s+(\d+)(\+)?/);
        if (prog) {
            item.current = parseInt(prog[2] || prog[1], 10);
            item.total = parseInt(prog[3], 10);
            item.plus = !!prog[4];
        }

        var timer = parseInt(a.timer, 10) * 1000 || 0;
        var next = tags.match(/\[(\d+)\s+серия\s*-\s*(\d+)\s+([А-Яа-яЁё]+)/);
        if (next && MONTHS[next[3].toLowerCase()] !== undefined) {
            var mon = MONTHS[next[3].toLowerCase()], dom = parseInt(next[2], 10);
            // год подбираем так, чтобы дата оказалась ближайшей к сегодня (переход через Новый год)
            var d = null;
            [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].forEach(function (y) {
                var c = new Date(y, mon, dom);
                if (!d || Math.abs(c - now) < Math.abs(d - now)) d = c;
            });
            // дата в заголовке прошла (сайт не обновил тег) — сериал недельный, переносим на ближайшую будущую неделю
            var today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            for (var w = 0; d < today0 && w < 9; w++) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
            item.nextEp = next[1] + ' серия';
            item.nextDate = d;
            item.day = dayIndex(d);
            // timer даёт точное время; верим ему, если он в будущем и не дальше суток от даты в заголовке
            var useTimer = timer > now.getTime() && Math.abs(timer - d.getTime()) < 36 * 3600000;
            item.airAt = useTimer ? timer : d.getTime();
            item.airExact = useTimer;
        } else if (timer > now.getTime() - 86400000) {
            item.nextDate = new Date(timer);
            item.day = dayIndex(item.nextDate);
            if (item.current) item.nextEp = (item.current + 1) + ' серия';
            item.airAt = timer;
            item.airExact = timer > now.getTime();
        }

        item.ongoing = item.day > -1 || item.plus || (item.total > 0 && item.current < item.total);
        return item;
    }

    // По дням, начиная с сегодняшнего; "без даты" в конце
    function groupByDay(list, now) {
        now = now || new Date();
        var today = (new Date(now.getTime() + 3 * 3600000).getUTCDay() + 6) % 7; // дни расписания — московские
        var buckets = [[], [], [], [], [], [], []];
        var undated = [];

        list.forEach(function (a) {
            if (!a.ongoing) return;
            if (a.day > -1) buckets[a.day].push(a);
            else undated.push(a);
        });

        var sections = [];
        var byTime = function (x, y) {
            var a = x.airMin >= 0 ? x.airMin : 9999, b = y.airMin >= 0 ? y.airMin : 9999;
            return a - b;
        };
        for (var i = 0; i < 7; i++) {
            var idx = (today + i) % 7;
            if (!buckets[idx].length) continue;
            buckets[idx].sort(byTime);
            var prefix = i === 0 ? 'Сегодня · ' : i === 1 ? 'Завтра · ' : '';
            sections.push({ title: prefix + DAYS[idx], items: buckets[idx] });
        }
        if (undated.length) sections.push({ title: 'Без даты выхода', items: undated });
        return sections;
    }

    // Расписание с главной animevost.org: блоки raspisMon..raspisSun, в ссылках id тайтла и время (МСК)
    var SITE_DAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

    function parseSchedule(html) {
        var map = {}, count = 0;
        var re = /id=["']raspis(Mon|Tue|Wed|Thu|Fri|Sat|Sun)["'][^>]*>([\s\S]*?)<\/div>/g, m;
        while ((m = re.exec(html || ''))) {
            var day = SITE_DAYS[m[1]];
            var link = /href=["'][^"']*?\/(\d+)-[^"']*["'][^>]*>([^<]*?)\s*~\s*\(([^)]*)\)/g, l;
            while ((l = link.exec(m[2]))) {
                var t = l[3].match(/(\d{1,2}):(\d{2})/);
                map[l[1]] = { day: day, time: t ? t[1].replace(/^(\d)$/, '0$1') + ':' + t[2] : '', min: t ? parseInt(t[1], 10) * 60 + parseInt(t[2], 10) : -1 };
                count++;
            }
        }
        return count ? map : null;
    }

    // Ближайший выход по расписанию (время на сайте — московское, UTC+3)
    function nextAiring(entry, now) {
        var MSK = 3 * 3600000;
        var base = new Date(now + MSK);
        for (var d = 0; d < 8; d++) {
            var day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + d));
            if ((day.getUTCDay() + 6) % 7 !== entry.day) continue;
            var minutes = entry.min >= 0 ? entry.min : 23 * 60 + 59;
            var at = day.getTime() + minutes * 60000 - MSK;
            if (at > now) return at;
        }
        return 0;
    }

    function applySchedule(item, entry, now) {
        if (!item || !entry) return item;
        now = now || Date.now();
        item.day = entry.day;
        item.airTime = entry.time;
        item.airMin = entry.min;
        item.ongoing = true;
        var at = nextAiring(entry, now);
        if (at) {
            item.airAt = at;
            item.airExact = entry.min >= 0;
            item.nextDate = new Date(at);
        }
        if (!item.nextEp && item.current) item.nextEp = (item.current + 1) + ' серия';
        return item;
    }

    // Текст "до выхода следующей серии"; '' если выхода не ожидается
    function countdownText(a, now) {
        now = now || Date.now();
        if (!a || !a.airAt || !a.ongoing) return '';
        var label = a.nextEp ? a.nextEp[0].toUpperCase() + a.nextEp.slice(1) : 'Следующая серия';
        var diff = a.airAt - now;
        if (a.airExact && diff > 0) {
            var d = Math.floor(diff / 86400000), h = Math.floor(diff % 86400000 / 3600000), m = Math.floor(diff % 3600000 / 60000);
            var parts = [];
            if (d) parts.push(d + ' д');
            if (d || h) parts.push(h + ' ч');
            parts.push(m + ' мин');
            return label + ' выйдет через ' + parts.join(' ');
        }
        var startOf = function (t) { var x = new Date(t); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
        var days = Math.round((startOf(a.airAt) - startOf(now)) / 86400000);
        if (days <= 0) return label + ' выходит сегодня';
        if (days === 1) return label + ' выходит завтра';
        return label + ' выйдет через ' + days + ' дн.';
    }

    var REL_MARK = /(^|[\s(])(сезон|фильм|ова|ova|ona|спешл|спэшл|special|спецвыпуск|пайлот|пилот|часть|эпизод|movie)/i;

    // Ключ франшизы: название без "(второй сезон)", "ОВА-1", "(фильм первый)" и подзаголовка после ":"
    function franchiseKey(ru) {
        var k = (ru || '').replace(/\s*\([^)]*\)/g, function (m) { return REL_MARK.test(m) ? '' : m; });
        k = k.replace(/\s+(ОВА|OVA|ONA)[\s\-\d].*$/i, '').replace(/\s+(ОВА|OVA|ONA)$/i, '');
        k = k.split(':')[0];
        return k.replace(/ё/gi, 'е').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    var ORD = { 'первый': 1, 'второй': 2, 'третий': 3, 'четвертый': 4, 'четвёртый': 4, 'пятый': 5, 'шестой': 6, 'седьмой': 7, 'восьмой': 8, 'девятый': 9, 'десятый': 10 };

    // Подпись для переключателя: "2 сезон", "Фильм 1", "ОВА", иначе подзаголовок
    function relationLabel(a) {
        var ru = a.ru || '';
        var m = ru.match(/\(([^)]*?)\s*сезон[^)]*\)/i);
        if (m) {
            var w = m[1].trim().toLowerCase();
            return (ORD[w] || parseInt(w, 10) || w) + ' сезон';
        }
        m = ru.match(/\(фильм\s*([^)]*)\)/i);
        if (m) return 'Фильм' + (ORD[m[1].trim().toLowerCase()] ? ' ' + ORD[m[1].trim().toLowerCase()] : (m[1] ? ' ' + m[1] : ''));
        m = ru.match(/(?:^|\s)(?:ОВА|OVA)(?=[\s\-\d]|$)[\s\-]*(\d*)/i);
        if (m) return m[1] ? 'ОВА ' + m[1] : 'ОВА';
        if (/полнометражн/i.test(a.type) || /фильм/i.test(a.type)) return 'Фильм';
        if (/ona/i.test(a.type)) return 'ONA';
        var sub = ru.split(':').slice(1).join(':').trim();
        if (sub) return sub;
        return /ТВ/i.test(a.type) ? '1 сезон' : (a.type || 'Тайтл');
    }

    // Тип части франшизы: сезоны идут первыми, потом фильмы, ОВА и остальное
    function relationKind(a) {
        var ru = a.ru || '';
        if (/\(фильм/i.test(ru) || /полнометражн|фильм/i.test(a.type || '')) return 1;
        if (/(?:^|\s)(?:ОВА|OVA)(?=[\s\-\d]|$)/i.test(ru) || /ova/i.test(a.type || '')) return 2;
        if (/ona|спешл|спэшл|special/i.test(a.type || '') || /\((?:спешл|спэшл|спецвыпуск|пайлот|пилот)/i.test(ru)) return 3;
        return 0;
    }

    function sortRelated(list) {
        return list.slice().sort(function (x, y) {
            return relationKind(x) - relationKind(y) ||
                (parseInt(x.year, 10) || 0) - (parseInt(y.year, 10) || 0) || x.id - y.id;
        });
    }

    // ----- Каталог сайта: жанры, категории, годы, онгоинги, анонсы -----
    // Разделы сайта (DLE). Слаги — из меню animevost.org; список жанров совпадает с /v1/genres.
    var CATALOG_GENRES = [
        ['boyevyye-iskusstva', 'Боевые искусства'], ['voyna', 'Война'], ['drama', 'Драма'], ['detektiv', 'Детектив'],
        ['istoriya', 'История'], ['komediya', 'Комедия'], ['mekha', 'Меха'], ['mistika', 'Мистика'],
        ['makho-sedze', 'Махо-сёдзё'], ['muzykalnyy', 'Музыкальный'], ['povsednevnost', 'Повседневность'],
        ['priklyucheniya', 'Приключения'], ['parodiya', 'Пародия'], ['romantika', 'Романтика'], ['senen', 'Сёнэн'],
        ['sedze', 'Сёдзё'], ['sport', 'Спорт'], ['skazka', 'Сказка'], ['sedze-ay', 'Сёдзё-ай'], ['senen-ay', 'Сёнэн-ай'],
        ['samurai', 'Самураи'], ['triller', 'Триллер'], ['uzhasy', 'Ужасы'], ['fantastika', 'Фантастика'],
        ['fentezi', 'Фэнтези'], ['shkola', 'Школа'], ['etti', 'Этти']
    ];
    var CATALOG_TYPES = [
        ['tv', 'ТВ'], ['tv-speshl', 'ТВ-спэшл'], ['ova', 'OVA'], ['ona', 'ONA'],
        ['polnometrazhnyy-film', 'Полнометражный фильм'], ['korotkometrazhnyy-film', 'Короткометражный фильм'], ['dunkhua', 'Дунхуа']
    ];

    function catalogYears(now) {
        var y = (now || new Date()).getFullYear(), out = [];
        for (; y >= 1991; y--) out.push(String(y));
        return out.concat(['1984', '1980', '1977', '1971']);
    }

    // Путь раздела каталога: kind = ongoing | preview | genre | type | year
    function catalogPath(kind, slug) {
        if (kind === 'ongoing') return 'ongoing/';
        if (kind === 'preview') return 'preview/';
        if (kind === 'genre') return 'zhanr/' + slug + '/';
        if (kind === 'type') return 'tip/' + slug + '/';
        if (kind === 'year') return 'god/' + slug + '/';
        return '';
    }

    function catalogUrl(site, path, page) {
        return site.replace(/\/+$/, '') + '/' + path + (page > 1 ? 'page/' + page + '/' : '');
    }

    // id тайтлов со страницы каталога. Десктопная и мобильная вёрстки сайта разные (разметка зависит от User-Agent),
    // поэтому два шаблона; сайдбары не попадают — берём только блоки записей. Порядок как на странице, без повторов.
    function parseCatalogIds(html) {
        var found = [], seen = {};
        var patterns = [
            /<div class="shortstory">\s*<div class="shortstoryHead">\s*<h2>\s*<a href="[^"]*?\/(\d+)-[^"]*"/g,
            /<article class="post"[^>]*>\s*<span><a href="[^"]*?\/(\d+)-[^"]*"/g
        ];
        patterns.forEach(function (re) {
            var m;
            while ((m = re.exec(html || ''))) found.push({ at: m.index, id: m[1] });
        });
        found.sort(function (a, b) { return a.at - b.at; });
        return found.map(function (f) { return f.id; }).filter(function (id) {
            if (seen[id]) return false;
            seen[id] = true;
            return true;
        });
    }

    // Запрос для поиска карточки в Lampa/TMDB: английское название без номера сезона и года
    function lampaQuery(a) {
        var en = (a.en || '').split(':')[0]
            .replace(/\s*\(\d{4}\)\s*$/, '')
            .replace(/\s+(\d+(st|nd|rd|th) season|season \d+|part \d+|\d+)$/i, '')
            .replace(/\s+/g, ' ').trim();
        return en || franchiseKey(a.ru) || a.ru || '';
    }

    function fmtTime(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
        var p = function (n) { return n < 10 ? '0' + n : '' + n; };
        return (h ? h + ':' + p(m) : m) + ':' + p(s);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { parseCatalogIds: parseCatalogIds, catalogPath: catalogPath, catalogUrl: catalogUrl, catalogYears: catalogYears, CATALOG_GENRES: CATALOG_GENRES, CATALOG_TYPES: CATALOG_TYPES, VERSION: VERSION, lampaQuery: lampaQuery, parseSchedule: parseSchedule, applySchedule: applySchedule, nextAiring: nextAiring, relationKind: relationKind, countdownText: countdownText, franchiseKey: franchiseKey, relationLabel: relationLabel, sortRelated: sortRelated, parseAnime: parseAnime, groupByDay: groupByDay, fmtTime: fmtTime, dayIndex: dayIndex };
    }

    if (typeof window === 'undefined' || typeof Lampa === 'undefined') return;
    if (window.animevost_plugin_ready) return;
    window.animevost_plugin_ready = true;

    /* ------------------------------------------------------------------ */
    /*  Storage / settings                                                */
    /* ------------------------------------------------------------------ */

    var PLAYERS = {
        lampa: 'Как в настройках Lampa',
        inner: 'Встроенный плеер Lampa',
        android: 'Внешний (Android / Lampa)',
        webos: 'Внешний (webOS)',
        vlc: 'VLC',
        infuse: 'Infuse',
        iina: 'IINA (macOS)',
        mpv: 'mpv',
        nplayer: 'nPlayer',
        senplayer: 'SenPlayer',
        copy: 'Скопировать ссылку'
    };

    function setting(name, def) {
        var v = Lampa.Storage.get(name, def + '');
        return v === '' ? def : v;
    }

    function api() {
        var url = ('' + setting('animevost_api', DEFAULT_API)).trim().replace(/\/+$/, '');
        return /^https?:\/\//i.test(url) ? url : 'https://' + url.replace(/^\/+/, '');
    }

    function httpsify(url) {
        if (!url) return url;
        return setting('animevost_https', true) ? url.replace(/^http:\/\//, 'https://') : url;
    }

    // У static.openni.ru истёк https-сертификат, а http работает, поэтому для картинок идём по цепочке:
    // как отдал API -> другая схема -> прокси weserv -> заглушка. Рабочий вариант для хоста запоминаем на сессию,
    // чтобы не повторять неудачные запросы на каждой карточке.
    var imgMode = {};

    function imgHost(url) {
        var m = (url || '').match(/^https?:\/\/([^\/]+)/i);
        return m ? m[1].toLowerCase() : '';
    }

    function imgChain(url) {
        var plain = url.replace(/^https?:\/\//, '');
        var other = (/^https/.test(url) ? 'http://' : 'https://') + plain;
        return [url, other, 'https://images.weserv.nl/?url=' + encodeURIComponent(plain)];
    }

    function bestPoster(url) {
        if (!url) return url;
        var step = imgMode[imgHost(url)];
        return step ? imgChain(url)[step] : url;
    }

    function setImage(img, url, onFail) {
        if (!url) return onFail ? onFail() : img.attr('src', './img/img_broken.svg');
        var host = imgHost(url), chain = imgChain(url);
        var step = imgMode[host] || 0;
        img.off('error.avost load.avost');
        img.on('load.avost', function () { imgMode[host] = step; });
        img.on('error.avost', function () {
            if (++step < chain.length) img.attr('src', chain[step]);
            else if (onFail) onFail();
            else img.attr('src', './img/img_broken.svg');
        });
        img.attr('src', chain[step]);
    }

    // Ленивая загрузка картинок. Сначала грузится всё, что в зоне видимости с запасом (opts.margin экранов
    // вокруг), чтобы при прокрутке не мелькали пустые плейсхолдеры. opts.trickle > 0 — остальные картинки
    // подгружаются фоном по несколько штук за тик, пока пользователь смотрит экран: в итоге грузятся все
    // (постер нужен, чтобы узнать тайтл), но без одновременного шквала запросов. Проверка по таймеру и при
    // смене фокуса — без IntersectionObserver (его нет в старых WebView).
    function Lazy(opts) {
        opts = opts || {};
        var margin = opts.margin === undefined ? 1 : opts.margin, trickle = opts.trickle || 0;
        var items = [], timer = null;

        function near(n) {
            var r = n.getBoundingClientRect();
            var vh = window.innerHeight || 720, vw = window.innerWidth || 1280;
            return r.bottom > -vh * margin && r.top < vh * (1 + margin) && r.right > -vw * margin && r.left < vw * (1 + margin);
        }

        this.add = function (img, url, onFail) { items.push({ img: img, url: url, fail: onFail }); };
        this.reset = function () { items = []; };
        this.check = function () {
            if (document.hidden) return;
            var far = [];
            items = items.filter(function (it) {
                var n = it.img[0];
                if (!n || !$.contains(document.documentElement, n)) return true; // ещё не в DOM — ждём
                if (near(n)) {
                    setImage(it.img, it.url, it.fail);
                    return false;
                }
                far.push(it);
                return true;
            });
            // фоновая подгрузка дальних: несколько штук за тик, в порядке следования в DOM
            if (trickle && far.length) {
                far.slice(0, trickle).forEach(function (it) { setImage(it.img, it.url, it.fail); });
                items = items.filter(function (it) { return far.slice(0, trickle).indexOf(it) < 0; });
            }
        };
        this.start = function () {
            var self = this;
            if (!timer) timer = setInterval(function () { self.check(); }, 500);
        };
        this.stop = function () {
            clearInterval(timer);
            timer = null;
            items = [];
        };
    }

    function getMap(key) {
        var v = Lampa.Storage.get(key, '{}');
        return v && typeof v === 'object' ? v : {};
    }

    // Тяжёлые кеши (списки серий, дашборд) кладём в IndexedDB через Lampa.Cache, чтобы не раздувать localStorage.
    // Если база недоступна — откатываемся на localStorage. Всегда читаем с life_time = -1 (иначе промис может не разрешиться).
    var bigMem = {};

    function bigSet(key, value) {
        bigMem[key] = value;
        var fallback = function () { try { Lampa.Storage.set(key, value); } catch (e) { /* квота */ } };
        try {
            if (Lampa.Cache && Lampa.Cache.rewriteData) {
                Lampa.Cache.rewriteData('other', key, value)['catch'](fallback);
                try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
            } else fallback();
        } catch (e) { fallback(); }
    }

    function bigGet(key, cb) {
        if (bigMem[key]) return cb(bigMem[key]);
        var legacy = function () {
            var v = Lampa.Storage.get(key, '');
            cb(v && typeof v === 'object' ? v : null);
        };
        try {
            if (Lampa.Cache && Lampa.Cache.getData) {
                Lampa.Cache.getData('other', key, -1).then(function (v) {
                    if (v && typeof v === 'object') { bigMem[key] = v; cb(v); } else legacy();
                })['catch'](legacy);
            } else legacy();
        } catch (e) { legacy(); }
    }

    function episodeHash(animeId, epName) {
        return Lampa.Utils.hash('animevost:' + animeId + ':' + epName);
    }

    function remember(anime, epName, idx, count) {
        var st = getMap('animevost_state');
        var old = st[anime.id] || {};
        st[anime.id] = {
            count: count || old.count || 0,
            id: anime.id,
            ru: anime.ru,
            en: anime.en,
            poster: anime.poster,
            last: epName,
            idx: idx,
            ts: Date.now()
        };
        // держим историю компактной: не больше 60 тайтлов
        var ids = Object.keys(st).sort(function (a, b) { return st[b].ts - st[a].ts; });
        ids.slice(60).forEach(function (id) { delete st[id]; });
        Lampa.Storage.set('animevost_state', st);
    }

    /* ------------------------------------------------------------------ */
    /*  Network                                                           */
    /* ------------------------------------------------------------------ */

    // Один автоповтор: API AnimeVost иногда отвечает ошибкой/таймаутом с первого раза
    function request(path, post, ok, fail, retried) {
        $.ajax({
            url: api() + path,
            method: post ? 'POST' : 'GET',
            data: post || undefined,
            dataType: 'json',
            timeout: 15000,
            success: ok,
            error: function (xhr, status) {
                if (!retried) return request(path, post, ok, fail, true);
                fail && fail(status || 'error');
            }
        });
    }

    function loadOngoing(ok, fail, force) {
        bigGet('animevost_cache_last', function (cache) {
            loadOngoingWith(cache || {}, ok, fail, force);
        });
    }

    function loadOngoingWith(cache, ok, fail, force) {
        if (!force && cache.ts && Date.now() - cache.ts < CACHE_TTL && cache.list) return ok(cache.list);

        var pages = parseInt(setting('animevost_pages', 3), 10) || 3;
        var left = pages, map = {}, failed = 0;

        function done() {
            if (--left) return;
            var list = Object.keys(map).map(function (k) { return map[k]; });
            if (!list.length) {
                if (cache.list) return ok(cache.list); // отдаём устаревший кеш вместо ошибки
                return fail('empty');
            }
            // описания в кеше дашборда не нужны (карточки их не показывают) — кеш в разы легче
            bigSet('animevost_cache_last', {
                ts: Date.now(),
                list: list.map(function (a) { return $.extend({}, a, { description: '' }); })
            });
            ok(list);
        }

        for (var p = 1; p <= pages; p++) {
            (function (page) {
                request('/last?page=' + page + '&quantity=40', null, function (r) {
                    (r.data || []).forEach(function (a) { map[a.id] = parseAnime(a); });
                    done();
                }, function () { failed++; done(); });
            })(p);
        }
    }

    // Страница сайта без CORS: на Android Lampa ходит нативным запросом, в браузере — через прокси из настроек.
    // Сайт отдаёт разную вёрстку по User-Agent (для Android — мобильную без расписания), поэтому просим десктопную.
    var DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

    function fetchText(url, ok, fail) {
        var proxy = ('' + setting('animevost_proxy', '')).trim();
        var viaAjax = function () {
            if (!proxy) return fail('cors');
            $.ajax({ url: proxy + url, dataType: 'text', timeout: 20000, success: ok, error: function () { fail('proxy'); } });
        };
        try {
            new Lampa.Reguest().native(url, function (str) {
                typeof str === 'string' && str.length > 200 ? ok(str) : viaAjax();
            }, viaAjax, false, { dataType: 'text', headers: { 'User-Agent': DESKTOP_UA } });
        } catch (e) { viaAjax(); }
    }

    // Чистим устаревшие кеши серий/франшиз, чтобы не раздувать localStorage на ТВ
    function cleanCaches() {
        try {
            var ls = window.localStorage, now = Date.now(), pl = [];
            for (var i = ls.length - 1; i >= 0; i--) {
                var k = ls.key(i);
                if (!k || (k.indexOf('animevost_pl_') !== 0 && k.indexOf('animevost_rel_') !== 0)) continue;
                var v = null;
                try { v = JSON.parse(ls.getItem(k)); } catch (e) { /* битая запись */ }
                if (!v || !v.ts || now - v.ts > 30 * 86400000) { ls.removeItem(k); continue; }
                if (k.indexOf('animevost_pl_') === 0) pl.push({ k: k, ts: v.ts });
            }
            pl.sort(function (a, b) { return b.ts - a.ts; }).slice(40).forEach(function (e) { ls.removeItem(e.k); });
        } catch (e) { /* storage недоступен */ }
    }

    // Расписание: сначала выделенная страница /raspisanie.html (в ней блок с расписанием есть и в мобильной, и в десктопной
    // версии сайта), затем главная. Каждая попытка проверяется разбором, а не размером ответа. Итоги пишем в диагностику.
    function loadSchedule(ok, fail, force) {
        var cache = getMap('animevost_schedule');
        if (!force && cache.ts && Date.now() - cache.ts < 3 * 3600000 && cache.map) return ok(cache.map);
        var site = ('' + setting('animevost_site', 'https://animevost.org')).replace(/\/+$/, '') + '/';
        var urls = [site + 'raspisanie.html', site];
        var tries = [];

        function finish(map, err) {
            Lampa.Storage.set('animevost_diag', { ts: Date.now(), tries: tries, entries: map ? Object.keys(map).length : 0, error: err || '' });
            if (map) {
                Lampa.Storage.set('animevost_schedule', { ts: Date.now(), map: map });
                return ok(map);
            }
            cache.map ? ok(cache.map) : fail(err || 'parse');
        }

        function attempt(i) {
            if (i >= urls.length) return finish(null, 'нет расписания: ' + tries.map(function (t) { return t.url + ' → ' + (t.error || t.entries + ' записей'); }).join('; '));
            fetchText(urls[i], function (html) {
                var map = parseSchedule(html);
                tries.push({ url: urls[i], bytes: html.length, entries: map ? Object.keys(map).length : 0 });
                if (map) finish(map); else attempt(i + 1);
            }, function (e) {
                tries.push({ url: urls[i], error: '' + e });
                attempt(i + 1);
            });
        }
        attempt(0);
    }

    // Дашборд = свежие обновления из API + официальное расписание сайта (если удалось получить).
    // Тайтлы из расписания, которых нет среди последних обновлений, догружаются через /info.
    function loadDashboard(ok, fail, force) {
        var list = null, sched = null, left = 2;
        function done() {
            if (--left) return;
            if (!list) return fail('empty');
            if (!sched) return ok(list);
            var have = {};
            list.forEach(function (a) { have[a.id] = true; applySchedule(a, sched[a.id]); });
            var missing = Object.keys(sched).filter(function (id) { return !have[id]; }).slice(0, 20);
            if (!missing.length) return ok(list);
            var pending = missing.length;
            missing.forEach(function (id) {
                request('/info', { id: id }, function (r) {
                    if (r.data && r.data[0]) list.push(applySchedule(parseAnime(r.data[0]), sched[id]));
                    if (!--pending) ok(list);
                }, function () { if (!--pending) ok(list); });
            });
        }
        loadOngoing(function (l) { list = l; done(); }, function () { done(); }, force);
        loadSchedule(function (m) { sched = m; done(); }, function () { done(); }, force);
    }

    // Страница каталога сайта (онгоинги, анонсы, жанр, категория, год): id берём со страницы сайта (она без CORS —
    // на Android нативный запрос, в браузере через прокси), полные карточки — одним запросом /info по списку id.
    // Результат кешируем в памяти на 10 минут. Для года при недоступном сайте — запасной вариант через API.
    function loadCatalogPage(kind, slug, page, ok, fail) {
        var site = '' + setting('animevost_site', 'https://animevost.org');
        var url = catalogUrl(site, catalogPath(kind, slug), page);
        var key = 'cat:' + url, hit = bigMem[key];
        if (hit && Date.now() - hit.ts < 10 * 60000) return ok(hit.items, hit.more);

        var withSchedule = function (items) {
            var sc = getMap('animevost_schedule').map;
            if (sc) items.forEach(function (a) { if (sc[a.id]) applySchedule(a, sc[a.id]); });
            return items;
        };
        var done = function (items, more) {
            bigMem[key] = { ts: Date.now(), items: items, more: more };
            ok(items, more);
        };

        fetchText(url, function (html) {
            var ids = parseCatalogIds(html);
            if (!ids.length) return done([], false);
            var more = html.indexOf('/page/' + (page + 1) + '/') >= 0;
            request('/info', { id: ids.join(',') }, function (r) {
                var byId = {};
                (r.data || []).forEach(function (a) { byId[a.id] = parseAnime(a); });
                done(withSchedule(ids.map(function (id) { return byId[id]; }).filter(Boolean)), more);
            }, function () { fail('api'); });
        }, function (e) {
            if (kind === 'year' && page === 1) {
                return request('/search', { year: slug }, function (r) {
                    done((r.data || []).map(function (a) { return parseAnime(a); }), false);
                }, function () { fail(e); });
            }
            fail(e);
        });
    }

    function searchAnime(query, ok, fail) {
        request('/search', { name: query }, function (r) {
            ok((r.data || []).map(function (a) { return parseAnime(a); }));
        }, fail);
    }

    // Сезоны/фильмы/ОВА: API связей не отдаёт, ищем по ключу франшизы и фильтруем по совпадению ключа
    function loadRelated(anime, ok) {
        var key = franchiseKey(anime.ru);
        if (!key) return ok([]);
        var ck = 'animevost_rel_' + key;
        var cache = Lampa.Storage.get(ck, '');
        if (cache && cache.ts && Date.now() - cache.ts < 7 * 86400000) return ok(cache.list);

        request('/search', { name: key }, function (r) {
            var list = sortRelated((r.data || []).map(function (a) { return parseAnime(a); })
                .filter(function (a) { return franchiseKey(a.ru) === key; }));
            // у самого тайтла данные свежее (он уже загружен) — подменяем
            list = list.map(function (a) { return a.id === anime.id ? $.extend({}, a, anime) : a; });
            Lampa.Storage.set(ck, { ts: Date.now(), list: list });
            ok(list);
        }, function () { ok(cache && cache.list ? cache.list : []); });
    }

    function loadAnime(id, ok, fail) {
        var key = 'animevost_pl_' + id;
        var info = null, playlist = null, errors = 0, left = 2;

        function done() {
            if (--left) return;
            if (!playlist || !playlist.length) {
                return bigGet(key, function (cached) {
                    if (cached && cached.playlist) ok(cached.info || info, cached.playlist, true);
                    else fail('empty');
                });
            }
            bigSet(key, { ts: Date.now(), info: info, playlist: playlist });
            ok(info, playlist, false);
        }

        request('/info', { id: id }, function (r) {
            if (r.data && r.data[0]) {
                info = parseAnime(r.data[0]);
                var sc = getMap('animevost_schedule').map;
                if (sc) applySchedule(info, sc[info.id]);
            }
            done();
        }, function () { errors++; done(); });

        request('/playlist', { id: id }, function (r) {
            playlist = Array.isArray(r) ? r : (r.data || []);
            done();
        }, function () { errors++; done(); });
    }

    /* ------------------------------------------------------------------ */
    /*  Player                                                            */
    /* ------------------------------------------------------------------ */

    function pickUrl(ep) {
        var q = setting('animevost_quality', 'hd');
        var url = q === 'hd' ? (ep.hd || ep.std) : (ep.std || ep.hd);
        return httpsify(url);
    }

    // Какие плееры имеет смысл предлагать на этом устройстве
    function availablePlayers() {
        var P = Lampa.Platform, keys = ['lampa', 'inner'];
        var is = function (n) { try { return P.is(n); } catch (e) { return false; } };
        var mac = false;
        try { mac = !!(P.macOS && P.macOS()); } catch (e) { /* ignore */ }

        if (is('android')) keys.push('android');
        if (is('webos')) keys.push('webos');
        if (is('apple') || is('apple_tv')) keys.push('vlc', 'infuse', 'nplayer', 'senplayer');
        if (mac) keys.push('iina', 'mpv', 'infuse', 'nplayer', 'senplayer');
        keys.push('copy');

        // выбранный ранее плеер оставляем в списке, даже если платформа не определилась
        var cur = setting('animevost_player', 'lampa');
        if (keys.indexOf(cur) < 0 && PLAYERS[cur]) keys.splice(2, 0, cur);
        return keys.filter(function (k, i) { return keys.indexOf(k) === i; });
    }

    function choosePlayer(done) {
        var cur = setting('animevost_player', 'lampa');
        var items = availablePlayers().map(function (k) {
            return { title: PLAYERS[k], value: k, selected: k === cur };
        });
        var back = Lampa.Controller.enabled().name;
        Lampa.Select.show({
            title: 'Плеер',
            items: items,
            onSelect: function (a) {
                Lampa.Storage.set('animevost_player', a.value);
                Lampa.Controller.toggle(back); // иначе после copy/внешнего плеера активным остаётся скрытый select
                done && done(a.value);
            },
            onBack: function () { Lampa.Controller.toggle(back); }
        });
    }

    // Для схем vlc://, infuse:// Lampa читает общую настройку "player" — подменяем её только на момент запуска.
    // Исходное значение запоминаем один раз (повторные запуски его не затирают) и возвращаем сразу после
    // события Player 'external' либо по таймеру.
    var playerPatch = null;

    function restorePlayer() {
        if (!playerPatch) return;
        clearTimeout(playerPatch.timer);
        Lampa.Storage.set('player', playerPatch.prev);
        playerPatch = null;
    }

    function patchPlayer(mode) {
        if (!playerPatch) playerPatch = { prev: Lampa.Storage.get('player', '') };
        clearTimeout(playerPatch.timer);
        playerPatch.timer = setTimeout(restorePlayer, 20000);
        Lampa.Storage.set('player', mode);
    }

    function hookPlayer() {
        if (!Lampa.Player || !Lampa.Player.listener) return;
        Lampa.Player.listener.follow('external', function () {
            restorePlayer();
            // launch_player живёт в Lampa до закрытия встроенного плеера — сбрасываем, чтобы не влиять на остальное
            if (Lampa.Player.runas) Lampa.Player.runas('');
            // callback закрытия встроенного плеера для внешнего не вызовется и не должен остаться висеть
            Lampa.Player.callback(false);
        });
    }

    // Возвращает false если запуск не нужен (скопировали ссылку)
    function applyPlayer(item, mode) {
        if (mode === 'copy') {
            Lampa.Utils.copyTextToClipboard(item.url, function () {
                Lampa.Noty.show('Ссылка скопирована');
            }, function () {
                Lampa.Noty.show('Не удалось скопировать ссылку');
            });
            return false;
        }
        if (mode === 'inner' || mode === 'android' || mode === 'webos') {
            item.launch_player = mode;
        } else if (mode !== 'lampa') {
            patchPlayer(mode);
        }
        return true;
    }

    function playEpisode(anime, eps, idx, onClose) {
        var go = function (mode) {
            var ep = eps[idx];
            // Плейлист на сотни серий: url и timeline каждой серии вычисляются лениво — только когда плеер
            // реально до них дотрагивается (переход на серию), а не для всех сразу при нажатии на одну.
            var playlist = eps.map(function (e, i) {
                var o = {
                    title: e.name,
                    poster: httpsify(e.preview),
                    // Lampa вызывает callback при автопереходе на серию — запоминаем актуальную
                    callback: function () { remember(anime, e.name, i, eps.length); }
                };
                var lazyProp = function (name, make) {
                    var done = false, val;
                    Object.defineProperty(o, name, {
                        enumerable: true,
                        configurable: true,
                        get: function () {
                            if (!done) { val = make(); done = true; }
                            return val;
                        },
                        // Lampa присваивает url/timeline (например, Torserver.toPlayUrl) — разрешаем перезапись
                        set: function (v) { val = v; done = true; }
                    });
                };
                lazyProp('url', function () { return pickUrl(e); });
                lazyProp('timeline', function () { return Lampa.Timeline.view(episodeHash(anime.id, e.name)); });
                return o;
            });
            var item = {
                title: anime.ru + ' — ' + ep.name,
                url: pickUrl(ep),
                poster: httpsify(ep.preview),
                timeline: playlist[idx].timeline,
                playlist: playlist
            };
            if (!applyPlayer(item, mode)) return;
            remember(anime, ep.name, idx, eps.length);
            Lampa.Player.play(item);
            Lampa.Player.playlist(playlist);
            Lampa.Player.callback(function () {
                onClose && onClose();
            });
        };

        if (setting('animevost_player_ask', false)) choosePlayer(go);
        else go(setting('animevost_player', 'lampa'));
    }

    /* ------------------------------------------------------------------ */
    /*  UI helpers                                                        */
    /* ------------------------------------------------------------------ */

    function injectStyle() {
        if ($('#animevost-style').length) return;
        $('head').append('<style id="animevost-style">' +
            '.avost{padding:1.2em 0 2em}' +
            '.avost-bar{display:flex;flex-wrap:wrap;padding:0 1.5em .4em}.avost-bar>.avost-btn{margin:0 .8em .8em 0}' +
            '.avost-btn{padding:.7em 1.4em;border-radius:.6em;background:rgba(255,255,255,.1);font-size:1.1em}' +
            '.avost-btn.focus{background:#fff;color:#000}' +
            '.avost-row{margin-bottom:1.6em}' +
            '.avost-row__title{font-size:1.5em;padding:0 1.5em .6em;opacity:.9}' +
            '.avost-grid{display:flex;flex-wrap:wrap;padding:0 1em}' +
            '.avost-card{position:relative;box-sizing:border-box;width:12.5%;padding:0 .45em;margin-bottom:1.2em;min-width:0}' +
            '.avost-card__img{position:relative;height:0;padding-top:145%;border-radius:.7em;overflow:hidden;background:#2a2a2a}' +
            '.avost-card__img img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}' +
            '.avost-card__bar{position:absolute;left:0;right:0;bottom:0;height:.4em;background:rgba(0,0,0,.55)}.avost-card__bar div{height:100%;background:#e8590c}' +
            '.avost-anime__descr--more.focus{background:rgba(255,255,255,.1);border-radius:.5em}.avost-anime__more{margin-top:.4em;color:#ffa94d}' +
            '.avost-modal__text{padding:1em 1.5em;line-height:1.5;font-size:1.2em;white-space:pre-wrap}' +
            '.avost-card__badge{position:absolute;left:0;bottom:.5em;padding:.2em .6em;background:#e8590c;color:#fff;font-size:.9em;border-radius:0 .4em .4em 0}' +
            '.avost-card__title{margin-top:.5em;font-size:1em;line-height:1.25;max-height:2.5em;overflow:hidden;padding:0 .2em}' +
            '.avost-card.focus .avost-card__img{box-shadow:0 0 0 .22em #fff}' +
            '.avost-anime{display:flex;padding:1.5em}.avost-anime__poster{margin-right:2em}' +
            '.avost-anime__poster{width:15em;flex-shrink:0}' +
            '.avost-anime__poster img{width:100%;border-radius:.7em}' +
            '.avost-anime__body{flex:1;min-width:0}' +
            '.avost-anime__title{font-size:2em;line-height:1.2}' +
            '.avost-anime__en{opacity:.6;margin-top:.2em}' +
            '.avost-anime__meta{margin:.8em 0;opacity:.8}' +
            '.avost-anime__timer{margin:.3em 0 .6em;font-size:1.2em;color:#ffa94d}' +
            '.avost-anime__descr{margin:1em 0;line-height:1.45;max-height:7.5em;overflow:hidden;opacity:.85}' +
            '.avost-anime__btns{display:flex;flex-wrap:wrap;margin:1em 0 .2em}.avost-anime__btns .avost-btn,.avost-anime__btns .avost-dd-wrap{margin:0 .8em .8em 0}' +
            // обёртка выпадающего списка — flex-контейнер, кнопка в ней растягивается на всю высоту ряда (как соседние кнопки) без двойных отступов
            '.avost-anime__btns .avost-dd-wrap{display:flex}.avost-anime__btns .avost-dd-wrap>.avost-btn{margin:0;flex:1 1 auto}' +
                        '.avost-row--eps .scroll__body{display:flex;flex-wrap:nowrap;align-items:flex-start}' +
            '.avost-row--eps{margin-top:1em}' +
            '.avost-ep{position:relative;width:24em;margin:0 .6em;flex-shrink:0;border-radius:.8em;padding:.4em}' +
            '.avost-ep.focus{background:rgba(255,255,255,.16);box-shadow:0 0 0 .2em #fff}' +
            '.avost-ep.watched{opacity:.55}' +
            '.avost-ep__img{position:relative;height:13.5em;border-radius:.6em;overflow:hidden;background:#2a2a2a}' +
            '.avost-ep__img img{width:100%;height:100%;object-fit:cover}' +
            '.avost-ep__check{display:none;position:absolute;right:.5em;top:.4em;background:#2f9e44;color:#fff;border-radius:50%;width:1.6em;height:1.6em;line-height:1.6em;text-align:center}' +
            '.avost-ep.watched .avost-ep__check{display:block}' +
            '.avost-ep__bar{position:absolute;left:0;right:0;bottom:0;height:.45em;background:rgba(0,0,0,.55)}' +
            '.avost-ep__bar div{height:100%;background:#e8590c}' +
            '.avost-ep__name{font-size:1.5em;margin-top:.5em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.avost-ep__sub{opacity:.65;margin-top:.15em;min-height:1.3em}' +
            '.avost-more{padding:.4em 1.5em 1.5em;text-align:center}.avost-btn--more{display:inline-block}' +
            '.avost-search{padding:0 1.5em}.avost-search__query{font-size:1.8em;padding:.5em .8em;margin-bottom:.8em;border-radius:.6em;background:rgba(255,255,255,.1);min-height:1.4em;word-wrap:break-word}' +
            '.avost-search__placeholder{opacity:.45}' +
            '.avost-keys__row{display:flex;flex-wrap:wrap;margin-bottom:.1em}' +
            '.avost-key{min-width:2.3em;box-sizing:border-box;text-align:center;padding:.55em .6em;margin:0 .35em .35em 0;border-radius:.5em;background:rgba(255,255,255,.1);font-size:1.25em}' +
            '.avost-key--wide{padding-left:1.1em;padding-right:1.1em}.avost-key--accent{background:#e8590c;color:#fff}' +
            '.avost-key.focus{background:#fff;color:#000}' +
            '.avost-sugs{padding:.8em 1.5em 2em}' +
            '.avost-sug{display:flex;align-items:center;padding:.5em .7em;margin-bottom:.35em;border-radius:.6em;background:rgba(255,255,255,.06)}' +
            '.avost-sug.focus{background:#fff;color:#000}' +
            '.avost-sug--text{font-size:1.2em;padding:.7em .9em}.avost-sug--danger{color:#ff8787}.avost-sug--accent{color:#ffa94d}' +
            '.avost-sug.focus.avost-sug--danger,.avost-sug.focus.avost-sug--accent{color:#000}' +
            '.avost-sug__img{width:3.4em;height:4.8em;border-radius:.4em;overflow:hidden;background:#2a2a2a;flex-shrink:0;margin-right:1em}' +
            '.avost-sug__img img{width:100%;height:100%;object-fit:cover}' +
            '.avost-sug__info{min-width:0;flex:1}.avost-sug__name{font-size:1.25em;line-height:1.25}.avost-sug__sub{opacity:.6;margin-top:.2em;word-wrap:break-word}' +
            '.avost-empty{padding:3em 1.5em;font-size:1.3em;opacity:.7}' +
            '@media (max-width:1100px){.avost-ep{width:20em}.avost-ep__img{height:11.2em}}' +
            '@media (max-width:760px){.avost-anime{flex-direction:column;padding:1em}.avost-anime__poster{width:9em;margin:0 0 1em 0}' +
            '.avost-anime__title{font-size:1.5em}.avost-grid{padding:0 .5em}' +
            '.avost-bar{padding:0 1em 1em}.avost-row__title{padding:0 1em .6em;font-size:1.3em}.avost-ep{width:16em}.avost-ep__img{height:9em}' +
            '.avost-ep__name{font-size:1.2em}}' +
            '@media (max-width:1499px){.avost-card{width:14.2857%}}' +
            '@media (max-width:1099px){.avost-card{width:16.6667%}}' +
            '@media (max-width:899px){.avost-card{width:20%}}' +
            '@media (max-width:699px){.avost-card{width:25%}}' +
            '@media (max-width:519px){.avost-card{width:33.3333%}}' +
            '@media (max-width:379px){.avost-card{width:50%}}' +
            '.avost-dd-wrap{position:relative;display:inline-block}' +
            '.avost-dd{position:absolute;left:0;top:100%;margin-top:.4em;box-sizing:border-box;width:30em;max-width:90vw;max-height:20em;overflow:hidden;background:#2b2b2b;border-radius:.7em;padding:.4em;box-shadow:0 .5em 2em rgba(0,0,0,.6);z-index:20}' +
            '.avost-dd__item{position:relative;display:block;box-sizing:border-box;width:100%;padding:.6em .9em;border-radius:.5em;white-space:normal;word-wrap:break-word;overflow-wrap:break-word}' +
            '.avost-dd__item.focus{background:#fff;color:#000}' +
            '.avost-dd__item--current .avost-dd__name:before{content:"✓ "}' +
            '.avost-dd__name{display:block;font-size:1.15em;line-height:1.25;white-space:normal;word-wrap:break-word}' +
            '.avost-dd__sub{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;opacity:.6;font-size:.9em;line-height:1.25;margin-top:.15em;white-space:normal;word-wrap:break-word;overflow:hidden}' +
            '</style>');
    }

    // Навигация пультом: каждый ряд — массив элементов, фокус двигаем сами,
    // а не через пространственный Navigator (на ТВ он прыгает между вложенными скроллами).
    function Grid(name, scroll) {
        var rows = [], r = 0, c = 0, self = this, layoutFn = null;

        function row(i) { return rows[i] || []; }

        // Если ряды зависят от ширины экрана (сетка с переносом) — пересобираем их перед каждым ходом
        function refresh() {
            if (!layoutFn) return;
            var cur = row(r)[c];
            rows = layoutFn();
            if (cur) self.track(cur);
        }

        this.layout = function (fn) { layoutFn = fn; rows = fn(); };

        this.set = function (arr, keep) {
            var cur = keep ? row(r)[c] : null;
            rows = arr;
            if (cur) self.track(cur);
        };
        this.at = function (nr, nc) { r = nr; c = nc || 0; };

        // вызывается из hover:focus / hover:hover — синхронизирует позицию с мышью и касанием
        this.track = function (el) {
            el = el[0] || el;
            for (var i = 0; i < rows.length; i++) {
                for (var j = 0; j < rows[i].length; j++) {
                    if (rows[i][j][0] === el) { r = i; c = j; return; }
                }
            }
        };

        this.focus = function () {
            refresh();
            if (!row(r).length) {
                for (var i = 0; i < rows.length; i++) if (rows[i].length) { r = i; c = 0; break; }
            }
            var list = row(r);
            if (!list.length) return;
            c = Math.max(0, Math.min(c, list.length - 1));
            Lampa.Controller.collectionFocus(list[c], scroll.render());
        };

        this.step = function (d) {
            refresh();
            var n = r + d;
            while (n >= 0 && n < rows.length && !rows[n].length) n += d;
            if (n < 0 || n >= rows.length) return false;
            r = n;
            this.focus();
            return true;
        };

        this.bind = function () {
            Lampa.Controller.add(name, {
                toggle: function () {
                    if (self.onToggle) self.onToggle();
                    Lampa.Controller.collectionSet(scroll.render());
                    self.focus();
                },
                left: function () {
                    refresh();
                    if (c > 0) { c--; self.focus(); }
                    else if (self.onEdge && self.onEdge('left', r)) return;
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    refresh();
                    if (c < row(r).length - 1) { c++; self.focus(); }
                    else if (self.onEdge) self.onEdge('right', r);
                },
                up: function () {
                    if (!self.step(-1)) Lampa.Controller.toggle('head');
                },
                down: function () { self.step(1); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle(name);
        };
    }

    function historyList() {
        var st = getMap('animevost_state');
        return Object.keys(st).map(function (k) { return st[k]; })
            .sort(function (a, b) { return b.ts - a.ts; });
    }

    function openAnime(a) {
        Lampa.Activity.push({
            url: '',
            title: a.ru,
            component: 'animevost_anime',
            anime: a,
            page: 1
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Каталог (меню) и экран поиска с подсказками                       */
    /* ------------------------------------------------------------------ */

    function openCatalog(kind, slug, title) {
        Lampa.Activity.push({ url: '', title: title, component: 'animevost_main', catalog: { kind: kind, slug: slug, title: title }, page: 1 });
    }

    // Меню как на сайте: Онгоинги, Анонсы, Жанры, Категории, Год. Второй уровень — отдельным списком.
    function openCatalogMenu() {
        var back = function () { Lampa.Controller.toggle('content'); };
        var sub = function (title, list, kind, prefix) {
            setTimeout(function () { // дать первому списку закрыться
                Lampa.Select.show({
                    title: title,
                    items: list.map(function (g) { return { title: g[1], value: g }; }),
                    onSelect: function (it) {
                        back();
                        openCatalog(kind, it.value[0], prefix + it.value[1]);
                    },
                    onBack: back
                });
            }, 80);
        };
        Lampa.Select.show({
            title: 'Каталог',
            items: [
                { title: 'Онгоинги', kind: 'ongoing' },
                { title: 'Анонсы', kind: 'preview' },
                { title: 'Жанры ▸', group: 'genre' },
                { title: 'Категории ▸', group: 'type' },
                { title: 'Год ▸', group: 'year' }
            ],
            onSelect: function (it) {
                if (it.kind) {
                    back();
                    return openCatalog(it.kind, '', it.title);
                }
                if (it.group === 'genre') sub('Жанры', CATALOG_GENRES, 'genre', 'Жанр: ');
                else if (it.group === 'type') sub('Категории', CATALOG_TYPES, 'type', 'Категория: ');
                else sub('Год', catalogYears().map(function (y) { return [y, y]; }), 'year', 'Год: ');
            },
            onBack: back
        });
    }

    // Экран поиска как на сайте: набираешь — под полем сразу подсказки (постер, название, год/тип).
    // Своя экранная клавиатура (RU/EN) управляется пультом; на ПК работает и физическая клавиатура.
    var SEARCH_KEYS = {
        ru: ['1234567890', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю.-'],
        en: ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm.-']
    };
    var SEARCH_MAX_SUGGEST = 8;

    function searchHistory() {
        var h = Lampa.Storage.get('animevost_search_history', '[]');
        return Array.isArray(h) ? h : [];
    }

    function searchRemember(q) {
        q = (q || '').trim();
        if (!q) return;
        var h = searchHistory().filter(function (x) { return x !== q; });
        h.unshift(q);
        Lampa.Storage.set('animevost_search_history', h.slice(0, 10));
    }

    // Подсказки: сначала названия, начинающиеся с запроса, потом содержащие
    function rankSuggestions(list, q) {
        q = q.toLowerCase();
        var starts = [], rest = [];
        list.forEach(function (a) {
            ((a.ru || '').toLowerCase().indexOf(q) === 0 || (a.en || '').toLowerCase().indexOf(q) === 0 ? starts : rest).push(a);
        });
        return starts.concat(rest);
    }

    function SearchComponent(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var html = $('<div class="avost"></div>');
        var grid = new Grid('content', scroll);
        var query = '', lang = 'ru';
        var destroyed = false, token = 0, timer = null, cache = {};
        var head, display, sugBox, langKey, keyRows = [], sugRows = [];

        scroll.minus();
        html.append(scroll.render());

        function render() {
            display.text(query || 'Начни вводить название…').toggleClass('avost-search__placeholder', !query);
        }

        function setQuery(q) {
            query = q;
            render();
            schedule();
        }

        function key(label, act, cls) {
            var el = $('<div class="avost-key selector"></div>').text(label);
            if (cls) el.addClass(cls);
            el.on('hover:focus', function () { grid.track(el); scroll.update(head, false); });
            el.on('hover:hover hover:touch', function () { grid.track(el); });
            el.on('hover:enter', act);
            return el;
        }

        function submit() {
            var q = query.trim();
            if (!q) return;
            searchRemember(q);
            Lampa.Activity.push({ url: '', title: 'Поиск: ' + q, component: 'animevost_main', query: q, page: 1 });
        }

        function buildKeyboard() {
            var kb = $('<div class="avost-keys"></div>');
            keyRows = [];
            var layout = SEARCH_KEYS[lang];
            layout.forEach(function (chars) {
                var line = $('<div class="avost-keys__row"></div>'), els = [];
                chars.split('').forEach(function (ch) {
                    var el = key(ch, function () { setQuery(query + ch); });
                    line.append(el);
                    els.push(el);
                });
                kb.append(line);
                keyRows.push(els);
            });
            var actions = $('<div class="avost-keys__row"></div>'), act = [];
            var add = function (label, fn, cls) { var el = key(label, fn, cls); actions.append(el); act.push(el); return el; };
            add('Пробел', function () { if (query && query.slice(-1) !== ' ') setQuery(query + ' '); }, 'avost-key--wide');
            add('⌫', function () { setQuery(query.slice(0, -1)); });
            add('Очистить', function () { setQuery(''); }, 'avost-key--wide');
            langKey = add(lang === 'ru' ? 'EN' : 'RU', function () {
                lang = lang === 'ru' ? 'en' : 'ru';
                buildAll(true);
            });
            add('Найти', submit, 'avost-key--wide avost-key--accent');
            kb.append(actions);
            keyRows.push(act);
            return kb;
        }

        function sugItem(a) {
            var el = $('<div class="avost-sug selector">' +
                '<div class="avost-sug__img"><img alt=""/></div>' +
                '<div class="avost-sug__info"><div class="avost-sug__name"></div><div class="avost-sug__sub"></div></div></div>');
            el.find('.avost-sug__name').text(a.ru);
            el.find('.avost-sug__sub').text([a.en, a.year, a.type].filter(Boolean).join(' · '));
            setImage(el.find('img'), a.poster, function () { el.find('img').hide(); });
            el.on('hover:focus', function () { grid.track(el); scroll.update(el, false); });
            el.on('hover:hover hover:touch', function () { grid.track(el); });
            el.on('hover:enter', function () {
                searchRemember(query);
                openAnime(a);
            });
            return el;
        }

        function textItem(label, act, cls) {
            var el = $('<div class="avost-sug avost-sug--text selector"></div>').text(label);
            if (cls) el.addClass(cls);
            el.on('hover:focus', function () { grid.track(el); scroll.update(el, false); });
            el.on('hover:hover hover:touch', function () { grid.track(el); });
            el.on('hover:enter', act);
            return el;
        }

        // Подсказки под клавиатурой; при пустом запросе — недавние запросы
        function showSuggestions(list, state) {
            sugBox.empty();
            sugRows = [];
            var add = function (el) { sugBox.append(el); sugRows.push([el]); };
            var q = query.trim();

            if (!q) {
                var h = searchHistory();
                if (h.length) {
                    sugBox.append($('<div class="avost-row__title">Недавние запросы</div>'));
                    h.forEach(function (w) { add(textItem(w, function () { setQuery(w); })); });
                    add(textItem('Очистить историю', function () {
                        Lampa.Storage.set('animevost_search_history', []);
                        showSuggestions([], '');
                    }, 'avost-sug--danger'));
                }
            } else if (state === 'loading') {
                sugBox.append($('<div class="avost-empty">Ищу…</div>'));
            } else if (state === 'error') {
                sugBox.append($('<div class="avost-empty">Не удалось получить подсказки. Проверьте сеть.</div>'));
            } else if (!list.length) {
                sugBox.append($('<div class="avost-empty">Ничего не найдено</div>'));
            } else {
                sugBox.append($('<div class="avost-row__title">Подсказки</div>'));
                list.slice(0, SEARCH_MAX_SUGGEST).forEach(function (a) { add(sugItem(a)); });
                if (list.length > SEARCH_MAX_SUGGEST) add(textItem('Все результаты (' + list.length + ')', submit, 'avost-sug--accent'));
            }
            grid.set(keyRows.concat(sugRows), true);
        }

        function schedule() {
            clearTimeout(timer);
            var q = query.trim();
            if (q.length < 2) {
                token++;
                return showSuggestions([], '');
            }
            if (cache[q]) return showSuggestions(cache[q], 'ok');
            showSuggestions([], 'loading');
            var mine = ++token;
            timer = setTimeout(function () {
                searchAnime(q, function (list) {
                    var ranked = rankSuggestions(list, q);
                    cache[q] = ranked;
                    if (destroyed || mine !== token) return;
                    showSuggestions(ranked, 'ok');
                }, function () {
                    if (destroyed || mine !== token) return;
                    showSuggestions([], 'error');
                });
            }, 300);
        }

        function buildAll(keepFocus) {
            scroll.clear();
            head = $('<div class="avost-search"></div>');
            display = $('<div class="avost-search__query"></div>');
            head.append(display).append(buildKeyboard());
            sugBox = $('<div class="avost-sugs"></div>');
            scroll.append(head);
            scroll.append(sugBox);
            render();
            showSuggestions([], '');
            if (query.trim().length >= 2) schedule();
            if (!keepFocus) grid.at(1, 0);
            else grid.at(keyRows.length - 1, 3); // после смены раскладки фокус остаётся на переключателе языка
            if (keepFocus) Lampa.Controller.toggle('content');
        }

        // Физическая клавиатура (ПК/Mac): печатные символы дописываются в запрос, Backspace стирает символ
        function onKey(e) {
            if (destroyed || !Lampa.Activity.active() || Lampa.Activity.active().activity !== self.activity) return;
            if (Lampa.Controller.enabled().name !== 'content') return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === 'Backspace' && query) {
                e.preventDefault();
                e.stopPropagation(); // иначе Lampa воспримет как «Назад»
                return setQuery(query.slice(0, -1));
            }
            if (e.key && e.key.length === 1 && /[0-9a-zа-яё.\- ]/i.test(e.key)) {
                e.preventDefault();
                setQuery(query + e.key.toLowerCase());
            }
        }

        this.create = function () {
            document.addEventListener('keydown', onKey, true);
            buildAll(false);
            self.activity.loader(false);
            self.activity.toggle();
        };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            grid.bind();
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            destroyed = true;
            clearTimeout(timer);
            document.removeEventListener('keydown', onKey, true);
            scroll.destroy();
            html.remove();
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Component: дашборд / поиск                                        */
    /* ------------------------------------------------------------------ */

    function MainComponent(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var html = $('<div class="avost"></div>');
        var grid = new Grid('content', scroll);
        var sections = [];
        var btns = [];
        var bar;
        var destroyed = false, token = 0;
        var lastGroups = null, builtSig = '';
        // каталог: текущая страница, есть ли следующая, кнопка «Загрузить ещё», последняя сетка (куда дописываем карточки)
        var catPage = 1, catMore = false, catBusy = false, moreBtn = null, lastBox = null, lastItems = null;
        // дашборд: вся зона видимости + 2 экрана запаса, остальные постеры фоном (по 4 за тик) — грузятся все
        var lazy = new Lazy({ margin: 2, trickle: 4 });

        scroll.minus();
        html.append(scroll.render());

        function card(a, badge, pct) {
            var el = $('<div class="avost-card selector">' +
                '<div class="avost-card__img"><img alt=""/></div>' +
                '<div class="avost-card__title"></div></div>');
            el.find('.avost-card__title').text(a.ru);
            lazy.add(el.find('img'), a.poster);
            var b = badge || (a.nextEp ? a.nextEp + (a.airTime ? ' · ' + a.airTime : '') : '') || (a.current ? a.current + '/' + (a.total || '?') + (a.plus ? '+' : '') : '');
            if (b) el.find('.avost-card__img').append($('<div class="avost-card__badge"></div>').text(b));
            if (pct > 0 && pct < 90) el.find('.avost-card__img').append($('<div class="avost-card__bar"><div></div></div>').find('div').css('width', pct + '%').end());
            return el;
        }

        // Карточка со всеми обработчиками (фокус, мышь/касание, открытие, долгое нажатие)
        function cardNode(a, badge, opts) {
            opts = opts || {};
            var el = card(a, badge, opts.pct && opts.pct(a));
            el.on('hover:focus', function () {
                grid.track(el);
                scroll.update(el, false);
                setTimeout(function () { lazy.check(); }, 60); // после сдвига скролла подгружаем картинки рядом
            });
            if (opts.onLong) {
                el.on('hover:long', function () { opts.onLong(a); });
                el.on('contextmenu', function (e) { e.preventDefault(); opts.onLong(a); });
            }
            el.on('hover:hover hover:touch', function () { grid.track(el); });
            el.on('hover:enter', function () { openAnime(a); });
            return el;
        }

        // Секция — адаптивная сетка с переносом строк: число колонок зависит от ширины экрана
        function row(title, list, badgeFn, opts) {
            opts = opts || {};
            var items = [];
            var wrap = $('<div class="avost-row"><div class="avost-row__title"></div><div class="avost-grid"></div></div>');
            var box = wrap.find('.avost-grid');
            wrap.find('.avost-row__title').text(title).toggle(!!title);

            list.forEach(function (a) {
                var el = cardNode(a, badgeFn && badgeFn(a), opts);
                box.append(el);
                items.push(el);
            });

            scroll.append(wrap);
            sections.push(items);
            lastBox = box;
            lastItems = items;
        }

        // Визуальные ряды секций: карточки с одинаковым offsetTop лежат в одной строке
        function layoutRows() {
            var out = [btns];
            sections.forEach(function (items) {
                var byTop = {}, tops = [];
                items.forEach(function (el) {
                    var t = el[0].offsetTop;
                    if (!byTop[t]) { byTop[t] = []; tops.push(t); }
                    byTop[t].push(el);
                });
                tops.sort(function (x, y) { return x - y; });
                tops.forEach(function (t) { out.push(byTop[t]); });
            });
            if (moreBtn && catMore) out.push([moreBtn]);
            return out;
        }

        function button(label, act) {
            var el = $('<div class="avost-btn selector"></div>').text(label);
            el.on('hover:focus', function () { grid.track(el); scroll.update(bar, false); });
            el.on('hover:hover hover:touch', function () { grid.track(el); });
            el.on('hover:enter', act);
            bar.append(el);
            return el;
        }

        function toolbar() {
            bar = $('<div class="avost-bar"></div>');
            btns = [];
            // из каталога и результатов поиска — явный возврат на дашборд (заменяем экран, а не наращиваем стек)
            if (object.catalog || object.query) {
                btns.push(button('← Дашборд', function () {
                    Lampa.Activity.replace({ url: '', title: 'AnimeVost', component: 'animevost_main', page: 1 }, true);
                }));
            }
            btns.push(button('Поиск', function () {
                Lampa.Activity.push({ url: '', title: 'Поиск', component: 'animevost_search', page: 1 });
            }));
            btns.push(button('Каталог', openCatalogMenu));
            if (!object.query) {
                btns.push(button('Обновить', function () { self.reload(true); }));
            }
            var pl = button('Плеер: ' + PLAYERS[setting('animevost_player', 'lampa')], function () {
                choosePlayer(function (v) {
                    pl.text('Плеер: ' + PLAYERS[v]);
                    Lampa.Controller.toggle('content');
                });
            });
            btns.push(pl);
            scroll.append(bar);
        }

        function history() { return historyList().slice(0, 20); }

        function finish() {
            grid.layout(layoutRows);
            grid.at(sections.length ? 1 : 0, 0); // сразу на первую карточку, а не на панель кнопок
            self.activity.loader(false);
            self.activity.toggle();
            setTimeout(function () { lazy.check(); }, 100); // первые картинки без ожидания таймера
        }

        // Управление историей: долгое нажатие на карточку в ряду «Продолжить просмотр»
        function historyMenu(h) {
            Lampa.Select.show({
                title: h.ru,
                items: [
                    { title: 'Открыть', run: function () { openAnime(h); } },
                    { title: 'Удалить из истории', run: function () { var st = getMap('animevost_state'); delete st[h.id]; Lampa.Storage.set('animevost_state', st); build(lastGroups); } },
                    { title: 'Очистить всю историю', run: function () { Lampa.Storage.set('animevost_state', {}); build(lastGroups); } }
                ],
                onSelect: function (it) {
                    Lampa.Controller.toggle('content');
                    it.run();
                },
                onBack: function () { Lampa.Controller.toggle('content'); }
            });
        }

        function histSig() {
            return history().map(function (h) { return h.id + ':' + h.last + ':' + h.ts; }).join('|');
        }

        function build(groups) {
            lastGroups = groups;
            builtSig = histSig();
            lazy.reset();
            scroll.clear();
            sections = [];
            toolbar();

            if (!object.query && !object.catalog) {
                var hist = history();
                if (hist.length) {
                    var byId = {};
                    groups.forEach(function (g) { g.items.forEach(function (a) { byId[a.id] = a; }); });
                    row('Продолжить просмотр', hist, function (h) {
                        var fresh = byId[h.id], extra = fresh && h.count && fresh.current > h.count ? ' · +' + (fresh.current - h.count) : '';
                        return h.last + extra;
                    }, {
                        pct: function (h) { return Lampa.Timeline.view(episodeHash(h.id, h.last)).percent; },
                        onLong: historyMenu
                    });
                }
            }

            if (!groups.length) {
                scroll.append($('<div class="avost-empty">Ничего не найдено</div>'));
            }
            groups.forEach(function (g) { row(g.title, g.items); });
            if (object.catalog && catMore) addMoreButton();
            finish();
        }

        // «Загрузить ещё»: дописывает карточки следующей страницы каталога в ту же сетку
        function addMoreButton() {
            moreBtn = $('<div class="avost-btn avost-btn--more selector">Загрузить ещё</div>');
            moreBtn.on('hover:focus', function () { grid.track(moreBtn); scroll.update(moreBtn, false); });
            moreBtn.on('hover:hover hover:touch', function () { grid.track(moreBtn); });
            moreBtn.on('hover:enter', loadMore);
            scroll.append($('<div class="avost-more"></div>').append(moreBtn));
        }

        function loadMore() {
            if (catBusy || !catMore) return;
            catBusy = true;
            moreBtn.text('Загружаю…');
            var mine = token, next = catPage + 1;
            var c = object.catalog;
            loadCatalogPage(c.kind, c.slug, next, function (items, more) {
                catBusy = false;
                if (destroyed || mine !== token) return;
                items.forEach(function (a) {
                    var el = cardNode(a);
                    lastBox.append(el);
                    lastItems.push(el);
                });
                catPage = next;
                catMore = more;
                if (more) moreBtn.text('Загрузить ещё');
                else { moreBtn.parent().remove(); moreBtn = null; }
                setTimeout(function () { lazy.check(); }, 100);
            }, function () {
                catBusy = false;
                if (!destroyed) moreBtn.text('Не удалось загрузить — повторить');
            });
        }

        function fail() {
            scroll.clear();
            sections = [];
            toolbar();
            scroll.append($('<div class="avost-empty">Не удалось загрузить данные AnimeVost. Проверьте сеть или адрес API в настройках.</div>'));
            finish();
        }

        this.reload = function (force) {
            var mine = ++token;
            var alive = function () { return !destroyed && mine === token; };
            self.activity.loader(true);
            if (object.query) {
                searchAnime(object.query, function (list) {
                    if (!alive()) return;
                    build([{ title: 'Найдено: ' + list.length, items: list }]);
                }, function () { if (alive()) fail(); });
            } else if (object.catalog) {
                var c = object.catalog;
                moreBtn = null;
                catBusy = false;
                loadCatalogPage(c.kind, c.slug, 1, function (items, more) {
                    if (!alive()) return;
                    catPage = 1;
                    catMore = more;
                    build([{ title: c.title + (items.length ? '' : ' — пусто'), items: items }]);
                }, function () { if (alive()) fail(); });
            } else {
                loadDashboard(function (list) {
                    if (alive()) build(groupByDay(list));
                }, function () { if (alive()) fail(); }, force);
            }
        };

        this.create = function () {
            lazy.start();
            this.reload(false);
        };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            // вернулись со страницы тайтла после просмотра — обновляем ряд «Продолжить просмотр» без сети
            if (lastGroups && builtSig !== histSig()) return build(lastGroups);
            grid.bind();
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () { destroyed = true; lazy.stop(); scroll.destroy(); html.remove(); };
    }

    /* ------------------------------------------------------------------ */
    /*  Component: страница тайтла и список серий                         */
    /* ------------------------------------------------------------------ */

    // ряды страницы: 0 — кнопки, 1 — серии
    var ROW_BTNS = 0, ROW_EPS = 1;
    var PAGE_SIZE = 50;

    function AnimeComponent(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var html = $('<div class="avost"></div>');
        var grid = new Grid('content', scroll);
        var anime = object.anime;
        var eps = [];
        var epNodes = [];     // по глобальному индексу серии; создаются только для текущей страницы
        var page = 0;
        var rows = [[], []];
        var continueBtn, relBtn, pageBtn, plBtn, qBtn, descrBtn, lampaBtn, relWrap, related = [], timerBox, head, descrEl, epsHost, tick;
        var dd = null, ddItems = [], ddIdx = 0;
        var destroyed = false, token = 0, tlTimer = null;
        // превью серий: только рядом с экраном (серия «подгружается», когда до неё дошли)
        var epLazy = new Lazy({ margin: 1 });

        scroll.minus();
        html.append(scroll.render());

        // Любое обновление Timeline (автопереход, внешний плеер, другое устройство через CUB) — обновляем прогресс
        function onTimeline() {
            clearTimeout(tlTimer);
            tlTimer = setTimeout(function () {
                if (!destroyed && eps.length) refreshProgress();
            }, 400);
        }

        function viewOf(ep) {
            return Lampa.Timeline.view(episodeHash(anime.id, ep.name));
        }

        function pageCount() { return Math.max(1, Math.ceil(eps.length / PAGE_SIZE)); }
        function pageStart() { return page * PAGE_SIZE; }

        // Какую серию предложить: недосмотренную последнюю или следующую после досмотренной
        function resumeIndex() {
            var st = getMap('animevost_state')[anime.id];
            if (!st) return 0;
            var idx = -1;
            for (var k = 0; k < eps.length; k++) if (eps[k].name === st.last) { idx = k; break; }
            if (idx < 0) return 0;
            var v = viewOf(eps[idx]);
            if (v.percent >= 90 && idx + 1 < eps.length) return idx + 1;
            return idx;
        }

        function play(idx) {
            playEpisode(anime, eps, idx, function () {
                refreshProgress();
                if (Math.floor(idx / PAGE_SIZE) === page) grid.at(ROW_EPS, idx - pageStart());
                Lampa.Controller.toggle('content');
            });
        }

        /* ---------- отметки просмотра ---------- */

        function setWatched(i, watched) {
            var v = viewOf(eps[i]);
            var dur = v.duration || 1;
            Lampa.Timeline.update({
                hash: v.hash,
                percent: watched ? 100 : 0,
                time: watched ? dur : 0,
                duration: watched ? dur : 0
            });
        }

        function episodeMenu(i) {
            var ep = eps[i], v = viewOf(ep), watched = v.percent >= 90;
            var items = [
                { title: watched ? 'Отметить непросмотренной' : 'Отметить просмотренной', run: function () { setWatched(i, !watched); } },
                { title: 'Отметить просмотренными все до этой', run: function () { for (var k = 0; k <= i; k++) setWatched(k, true); } }
            ];
            if (v.percent > 0 || v.time > 5) items.push({ title: 'Сбросить прогресс серии', run: function () { setWatched(i, false); } });
            items.push({ title: 'Сбросить прогресс всего тайтла', run: function () { for (var k = 0; k < eps.length; k++) setWatched(k, false); } });

            Lampa.Select.show({
                title: ep.name,
                items: items,
                onSelect: function (it) {
                    Lampa.Controller.toggle('content');
                    it.run();
                    refreshProgress();
                },
                onBack: function () { Lampa.Controller.toggle('content'); }
            });
        }

        function epNode(ep, idx, line, wrap) {
            var el = $('<div class="avost-ep selector">' +
                '<div class="avost-ep__img"><img alt=""/>' +
                '<div class="avost-ep__check">✓</div>' +
                '<div class="avost-ep__bar"><div></div></div></div>' +
                '<div class="avost-ep__name"></div>' +
                '<div class="avost-ep__sub"></div></div>');
            el.find('.avost-ep__name').text(ep.name);
            epLazy.add(el.find('img'), ep.preview, function () { el.find('img').hide(); });
            el.on('hover:focus', function () {
                grid.track(el);
                line.update(el, true);
                scroll.update(wrap, false);
                setTimeout(function () { epLazy.check(); }, 60);
            });
            el.on('hover:hover hover:touch', function () { grid.track(el); });
            el.on('hover:enter', function () { play(idx); });
            // долгое нажатие OK на пульте / правая кнопка мыши — меню отметок
            el.on('hover:long', function () { episodeMenu(idx); });
            el.on('contextmenu', function (e) { e.preventDefault(); episodeMenu(idx); });
            return el;
        }

        function refreshProgress() {
            for (var i = 0; i < eps.length; i++) {
                var el = epNodes[i];
                if (!el) continue;
                var v = viewOf(eps[i]);
                el.toggleClass('watched', v.percent >= 90);
                el.find('.avost-ep__bar').toggle(v.percent > 0 && v.percent < 90);
                el.find('.avost-ep__bar div').css('width', Math.min(100, v.percent) + '%');
                el.find('.avost-ep__sub').text(
                    v.percent >= 90 ? 'Просмотрено' :
                    v.time > 5 ? 'Остановились на ' + fmtTime(v.time) : ''
                );
            }
            if (continueBtn && eps.length) {
                var r = resumeIndex(), rv = eps[r] ? viewOf(eps[r]) : null;
                continueBtn.text(
                    getMap('animevost_state')[anime.id]
                        ? 'Продолжить: ' + eps[r].name + (rv && rv.time > 5 && rv.percent < 90 ? ' (' + fmtTime(rv.time) + ')' : '')
                        : 'Смотреть: ' + eps[0].name
                );
            }
        }

        // Серии текущей страницы — одна строка больших тайлов с горизонтальной прокруткой.
        // Длинные тайтлы режем на страницы по PAGE_SIZE, чтобы не создавать тысячи тайлов сразу.
        function renderEpisodes() {
            epsHost.empty();
            epLazy.reset();
            epNodes = [];
            var from = pageStart(), to = Math.min(eps.length, from + PAGE_SIZE);
            var title = 'Серии' + (pageCount() > 1 ? ' ' + eps[from].name.split(' ')[0] + '–' + eps[to - 1].name.split(' ')[0] : '');
            var wrap = $('<div class="avost-row avost-row--eps"><div class="avost-row__title"></div></div>');
            wrap.find('.avost-row__title').text(title);
            var line = new Lampa.Scroll({ horizontal: true, step: 450 });
            var nodes = [];
            for (var i = from; i < to; i++) {
                var n = epNode(eps[i], i, line, wrap);
                epNodes[i] = n;
                nodes.push(n);
                line.append(n);
            }
            wrap.append(line.render());
            epsHost.append(wrap);
            rows[ROW_EPS] = nodes;
            refreshProgress();
            setTimeout(function () { epLazy.check(); }, 100);
        }

        // после внешнего плеера Player.callback не вызывается — обновляем прогресс, когда окно снова видно
        function onVisible() {
            if (!document.hidden && !destroyed && eps.length) refreshProgress();
        }

        function tickTimer() {
            if (!timerBox) return;
            var txt = countdownText(anime);
            timerBox.text(txt ? '⏱ ' + txt : '').toggle(!!txt);
        }

        // Загрузка тайтла; при ошибке — экран с кнопками «Повторить»/«Назад», чтобы пульту было что выбрать
        function load() {
            var mine = ++token; // ответы от устаревших запросов (быстрое переключение, уход со страницы) игнорируем
            self.activity.loader(true);
            loadAnime(anime.id, function (info, playlist, offline) {
                if (destroyed || mine !== token) return;
                build(info, playlist, offline);
            }, function () {
                if (destroyed || mine !== token) return;
                failView('Не удалось получить список серий.', load);
            });
        }

        function failView(msg, retry) {
            scroll.clear();
            related = [];
            dd = null;
            ddItems = [];
            head = $('<div class="avost-anime"><div class="avost-anime__body"></div></div>');
            var body = head.find('.avost-anime__body');
            body.append($('<div class="avost-empty"></div>').text(msg));
            var wrapBtns = $('<div class="avost-anime__btns"></div>');
            var again = button(wrapBtns, 'Повторить', retry);
            var back = button(wrapBtns, 'Назад', function () { Lampa.Activity.backward(); });
            body.append(wrapBtns);
            scroll.append(head);
            rows = [[again, back], []];
            grid.set(rows);
            grid.at(0, 0);
            self.activity.loader(false);
            self.activity.toggle();
        }

        // Переключение между сезонами/фильмами/ОВА на месте, без пересоздания экрана
        function switchTo(a) {
            if (a.id === anime.id) return;
            anime = a;
            object.anime = a; // чтобы «Назад»/перезагрузка активности помнили выбранную часть
            load();
        }

        /* ---------- выпадающие списки (сезоны, страницы серий) — свой контроллер, без системных окон ---------- */

        grid.onToggle = function () { if (dd) { dd.remove(); dd = null; ddItems = []; } };

        function ddFocus() {
            var it = ddItems[ddIdx];
            if (!it) return;
            Lampa.Controller.collectionFocus(it, dd);
            var n = it[0];
            if (n.offsetTop < dd[0].scrollTop) dd[0].scrollTop = n.offsetTop;
            else if (n.offsetTop + n.offsetHeight > dd[0].scrollTop + dd[0].clientHeight) dd[0].scrollTop = n.offsetTop + n.offsetHeight - dd[0].clientHeight;
        }

        function closeDd(silent) {
            if (!dd) return;
            dd.remove();
            dd = null;
            ddItems = [];
            if (!silent) Lampa.Controller.toggle('content');
        }

        // items: [{ name, sub, current, pick }]
        function openDd(host, items) {
            if (dd) return closeDd();
            if (!items.length) return;
            dd = $('<div class="avost-dd"></div>');
            ddItems = [];
            ddIdx = 0;
            items.forEach(function (d, i) {
                var it = $('<div class="avost-dd__item selector"></div>');
                it.append($('<span class="avost-dd__name"></span>').text(d.name));
                if (d.sub) it.append($('<span class="avost-dd__sub"></span>').text(d.sub));
                if (d.current) { it.addClass('avost-dd__item--current'); ddIdx = i; }
                it.on('hover:focus hover:hover hover:touch', function () { ddIdx = i; });
                it.on('hover:enter', function () {
                    closeDd();
                    d.pick();
                });
                dd.append(it);
                ddItems.push(it);
            });
            host.append(dd);
            // не даём панели уехать за правый край экрана — прижимаем к правому краю кнопки
            if (dd[0].getBoundingClientRect().right > window.innerWidth) dd.css({ left: 'auto', right: 0 });
            scroll.update(head, false);

            Lampa.Controller.add('animevost_dd', {
                toggle: function () {
                    Lampa.Controller.collectionSet(dd);
                    ddFocus();
                },
                up: function () { if (ddIdx > 0) { ddIdx--; ddFocus(); } },
                down: function () { if (ddIdx < ddItems.length - 1) { ddIdx++; ddFocus(); } },
                left: function () { closeDd(); },
                right: function () { closeDd(); },
                back: function () { closeDd(); }
            });
            Lampa.Controller.toggle('animevost_dd');
        }

        function openSeasons() {
            if (related.length < 2) return;
            openDd(relWrap, related.map(function (a) {
                var total = a.total ? ' · ' + a.current + '/' + a.total + (a.plus ? '+' : '') : '';
                return {
                    name: relationLabel(a) + (a.year ? ' · ' + a.year : ''),
                    sub: a.ru + total,
                    current: a.id === anime.id,
                    pick: function () { switchTo(a); }
                };
            }));
        }

        function gotoPage(p, focusIdx) {
            page = Math.max(0, Math.min(pageCount() - 1, p));
            renderEpisodes();
            grid.set(rows, true);
            grid.at(ROW_EPS, focusIdx === undefined ? 0 : focusIdx - pageStart());
            Lampa.Controller.toggle('content');
        }

        // Номер серии из названия («120 серия» → 120); у названий без числа (ОВА, спешл) — 0
        function epNumber(ep) {
            var m = /^\s*(\d+)/.exec(ep.name || '');
            return m ? parseInt(m[1], 10) : 0;
        }

        // «Перейти к серии…»: вводим номер, плагин сам листает к нужной серии; такой серии нет — ничего не делаем
        function openGoto() {
            Lampa.Input.edit({ free: true, title: 'Номер серии', nosave: true, value: '' }, function (value) {
                var n = parseInt(value, 10), idx = -1;
                if (n > 0) {
                    for (var i = 0; i < eps.length; i++) if (epNumber(eps[i]) === n) { idx = i; break; }
                }
                if (idx < 0) return Lampa.Controller.toggle('content');
                gotoPage(Math.floor(idx / PAGE_SIZE), idx);
            });
        }

        // Край полосы серий: вправо с последней плитки — следующая страница, влево с первой — предыдущая
        grid.onEdge = function (dir, row) {
            if (row !== ROW_EPS || pageCount() < 2) return false;
            if (dir === 'right' && page < pageCount() - 1) {
                gotoPage(page + 1, (page + 1) * PAGE_SIZE);
                return true;
            }
            if (dir === 'left' && page > 0) {
                gotoPage(page - 1, page * PAGE_SIZE - 1);
                return true;
            }
            return false;
        };

        function renderRelated(list) {
            if (list.length < 2 || !relBtn) return;
            related = list;
            var cur = list.filter(function (a) { return a.id === anime.id; })[0];
            relBtn.text((cur ? relationLabel(cur) : 'Сезоны') + ' ▾');
            relWrap.show();
            // кнопка встала в ряд — пересобираем ряд, не теряя текущий фокус
            rows[ROW_BTNS] = btnRow();
            grid.set(rows, true);
        }

        function btnRow() {
            var row = [continueBtn];
            if (related.length > 1) row.push(relBtn);
            if (pageCount() > 1) row.push(pageBtn);
            row.push(plBtn, qBtn);
            if (anime.description) row.push(descrBtn);
            if (Lampa.Search && Lampa.Search.open) row.push(lampaBtn);
            return row;
        }

        function button(container, label, act) {
            var el = $('<div class="avost-btn selector"></div>').text(label);
            el.on('hover:focus', function () { grid.track(el); scroll.update(head, false); });
            el.on('hover:hover hover:touch', function () { grid.track(el); });
            el.on('hover:enter', act);
            container.append(el);
            return el;
        }

        function showDescription() {
            var box = $('<div class="avost-modal"></div>');
            box.append($('<div class="avost-modal__text"></div>').text(anime.description));
            Lampa.Modal.open({
                title: anime.ru,
                html: box,
                size: 'medium',
                onBack: function () {
                    Lampa.Modal.close();
                    Lampa.Controller.toggle('content');
                }
            });
        }

        // «Увидел список серий» — сбрасываем бейдж «+N новых» на дашборде
        function markSeen() {
            var st = getMap('animevost_state');
            if (st[anime.id] && st[anime.id].count !== eps.length) {
                st[anime.id].count = eps.length;
                Lampa.Storage.set('animevost_state', st);
            }
        }

        function build(info, playlist, offline) {
            if (info) anime = $.extend({}, anime, info);
            eps = playlist;
            epNodes = [];
            rows = [[], []];
            related = [];
            dd = null;
            ddItems = [];
            scroll.clear();
            markSeen();

            head = $('<div class="avost-anime">' +
                '<div class="avost-anime__poster"><img alt=""/></div>' +
                '<div class="avost-anime__body">' +
                '<div class="avost-anime__title"></div><div class="avost-anime__en"></div>' +
                '<div class="avost-anime__meta"></div>' +
                '<div class="avost-anime__timer"></div>' +
                '<div class="avost-anime__btns"></div>' +
                '<div class="avost-anime__descr"></div></div></div>');

            setImage(head.find('img'), anime.poster);
            head.find('.avost-anime__title').text(anime.ru);
            head.find('.avost-anime__en').text(anime.en);
            head.find('.avost-anime__meta').text([
                anime.year, anime.type, anime.genre,
                anime.current ? anime.current + '/' + (anime.total || '?') + (anime.plus ? '+' : '') + ' серий' : '',
                offline ? 'офлайн-кеш' : ''
            ].filter(Boolean).join(' · '));
            timerBox = head.find('.avost-anime__timer');
            tickTimer();

            descrEl = head.find('.avost-anime__descr').text(anime.description);

            // ряд 0: кнопки
            var btns = head.find('.avost-anime__btns');
            continueBtn = button(btns, 'Смотреть', function () { play(resumeIndex()); });

            relWrap = $('<div class="avost-dd-wrap"></div>').hide();
            btns.append(relWrap);
            relBtn = button(relWrap, 'Сезоны ▾', openSeasons);

            page = Math.floor(resumeIndex() / PAGE_SIZE);
            // у очень длинных тайтлов (сотни серий) — кнопка перехода к серии по номеру
            pageBtn = button(btns, 'Перейти к серии…', openGoto);
            if (pageCount() < 2) pageBtn.hide();

            plBtn = button(btns, 'Плеер: ' + PLAYERS[setting('animevost_player', 'lampa')], function () {
                choosePlayer(function (v) {
                    plBtn.text('Плеер: ' + PLAYERS[v]);
                    Lampa.Controller.toggle('content');
                });
            });

            qBtn = button(btns, 'Качество: ' + (setting('animevost_quality', 'hd') === 'hd' ? '720p' : '480p'), function () {
                var q = setting('animevost_quality', 'hd') === 'hd' ? 'std' : 'hd';
                Lampa.Storage.set('animevost_quality', q);
                qBtn.text('Качество: ' + (q === 'hd' ? '720p' : '480p'));
            });
            descrBtn = button(btns, 'Описание', showDescription);
            if (!anime.description) descrBtn.hide();
            lampaBtn = button(btns, 'Карточка Lampa', function () {
                Lampa.Search.open({ input: lampaQuery(anime) });
            });
            if (!(Lampa.Search && Lampa.Search.open)) lampaBtn.hide();
            rows[ROW_BTNS] = btnRow();

            scroll.append(head);

            // ряд 1: серии
            epsHost = $('<div class="avost-eps-host"></div>');
            scroll.append(epsHost);
            renderEpisodes();

            var forId = anime.id;
            loadRelated(anime, function (list) {
                if (!destroyed && forId === anime.id) renderRelated(list);
            });

            // фокус сразу на серии, которую нужно продолжить
            grid.set(rows);
            if (getMap('animevost_state')[anime.id] && rows[ROW_EPS].length) grid.at(ROW_EPS, resumeIndex() - pageStart());
            else grid.at(ROW_BTNS, 0);

            self.activity.loader(false);
            self.activity.toggle();
        }

        this.create = function () {
            self.activity.loader(true);
            tick = setInterval(tickTimer, 30000);
            epLazy.start();
            document.addEventListener('visibilitychange', onVisible);
            if (Lampa.Timeline && Lampa.Timeline.listener) Lampa.Timeline.listener.follow('update', onTimeline);
            load();
        };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            refreshProgress();
            grid.bind();
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            destroyed = true;
            epLazy.stop();
            clearInterval(tick);
            document.removeEventListener('visibilitychange', onVisible);
            clearTimeout(tlTimer);
            if (Lampa.Timeline && Lampa.Timeline.listener && Lampa.Timeline.listener.remove) Lampa.Timeline.listener.remove('update', onTimeline);
            scroll.destroy();
            html.remove();
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Menu + settings                                                   */
    /* ------------------------------------------------------------------ */

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M10 8.5v5l4-2.5-4-2.5z" fill="currentColor"/><path d="M8 21h8"/></svg>';

    function addMenu() {
        if ($('.menu .menu__list [data-action="animevost"]').length) return;
        var item = $('<li class="menu__item selector" data-action="animevost">' +
            '<div class="menu__ico">' + ICON + '</div>' +
            '<div class="menu__text">AnimeVost</div></li>');
        item.on('hover:enter', function () {
            Lampa.Activity.push({ url: '', title: 'AnimeVost', component: 'animevost_main', page: 1 });
        });
        $('.menu .menu__list').eq(0).append(item);
    }

    // Диагностика: версия, платформа, доступность API и расписания — чтобы понять, почему на конкретном устройстве
    // что-то отличается (старая версия из кеша, мобильная вёрстка сайта, недоступный API).
    function platformName() {
        var names = ['android', 'webos', 'tizen', 'apple_tv', 'apple', 'orsay', 'netcast', 'noname'], out = [];
        names.forEach(function (n) { try { if (Lampa.Platform.is(n)) out.push(n); } catch (e) { /* ignore */ } });
        return out.join(', ') || 'браузер/ПК';
    }

    function showDiagnostics(apiState) {
        var d = getMap('animevost_diag'), sc = getMap('animevost_schedule');
        var when = function (t) { return t ? new Date(t).toLocaleString() : '—'; };
        var lines = [
            'Версия плагина: ' + VERSION,
            'Платформа: ' + platformName(),
            'User-Agent: ' + ((typeof navigator !== 'undefined' && navigator.userAgent) || '').slice(0, 140),
            'API: ' + api() + ' → ' + apiState,
            'Расписание в кеше: ' + (sc.map ? Object.keys(sc.map).length + ' записей, ' + when(sc.ts) : 'нет'),
            'Прокси для расписания: ' + (setting('animevost_proxy', '') || 'не задан')
        ];
        if (d.ts) {
            lines.push('Последняя загрузка расписания: ' + when(d.ts) + ' — ' + (d.entries ? 'успешно, ' + d.entries + ' записей' : 'НЕ удалась'));
            (d.tries || []).forEach(function (t) {
                lines.push('  • ' + t.url + ' → ' + (t.error ? 'ошибка ' + t.error : t.bytes + ' байт, ' + t.entries + ' записей'));
            });
            if (d.error) lines.push('  ' + d.error);
        } else {
            lines.push('Расписание ещё не загружалось.');
        }
        lines.push('Если расписания нет — дни выхода берутся из заголовков тайтлов, часть тайтлов попадёт в «Без даты выхода».');

        Lampa.Modal.open({
            title: 'AnimeVost: диагностика',
            html: $('<div class="avost-modal"></div>').append($('<div class="avost-modal__text"></div>').text(lines.join('\n'))),
            size: 'medium',
            onBack: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle('settings_component');
            }
        });
    }

    function runDiagnostics() {
        Lampa.Noty.show('Проверяю API и расписание…');
        var apiState = '…';
        var left = 2;
        var done = function () { if (!--left) showDiagnostics(apiState); };
        var t0 = Date.now();
        request('/last?page=1&quantity=1', null, function () { apiState = 'доступен (' + (Date.now() - t0) + ' мс)'; done(); },
            function (e) { apiState = 'НЕДОСТУПЕН (' + e + ')'; done(); });
        loadSchedule(function () { done(); }, function () { done(); }, true);
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({ component: 'animevost', name: 'AnimeVost', icon: ICON });
        Lampa.SettingsApi.addParam({
            component: 'animevost',
            param: { name: 'animevost_version', type: 'static', default: '' },
            field: { name: 'Версия плагина', description: VERSION }
        });
        Lampa.SettingsApi.addParam({
            component: 'animevost',
            param: { name: 'animevost_diag_btn', type: 'button' },
            field: { name: 'Диагностика', description: 'Проверить API, обновить расписание и показать версию, платформу и ошибки' },
            onChange: runDiagnostics
        });

        Lampa.SettingsApi.addParam({
            component: 'animevost',
            param: { name: 'animevost_player', type: 'select', values: PLAYERS, default: 'lampa' },
            field: { name: 'Плеер', description: 'Внешние плееры (VLC, Infuse и т.д.) не возвращают таймкод — запоминание работает только во встроенном плеере и Android-плеере' }
        });
        Lampa.SettingsApi.addParam({
            component: 'animevost',
            param: { name: 'animevost_player_ask', type: 'trigger', default: false },
            field: { name: 'Спрашивать плеер при каждом запуске' }
        });
        Lampa.SettingsApi.addParam({
            component: 'animevost',
            param: { name: 'animevost_quality', type: 'select', values: { hd: '720p', std: '480p' }, default: 'hd' },
            field: { name: 'Качество видео' }
        });
        Lampa.SettingsApi.addParam({
            component: 'animevost',
            param: { name: 'animevost_pages', type: 'select', values: { '2': '80 тайтлов', '3': '120 тайтлов', '5': '200 тайтлов' }, default: '3' },
            field: { name: 'Глубина поиска онгоингов', description: 'Сколько последних обновлений сканировать для расписания' }
        });
        Lampa.SettingsApi.addParam({
            component: 'animevost',
            param: { name: 'animevost_https', type: 'trigger', default: true },
            field: { name: 'Принудительно HTTPS для видео и картинок', description: 'Нужно, если Lampa открыта по https (иначе браузер блокирует http-видео)' }
        });
        Lampa.SettingsApi.addParam({
            component: 'animevost',
            param: { name: 'animevost_proxy', type: 'input', values: '', default: '' },
            field: { name: 'CORS-прокси для расписания', description: 'Расписание берётся с главной animevost.org. На Android Lampa получает его сама; в браузере нужен прокси-префикс (например https://corsproxy.io/?). Без него расписание строится по заголовкам тайтлов' }
        });
        Lampa.SettingsApi.addParam({
            component: 'animevost',
            param: { name: 'animevost_api', type: 'input', values: '', default: DEFAULT_API },
            field: { name: 'Адрес API', description: 'Можно указать зеркало или прокси' }
        });
    }

    // Источник в глобальном поиске Lampa: AnimeVost появляется рядом с TMDB-результатами
    function addGlobalSearch() {
        if (!Lampa.Search || !Lampa.Search.addSource) return;

        var toCard = function (a) {
            return {
                id: a.id,
                title: a.ru,
                name: a.ru,
                original_title: a.en,
                original_name: a.en,
                img: bestPoster(a.poster),
                poster: bestPoster(a.poster),
                release_date: a.year ? a.year + '-01-01' : '',
                vote_average: 0,
                source: 'animevost',
                anime: a
            };
        };

        Lampa.Search.addSource({
            title: 'AnimeVost',
            search: function (params, done) {
                var q = decodeURIComponent(params.query || '');
                searchAnime(q, function (list) {
                    done(list.length ? [{ title: 'AnimeVost', results: list.map(toCard), total: list.length }] : []);
                }, function () { done([]); });
            },
            onCancel: function () {},
            params: { lazy: true, align_left: true, card_events: { onMenu: function () {} } },
            onMore: function (params, close) {
                if (close) close();
                Lampa.Activity.push({ url: '', title: 'Поиск: ' + params.query, component: 'animevost_main', query: params.query, page: 1 });
            },
            onSelect: function (params, close) {
                if (close) close();
                openAnime(params.element.anime);
            }
        });
    }

    // Ряды на главном экране Lampa: «продолжить» и «сегодня выходит» (без сетевых запросов — только из кеша)
    function addMainRows() {
        if (!Lampa.ContentRows || !Lampa.ContentRows.add) return;
        bigGet('animevost_cache_last', function () { /* прогреваем кеш для ряда «сегодня» */ });

        var mk = function (a) {
            return {
                id: a.id,
                title: a.ru,
                name: a.ru,
                original_title: a.en,
                original_name: a.en,
                img: bestPoster(a.poster),
                poster: bestPoster(a.poster),
                release_date: a.year ? a.year + '-01-01' : '',
                vote_average: 0,
                source: 'animevost',
                anime: a,
                params: { emit: { onlyEnter: function () { openAnime(a); } } }
            };
        };

        Lampa.ContentRows.add({
            name: 'animevost_continue',
            title: 'AnimeVost: продолжить просмотр',
            index: 1,
            screen: ['main'],
            call: function () {
                try {
                    var hist = historyList().slice(0, 15);
                    if (!hist.length) return;
                    return function (call) { call({ results: hist.map(mk), title: 'AnimeVost: продолжить просмотр' }); };
                } catch (e) { console.log('AnimeVost', 'row continue', e); }
            }
        });

        Lampa.ContentRows.add({
            name: 'animevost_today',
            title: 'AnimeVost: сегодня выходит',
            index: 2,
            screen: ['main'],
            call: function () {
                try {
                    var cache = bigMem.animevost_cache_last, sc = getMap('animevost_schedule').map;
                    if (!cache || !cache.list || !sc) return;
                    var today = (new Date(Date.now() + 3 * 3600000).getUTCDay() + 6) % 7;
                    var items = cache.list.filter(function (a) { return sc[a.id] && sc[a.id].day === today; })
                        .map(function (a) { return applySchedule($.extend({}, a), sc[a.id]); })
                        .sort(function (x, y) { return (x.airMin >= 0 ? x.airMin : 9999) - (y.airMin >= 0 ? y.airMin : 9999); })
                        .slice(0, 15);
                    if (!items.length) return;
                    return function (call) { call({ results: items.map(mk), title: 'AnimeVost: сегодня выходит' }); };
                } catch (e) { console.log('AnimeVost', 'row today', e); }
            }
        });
    }

    function start() {
        console.log('AnimeVost', 'v' + VERSION);
        injectStyle();
        cleanCaches();
        hookPlayer();
        Lampa.Component.add('animevost_main', MainComponent);
        Lampa.Component.add('animevost_anime', AnimeComponent);
        Lampa.Component.add('animevost_search', SearchComponent);
        addSettings();
        addMenu();
        try { addGlobalSearch(); } catch (e) { console.log('AnimeVost', 'global search unavailable', e); }
        try { addMainRows(); } catch (e) { console.log('AnimeVost', 'main rows unavailable', e); }
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
