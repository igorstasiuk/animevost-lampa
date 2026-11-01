/*!
 * AnimeVost for Lampa
 * Отдельная страница: дашборд онгоингов по дням недели, список серий,
 * запоминание прогресса/таймкода, выбор плеера.
 * API: https://api.animevost.org/v1
 */
(function () {
    'use strict';

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
            var d = new Date(now.getFullYear(), MONTHS[next[3].toLowerCase()], parseInt(next[2], 10));
            if (d.getTime() < now.getTime() - 60 * 86400000) d.setFullYear(d.getFullYear() + 1);
            item.nextEp = next[1] + ' серия';
            item.nextDate = d;
            item.day = dayIndex(d);
            // timer даёт точное время, но иногда устаревший — верим ему только если день совпал
            var td = new Date(timer);
            item.airAt = timer > now.getTime() && td.toDateString() === d.toDateString() ? timer : d.getTime();
            item.airExact = item.airAt === timer && timer > 0;
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
        var today = dayIndex(now);
        var buckets = [[], [], [], [], [], [], []];
        var undated = [];

        list.forEach(function (a) {
            if (!a.ongoing) return;
            if (a.day > -1) buckets[a.day].push(a);
            else undated.push(a);
        });

        var sections = [];
        for (var i = 0; i < 7; i++) {
            var idx = (today + i) % 7;
            if (!buckets[idx].length) continue;
            var prefix = i === 0 ? 'Сегодня · ' : i === 1 ? 'Завтра · ' : '';
            sections.push({ title: prefix + DAYS[idx], items: buckets[idx] });
        }
        if (undated.length) sections.push({ title: 'Без даты выхода', items: undated });
        return sections;
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
        var days = Math.round((a.airAt - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
        if (days <= 0) return label + ' выходит сегодня';
        if (days === 1) return label + ' выходит завтра';
        return label + ' выйдет через ' + days + ' дн.';
    }

    var REL_MARK = /(^|[\s(])(сезон|фильм|ова|ova|ona|спешл|special|часть|эпизод|movie)/i;

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

    function sortRelated(list) {
        return list.slice().sort(function (x, y) {
            return (parseInt(x.year, 10) || 0) - (parseInt(y.year, 10) || 0) || x.id - y.id;
        });
    }

    function fmtTime(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
        var p = function (n) { return n < 10 ? '0' + n : '' + n; };
        return (h ? h + ':' + p(m) : m) + ':' + p(s);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { countdownText: countdownText, franchiseKey: franchiseKey, relationLabel: relationLabel, sortRelated: sortRelated, parseAnime: parseAnime, groupByDay: groupByDay, fmtTime: fmtTime, dayIndex: dayIndex };
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
        return ('' + setting('animevost_api', DEFAULT_API)).replace(/\/+$/, '');
    }

    function httpsify(url) {
        if (!url) return url;
        return setting('animevost_https', true) ? url.replace(/^http:\/\//, 'https://') : url;
    }

    // У static.openni.ru истёк https-сертификат, а http работает, поэтому для картинок
    // идём по цепочке: как отдал API -> другая схема -> прокси weserv -> заглушка.
    function setImage(img, url, onFail) {
        if (!url) return onFail ? onFail() : img.attr('src', './img/img_broken.svg');
        var plain = url.replace(/^https?:\/\//, '');
        var chain = [url, (/^https/.test(url) ? 'http://' : 'https://') + plain,
            'https://images.weserv.nl/?url=' + encodeURIComponent(plain)];
        var step = 0;
        img.off('error.avost').on('error.avost', function () {
            if (++step < chain.length) img.attr('src', chain[step]);
            else if (onFail) onFail();
            else img.attr('src', './img/img_broken.svg');
        });
        img.attr('src', chain[0]);
    }

    function getMap(key) {
        var v = Lampa.Storage.get(key, '{}');
        return v && typeof v === 'object' ? v : {};
    }

    function episodeHash(animeId, epName) {
        return Lampa.Utils.hash('animevost:' + animeId + ':' + epName);
    }

    function remember(anime, epName, idx) {
        var st = getMap('animevost_state');
        st[anime.id] = {
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

    function request(path, post, ok, fail) {
        $.ajax({
            url: api() + path,
            method: post ? 'POST' : 'GET',
            data: post || undefined,
            dataType: 'json',
            timeout: 15000,
            success: ok,
            error: function (xhr, status) { fail && fail(status || 'error'); }
        });
    }

    function loadOngoing(ok, fail, force) {
        var cache = getMap('animevost_cache_last');
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
            Lampa.Storage.set('animevost_cache_last', { ts: Date.now(), list: list });
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
        var cached = Lampa.Storage.get(key, '');
        var info = null, playlist = null, errors = 0, left = 2;

        function done() {
            if (--left) return;
            if (!playlist || !playlist.length) {
                if (cached && cached.playlist) return ok(cached.info || info, cached.playlist, true);
                return fail('empty');
            }
            Lampa.Storage.set(key, { info: info, playlist: playlist });
            ok(info, playlist, false);
        }

        request('/info', { id: id }, function (r) {
            if (r.data && r.data[0]) info = parseAnime(r.data[0]);
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
                done && done(a.value);
            },
            onBack: function () { Lampa.Controller.toggle(back); }
        });
    }

    // Возвращает false если запуск не нужен (скопировали ссылку)
    function applyPlayer(item, mode) {
        if (mode === 'copy') {
            Lampa.Utils.copyTextToClipboard(item.url, function () {
                Lampa.Noty.show('Ссылка скопирована');
            }, function () {
                Lampa.Noty.show('Не удалось скопировать: ' + item.url);
            });
            return false;
        }
        if (mode === 'inner' || mode === 'android' || mode === 'webos') {
            item.launch_player = mode;
        } else if (mode !== 'lampa') {
            // для схем вида vlc://, infuse:// Lampa читает общую настройку "player" —
            // подменяем её на время запуска
            var prev = Lampa.Storage.get('player', 'inner');
            Lampa.Storage.set('player', mode);
            var restore = function () { Lampa.Storage.set('player', prev); };
            setTimeout(restore, 5000);
        }
        return true;
    }

    function playEpisode(anime, eps, idx, onClose) {
        var go = function (mode) {
            var ep = eps[idx];
            var playlist = eps.map(function (e) {
                return {
                    title: e.name,
                    url: pickUrl(e),
                    poster: httpsify(e.preview),
                    timeline: Lampa.Timeline.view(episodeHash(anime.id, e.name))
                };
            });
            var item = {
                title: anime.ru + ' — ' + ep.name,
                url: pickUrl(ep),
                poster: httpsify(ep.preview),
                timeline: playlist[idx].timeline,
                playlist: playlist
            };
            if (!applyPlayer(item, mode)) return;
            remember(anime, ep.name, idx);
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
            '.avost-bar{display:flex;flex-wrap:wrap;gap:.8em;padding:0 1.5em 1em}' +
            '.avost-btn{padding:.7em 1.4em;border-radius:.6em;background:rgba(255,255,255,.1);font-size:1.1em}' +
            '.avost-btn.focus{background:#fff;color:#000}' +
            '.avost-row{margin-bottom:1.6em}' +
            '.avost-row__title{font-size:1.5em;padding:0 1.5em .6em;opacity:.9}' +
            '.avost-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(10em,1fr));gap:1.2em .9em;padding:0 1.5em}' +
            '.avost-card{position:relative;min-width:0}' +
            '.avost-card__img{position:relative;height:0;padding-top:145%;border-radius:.7em;overflow:hidden;background:#2a2a2a}' +
            '.avost-card__img img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}' +
            '.avost-card__badge{position:absolute;left:0;bottom:.5em;padding:.2em .6em;background:#e8590c;color:#fff;font-size:.9em;border-radius:0 .4em .4em 0}' +
            '.avost-card__title{margin-top:.5em;font-size:1em;line-height:1.25;max-height:2.5em;overflow:hidden;padding:0 .2em}' +
            '.avost-card.focus .avost-card__img{box-shadow:0 0 0 .22em #fff}' +
            '.avost-anime{display:flex;gap:2em;padding:1.5em}' +
            '.avost-anime__poster{width:15em;flex-shrink:0}' +
            '.avost-anime__poster img{width:100%;border-radius:.7em}' +
            '.avost-anime__body{flex:1;min-width:0}' +
            '.avost-anime__title{font-size:2em;line-height:1.2}' +
            '.avost-anime__en{opacity:.6;margin-top:.2em}' +
            '.avost-anime__meta{margin:.8em 0;opacity:.8}' +
            '.avost-anime__timer{margin:.3em 0 .6em;font-size:1.2em;color:#ffa94d}' +
            '.avost-anime__rel{margin:.6em 0;max-width:60em}' +
            '.avost-anime__rel-title{opacity:.6;margin-bottom:.4em}' +
                        '.avost-chip{padding:.6em 1.2em;margin:0 .5em 0 0;border-radius:.6em;background:rgba(255,255,255,.1);white-space:nowrap;flex-shrink:0}' +
            '.avost-chip__year{opacity:.55;margin-left:.6em;font-size:.9em}' +
            '.avost-chip--current{background:#e8590c;color:#fff}' +
            '.avost-chip.focus{background:#fff;color:#000}' +
            '.avost-anime__descr{margin:1em 0;line-height:1.45;max-height:7.5em;overflow:hidden;opacity:.85}' +
            '.avost-anime__btns{display:flex;flex-wrap:wrap;gap:.8em;margin:1em 0}' +
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
            '.avost-empty{padding:3em 1.5em;font-size:1.3em;opacity:.7}' +
            '@media (max-width:1100px){.avost-ep{width:20em}.avost-ep__img{height:11.2em}}' +
            '@media (max-width:760px){.avost-anime{flex-direction:column;gap:1em;padding:1em}.avost-anime__poster{width:9em}' +
            '.avost-anime__title{font-size:1.5em}.avost-grid{grid-template-columns:repeat(auto-fill,minmax(8em,1fr));padding:0 1em;gap:1em .7em}' +
            '.avost-bar{padding:0 1em 1em}.avost-row__title{padding:0 1em .6em;font-size:1.3em}.avost-ep{width:16em}.avost-ep__img{height:9em}' +
            '.avost-ep__name{font-size:1.2em}}' +
            '@media (min-width:1900px){.avost-grid{grid-template-columns:repeat(auto-fill,minmax(11em,1fr))}}' +
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

        this.set = function (arr) { rows = arr; };
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
                    Lampa.Controller.collectionSet(scroll.render());
                    self.focus();
                },
                left: function () {
                    refresh();
                    if (c > 0) { c--; self.focus(); }
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    refresh();
                    if (c < row(r).length - 1) { c++; self.focus(); }
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
    /*  Component: дашборд / поиск                                        */
    /* ------------------------------------------------------------------ */

    function MainComponent(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var html = $('<div class="avost"></div>');
        var grid = new Grid('animevost_main', scroll);
        var sections = [];
        var btns = [];
        var bar;

        scroll.minus();
        html.append(scroll.render());

        function card(a, badge) {
            var el = $('<div class="avost-card selector">' +
                '<div class="avost-card__img"><img alt=""/></div>' +
                '<div class="avost-card__title"></div></div>');
            el.find('.avost-card__title').text(a.ru);
            setImage(el.find('img'), a.poster);
            var b = badge || a.nextEp || (a.current ? a.current + '/' + (a.total || '?') + (a.plus ? '+' : '') : '');
            if (b) el.find('.avost-card__img').append($('<div class="avost-card__badge"></div>').text(b));
            return el;
        }

        // Секция — адаптивная сетка с переносом строк: число колонок зависит от ширины экрана
        function row(title, list, badgeFn) {
            var items = [];
            var wrap = $('<div class="avost-row"><div class="avost-row__title"></div><div class="avost-grid"></div></div>');
            var box = wrap.find('.avost-grid');
            wrap.find('.avost-row__title').text(title).toggle(!!title);

            list.forEach(function (a) {
                var el = card(a, badgeFn && badgeFn(a));
                el.on('hover:focus', function () {
                    grid.track(el);
                    scroll.update(el, false);
                });
                el.on('hover:hover hover:touch', function () { grid.track(el); });
                el.on('hover:enter', function () { openAnime(a); });
                box.append(el);
                items.push(el);
            });

            scroll.append(wrap);
            sections.push(items);
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
            btns.push(button('Поиск', function () {
                Lampa.Input.edit({ free: true, title: 'Поиск аниме', nosave: true, value: '' }, function (value) {
                    if (value) Lampa.Activity.push({ url: '', title: 'Поиск: ' + value, component: 'animevost_main', query: value, page: 1 });
                    else Lampa.Controller.toggle('animevost_main');
                });
            }));
            if (!object.query) {
                btns.push(button('Обновить', function () { self.reload(true); }));
            }
            var pl = button('Плеер: ' + PLAYERS[setting('animevost_player', 'lampa')], function () {
                choosePlayer(function (v) {
                    pl.text('Плеер: ' + PLAYERS[v]);
                    Lampa.Controller.toggle('animevost_main');
                });
            });
            btns.push(pl);
            scroll.append(bar);
        }

        function history() {
            var st = getMap('animevost_state');
            return Object.keys(st).map(function (k) { return st[k]; })
                .sort(function (a, b) { return b.ts - a.ts; })
                .slice(0, 20);
        }

        function finish() {
            grid.layout(layoutRows);
            grid.at(sections.length ? 1 : 0, 0); // сразу на первую карточку, а не на панель кнопок
            self.activity.loader(false);
            self.activity.toggle();
        }

        function build(groups) {
            scroll.clear();
            sections = [];
            toolbar();

            if (!object.query) {
                var hist = history();
                if (hist.length) {
                    row('Продолжить просмотр', hist, function (h) { return h.last; });
                }
            }

            if (!groups.length) {
                scroll.append($('<div class="avost-empty">Ничего не найдено</div>'));
            }
            groups.forEach(function (g) { row(g.title, g.items); });
            finish();
        }

        function fail() {
            scroll.clear();
            sections = [];
            toolbar();
            scroll.append($('<div class="avost-empty">Не удалось загрузить данные AnimeVost. Проверьте сеть или адрес API в настройках.</div>'));
            finish();
        }

        this.reload = function (force) {
            self.activity.loader(true);
            if (object.query) {
                searchAnime(object.query, function (list) {
                    build([{ title: 'Найдено: ' + list.length, items: list }]);
                }, fail);
            } else {
                loadOngoing(function (list) { build(groupByDay(list)); }, fail, force);
            }
        };

        this.create = function () { this.reload(false); };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            grid.bind();
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () { scroll.destroy(); html.remove(); };
    }

    /* ------------------------------------------------------------------ */
    /*  Component: страница тайтла и список серий                         */
    /* ------------------------------------------------------------------ */

    // ряды страницы: 0 — кнопки, 1 — сезоны/фильмы, 2 — серии
    var ROW_BTNS = 0, ROW_REL = 1, ROW_EPS = 2;

    function AnimeComponent(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var html = $('<div class="avost"></div>');
        var grid = new Grid('animevost_anime', scroll);
        var anime = object.anime;
        var eps = [];
        var epNodes = [];
        var rows = [[], [], []];
        var continueBtn, relBox, relLine, timerBox, head, tick;

        scroll.minus();
        html.append(scroll.render());

        function viewOf(ep) {
            return Lampa.Timeline.view(episodeHash(anime.id, ep.name));
        }

        // Какую серию предложить: недосмотренную последнюю или следующую после досмотренной
        function resumeIndex() {
            var st = getMap('animevost_state')[anime.id];
            if (!st) return 0;
            var idx = eps.findIndex(function (e) { return e.name === st.last; });
            if (idx < 0) return 0;
            var v = viewOf(eps[idx]);
            if (v.percent >= 90 && idx + 1 < eps.length) return idx + 1;
            return idx;
        }

        function play(idx) {
            playEpisode(anime, eps, idx, function () {
                refreshProgress();
                grid.at(ROW_EPS, idx);
                Lampa.Controller.toggle('animevost_anime');
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
            setImage(el.find('img'), ep.preview, function () { el.find('img').hide(); });
            el.on('hover:focus', function () {
                grid.track(el);
                line.update(el, true);
                scroll.update(wrap, false);
            });
            el.on('hover:hover hover:touch', function () { grid.track(el); });
            el.on('hover:enter', function () { play(idx); });
            return el;
        }

        function refreshProgress() {
            eps.forEach(function (ep, i) {
                var v = viewOf(ep), el = epNodes[i];
                if (!el) return;
                el.toggleClass('watched', v.percent >= 90);
                el.find('.avost-ep__bar').toggle(v.percent > 0 && v.percent < 90);
                el.find('.avost-ep__bar div').css('width', Math.min(100, v.percent) + '%');
                el.find('.avost-ep__sub').text(
                    v.percent >= 90 ? 'Просмотрено' :
                    v.time > 5 ? 'Остановились на ' + fmtTime(v.time) : ''
                );
            });
            if (continueBtn) {
                var i = resumeIndex(), v = eps[i] ? viewOf(eps[i]) : null;
                continueBtn.text(
                    getMap('animevost_state')[anime.id]
                        ? 'Продолжить: ' + eps[i].name + (v && v.time > 5 && v.percent < 90 ? ' (' + fmtTime(v.time) + ')' : '')
                        : 'Смотреть: ' + eps[0].name
                );
            }
        }

        function tickTimer() {
            if (!timerBox) return;
            var txt = countdownText(anime);
            timerBox.text(txt ? '⏱ ' + txt : '').toggle(!!txt);
        }

        // Переключатель сезонов/фильмов/ОВА; показываем только если связанных тайтлов больше одного
        function renderRelated(list) {
            if (!relBox || list.length < 2) return;
            var chips = [];
            list.forEach(function (a) {
                var chip = $('<div class="avost-chip selector"></div>');
                chip.append($('<span class="avost-chip__name"></span>').text(relationLabel(a)));
                if (a.year) chip.append($('<span class="avost-chip__year"></span>').text(a.year));
                if (a.id === anime.id) chip.addClass('avost-chip--current');
                chip.on('hover:focus', function () {
                    grid.track(chip);
                    relLine.update(chip, true);
                    scroll.update(head, false);
                });
                chip.on('hover:hover hover:touch', function () { grid.track(chip); });
                chip.on('hover:enter', function () {
                    if (a.id === anime.id) return;
                    Lampa.Activity.replace({ anime: a, title: a.ru });
                });
                relLine.append(chip);
                chips.push(chip);
            });
            rows[ROW_REL] = chips;
            grid.set(rows);
            relBox.show();
            if (Lampa.Activity.active() && Lampa.Activity.active().activity === self.activity &&
                Lampa.Controller.enabled().name === 'animevost_anime') {
                Lampa.Controller.collectionSet(scroll.render());
            }
        }

        function button(container, label, act) {
            var el = $('<div class="avost-btn selector"></div>').text(label);
            el.on('hover:focus', function () { grid.track(el); scroll.update(head, false); });
            el.on('hover:hover hover:touch', function () { grid.track(el); });
            el.on('hover:enter', act);
            container.append(el);
            return el;
        }

        function build(info, playlist, offline) {
            if (info) anime = $.extend({}, anime, info);
            eps = playlist;
            epNodes = [];
            rows = [[], [], []];
            scroll.clear();

            head = $('<div class="avost-anime">' +
                '<div class="avost-anime__poster"><img alt=""/></div>' +
                '<div class="avost-anime__body">' +
                '<div class="avost-anime__title"></div><div class="avost-anime__en"></div>' +
                '<div class="avost-anime__meta"></div>' +
                '<div class="avost-anime__timer"></div>' +
                '<div class="avost-anime__btns"></div>' +
                '<div class="avost-anime__rel"><div class="avost-anime__rel-title">Сезоны и фильмы</div></div>' +
                '<div class="avost-anime__descr"></div></div></div>');

            setImage(head.find('img'), anime.poster);
            head.find('.avost-anime__title').text(anime.ru);
            head.find('.avost-anime__en').text(anime.en);
            head.find('.avost-anime__meta').text([
                anime.year, anime.type, anime.genre,
                anime.current ? anime.current + '/' + (anime.total || '?') + (anime.plus ? '+' : '') + ' серий' : '',
                offline ? 'офлайн-кеш' : ''
            ].filter(Boolean).join(' · '));
            head.find('.avost-anime__descr').text(anime.description);
            timerBox = head.find('.avost-anime__timer');
            tickTimer();

            // ряд 0: кнопки
            var btns = head.find('.avost-anime__btns');
            continueBtn = button(btns, 'Смотреть', function () { play(resumeIndex()); });

            var plBtn = button(btns, 'Плеер: ' + PLAYERS[setting('animevost_player', 'lampa')], function () {
                choosePlayer(function (v) {
                    plBtn.text('Плеер: ' + PLAYERS[v]);
                    Lampa.Controller.toggle('animevost_anime');
                });
            });

            var qBtn = button(btns, 'Качество: ' + (setting('animevost_quality', 'hd') === 'hd' ? '720p' : '480p'), function () {
                var q = setting('animevost_quality', 'hd') === 'hd' ? 'std' : 'hd';
                Lampa.Storage.set('animevost_quality', q);
                qBtn.text('Качество: ' + (q === 'hd' ? '720p' : '480p'));
            });
            rows[ROW_BTNS] = [continueBtn, plBtn, qBtn];

            // ряд 1: сезоны (появляется, когда загрузится поиск связанных тайтлов)
            relBox = head.find('.avost-anime__rel').hide();
            relLine = new Lampa.Scroll({ horizontal: true, step: 300 });
            relBox.append(relLine.render());

            scroll.append(head);

            // ряд 2: серии — одна строка больших тайлов с горизонтальной прокруткой
            var wrap = $('<div class="avost-row avost-row--eps"><div class="avost-row__title">Серии</div></div>');
            var line = new Lampa.Scroll({ horizontal: true, step: 450 });
            eps.forEach(function (ep, i) {
                var n = epNode(ep, i, line, wrap);
                epNodes.push(n);
                line.append(n);
            });
            wrap.append(line.render());
            scroll.append(wrap);
            rows[ROW_EPS] = epNodes.slice();

            refreshProgress();
            loadRelated(anime, renderRelated);

            // фокус сразу на серии, которую нужно продолжить
            grid.set(rows);
            if (getMap('animevost_state')[anime.id] && epNodes.length) grid.at(ROW_EPS, resumeIndex());
            else grid.at(ROW_BTNS, 0);

            self.activity.loader(false);
            self.activity.toggle();
        }

        this.create = function () {
            self.activity.loader(true);
            tick = setInterval(tickTimer, 30000);
            loadAnime(anime.id, build, function () {
                scroll.clear();
                scroll.append($('<div class="avost-empty">Не удалось получить список серий.</div>'));
                self.activity.loader(false);
                self.activity.toggle();
            });
        };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            refreshProgress();
            grid.bind();
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () { clearInterval(tick); scroll.destroy(); html.remove(); };
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

    function addSettings() {
        Lampa.SettingsApi.addComponent({ component: 'animevost', name: 'AnimeVost', icon: ICON });

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
                img: a.poster,
                poster: a.poster,
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

    function start() {
        injectStyle();
        Lampa.Component.add('animevost_main', MainComponent);
        Lampa.Component.add('animevost_anime', AnimeComponent);
        addSettings();
        addMenu();
        try { addGlobalSearch(); } catch (e) { console.log('AnimeVost', 'global search unavailable', e); }
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
