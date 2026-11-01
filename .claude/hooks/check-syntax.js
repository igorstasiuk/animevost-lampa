#!/usr/bin/env node
// PostToolUse-хук: после правки animevost.js сразу проверяет синтаксис и ES5-несовместимые конструкции.
// Ошибка (exit 2) возвращается Claude в stderr — он исправляет сразу, а не на ТВ.
var cp = require('child_process');
var fs = require('fs');

var input = '';
process.stdin.on('data', function (c) { input += c; });
process.stdin.on('end', function () {
    var file = '';
    try { file = (JSON.parse(input).tool_input || {}).file_path || ''; } catch (e) { return; }
    if (!/animevost\.js$/.test(file) || !fs.existsSync(file)) return;

    try {
        cp.execFileSync('node', ['--check', file], { stdio: 'pipe' });
    } catch (e) {
        process.stderr.write('animevost.js: синтаксическая ошибка\n' + (e.stderr || e.message) + '\n');
        process.exit(2);
    }

    // ES5-сканер: стрелки, let/const, шаблонные строки, методы ES6+, gap — не пройдут на старых WebView
    var bad = [];
    fs.readFileSync(file, 'utf8').split('\n').forEach(function (line, i) {
        var code = line.replace(/\/\/.*$/, '');
        if (/=>|(^|[^\w.$'"-])(let|const) [\w{[]|`|\.(includes|findIndex|startsWith|endsWith|padStart)\(|Object\.(assign|values|entries)|Array\.from|[;{"']gap:/.test(code)) {
            bad.push((i + 1) + ': ' + line.trim().slice(0, 110));
        }
    });
    if (bad.length) {
        process.stderr.write('animevost.js: конструкции не для старых WebView ТВ (см. .claude/rules/es5-webview.md):\n' + bad.slice(0, 8).join('\n') + '\n');
        process.exit(2);
    }
});
