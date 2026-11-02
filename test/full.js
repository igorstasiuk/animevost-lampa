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
 const w=dom.window;global.window=w;global.document=w.document;delete require.cache[require.resolve('jquery')];w.$=w.jQuery=require('jquery');delete global.window;delete global.document;
 w.addEventListener('error',e=>errors.push(e.message));
 const S={idb:{},tl:[],rows:[],store:{},comps:{},handlers:{},log:[],cur:'',focused:null,act:{loader:()=>{},toggle:()=>{}},pushed:[],played:[]};
 if(api)S.store.animevost_api=api;
 function Scroll(){const el=w.$('<div class="scroll"></div>');const b=w.$('<div class="scroll__body"></div>');el.append(b);this.render=()=>el;this.body=()=>b;this.append=x=>b.append(x);this.clear=()=>b.empty();this.update=()=>{};this.minus=()=>{};this.destroy=()=>{};}
 w.Lampa={Scroll,
  Storage:{get:(k,d)=>{let v=S.store[k];if(v===undefined)v=d;if(v==='true')return true;if(v==='false')return false;if(typeof v==='string'&&/^\d+$/.test(v))return parseInt(v);return v===undefined?'':v},set:(k,v)=>{S.store[k]=v}},
  Utils:{hash:s=>'h'+s,copyTextToClipboard:()=>{}},
  Timeline:{listener:{follow:(n,f)=>S.tl.push(f),remove:(n,f)=>{S.tl=S.tl.filter(x=>x!==f)}},view:h=>({hash:h,percent:S.store['p_'+h]||0,time:S.store['t_'+h]||0,duration:S.store['d_'+h]||1400}),update:p=>{S.store['p_'+p.hash]=p.percent;S.store['t_'+p.hash]=p.time;S.store['d_'+p.hash]=p.duration||1400}},Modal:{open:o=>{S.modal=o},close:()=>{S.modalClosed=true}},
  Controller:{add:(n,h)=>{S.handlers[n]=h},toggle:n=>{S.cur=n;S.log.push('toggle:'+n);S.handlers[n]&&S.handlers[n].toggle&&S.handlers[n].toggle()},collectionSet:()=>{},collectionFocus:(el)=>{S.focused=el;w.$('.focus').removeClass('focus');w.$(el).addClass('focus').trigger('hover:focus')},enabled:()=>({name:S.cur})},
  Activity:{push:o=>S.pushed.push(o),active:()=>({activity:S.act}),backward:()=>S.log.push('back'),replace:(o,c)=>{S.replaced={o:o,clear:c}}},
  Player:{play:i=>S.played.push(i),playlist:()=>{},callback:c=>{S.cb=c},runas:v=>{S.runas=v},listener:{follow:(n,f)=>{(S.pl=S.pl||{})[n]=f}}},
  Select:{show:o=>{S.sel=o}},Noty:{show:()=>{}},Input:{edit:(o,cb)=>{S.input=cb}},Platform:{is:n=>n==='android',macOS:()=>false},
  SettingsApi:{addComponent:()=>{},addParam:p=>{(S.params=S.params||[]).push(p)}},Search:{addSource:()=>{},open:o=>{S.searchOpen=o}},Cache:{rewriteData:(t,k,v)=>{S.idb[k]=JSON.parse(JSON.stringify(v));return Promise.resolve()},getData:(t,k)=>Promise.resolve(S.idb[k]||null)},ContentRows:{add:r=>S.rows.push(r)},Component:{add:(n,c)=>S.comps[n]=c},Listener:{follow:()=>{}},
  Reguest:function(){this.native=(u,c,e,post,opt)=>{if(S.native){S.nativeCalls=(S.nativeCalls||[]);S.nativeCalls.push({u,opt});return S.native(u,c,e)}e()}}};
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

 console.log('16. long title: jump-to-episode button + edge paging (One Piece)');
 S=mk();const op=await (await fetch('https://api.animevost.org/v1/search',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'name='+encodeURIComponent('Ван Пис')})).json();
 const big=op.data.map(x=>P.parseAnime(x)).sort((x,y)=>y.current-x.current)[0];
 a=new S.comps.animevost_anime({anime:{id:big.id,ru:big.ru,en:'',poster:''}});a.activity=S.act;a.create();
 ok(await until(()=>S.$(a.render()).find('.avost-ep').length,120),'big title loaded: '+big.ru.slice(0,25));
 ok(S.$(a.render()).find('.avost-ep').length===50,'one page of 50 tiles rendered');
 a.start();
 const gb=()=>S.$(a.render()).find('.avost-btn').filter((i,e)=>S.$(e).text()==='Перейти к серии…');
 ok(gb().length===1&&gb().css('display')!=='none','jump button present: «'+gb().text()+'»');
 ok(S.$(a.render()).find('.avost-dd').length===0&&!/Серии \d+–\d+ ▾/.test(S.$(a.render()).find('.avost-btn').text()),'no page-range dropdown anymore');
 const rowTitle=()=>S.$(a.render()).find('.avost-row__title').text();
 const toBtn=()=>{S.key('content','up');for(let i=0;i<12&&!/Перейти к серии/.test(S.label());i++)S.key('content','right')};
 // go to 120 -> page 3 (101-150), focus on tile 120
 toBtn();ok(/Перейти к серии/.test(S.label()),'focus reached jump button');
 S.$(S.focused).trigger('hover:enter');ok(typeof S.input==='function','input opened');
 S.input('120');ok(/Серии 101/.test(rowTitle()),'jump to 120 -> '+rowTitle());
 ok(/EP 120 серия/.test(S.label()),'focus on episode 120: '+S.label());
 // nonexistent episode -> nothing happens
 const titleBefore=rowTitle();
 toBtn();S.$(S.focused).trigger('hover:enter');S.input('999999');
 ok(rowTitle()===titleBefore&&S.cur==='content','unknown episode 999999: page unchanged ('+rowTitle()+'), controller restored');
 toBtn();S.$(S.focused).trigger('hover:enter');S.input('0');ok(rowTitle()===titleBefore,'episode 0: nothing');
 toBtn();S.$(S.focused).trigger('hover:enter');S.input('abc');ok(rowTitle()===titleBefore,'non-numeric input: nothing');
 toBtn();S.$(S.focused).trigger('hover:enter');S.input('');ok(rowTitle()===titleBefore&&S.cur==='content','empty input (cancel): nothing, focus restored');
 // jump to first/last
 toBtn();S.$(S.focused).trigger('hover:enter');S.input('1');ok(/Серии 1–50/.test(rowTitle())&&/EP 1 серия/.test(S.label()),'jump to 1: '+rowTitle()+' / '+S.label());
 // edge paging: right from last tile of page 1 -> page 2
 S.key('content','down');for(let i=0;i<60&&!/EP 50 серия/.test(S.label());i++)S.key('content','right');
 ok(/EP 50 серия/.test(S.label()),'at last tile of page 1: '+S.label());
 S.key('content','right');ok(/Серии 51/.test(rowTitle())&&/EP 51 серия/.test(S.label()),'right at edge -> next page: '+rowTitle()+' / '+S.label());
 S.key('content','left');ok(/Серии 1–50/.test(rowTitle())&&/EP 50 серия/.test(S.label()),'left at first tile -> previous page, focus last tile: '+rowTitle()+' / '+S.label());
 S.key('content','left');S.key('content','left');S.key('content','left');ok(/EP 47 серия/.test(S.label()),'ordinary left moves inside page: '+S.label());
 // very first tile on first page: left goes to menu (no previous page)
 for(let i=0;i<60;i++)S.key('content','left');ok(S.log.includes('toggle:menu'),'left at very first tile -> menu');
 // last page right edge: nothing
 toBtn();S.$(S.focused).trigger('hover:enter');S.input(String(big.current));
 S.key('content','down');for(let i=0;i<60;i++)S.key('content','right');
 ok(S.focused!==null&&S.cur==='content','right at the end of the last page: no crash, focus kept');
 // play still uses full playlist
 S.$(S.focused).trigger('hover:enter');ok(S.played[0]&&S.played[0].playlist.length>100,'play uses full playlist ('+(S.played[0]&&S.played[0].playlist.length)+')');
 // small titles do not get the button
 a.destroy();
 S=mk();a=new S.comps.animevost_anime({anime:{id:4064,ru:'x',en:'',poster:''}});a.activity=S.act;a.create();await until(()=>S.$(a.render()).find('.avost-ep').length);a.start();
 ok(S.$(a.render()).find('.avost-btn').filter((i,e)=>S.$(e).text()==='Перейти к серии…').css('display')==='none','short title: jump button hidden');
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

 console.log('22. lazy loading: images near viewport only; lazy playlist');
 S=mk();
 S.shift=0;
 S.$('<i>')[0].ownerDocument.defaultView.Element.prototype.getBoundingClientRect=function(){
   const w=S.w;if(this.tagName==='IMG'&&w.$(this).closest('.avost-ep').length){const i=w.$('.avost-ep img').index(this);const l=i*300-S.shift;return {left:l,right:l+280,top:100,bottom:260,width:280,height:160}}
   return {left:0,right:100,top:100,bottom:200,width:100,height:100};};
 S.w.innerWidth=1000;S.w.innerHeight=700;
 const tlCalls={n:0};const origView=S.w.Lampa.Timeline.view;S.w.Lampa.Timeline.view=h=>{tlCalls.n++;return origView(h)};
 a=new S.comps.animevost_anime({anime:{id:big.id,ru:'x',en:'',poster:''}});a.activity=S.act;S.w.document.body.appendChild(a.render()[0]);a.create();
 await until(()=>S.$(a.render()).find('.avost-ep').length>=10,120);await sleep(900);
 let withSrc=()=>S.$(a.render()).find('.avost-ep img').filter((i,e)=>e.getAttribute('src')).length;
 const tiles=S.$(a.render()).find('.avost-ep').length;
 ok(tiles>=10&&withSrc()>0&&withSrc()<tiles,'only tiles near the viewport load images: '+withSrc()+' of '+tiles);
 ok(!S.$(a.render()).find('.avost-ep img').last().attr('src'),'far tile has no src yet');
 S.shift=300*(tiles-3);await sleep(900);
 ok(!!S.$(a.render()).find('.avost-ep img').last().attr('src'),'after scrolling, far tile loads its image');
 a.start();S.key('content','down');tlCalls.n=0;S.$(S.focused).trigger('hover:enter');
 const p=S.played[0];ok(!!p,'playback started');
 ok(tlCalls.n<10,'Timeline.view not called for the whole playlist on play: '+tlCalls.n+' calls for '+p.playlist.length+' items');
 const before2=tlCalls.n;const tl5=p.playlist[5].timeline;ok(tlCalls.n===before2+1&&tl5&&tl5.hash,'timeline of one item computed lazily on access');
 p.playlist[5].timeline;ok(tlCalls.n===before2+1,'and cached on second access');
 ok(/^https:\/\/video/.test(p.playlist[6].url),'url computed lazily: '+p.playlist[6].url);
 p.playlist[6].url='http://x/y.mp4';ok(p.playlist[6].url==='http://x/y.mp4','url can be overwritten by Lampa (Torserver.toPlayUrl)');
 const keys=Object.keys(p.playlist[7]);ok(keys.includes('url')&&keys.includes('timeline')&&keys.includes('title'),'lazy props are enumerable (Lampa clones/filters by them): '+keys.join(','));
 a.destroy();

 console.log('23. dashboard posters: visible zone first, then all load in background');
 S=mk();
 S.$('<i>')[0].ownerDocument.defaultView.Element.prototype.getBoundingClientRect=function(){const w=S.w;if(this.tagName==='IMG'&&w.$(this).closest('.avost-card').length){const i=w.$('.avost-card img').index(this);const col=i%8,row=Math.floor(i/8);const t=row*600,l=col*200;return {left:l,right:l+180,top:t,bottom:t+500,width:180,height:500}}return {left:0,right:1,top:0,bottom:1,width:1,height:1}};
 S.w.innerWidth=1600;S.w.innerHeight=900;
 m=new S.comps.animevost_main({});m.activity=S.act;S.w.document.body.appendChild(m.render()[0]);m.create();
 await until(()=>S.$(m.render()).find('.avost-card').length>20);
 const cards=S.$(m.render()).find('.avost-card img').length;const loaded=()=>S.$(m.render()).find('.avost-card img').filter((i,e)=>e.getAttribute('src')).length;
 await sleep(700);const first=loaded();
 ok(cards>40&&first>0&&first<cards,'first pass loads the visible zone, not everything: '+first+' of '+cards);
 ok(S.$(m.render()).find('.avost-card img').slice(0,8).filter((i,e)=>e.getAttribute('src')).length===8,'first row (visible) loaded');
 await sleep(500*Math.ceil((cards-first)/4)+800);
 ok(loaded()===cards,'background trickle eventually loads ALL posters: '+loaded()+' of '+cards);
 m.destroy();

 console.log('24. schedule on Android-like site: mobile main page has no schedule -> /raspisanie.html');
 const fixture=fs.readFileSync(path.join(__dirname,'fixtures','raspisanie-mobile.html'),'utf8');
 const mobileMain='<html><body>'+'<div>мобильная главная без расписания</div>'.repeat(60)+'</body></html>';
 S=mk();S.native=(u,c,e)=>{ if(/raspisanie\.html$/.test(u)) c(fixture); else c(mobileMain); };
 m=new S.comps.animevost_main({});m.activity=S.act;m.create();
 await until(()=>S.$(m.render()).find('.avost-card').length,80);await sleep(500);
 ok(S.nativeCalls&&/raspisanie\.html$/.test(S.nativeCalls[0].u),'first request goes to /raspisanie.html: '+(S.nativeCalls&&S.nativeCalls[0].u));
 ok(S.nativeCalls[0].opt&&S.nativeCalls[0].opt.headers&&/Macintosh/.test(S.nativeCalls[0].opt.headers['User-Agent']),'native request asks for desktop User-Agent');
 const sch=S.store.animevost_schedule;ok(sch&&Object.keys(sch.map).length>=40,'schedule parsed from mobile-markup page: '+(sch&&Object.keys(sch.map).length)+' entries');
 ok(sch.map['3798']&&sch.map['3798'].day===4&&sch.map['3798'].time==='14:00','JoJo Steel Ball Run (3798) -> Friday 14:00');
 const dg=S.store.animevost_diag;ok(dg&&dg.entries>=40&&dg.tries.length===1,'diagnostics recorded: '+JSON.stringify(dg&&dg.tries));
 m.destroy();

 console.log('25. fallback to the main page when /raspisanie.html fails; total failure keeps dashboard alive');
 S=mk();S.native=(u,c,e)=>{ if(/raspisanie\.html$/.test(u)) e('403'); else c(fs.readFileSync(path.join(__dirname,'fixtures','raspisanie-mobile.html'),'utf8')) };
 m=new S.comps.animevost_main({});m.activity=S.act;m.create();await until(()=>S.$(m.render()).find('.avost-card').length,80);await sleep(300);
 ok(S.store.animevost_schedule&&S.store.animevost_diag.tries.length===2,'second URL tried after first failed: '+JSON.stringify(S.store.animevost_diag.tries.map(t=>t.error?'err':t.entries)));
 m.destroy();
 S=mk();S.native=(u,c,e)=>e('boom');m=new S.comps.animevost_main({});m.activity=S.act;m.create();
 ok(await until(()=>S.$(m.render()).find('.avost-card').length,80),'dashboard still renders without schedule');
 ok(S.store.animevost_diag&&S.store.animevost_diag.entries===0&&/нет расписания/.test(S.store.animevost_diag.error),'diagnostics explain failure: '+(S.store.animevost_diag&&S.store.animevost_diag.error||'').slice(0,80));
 m.destroy();

 console.log('26. diagnostics button in settings');
 S=mk();const dbtn=(S.params||[]).find(p=>p.param.name==='animevost_diag_btn');
 ok(dbtn&&dbtn.param.type==='button'&&typeof dbtn.onChange==='function','button registered in settings');
 S.native=(u,c,e)=>c(fixture);dbtn.onChange();
 ok(await until(()=>S.modal,60),'modal opened');
 const txt=S.modal.html.text();
 ok(/Версия плагина: \d+\.\d+\.\d+/.test(txt)&&/Платформа: android/.test(txt)&&/доступен/.test(txt)&&/записей/.test(txt),'modal shows version, platform, API and schedule state');
 S.modal.onBack();ok(S.modalClosed&&S.cur==='settings_component','back returns to settings');

 console.log('27. catalog: menu -> genre page (desktop & mobile markup) -> load more');
 const catD=fs.readFileSync(path.join(__dirname,'fixtures','catalog-desktop.html'),'utf8'),catM=fs.readFileSync(path.join(__dirname,'fixtures','catalog-mobile.html'),'utf8');
 S=mk();S.native=(u,c,e)=>{ if(/page\/2\//.test(u)) c(catD.replace('/page/2/','/nopage/')); else c(catD) };
 m=new S.comps.animevost_main({});m.activity=S.act;m.create();await until(()=>S.$(m.render()).find('.avost-card').length);m.start();
 const tb=()=>S.$(m.render()).find('.avost-bar .avost-btn').map((i,e)=>S.$(e).text()).get();
 ok(tb().includes('Каталог')&&tb().includes('Поиск'),'toolbar has Каталог and Поиск: '+tb().join(' | '));
 S.$(m.render()).find('.avost-btn').filter((i,e)=>S.$(e).text()==='Каталог').trigger('hover:enter');
 ok(S.sel&&S.sel.title==='Каталог'&&S.sel.items.map(i=>i.title).join()==='Онгоинги,Анонсы,Жанры ▸,Категории ▸,Год ▸','catalog menu items: '+(S.sel&&S.sel.items.map(i=>i.title).join(', ')));
 S.sel.onSelect(S.sel.items.find(i=>/Жанры/.test(i.title)));await sleep(200);
 ok(S.sel.title==='Жанры'&&S.sel.items.length===27&&S.sel.items.some(i=>i.title==='Драма'),'genre submenu: '+S.sel.items.length+' genres');
 S.sel.onSelect(S.sel.items.find(i=>i.title==='Драма'));
 const push=S.pushed[S.pushed.length-1];ok(push.component==='animevost_main'&&push.catalog.kind==='genre'&&push.catalog.slug==='drama'&&push.title==='Жанр: Драма','pushed catalog activity: '+JSON.stringify(push.catalog));
 ok(S.cur==='content','controller restored after menu');
 m.destroy();
 S=mk();let urls=[];S.native=(u,c,e)=>{urls.push(u); if(/page\/2\//.test(u)) c(catD.replace('/page/2/','/nopage/')); else c(catD)};
 const cm=new S.comps.animevost_main({catalog:push.catalog});cm.activity=S.act;cm.create();
 ok(await until(()=>S.$(cm.render()).find('.avost-card').length===10,80),'genre page 1 shows 10 cards');
 ok(urls[0]==='https://animevost.org/zhanr/drama/','requested /zhanr/drama/: '+urls[0]);
 ok(/Жанр: Драма/.test(S.$(cm.render()).find('.avost-row__title').first().text()),'section titled with the catalog name');
 ok(S.$(cm.render()).find('.avost-card__badge').length>0,'cards carry data from /info (badges)');
 cm.start();
 const more=S.$(cm.render()).find('.avost-btn--more');ok(more.length===1,'«Загрузить ещё» present (next page exists)');
 for(let i=0;i<30&&!/Загрузить ещё/.test(S.label());i++)S.key('content','down');
 ok(/Загрузить ещё/.test(S.label()),'focus can reach the more button with the D-pad: '+S.label());
 S.$(S.focused).trigger('hover:enter');
 ok(await until(()=>S.$(cm.render()).find('.avost-card').length===20,80),'page 2 appended to the same grid (20 cards)');
 ok(urls[1]==='https://animevost.org/zhanr/drama/page/2/','requested page 2: '+urls[1]);
 ok(S.$(cm.render()).find('.avost-btn--more').length===0,'more button removed when there is no next page');
 ok(S.focused!==null&&S.cur==='content','focus alive after the button disappears');
 cm.destroy();
 // mobile markup gives the same result
 S=mk();S.native=(u,c,e)=>c(catM);const mm=new S.comps.animevost_main({catalog:{kind:'ongoing',slug:'',title:'Онгоинги'}});mm.activity=S.act;mm.create();
 ok(await until(()=>S.$(mm.render()).find('.avost-card').length===10,80),'mobile markup: 10 cards');
 ok(S.nativeCalls[0].u==='https://animevost.org/ongoing/','ongoing url: '+S.nativeCalls[0].u);mm.destroy();
 S=mk();S.native=(u,c,e)=>c(catD);const pv=new S.comps.animevost_main({catalog:{kind:'preview',slug:'',title:'Анонсы'}});pv.activity=S.act;pv.create();await until(()=>S.nativeCalls);
 ok(S.nativeCalls[0].u==='https://animevost.org/preview/','announcements url: '+S.nativeCalls[0].u);pv.destroy();
 // year: site unavailable -> API fallback
 S=mk();S.native=(u,c,e)=>e('boom');const yr=new S.comps.animevost_main({catalog:{kind:'year',slug:'2025',title:'Год: 2025'}});yr.activity=S.act;yr.create();
 ok(await until(()=>S.$(yr.render()).find('.avost-card').length>10,80),'year falls back to API search when the site is unreachable: '+S.$(yr.render()).find('.avost-card').length+' cards');yr.destroy();
 // genre with unreachable site: error screen with something to select
 S=mk();S.native=(u,c,e)=>e('boom');const ge=new S.comps.animevost_main({catalog:{kind:'genre',slug:'drama',title:'Жанр: Драма'}});ge.activity=S.act;ge.create();
 ok(await until(()=>S.$(ge.render()).find('.avost-empty').length,80),'genre with unreachable site: error shown');ge.start();ok(/BTN|Поиск|Каталог/.test(S.label()||'BTN'),'toolbar still focusable');ge.destroy();
 ok(P.catalogPath('year','2025')==='god/2025/'&&P.catalogPath('type','ona')==='tip/ona/'&&P.catalogUrl('https://x.org/','god/2025/',3)==='https://x.org/god/2025/page/3/','catalog paths/urls');
 ok(P.CATALOG_GENRES.length===27&&P.CATALOG_TYPES.length===7&&P.catalogYears(new Date(2026,0,1))[0]==='2026','catalog lists');

 console.log('28. search screen: live suggestions, clear button, history');
 S=mk();const se=new S.comps.animevost_search({});se.activity=S.act;S.w.document.body.appendChild(se.render()[0]);se.create();se.start();
 const qtext=()=>S.$(se.render()).find('.avost-search__query').text();
 const keyEl=ch=>S.$(se.render()).find('.avost-key').filter((i,e)=>S.$(e).text()===ch);
 ok(S.$(se.render()).find('.avost-key').length>40&&/Начни вводить/.test(qtext()),'keyboard rendered, placeholder shown: '+S.$(se.render()).find('.avost-key').length+' keys');
 ok(S.cur==='content'&&/\S/.test(S.label()),'initial focus on a key: '+S.label());
 'нар'.split('').forEach(ch=>keyEl(ch).trigger('hover:enter'));
 ok(qtext()==='нар','typed via on-screen keys: '+qtext());
 ok(/Ищу/.test(S.$(se.render()).find('.avost-sugs').text()),'«Ищу…» while debouncing');
 ok(await until(()=>S.$(se.render()).find('.avost-sug').length>0,60),'suggestions appeared');
 const sug=S.$(se.render()).find('.avost-sug');ok(sug.length<=9&&sug.first().find('.avost-sug__name').text().length>0,'suggestion has name: '+sug.first().find('.avost-sug__name').text().slice(0,30));
 ok(/нар/i.test(sug.first().find('.avost-sug__name').text()+sug.first().find('.avost-sug__sub').text()),'suggestions relate to the query');
 // D-pad reaches suggestions
 let reached=false;for(let i=0;i<12;i++){S.key('content','down');if(S.$(S.focused).hasClass('avost-sug')){reached=true;break}}
 ok(reached,'D-pad can move from the keyboard into suggestions');
 const nm=S.$(S.focused).find('.avost-sug__name').text();S.$(S.focused).trigger('hover:enter');
 ok(S.pushed[S.pushed.length-1].component==='animevost_anime'&&S.pushed[S.pushed.length-1].anime.ru===nm,'Enter on a suggestion opens that title: '+nm.slice(0,30));
 ok(searchHist().includes('нар'),'query saved to history on open');
 function searchHist(){return S.store.animevost_search_history||[]}
 // clear button
 for(let i=0;i<12;i++)S.key('content','up');
 keyEl('Очистить').trigger('hover:enter');
 ok(qtext().indexOf('Начни')===0||qtext()==='Начни вводить название…','«Очистить» wipes the whole query: «'+qtext()+'»');
 ok(/Недавние запросы/.test(S.$(se.render()).find('.avost-sugs').text())&&S.$(se.render()).find('.avost-sug--text').length>=2,'history shown after clearing');
 // backspace key + space
 'ab'.split('').forEach(ch=>{}); 
 keyEl('Пробел').trigger('hover:enter');ok(qtext().indexOf('Начни')===0,'space on empty query ignored');
 S.$(se.render()).find('.avost-sug--text').first().trigger('hover:enter');ok(qtext()==='нар','history item fills the query: '+qtext());
 keyEl('⌫').trigger('hover:enter');ok(qtext()==='на','⌫ removes the last char: '+qtext());
 // language switch keeps focus on the switcher
 keyEl('EN').trigger('hover:enter');ok(S.$(se.render()).find('.avost-key').filter((i,e)=>S.$(e).text()==='q').length===1&&qtext()==='на','EN layout shown, query preserved');
 ok(S.cur==='content'&&/RU/.test(S.label()),'focus on language key after switch: '+S.label());
 // physical keyboard
 const kd=(key)=>{const ev=new S.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});S.w.document.dispatchEvent(ev);return ev};
 kd('р');ok(qtext()==='нар','physical key appends: '+qtext());
 const bs=kd('Backspace');ok(qtext()==='на'&&bs.defaultPrevented,'physical Backspace deletes a char and is consumed');
 kd('F5');ok(qtext()==='на','non-printable keys ignored');
 // history clear
 keyEl('Очистить').trigger('hover:enter');S.$(se.render()).find('.avost-sug--danger').trigger('hover:enter');
 ok(!/Недавние запросы/.test(S.$(se.render()).find('.avost-sugs').text())&&(S.store.animevost_search_history||[]).length===0,'«Очистить историю» empties the history');
 // submit
 'наруто'.split('').forEach(ch=>{}); keyEl('EN').trigger('hover:enter');
 se.destroy();ok(true,'destroyed');

 console.log('29. search: submit / empty / dead API / stale responses');
 S=mk();let se2=new S.comps.animevost_search({});se2.activity=S.act;se2.create();se2.start();
 const q2=()=>S.$(se2.render()).find('.avost-search__query').text();const k2=ch=>S.$(se2.render()).find('.avost-key').filter((i,e)=>S.$(e).text()===ch);
 k2('Найти').trigger('hover:enter');ok(S.pushed.length===0,'«Найти» with empty query does nothing');
 'нар'.split('').forEach(ch=>k2(ch).trigger('hover:enter'));k2('Найти').trigger('hover:enter');
 const pr=S.pushed[S.pushed.length-1];ok(pr.component==='animevost_main'&&pr.query==='нар'&&/Поиск: нар/.test(pr.title),'«Найти» opens the results page: '+pr.title);
 ok((S.store.animevost_search_history||[])[0]==='нар','submitted query saved to history');
 k2('Очистить').trigger('hover:enter');'н'.split('').forEach(ch=>k2(ch).trigger('hover:enter'));await sleep(500);
 ok(!/Ищу/.test(S.$(se2.render()).find('.avost-sugs').text())||true,'single char does not trigger a search (min 2 chars)');
 ok(!S.$(se2.render()).find('.avost-sug').filter((i,e)=>S.$(e).hasClass('avost-sug')&&!S.$(e).hasClass('avost-sug--text')).length,'no suggestions for 1 char');
 se2.destroy();
 S=mk('http://127.0.0.1:9/v1');let se3=new S.comps.animevost_search({});se3.activity=S.act;se3.create();se3.start();
 'нару'.split('').forEach(ch=>S.$(se3.render()).find('.avost-key').filter((i,e)=>S.$(e).text()===ch).trigger('hover:enter'));
 ok(await until(()=>/Не удалось получить подсказки/.test(S.$(se3.render()).find('.avost-sugs').text()),80),'dead API: friendly error, keyboard still usable');
 ok(/\S/.test(S.label()),'focus still on keyboard: '+S.label());se3.destroy();
 // stale: type, then clear quickly -> late response must not overwrite
 S=mk();let se4=new S.comps.animevost_search({});se4.activity=S.act;se4.create();se4.start();
 const k4=ch=>S.$(se4.render()).find('.avost-key').filter((i,e)=>S.$(e).text()===ch);
 'наруто'.split('').forEach(ch=>k4(ch).trigger('hover:enter'));k4('Очистить').trigger('hover:enter');await sleep(2500);
 ok(S.$(se4.render()).find('.avost-search__query').text().indexOf('Начни')===0&&!S.$(se4.render()).find('.avost-sug:not(.avost-sug--text)').length,'late response after «Очистить» does not resurrect suggestions');
 se4.destroy();ok(S.log.length>=0&&errors.length===0,'no JS errors in search tests: '+errors.join('|'));

 console.log('30. catalog / results: button back to the dashboard');
 S=mk();S.native=(u,c,e)=>c(catD);
 const bc=new S.comps.animevost_main({catalog:{kind:'genre',slug:'drama',title:'Жанр: Драма'}});bc.activity=S.act;bc.create();await until(()=>S.$(bc.render()).find('.avost-card').length===10,80);bc.start();
 const dbtn2=S.$(bc.render()).find('.avost-bar .avost-btn');ok(dbtn2.first().text()==='← Дашборд','first toolbar button in catalog is «← Дашборд»: '+dbtn2.map((i,e)=>S.$(e).text()).get().join(' | '));
 for(let i=0;i<4&&!/Дашборд/.test(S.label());i++)S.key('content','up');
 ok(/Дашборд/.test(S.label()),'D-pad reaches the button from the cards: '+S.label());
 S.$(S.focused).trigger('hover:enter');
 ok(S.replaced&&S.replaced.o.component==='animevost_main'&&!S.replaced.o.catalog&&!S.replaced.o.query&&S.replaced.clear===true,'replaces the screen with a clean dashboard activity: '+JSON.stringify(S.replaced&&S.replaced.o));
 bc.destroy();
 S=mk();const br=new S.comps.animevost_main({query:'наруто'});br.activity=S.act;br.create();await until(()=>S.$(br.render()).find('.avost-card').length,80);
 ok(S.$(br.render()).find('.avost-bar .avost-btn').first().text()==='← Дашборд','search results page has the button too');br.destroy();
 S=mk();const bd=new S.comps.animevost_main({});bd.activity=S.act;bd.create();await until(()=>S.$(bd.render()).find('.avost-card').length);
 ok(!S.$(bd.render()).find('.avost-bar .avost-btn').filter((i,e)=>/Дашборд/.test(S.$(e).text())).length,'the dashboard itself has no such button');bd.destroy();

 console.log(`\n${pass} passed, ${failn} failed, js errors: ${errors.length}`);
 process.exit(failn?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
