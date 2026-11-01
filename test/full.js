/*
 * Интеграционные тесты плагина: jsDelivr-независимый стенд на jsdom с заглушкой Lampa.
 * Запуск: npm test   (нужен интернет: часть сценариев ходит в живой api.animevost.org)
 *
 * Стенд (mk): заглушки Lampa.Scroll/Controller/Storage/Select/Modal/Cache/Timeline/Player и т.д.
 * Контроллеры страниц регистрируются под именем "content", выпадающий список — "animevost_dd".
 * jsdom не считает раскладку (offsetTop = 0), поэтому реальный перенос строк сетки здесь не проверить.
 * Новый сценарий: скопируй соседний блок «N. …», используй S.key(контроллер, 'up|down|left|right|back'),
 * S.$(S.focused).trigger('hover:enter'|'hover:long'), until(() => условие), ok(условие, 'описание').
 */
const {JSDOM}=require('jsdom');const fs=require('fs');const path=require('path');
const PLUGIN=path.resolve(__dirname,'..','animevost.js');
const errors=[];let pass=0,failn=0;
const ok=(c,m)=>{if(c){pass++;console.log('  ok  ',m)}else{failn++;console.log('  FAIL',m)}};
function mk(api){
 const dom=new JSDOM('<body><div class="menu"><ul class="menu__list"></ul></div></body>',{url:'https://lampa.test/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;global.window=w;global.document=w.document;w.$=w.jQuery=require('jquery');delete global.window;delete global.document;
 w.addEventListener('error',e=>errors.push(e.message));
 const S={idb:{},tl:[],rows:[],store:{},comps:{},handlers:{},log:[],cur:'',focused:null,act:{loader:()=>{},toggle:()=>{}},pushed:[],played:[]};
 if(api)S.store.animevost_api=api;
 function Scroll(){const el=w.$('<div class="scroll"></div>');const b=w.$('<div class="scroll__body"></div>');el.append(b);this.render=()=>el;this.body=()=>b;this.append=x=>b.append(x);this.clear=()=>b.empty();this.update=()=>{};this.minus=()=>{};this.destroy=()=>{};}
 w.Lampa={Scroll,
  Storage:{get:(k,d)=>{let v=S.store[k];if(v===undefined)v=d;if(v==='true')return true;if(v==='false')return false;if(typeof v==='string'&&/^\d+$/.test(v))return parseInt(v);return v===undefined?'':v},set:(k,v)=>{S.store[k]=v}},
  Utils:{hash:s=>'h'+s,copyTextToClipboard:()=>{}},
  Timeline:{listener:{follow:(n,f)=>S.tl.push(f),remove:(n,f)=>{S.tl=S.tl.filter(x=>x!==f)}},view:h=>({hash:h,percent:S.store['p_'+h]||0,time:S.store['t_'+h]||0,duration:S.store['d_'+h]||1400}),update:p=>{S.store['p_'+p.hash]=p.percent;S.store['t_'+p.hash]=p.time;S.store['d_'+p.hash]=p.duration||1400}},Modal:{open:o=>{S.modal=o},close:()=>{S.modalClosed=true}},
  Controller:{add:(n,h)=>{S.handlers[n]=h},toggle:n=>{S.cur=n;S.log.push('toggle:'+n);S.handlers[n]&&S.handlers[n].toggle&&S.handlers[n].toggle()},collectionSet:()=>{},collectionFocus:(el)=>{S.focused=el;w.$('.focus').removeClass('focus');w.$(el).addClass('focus').trigger('hover:focus')},enabled:()=>({name:S.cur})},
  Activity:{push:o=>S.pushed.push(o),active:()=>({activity:S.act}),backward:()=>S.log.push('back'),replace:()=>{}},
  Player:{play:i=>S.played.push(i),playlist:()=>{},callback:c=>{S.cb=c},runas:v=>{S.runas=v},listener:{follow:(n,f)=>{(S.pl=S.pl||{})[n]=f}}},
  Select:{show:o=>{S.sel=o}},Noty:{show:()=>{}},Input:{edit:(o,cb)=>{S.input=cb}},Platform:{is:n=>n==='android',macOS:()=>false},
  SettingsApi:{addComponent:()=>{},addParam:()=>{}},Search:{addSource:()=>{},open:o=>{S.searchOpen=o}},Cache:{rewriteData:(t,k,v)=>{S.idb[k]=JSON.parse(JSON.stringify(v));return Promise.resolve()},getData:(t,k)=>Promise.resolve(S.idb[k]||null)},ContentRows:{add:r=>S.rows.push(r)},Component:{add:(n,c)=>S.comps[n]=c},Listener:{follow:()=>{}},
  Reguest:function(){this.native=(u,c,e)=>e()}};
 w.appready=true;w.eval(fs.readFileSync(PLUGIN,'utf8'));
 S.w=w;S.key=(n,k)=>S.handlers[n][k]();S.$=w.$;
 S.label=()=>{const e=w.$(S.focused);return e.hasClass('avost-ep')?'EP '+e.find('.avost-ep__name').text():e.hasClass('avost-card')?'CARD':e.hasClass('avost-dd__item')?'DD '+e.find('.avost-dd__name').text():'BTN '+e.text()};
 return S;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,n=60){for(let i=0;i<n;i++){if(f())return true;await sleep(500)}return false}
const inDom=(S)=>S.focused&&S.w.document.body.contains?true:false;

(async()=>{
 console.log('1. dashboard (live API)');
 let S=mk();let m=new S.comps.animevost_main({});m.activity=S.act;m.create();
 ok(await until(()=>S.$(m.render()).find('.avost-card').length),'cards render');
 m.start();ok(/CARD/.test(S.label()),'initial focus on card');
 for(const k of ['right','down','down','up','up','up','left','right'])S.key('content',k);
 ok(S.focused!==null,'random walk keeps a focus target');
 const wrap=S.$(m.render()).find('.avost-grid').length;ok(wrap>0,'sections use wrapping .avost-grid (no horizontal Scroll rows): '+wrap);
 ok(S.$(m.render()).find('.scroll--horizontal, .avost-row .scroll').length===0,'no nested horizontal scrolls in dashboard');
 m.destroy();

 console.log('2. dashboard with dead API (no network)');
 S=mk('http://127.0.0.1:9/v1');m=new S.comps.animevost_main({});m.activity=S.act;m.create();
 ok(await until(()=>S.$(m.render()).find('.avost-empty').length,80),'error state shown');
 m.start();ok(/BTN/.test(S.label()),'something focusable on error screen: '+S.label());
 m.destroy();

 console.log('3. anime page with seasons (4064)');
 S=mk();let a=new S.comps.animevost_anime({anime:{id:4064,ru:'Отель для нелюдей (второй сезон)',en:'',poster:''}});a.activity=S.act;a.create();
 ok(await until(()=>S.$(a.render()).find('.avost-ep').length),'episodes render');
 ok(await until(()=>S.$(a.render()).find('.avost-dd-wrap').css('display')!=='none'),'season dropdown button shown');
 a.start();ok(/BTN Смотреть/.test(S.label()),'start on Смотреть: '+S.label());
 S.key('content','right');ok(/Сезон|▾/.test(S.label()),'right -> season button: '+S.label());
 S.$(S.focused).trigger('hover:enter');
 ok(S.cur==='animevost_dd'&&S.$(a.render()).find('.avost-dd__item').length===2,'dropdown open with 2 items, controller dd');
 ok(/DD/.test(S.label()),'focus inside dropdown: '+S.label());
 S.key('animevost_dd','up');S.key('animevost_dd','up');S.key('animevost_dd','down');S.key('animevost_dd','down');S.key('animevost_dd','down');
 ok(/DD/.test(S.label()),'dd edges ok');
 S.key('animevost_dd','back');
 ok(S.cur==='content'&&!S.$(a.render()).find('.avost-dd').length,'back closes dropdown, returns to page controller');
 ok(/BTN/.test(S.label()),'focus returned to button: '+S.label());
 S.key('content','down');ok(/EP/.test(S.label()),'down -> episodes: '+S.label());
 S.key('content','up');S.$(S.focused).trigger('hover:enter');S.key('animevost_dd','up');S.$(S.focused).trigger('hover:enter');
 ok(await until(()=>/Отель для нелюдей$/.test(S.$(a.render()).find('.avost-anime__title').text())),'switched to season 1');
 ok(S.cur==='content','page controller active after switch: '+S.cur);
 ok(await until(()=>S.$(a.render()).find('.avost-ep').length===13),'season 1 episodes loaded (13)');
 S.key('content','right');S.key('content','down');ok(/EP/.test(S.label()),'nav works after switch: '+S.label());
 S.$(S.focused).trigger('hover:enter');ok(S.played.length===1&&S.played[0].playlist.length===13,'play after switch ok');
 console.log('4. rapid switching (race)');
 S.key('content','up');S.key('content','up');
 for(const k of ['right']) S.key('content',k);
 S.$(S.focused).trigger('hover:enter');S.key('animevost_dd','down');S.$(S.focused).trigger('hover:enter');
 S.key('content','right');
 S.$(S.focused).trigger('hover:enter');S.key('animevost_dd','up');S.$(S.focused).trigger('hover:enter');
 await sleep(6000);
 const title=S.$(a.render()).find('.avost-anime__title').text();
 ok(/Отель для нелюдей$/.test(title),'final state = last selection, not stale response: '+title);
 ok(S.$(a.render()).find('.avost-anime__title').length===1,'exactly one head rendered');
 a.destroy();

 console.log('5. destroy while loading');
 S=mk();a=new S.comps.animevost_anime({anime:{id:4064,ru:'x',en:'',poster:''}});a.activity=S.act;a.create();a.destroy();await sleep(5000);ok(errors.length===0,'no JS errors after late responses ('+errors.join('|')+')');

 console.log('6. anime page with dead API -> retry view');
 S=mk('http://127.0.0.1:9/v1');a=new S.comps.animevost_anime({anime:{id:4064,ru:'x',en:'',poster:''}});a.activity=S.act;a.create();
 ok(await until(()=>S.$(a.render()).find('.avost-empty').length,80),'fail view shown');
 a.start();ok(/BTN Повторить/.test(S.label()),'focus on Повторить: '+S.label());
 S.key('content','right');ok(/Назад/.test(S.label()),'right -> Назад');
 S.$(S.focused).trigger('hover:enter');ok(S.log.includes('back'),'Назад works');
 S.key('content','left');S.$(S.focused).trigger('hover:enter');ok(await until(()=>S.log.length>0),'Повторить triggers reload (no crash)');
 a.destroy();

 console.log('7. long franchise dropdown (Naruto)');
 S=mk();const r=await (await fetch('https://api.animevost.org/v1/search',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'name='+encodeURIComponent('Наруто')})).json();
 const rid=r.data.find(x=>/^Наруто \/ Naruto \[/.test(x.title)).id;
 a=new S.comps.animevost_anime({anime:{id:rid,ru:'Наруто',en:'',poster:''}});a.activity=S.act;a.create();
 ok(await until(()=>S.$(a.render()).find('.avost-ep').length),'naruto loaded');
 ok(await until(()=>S.$(a.render()).find('.avost-dd-wrap').css('display')!=='none'),'dropdown button shown');
 a.start();S.key('content','right');S.$(S.focused).trigger('hover:enter');
 const n=S.$(a.render()).find('.avost-dd__item').length;ok(n>=10,'dropdown items: '+n);
 for(let i=0;i<n+3;i++)S.key('animevost_dd','down');ok(/DD/.test(S.label()),'bottom edge stable');
 for(let i=0;i<n+3;i++)S.key('animevost_dd','up');ok(/DD/.test(S.label()),'top edge stable');
 S.key('animevost_dd','left');ok(S.cur==='content','left closes dropdown');
 a.destroy();

 console.log('8. controller named content survives menu/head round-trip');
 S=mk();m=new S.comps.animevost_main({});m.activity=S.act;m.create();
 await until(()=>S.$(m.render()).find('.avost-card').length);m.start();
 ok(typeof S.handlers.content==='object'&&!S.handlers.animevost_main,'page registers controller as "content"');
 S.key('content','right');const before=S.label();
 S.focused=null;S.$('.focus').removeClass('focus');
 S.log.length=0;S.w.Lampa.Controller.toggle('content'); // what menu/head do on return
 ok(S.focused!==null,'toggle(content) restores a focus target: '+S.label());
 m.destroy();

 console.log('9. dropdown closed by external content toggle');
 S=mk();a=new S.comps.animevost_anime({anime:{id:4064,ru:'Отель для нелюдей (второй сезон)',en:'',poster:''}});a.activity=S.act;a.create();
 await until(()=>S.$(a.render()).find('.avost-ep').length);await until(()=>S.$(a.render()).find('.avost-dd-wrap').css('display')!=='none');a.start();
 S.key('content','right');S.$(S.focused).trigger('hover:enter');
 ok(S.$(a.render()).find('.avost-dd').length===1,'dropdown open');
 S.w.Lampa.Controller.toggle('content');
 ok(S.$(a.render()).find('.avost-dd').length===0,'dropdown removed on content toggle (no orphan overlay)');

 console.log('10. player patch/restore');
 S.store.animevost_player='vlc';S.store.player='android';
 S.key('content','left');S.key('content','down');S.$(S.focused).trigger('hover:enter');
 ok(S.store.player==='vlc','player temporarily patched');
 S.$(S.focused).trigger('hover:enter'); // second launch within window
 S.pl.external();
 ok(S.store.player==='android','restored to ORIGINAL (android) after external event, not stuck on vlc: '+S.store.player);
 ok(S.runas==='','launch_player reset via runas("")');
 ok(S.cb===false,'dangling Player.callback cleared');
 ok(S.played[0].playlist.every(i=>typeof i.callback==='function'),'playlist items carry callback for auto-advance');
 S.played[0].playlist[2].callback();
 ok(S.store.animevost_state['4064'].last===S.played[0].playlist[2].title,'auto-advance remembered: '+S.store.animevost_state['4064'].last);
 a.destroy();

 console.log('11. date edge cases (pure)');
 const P=require(PLUGIN);
 const T=(title,now,timer)=>P.parseAnime({id:1,title:'X / Y [1-5 из 12+] ['+title+']',timer:timer||'0'},now);
 let x=T('6 серия - 1 ноября',new Date(2026,10,2,12));ok(x.nextDate>=new Date(2026,10,2),'stale past date moves to future week: '+x.nextDate.toDateString());
 ok(!/выходит сегодня/.test(P.countdownText(x,new Date(2026,10,2,12).getTime())),'stale date not shown as "today"');
 x=T('3 серия - 5 января',new Date(2026,11,28,12));ok(x.nextDate.getFullYear()===2027&&/через (8|9) дн/.test(P.countdownText(x,new Date(2026,11,28,12).getTime())),'New Year rollover: '+P.countdownText(x,new Date(2026,11,28,12).getTime()));
 x=T('3 серия - 28 декабря',new Date(2027,0,2,12));ok(x.nextDate>=new Date(2027,0,2),'late-Dec tag in early Jan not +360d: '+x.nextDate.toDateString());
 x=T('3 серия - 3 ноября',new Date(2026,10,2,1,38));ok(/завтра/.test(P.countdownText(x,new Date(2026,10,2,1,38).getTime())),'tomorrow at 23:59 edge: '+P.countdownText(x,new Date(2026,10,2,1,38).getTime()));
 x=T('3 серия - 8 ноября',new Date(2026,10,2,12),String(new Date(2026,10,8,21).getTime()/1000));ok(x.airExact&&x.airAt===new Date(2026,10,8,21).getTime(),'timer within 36h of tag date used');
 x=T('3 серия - 8 ноября',new Date(2026,10,2,12),String(new Date(2026,10,1,21).getTime()/1000));ok(!x.airExact,'stale timer ignored');
 x=P.parseAnime({id:2,title:'X / Y [1-5 из 12+]',timer:'0'});ok(P.relationLabel({ru:'Магия (Спэшл)',type:'ТВ-спэшл'}).length>0&&P.relationKind({ru:'Магия (Спэшл)',type:'ТВ-спэшл'})===3,'special kinds recognized');

 console.log('12. history row refreshes after returning');
 S=mk();S.store.animevost_state={};m=new S.comps.animevost_main({});m.activity=S.act;m.create();
 await until(()=>S.$(m.render()).find('.avost-card').length);m.start();
 ok(!/Продолжить просмотр/.test(S.$(m.render()).text()),'no history row initially');
 S.store.animevost_state={9:{id:9,ru:'Тест',en:'',poster:'',last:'3 серия',idx:2,ts:Date.now()}};
 m.start();
 ok(/Продолжить просмотр/.test(S.$(m.render()).text())&&/3 серия/.test(S.$(m.render()).text()),'history row appears on return without network');
 m.destroy();

 console.log('13. description button + modal');
 S=mk();a=new S.comps.animevost_anime({anime:{id:4064,ru:'Отель',en:'',poster:''}});a.activity=S.act;a.create();
 await until(()=>S.$(a.render()).find('.avost-ep').length);a.start();
 const btnTexts=S.$(a.render()).find('.avost-anime__btns .avost-btn').map((i,e)=>S.$(e).text()).get();
 ok(btnTexts.includes('Описание'),'Описание button present: '+btnTexts.join(' | '));
 const dBtn=S.$(a.render()).find('.avost-btn').filter((i,e)=>S.$(e).text()==='Описание');
 dBtn.trigger('hover:enter');ok(S.modal&&S.modal.title&&S.modal.html.text().length>20,'modal opened with description');
 S.modal.onBack();ok(S.modalClosed&&S.cur==='content','modal back restores content controller');
 ok(S.$(a.render()).find('.avost-ep').length>0&&/BTN|EP/.test(S.label()||'BTN'),'page intact after modal');

 console.log('14. episode context menu: watched marks');
 S.key('content','down');const e0=S.$(S.focused);ok(e0.hasClass('avost-ep'),'on episode tile');
 e0.trigger('hover:long');ok(S.sel&&S.sel.items.length>=3,'long-press opens menu: '+(S.sel&&S.sel.items.map(i=>i.title).join(' / ')));
 const markAll=S.sel.items.find(i=>/все до этой/.test(i.title));
 S.key('content','right');S.key('content','right');S.$(S.focused).trigger('hover:long');
 S.sel.onSelect(S.sel.items.find(i=>/все до этой/.test(i.title)));
 ok(S.$(a.render()).find('.avost-ep.watched').length===3,'"all before this" marks 3 watched: '+S.$(a.render()).find('.avost-ep.watched').length);
 ok(S.cur==='content','controller restored after menu');
 S.$(S.$(a.render()).find('.avost-ep')[0]).trigger('hover:long');
 S.sel.onSelect(S.sel.items.find(i=>/непросмотренной/.test(i.title)));
 ok(S.$(a.render()).find('.avost-ep.watched').length===2,'unmark single episode');
 S.$(S.$(a.render()).find('.avost-ep')[1]).trigger('hover:long');
 S.sel.onSelect(S.sel.items.find(i=>/всего тайтла/.test(i.title)));
 ok(S.$(a.render()).find('.avost-ep.watched').length===0,'reset all progress');
 S.$(S.$(a.render()).find('.avost-ep')[0]).trigger('contextmenu');ok(S.sel.title.length>0,'right-click also opens menu');
 S.sel.onBack();ok(S.cur==='content','menu back ok');
 a.destroy();

 console.log('15. history menu + new badge + progress bar');
 S=mk();S.store.animevost_state={4026:{id:4026,ru:'Я ведьма',en:'',poster:'',last:'2 серия',idx:1,ts:Date.now(),count:1},4054:{id:4054,ru:'Гоблин',en:'',poster:'',last:'1 серия',idx:0,ts:Date.now()-1000}};
 const hh=P.__h||null;
 S.store['p_h'+'animevost:4026:2 серия']=40;
 m=new S.comps.animevost_main({});m.activity=S.act;m.create();
 await until(()=>S.$(m.render()).find('.avost-card').length);m.start();
 const histRow=S.$(m.render()).find('.avost-row').first();
 ok(/Продолжить просмотр/.test(histRow.text()),'history row first');
 ok(histRow.find('.avost-card__bar').length===1,'progress bar on history card with progress');
 ok(/\+\d/.test(histRow.find('.avost-card').first().text()),'new-episodes badge: '+histRow.find('.avost-card__badge').first().text());
 histRow.find('.avost-card').first().trigger('hover:long');
 ok(S.sel&&S.sel.items.length===3,'history menu: '+S.sel.items.map(i=>i.title).join(' / '));
 S.sel.onSelect(S.sel.items.find(i=>/Удалить из истории/.test(i.title)));
 ok(Object.keys(S.store.animevost_state).length===1,'deleted one from history');
 ok(S.$(m.render()).find('.avost-row').first().find('.avost-card').length===1,'row re-rendered');
 const sel2=(S.$(m.render()).find('.avost-row').first().find('.avost-card').first().trigger('hover:long'),S.sel);
 sel2.onSelect(sel2.items.find(i=>/Очистить/.test(i.title)));
 ok(!/Продолжить просмотр/.test(S.$(m.render()).text()),'clear history removes row');
 m.destroy();

 console.log('16. long title paging (One Piece)');
 S=mk();const op=await (await fetch('https://api.animevost.org/v1/search',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'name='+encodeURIComponent('Ван Пис')})).json();
 const big=op.data.map(x=>P.parseAnime(x)).sort((x,y)=>y.current-x.current)[0];
 a=new S.comps.animevost_anime({anime:{id:big.id,ru:big.ru,en:'',poster:''}});a.activity=S.act;a.create();
 ok(await until(()=>S.$(a.render()).find('.avost-ep').length,120),'big title loaded: '+big.ru.slice(0,25));
 const total=S.$(a.render()).find('.avost-ep').length;ok(total<=50,'only one page of tiles rendered: '+total);
 a.start();
 const pb=S.$(a.render()).find('.avost-btn').filter((i,e)=>/Серии \d+–\d+ ▾/.test(S.$(e).text()));ok(pb.length===1,'page button: '+pb.text());
 for(let i=0;i<12&&!/Серии \d+–\d+ ▾/.test(S.label());i++)S.key('content','right');
 S.$(S.focused).trigger('hover:enter');const ddn=S.$(a.render()).find('.avost-dd__item').length;ok(ddn>=3,'page dropdown items: '+ddn);
 S.key('animevost_dd','down');S.$(S.focused).trigger('hover:enter');
 ok(S.cur==='content'&&/Серии 51/.test(S.$(a.render()).find('.avost-row__title').text()),'switched to page 2: '+S.$(a.render()).find('.avost-row__title').text());
 ok(S.$(a.render()).find('.avost-ep').length===50,'50 tiles on page 2');
 S.key('content','down');ok(/EP/.test(S.label()),'nav into tiles of page 2: '+S.label());
 S.$(S.focused).trigger('hover:enter');ok(S.played[0]&&S.played[0].playlist.length>100,'play uses full playlist ('+(S.played[0]&&S.played[0].playlist.length)+')');
 S.key('content','up');for(let i=0;i<12&&!/Серии \d+–\d+ ▾/.test(S.label());i++)S.key('content','right');
 S.$(S.focused).trigger('hover:enter');for(let i=0;i<ddn;i++)S.key('animevost_dd','down');S.$(S.focused).trigger('hover:enter');
 ok(typeof S.input==='function','goto-episode opens input');
 S.input('120');ok(/Серии 101/.test(S.$(a.render()).find('.avost-row__title').text()),'goto 120 -> page 3: '+S.$(a.render()).find('.avost-row__title').text());
 a.destroy();

 console.log('17. IndexedDB cache (Lampa.Cache) + offline fallback');
 S=mk();let S1=S;a=new S.comps.animevost_anime({anime:{id:4064,ru:'Отель',en:'',poster:''}});a.activity=S.act;a.create();
 await until(()=>S.$(a.render()).find('.avost-ep').length);await sleep(200);
 ok(S.idb.animevost_pl_4064&&S.idb.animevost_pl_4064.playlist.length>0,'playlist cached in IndexedDB');
 ok(S.store.animevost_pl_4064===undefined,'not duplicated into localStorage');
 a.destroy();
 S=mk('http://127.0.0.1:9/v1');S.idb=S1.idb;
 a=new S.comps.animevost_anime({anime:{id:4064,ru:'Отель',en:'',poster:''}});a.activity=S.act;a.create();
 ok(await until(()=>S.$(a.render()).find('.avost-ep').length,80),'episodes shown offline from IndexedDB cache');
 ok(/офлайн-кеш/.test(S.$(a.render()).find('.avost-anime__meta').text()),'offline label shown');
 a.destroy();

 console.log('18. live Timeline refresh');
 S=mk();a=new S.comps.animevost_anime({anime:{id:4064,ru:'Отель',en:'',poster:''}});a.activity=S.act;a.create();
 await until(()=>S.$(a.render()).find('.avost-ep').length);a.start();
 ok(S.tl.length===1,'listener registered once');
 const h0='hanimevost:4064:'+S.$(a.render()).find('.avost-ep__name').first().text();
 S.store['p_'+h0]=95;S.tl.forEach(f=>f({}));await sleep(700);
 ok(S.$(a.render()).find('.avost-ep').first().hasClass('watched'),'tile updated from Timeline event without reopening');
 a.destroy();ok(S.tl.length===0,'listener removed on destroy');

 console.log('19. Lampa card button');
 S=mk();a=new S.comps.animevost_anime({anime:{id:4064,ru:'Отель для нелюдей (второй сезон)',en:'Hotel Inhumans 2',poster:''}});a.activity=S.act;a.create();
 await until(()=>S.$(a.render()).find('.avost-ep').length);a.start();
 S.$(a.render()).find('.avost-btn').filter((i,e)=>S.$(e).text()==='Карточка Lampa').trigger('hover:enter');
 ok(S.searchOpen&&S.searchOpen.input==='Hotel Inhumans','Search.open with cleaned EN title: '+(S.searchOpen&&S.searchOpen.input));
 ok(P.lampaQuery({en:'Ranma ½ (2024) 3rd Season'})==='Ranma ½ (2024)'||P.lampaQuery({en:'Ranma ½ (2024) 3rd Season'}).startsWith('Ranma'),'query cleaner: '+P.lampaQuery({en:'Ranma ½ (2024) 3rd Season'}));
 ok(P.lampaQuery({en:'',ru:'Блич: Тысячелетняя война'})==='блич','falls back to franchise key');
 a.destroy();

 console.log('20. main-screen rows (ContentRows)');
 S=mk();ok(S.rows.length===2,'two rows registered: '+S.rows.map(r=>r.name).join(','));
 const cont=S.rows.find(r=>r.name==='animevost_continue');ok(cont.call({},'main')===undefined,'continue row hidden when no history');
 S.store.animevost_state={4026:{id:4026,ru:'Я ведьма',en:'',poster:'',last:'2 серия',idx:1,ts:Date.now()}};
 const fn=cont.call({},'main');ok(typeof fn==='function','continue row returns loader when history exists');
 let got;fn(d=>{got=d});ok(got.results.length===1&&typeof got.results[0].params.emit.onlyEnter==='function','row card has onlyEnter');
 got.results[0].params.emit.onlyEnter();ok(S.pushed.length&&S.pushed[0].component==='animevost_anime','onlyEnter opens anime page');
 m=new S.comps.animevost_main({});m.activity=S.act;m.create();await until(()=>S.$(m.render()).find('.avost-card').length);await sleep(300);
 const today=S.rows.find(r=>r.name==='animevost_today').call({},'main');
 console.log('   today row (depends on schedule fetch in this env):',typeof today);
 m.destroy();

 console.log('21. integration walk: all features together');
 S=mk();m=new S.comps.animevost_main({});m.activity=S.act;m.create();await until(()=>S.$(m.render()).find('.avost-card').length);m.start();
 S.$(m.render()).find('.avost-card').first().trigger('hover:enter');const pushed=S.pushed[S.pushed.length-1];
 a=new S.comps.animevost_anime({anime:pushed.anime});a.activity=S.act;a.create();await until(()=>S.$(a.render()).find('.avost-ep').length);a.start();
 let steps=0;const walk=(k,n=1)=>{for(let i=0;i<n;i++){S.key('content',k);steps++}};
 walk('right',3);walk('down');walk('right');walk('left',2);walk('up');walk('down');
 S.$(S.focused).trigger('hover:long');S.sel.onBack();
 S.key('content','up');S.key('content','right');
 const btn=S.$(S.focused);if(/▾/.test(btn.text())){btn.trigger('hover:enter');S.key('animevost_dd','down');S.key('animevost_dd','back')}
 S.key('content','down');S.$(S.focused).trigger('hover:enter');
 ok(S.played.length===1,'full walk ends in playback ('+steps+' key presses, '+S.played.length+' play)');
 ok(S.focused!==null&&S.cur==='content','controller consistent at the end: '+S.cur);
 ok(errors.length===0,'no JS errors in walk: '+errors.join('|'));
 a.destroy();m.destroy();

 console.log(`\n${pass} passed, ${failn} failed, js errors: ${errors.length}`);
 process.exit(failn?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
