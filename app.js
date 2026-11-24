import { basicSetup } from 'codemirror';
import { EditorView } from '@codemirror/view';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { format as formatSQL } from 'sql-formatter';
import { SQLiteAdapter } from './database/sqlite-adapter.mjs';
import { MysqlSandboxAdapter } from './database/mysql-sandbox-adapter.mjs';
const MYSQL_RUNNER_URL = import.meta.env.VITE_MYSQL_RUNNER_URL || '';

const $ = s => document.querySelector(s);
const DB = 'terminnia-local', STORE = 'snapshots', KEY = 'main';
const QUERY = 'terminnia-query-v2', HISTORY = 'terminnia-history-v1', TAB_STORAGE = 'terminnia-sql-tabs-v1';
const SAMPLE = 'SELECT e.name, e.department, e.salary, d.budget\nFROM employees AS e\nJOIN departments AS d ON d.name = e.department\nORDER BY e.salary DESC;';
let editor, worker, dbAdapter, localAdapter, mysqlAdapter, mysqlCredentials = null, activeEngine = 'sqlite', seq = 0, ready = false, tableName = null, results = [], currentResultIndex = 0, columns = [], rows = [], tabs = [], activeTabId = null, nextTabId = 1;
const pending = new Map();
let saveQueue = Promise.resolve();

function hasSensitiveCredentials(sql) {
  return /\bIDENTIFIED\s+BY\s+['"]/i.test(sql) || /\bSET\s+PASSWORD\b/i.test(sql) || /\bPASSWORD\s*\(\s*['"]/i.test(sql);
}
function status(text, state='ready') { $('#status').textContent=text; $('#status').dataset.state=state; }
function toast(text, error=false) {
  const el=$('#toast'); el.textContent=text; el.dataset.kind=error?'error':'success'; el.classList.add('visible');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('visible'),2800);
}
function storage() {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE);};
    r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error||new Error('Local storage unavailable.'));
    r.onblocked=()=>reject(new Error('Close other Terminnia tabs and reload.'));
  });
}
async function loadSaved() {
  const d=await storage();
  try{return await new Promise((resolve,reject)=>{
    const r=d.transaction(STORE,'readonly').objectStore(STORE).get(KEY);
    r.onsuccess=()=>resolve(r.result||null); r.onerror=()=>reject(r.error);
  });} finally{d.close();}
}
function persist(buffer) {
  if(!(buffer instanceof ArrayBuffer))return Promise.resolve();
  // A failed write must not permanently poison the queue. The next snapshot
  // gets a fresh transaction after the previous failure has been observed.
  const operation=saveQueue.catch(()=>{}).then(async()=>{
    const d=await storage();
    try{await new Promise((resolve,reject)=>{
      const tx=d.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(buffer,KEY);
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
    });}finally{d.close();}
  });
  saveQueue=operation;
  return operation;
}
let recoveringWorker=false;
function failWorker(error, source) {
  if(source && source!==worker)return;
  const failed=worker;
  worker=null;
  ready=false;
  failed?.terminate();
  pending.forEach(p=>{clearTimeout(p.timer);p.reject(error);});
  pending.clear();
  status('Database worker stopped','error');
  $('#connection').textContent='Recovering local database…';
  if(!recoveringWorker)void recoverWorker(error);
}
async function recoverWorker(reason) {
  if(recoveringWorker)return;
  recoveringWorker=true;
  try{
    status('Restoring local database…','busy');
    startWorker();
    const saved=await loadSaved();
    const transfer=saved instanceof ArrayBuffer?[saved]:[];
    localAdapter ??= new SQLiteAdapter({ request: call });
    if (activeEngine === 'sqlite') dbAdapter = localAdapter;
    await localAdapter.connect({buffer:saved||undefined,transfer});
    ready=true;
    $('#startup-error').hidden=true;
    updateEngineChrome();
    await refreshTables();
    status(activeEngine === 'mysql' ? 'MySQL Lab ready · local engine recovered' : 'Ready · local database restored');
    toast('Local database engine recovered.');
  }catch(error){
    ready=false;
    $('#connection').textContent='Database unavailable';
    $('#startup-error').hidden=false;
    $('#startup-error').textContent='Automatic recovery failed: '+error.message+' Reload Terminnia to try again.';
    status('Database recovery failed','error');
  }finally{
    recoveringWorker=false;
  }
}
function startWorker() {
  const instance=new Worker(new URL('./sql-worker.js', import.meta.url), { type: 'module' });
  worker=instance;
  instance.onmessage=async e=>{
    if(instance!==worker)return;
    const data=e.data, task=pending.get(data.id); if(!task)return;
    pending.delete(data.id); clearTimeout(task.timer);
    try{if(data.snapshot instanceof ArrayBuffer)await persist(data.snapshot);task.resolve(data);}
    catch(err){
      if(data.stagedId)instance.postMessage({id:++seq,action:'discardImport',stagedId:data.stagedId});
      task.reject(err);
    }
  };
  instance.onerror=e=>{
    e.preventDefault?.();
    failWorker(new Error(e.message||'SQL worker stopped unexpectedly.'),instance);
  };
  instance.onmessageerror=()=>failWorker(new Error('The database worker returned an unreadable message.'),instance);
}
function call(action,payload={}) {
  return new Promise((resolve,reject)=>{
    const target=worker;
    if(!target){reject(new Error('Database worker is unavailable. Recovery is in progress.'));return;}
    const id=++seq;
    const timer=setTimeout(()=>{
      pending.delete(id);
      const error=new Error('SQL engine timed out. The worker is being restarted from the last saved database.');
      reject(error);
      failWorker(error,target);
    },30000);
    pending.set(id,{resolve,reject,timer});
    try{target.postMessage({id,action,...payload},payload.transfer||[]);}
    catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
  });
}
function switchPanel(name) {
  document.querySelectorAll('[data-panel]').forEach(n=>n.hidden=n.dataset.panel!==name);
  document.querySelectorAll('[data-panel-tab]').forEach(n=>n.classList.toggle('active',n.dataset.panelTab===name));
}
function message(text,error=false) {const n=$('#message-content');n.textContent=text;n.className=error?'message-content error':'message-content';switchPanel('messages');}
function cell(value) {const n=document.createElement('td');n.textContent=value===null?'NULL':String(value);if(value===null)n.className='null-value';return n;}
function renderResult(result,index=0) {
  currentResultIndex=index;
  columns=result.columns||[];rows=result.values||[];$('#row-count').textContent=result.rowCount??rows.length;$('#csv').disabled=!columns.length;
  const host=$('#result-content');host.replaceChildren();
  if(!columns.length){host.textContent='Statement executed successfully. No result set was returned.';return;}
  const wrap=document.createElement('div');wrap.className='table-wrap';
  const table=document.createElement('table');table.className='result-table';table.setAttribute('aria-label','SQL query results');
  const head=document.createElement('thead'),hr=document.createElement('tr');
  columns.forEach(c=>{const th=document.createElement('th');th.scope='col';th.textContent=c;hr.append(th);});head.append(hr);
  const body=document.createElement('tbody');
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns.length;td.textContent='No rows returned.';tr.append(td);body.append(tr);}
  rows.forEach(row=>{const tr=document.createElement('tr');row.forEach(v=>tr.append(cell(v)));body.append(tr);});
  table.append(head,body);wrap.append(table);host.append(wrap);
  if(result.truncated){const note=document.createElement('p');note.className='notice';note.textContent='Showing first 5,000 rows. Add LIMIT to narrow the result.';host.append(note);}
}
function renderResultTabs() {
  const host=$('#result-tabs');host.replaceChildren();host.hidden=results.length<2;
  results.forEach((r,i)=>{const b=document.createElement('button');b.className='result-tab'+(i===currentResultIndex?' active':'');b.textContent='Result '+(i+1)+' ('+(r.rowCount??r.values.length)+')';b.onclick=()=>{renderResult(r,i);host.querySelectorAll('button').forEach((x,j)=>x.classList.toggle('active',i===j));};host.append(b);});
}
async function refreshTables() {
  const objects=await dbAdapter.listObjects(['table','view']);
  const host=$('#table-list');host.replaceChildren();$('#table-total').textContent=String(objects.length);
  if(!objects.length){const p=document.createElement('p');p.className='muted small';p.textContent='No tables yet. Run CREATE TABLE.';host.append(p);$('#views-empty').textContent='No views';return;}
  const views=objects.filter(object=>object.type==='view');
  $('#views-empty').textContent=views.length?views.map(object=>object.name).join(' · '):'No views';
  objects.forEach(({name,type})=>{const b=document.createElement('button');b.className='table-item'+(name===tableName?' active':'');b.textContent=(type==='view'?'◇ ':'▦ ')+name;b.onclick=()=>browse(name);host.append(b);});
}
async function browse(name) {
  tableName=name;await refreshTables();const s=await dbAdapter.describeObject(name);
  const host=$('#schema-content');host.replaceChildren();
  const t=document.createElement('table');t.className='schema-table';
  const h=document.createElement('thead');h.innerHTML='<tr><th>Column</th><th>Type</th><th>Null</th><th>Key</th></tr>';
  const body=document.createElement('tbody');
  (s.columns||[]).forEach(c=>{const tr=document.createElement('tr');[c.name,c.type||'—',c.notnull?'No':'Yes',c.pk?'Primary':'—'].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td);});body.append(tr);});
  t.append(h,body);host.append(t);
  const identifier = activeEngine === 'mysql' ? '`' + name.replace(/`/g,'``') + '`' : '"' + name.replace(/"/g,'""') + '"';
  editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:'SELECT * FROM '+identifier+' LIMIT 200;'}});
  await run();
  if(matchMedia('(max-width:760px)').matches)closeMobileSidebar();
}
function remember(text) {
  if(hasSensitiveCredentials(text))return;
  try{const old=JSON.parse(localStorage.getItem(HISTORY)||'[]');const list=[text,...old.filter(x=>x!==text)].slice(0,30);localStorage.setItem(HISTORY,JSON.stringify(list));renderHistory();}catch{}
}
function renderHistory() {
  let list=[];
  try{
    const stored=JSON.parse(localStorage.getItem(HISTORY)||'[]');
    if(Array.isArray(stored)){list=stored.filter(q=>typeof q==='string'&&!hasSensitiveCredentials(q)).slice(0,30);if(list.length!==stored.length)localStorage.setItem(HISTORY,JSON.stringify(list));}
  }catch{}
  const host=$('#history-list');host.replaceChildren();
  if(!list.length){host.textContent='Executed queries appear here.';return;}
  list.forEach(q=>{const b=document.createElement('button');b.className='history-item';b.textContent=q.replace(/\s+/g,' ').slice(0,90);b.title=q;b.onclick=()=>editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:q}});host.append(b);});
}
async function run() {
  if(!ready)return toast('Database is starting. Please wait.',true);
  const sel=editor.state.selection.main, query=sel.empty?editor.state.doc.toString():editor.state.sliceDoc(sel.from,sel.to);
  if(!query.trim())return;
  $('#run').disabled=true;$('#run').textContent='Running…';status('Executing SQL…','busy');
  try{
    const executionOptions = activeEngine === 'mysql' && mysqlCredentials ? mysqlCredentials : {};
    const r=await dbAdapter.execute(query, executionOptions);
    results=r.results||[];currentResultIndex=0;
    if(results.length){renderResult(results[0]);renderResultTabs();}
    else{$('#result-content').textContent='Statement executed. No result set.';$('#row-count').textContent='0';$('#csv').disabled=true;$('#result-tabs').hidden=true;columns=[];rows=[];}
    if(r.ok){
      await refreshTables();remember(query);$('#duration').textContent=(r.durationMs||0).toFixed(1)+' ms';
      const completion = activeEngine === 'mysql'
        ? 'Query completed successfully.\nMySQL 8.4 · Temporary isolated sandbox\nResult sets: '+results.length+'\nExecution: '+(r.durationMs||0).toFixed(2)+' ms\nRows changed: '+(r.rowsChanged ?? 'Not reported')
        : 'Query completed successfully.\nResult sets: '+results.length+'\nRows changed: '+r.rowsChanged+'\nExecution: '+(r.durationMs||0).toFixed(2)+' ms'+(r.snapshotDeferred?'\nSave will complete after the transaction is committed.':r.snapshotSaved?'\nDatabase snapshot saved locally.':'\nNo database changes; the existing local snapshot remains current.');
      message(completion);
      switchPanel(results.length?'results':'messages');status(activeEngine === 'mysql' ? 'Ready · MySQL 8.4 sandbox' : 'Ready · local database saved');
    }else{message(r.error?.message||'SQL execution failed.',true);$('#duration').textContent='Failed';status('SQL execution failed','error');}
  }catch(e){if(activeEngine==='mysql' && mysqlAdapter && !(await mysqlAdapter.getConnectionInfo()).connected){$('#connection').textContent='MySQL sandbox expired · reconnect';status('MySQL session expired','error');}message(e.message,true);status('Database operation failed','error');toast(e.message,true);}
  finally{$('#run').disabled=false;$('#run').textContent='▶ Run';}
}
function download(name,data,type) {
  const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportCsv() {
  if(!columns.length)return toast('No result set to export.',true);
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  download('terminnia-results.csv','\uFEFF'+[columns,...rows].map(row=>row.map(q).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}
function formatSql(source) {
  try {
    return formatSQL(source, { language: activeEngine === 'mysql' ? 'mysql' : 'sqlite', keywordCase: 'upper', tabWidth: 2 });
  } catch (error) {
    toast('Could not format this SQL: ' + error.message, true);
    return source;
  }
}
async function exportDb() {
  const r=await call('export');if(!r.ok||!(r.buffer instanceof ArrayBuffer))throw new Error(r.error?.message||'Export failed.');
  download('terminnia.sqlite',r.buffer,'application/x-sqlite3');
}
async function importDb(file) {
  const buffer=await file.arrayBuffer();
  const staged=await call('import',{buffer,transfer:[buffer]});
  if(!staged.ok)throw new Error(staged.error?.message||'Import validation failed.');
  try{
    const committed=await call('commitImport',{stagedId:staged.stagedId});
    if(!committed.ok)throw new Error(committed.error?.message||'Could not activate imported database.');
  }catch(error){
    await call('discardImport',{stagedId:staged.stagedId}).catch(()=>{});
    throw error;
  }
  tableName=null;
  await refreshTables();
  $('#schema-content').textContent='Select a table to inspect its columns.';
  toast('Database imported and saved.');
}
async function initialize() {
  try{
    status('Opening local database…','busy');startWorker();
    const saved=await loadSaved(),transfer=saved instanceof ArrayBuffer?[saved]:[];
    localAdapter ??= new SQLiteAdapter({ request: call });
    await localAdapter.connect({buffer:saved||undefined,transfer});
    if (activeEngine === 'sqlite') dbAdapter = localAdapter;
    try {
      const stored=JSON.parse(localStorage.getItem(TAB_STORAGE)||'[]');
      if(Array.isArray(stored)){
        const seen=new Set();
        tabs=stored.filter(tab=>{
          if(!tab||typeof tab!=='object')return false;
          const id=Number(tab.id);
          if(!Number.isSafeInteger(id)||id<1||seen.has(id))return false;
          if(typeof tab.name!=='string'||typeof tab.content!=='string')return false;
          seen.add(id);
          return true;
        }).map(tab=>({id:Number(tab.id),name:tab.name.slice(0,120)||'query.sql',content:hasSensitiveCredentials(tab.content)?'':tab.content}));
      }
    } catch { tabs=[]; }
    try { const previousQuery=localStorage.getItem(QUERY); if(previousQuery&&hasSensitiveCredentials(previousQuery)) localStorage.removeItem(QUERY); } catch {}
    if(!tabs.length){const savedQuery=localStorage.getItem(QUERY)||SAMPLE;const safeQuery=hasSensitiveCredentials(savedQuery)?'':savedQuery;if(safeQuery!==savedQuery)try{localStorage.removeItem(QUERY);}catch{}tabs=[{id:nextTabId++,name:'query.sql',content:safeQuery}];}
    nextTabId=Math.max(1,...tabs.map(t=>t.id))+1;
    activeTabId=tabs[0].id;
    editor=new EditorView({
      doc:tabs[0].content??SAMPLE,
      extensions:[basicSetup,sql(),oneDark,EditorView.lineWrapping,EditorView.updateListener.of(u=>{
        if(u.docChanged){const value=u.state.doc.toString(),active=tabs.find(t=>t.id===activeTabId);if(active)active.content=value;if(hasSensitiveCredentials(value)){try{localStorage.removeItem(QUERY);saveTabs();}catch{}$('#draft-state').textContent='Sensitive SQL kept in memory only';}else{try{localStorage.setItem(QUERY,value);if(active)saveTabs();$('#draft-state').textContent='Draft saved locally';}catch{$('#draft-state').textContent='Draft not saved';}}}
        const pos=u.state.selection.main.head, line=u.state.doc.lineAt(pos);
        $('#cursor').textContent='Ln '+line.number+', Col '+(pos-line.from+1);
        $('#status-selection').textContent=u.state.selection.main.empty?'No selection':(u.state.selection.main.to-u.state.selection.main.from)+' selected';
      })],parent:$('#editor')
    });
    ready=true;renderTabs();applyEditorSettings();updateEngineChrome();
    status('Ready · data stored in this browser');await refreshTables();renderHistory();
    if(!saved)toast('Welcome to Terminnia. Sample database loaded.');
    if(localStorage.getItem('terminnia-engine-mode')==='mysql' && MYSQL_RUNNER_URL) await switchToMysql();
  }catch(e){console.error(e);$('#connection').textContent='Database unavailable';$('#startup-error').hidden=false;$('#startup-error').textContent=e.message+' Check your connection and reload.';status('Startup failed','error');}
}

$('#run').onclick=run;
$('#clear').onclick=()=>editor?.dispatch({changes:{from:0,to:editor.state.doc.length,insert:''}});
$('#format').onclick=()=>{if(editor)editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:formatSql(editor.state.doc.toString())}});};
$('#example').onclick=()=>{editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:SAMPLE}});run();};
$('#csv').onclick=exportCsv;
$('#export-db').onclick=()=>exportDb().catch(e=>toast(e.message,true));
$('#import-db').onclick=()=>$('#database-file').click();
$('#database-file').onchange=async e=>{const f=e.target.files?.[0];if(f)try{await importDb(f);}catch(err){toast(err.message,true);}finally{e.target.value='';}};
$('#download-sql').onclick=()=>download('query.sql',editor?.state.doc.toString()||'','text/sql;charset=utf-8');
$('#copy-sql').onclick=async()=>{try{await navigator.clipboard.writeText(editor.state.doc.toString());toast('SQL copied.');}catch{toast('Clipboard permission unavailable.',true);}};
// Mobile sidebar is opened by the activity bar; the sidebar itself has no separate toggle control.
$('#new-table').onclick=()=>{editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:'CREATE TABLE new_table (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n);'}});editor.focus();};
$('#refresh-tables').onclick=()=>refreshTables().catch(e=>toast(e.message,true));
document.querySelectorAll('[data-panel-tab]').forEach(b=>b.onclick=()=>switchPanel(b.dataset.panelTab));
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run();}if(e.key==='F5'){e.preventDefault();run();}if(e.key==='Escape'){closeMobileSidebar();$('#settings-popover').hidden=true;$('#run-as-popover').hidden=true;$('#run-as-toggle').setAttribute('aria-expanded','false');}});
initialize();


// Spck-inspired workspace controls.
function setActivity(name) {
  document.querySelectorAll('[data-activity]').forEach(b=>{const selected=b.dataset.activity===name;b.classList.toggle('selected',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const titles={explorer:'EXPLORER',search:'SEARCH',database:'DATABASE',history:'HISTORY',settings:'SETTINGS'};
  $('#sidebar-title').textContent=titles[name]||'EXPLORER';
  const explorer=$('.explorer-section'), history=$('#history-section');
  if(explorer)explorer.hidden=!['explorer','database'].includes(name);
  const starter=$('#starter-section');if(starter)starter.hidden=!['explorer'].includes(name);
  if(history)history.hidden=name!=='history';
  if(name==='search') {
    if(!$('#sidebar-search')) {
      const wrap=document.createElement('div');wrap.className='sidebar-search-wrap';wrap.innerHTML='<div class="search-field"><input id="sidebar-search" type="search" placeholder="Find in this SQL file…" autocomplete="off" aria-label="Find text in SQL file"><button type="button" id="search-prev" aria-label="Previous match" title="Previous match">↑</button><button type="button" id="search-next" aria-label="Next match" title="Next match">↓</button></div><div class="search-hint" id="search-hint" aria-live="polite">Type to find text in the current document.</div>';
      $('.sidebar-scroll').prepend(wrap);
      let searchMatches=[],searchIndex=-1;
      const searchInput=$('#sidebar-search');
      const updateSearch=(direction=0)=>{
        const q=searchInput.value,doc=editor.state.doc.toString();
        if(!q){searchMatches=[];searchIndex=-1;$('#search-hint').textContent='Type to find text in the current document.';return;}
        const lower=doc.toLocaleLowerCase(),needle=q.toLocaleLowerCase();searchMatches=[];
        for(let at=lower.indexOf(needle);at!==-1;at=lower.indexOf(needle,at+needle.length))searchMatches.push(at);
        if(!searchMatches.length){searchIndex=-1;$('#search-hint').textContent='No matches found';return;}
        searchIndex=direction===0?0:(searchIndex+direction+searchMatches.length)%searchMatches.length;
        const at=searchMatches[searchIndex];
        editor.dispatch({selection:{anchor:at,head:at+q.length},scrollIntoView:true});
        $('#search-hint').textContent=(searchIndex+1)+' of '+searchMatches.length+' matches';
      };
      searchInput.addEventListener('input',()=>updateSearch(0));
      searchInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();updateSearch(e.shiftKey?-1:1);}if(e.key==='Escape'){searchInput.value='';updateSearch(0);}});
      $('#search-prev').onclick=()=>{updateSearch(-1);searchInput.focus({preventScroll:true});};
      $('#search-next').onclick=()=>{updateSearch(1);searchInput.focus({preventScroll:true});};
    }
    $('#sidebar-search').parentElement.hidden=false;
  } else if($('#sidebar-search')) $('#sidebar-search').parentElement.hidden=true;
  if(name==='settings') {$('#settings-popover').hidden=false;}
}
document.querySelectorAll('[data-activity]').forEach(b=>b.addEventListener('click',()=>{
  const mobile=matchMedia('(max-width:760px)').matches;
  if(mobile && ['explorer','database','history','search'].includes(b.dataset.activity)){ $('#sidebar').classList.add('open');$('#drawer-backdrop').hidden=false; }
  setActivity(b.dataset.activity);
}));
function closeMobileSidebar(){const sidebar=$('#sidebar');sidebar.classList.remove('open');$('#drawer-backdrop').hidden=true;}
$('#drawer-backdrop').onclick=closeMobileSidebar;
$('#sidebar-collapse').onclick=()=>{if(matchMedia('(max-width:760px)').matches){closeMobileSidebar();}else{$('#sidebar').classList.toggle('collapsed');}};
$('#project-tree-toggle').onclick=()=>{const node=$('.project-meta');node.hidden=!node.hidden;$('.explorer-section').classList.toggle('tree-collapsed',node.hidden);};
$('#tables-tree-toggle').onclick=()=>{$('#table-list').hidden=!$('#table-list').hidden;};
$('#views-tree-toggle').onclick=()=>{$('#views-empty').hidden=!$('#views-empty').hidden;};
$('#settings-toggle').onclick=()=>{$('#settings-popover').hidden=!$('#settings-popover').hidden;};
function persistEditorSettings(){try{localStorage.setItem('terminnia-editor-settings-v1',JSON.stringify({fontSize:$('#font-size').value,lineWrap:$('#line-wrap').checked,zenMode:$('#zen-mode').checked}));}catch{}}
function applyEditorSettings(){let settings={};try{settings=JSON.parse(localStorage.getItem('terminnia-editor-settings-v1')||'{}')||{};}catch{}
  const size=['12','13','14','15','16'].includes(String(settings.fontSize))?String(settings.fontSize):'13';
  $('#font-size').value=size;const wrap=settings.lineWrap!==false;$('#line-wrap').checked=wrap;$('#editor').classList.toggle('no-wrap',!wrap);
  $('#zen-mode').checked=settings.zenMode===true;document.body.classList.toggle('zen-mode',$('#zen-mode').checked);
  const cm=document.querySelector('.cm-editor');if(cm)cm.style.fontSize=size+'px';
}
$('#font-size').onchange=e=>{const cm=document.querySelector('.cm-editor');if(cm)cm.style.fontSize=e.target.value+'px';persistEditorSettings();};
$('#line-wrap').onchange=e=>{$('#editor').classList.toggle('no-wrap',!e.target.checked);persistEditorSettings();};
$('#zen-mode').onchange=e=>{document.body.classList.toggle('zen-mode',e.target.checked);persistEditorSettings();};
$('#panel-toggle').onclick=()=>{const panel=$('#output-section'),resize=$('#panel-resize');const hidden=panel.hidden;panel.hidden=!hidden;resize.hidden=!hidden;$('#panel-toggle').textContent=hidden?'⌄':'⌃';};
function saveTabs(){try{const safeTabs=tabs.map(tab=>({...tab,content:hasSensitiveCredentials(tab.content)?'':tab.content}));localStorage.setItem(TAB_STORAGE,JSON.stringify(safeTabs));}catch{toast('Could not save SQL tabs. Browser storage may be full.',true);}}
function renderTabs(){
  const strip=$('.tab-strip'), add=$('#add-tab');
  strip.querySelectorAll('.editor-tab').forEach(n=>n.remove());
  tabs.forEach(tab=>{
    const item=document.createElement('div');item.className='editor-tab'+(tab.id===activeTabId?' active':'');item.setAttribute('role','tab');item.setAttribute('tabindex',tab.id===activeTabId?'0':'-1');item.setAttribute('aria-selected',String(tab.id===activeTabId));item.setAttribute('aria-label',tab.name);
    const icon=document.createElement('span');icon.className='tab-file-icon';icon.textContent='▤';
    const name=document.createElement('span');name.textContent=tab.name;
    const close=document.createElement('span');close.className='tab-close';close.setAttribute('role','button');close.setAttribute('tabindex','0');close.textContent='×';close.title='Close tab';
    close.setAttribute('aria-label','Close '+tab.name);close.onclick=e=>{e.stopPropagation();closeTab(tab.id);};close.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();closeTab(tab.id);}};
    item.append(icon,name,close);item.onclick=()=>switchTab(tab.id);item.onkeydown=e=>{if(e.target===close)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();switchTab(tab.id);}if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const index=tabs.findIndex(t=>t.id===tab.id),next=tabs[(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];switchTab(next.id);strip.querySelectorAll('[role=tab]')[tabs.findIndex(t=>t.id===next.id)]?.focus();}};strip.insertBefore(item,add);
  });
}
function switchTab(id){
  if(id===activeTabId)return;
  const target=tabs.find(t=>t.id===id);if(!target)return;
  const current=tabs.find(t=>t.id===activeTabId);if(current)current.content=editor.state.doc.toString();
  activeTabId=id;
  editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:target.content||''}});
  renderTabs();editor.focus();
}
function createTab(){
  if(!editor)return;
  const id=nextTabId++;const tab={id,name:'query-'+id+'.sql',content:''};
  const current=tabs.find(t=>t.id===activeTabId);if(current)current.content=editor.state.doc.toString();
  tabs.push(tab);activeTabId=tab.id;saveTabs();
  editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:''}});
  renderTabs();editor.focus();
}
function closeTab(id){
  if(tabs.length===1){tabs[0].content='';editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:''}});saveTabs();renderTabs();return;}
  const index=tabs.findIndex(t=>t.id===id);if(index<0)return;
  const wasActive=id===activeTabId;tabs=tabs.filter(t=>t.id!==id);
  if(wasActive){const target=tabs[Math.max(0,index-1)];activeTabId=target.id;editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:target.content||''}});}
  saveTabs();renderTabs();
}
document.querySelectorAll('[data-template]').forEach(button=>button.addEventListener('click',()=>{
  const templates={
    select:'SELECT * FROM employees LIMIT 20;',
    create:'CREATE TABLE new_table (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n);',
    join:'SELECT e.name, e.department, d.budget\nFROM employees AS e\nJOIN departments AS d ON d.name = e.department;'
  };
  const source=templates[button.dataset.template];if(!source||!editor)return;
  editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:source}});
  editor.focus();if(matchMedia('(max-width:760px)').matches)closeMobileSidebar();
  toast('SQL template inserted. Review it, then run your query.');
}));
$('#add-tab').onclick=createTab;
$('#new-query').onclick=createTab;
function updateEngineChrome() {
  const mysql = activeEngine === 'mysql';
  $('#engine-label').textContent = mysql ? 'MySQL 8.4 · Remote sandbox' : 'SQLite WebAssembly · Local';
  $('#connection').textContent = mysql ? '● MySQL 8.4 sandbox connected' : '● Local database ready';
  $('#project-switcher .workspace-name').textContent = mysql ? 'MySQL Lab' : 'My Database';
  $('#project-switcher .workspace-type').textContent = mysql ? 'MYSQL 8.4' : 'LOCAL';
  $('#project-switcher').setAttribute('aria-label', mysql ? 'Current workspace: MySQL Lab' : 'Current workspace: My Database');
  $('#dialect-name').textContent = mysql ? 'MySQL 8.4' : 'SQLite';
  $('#import-db').disabled = mysql;
  $('#export-db').disabled = mysql;
  $('#run-as-toggle').hidden = !mysql;
  $('#run-as-toggle').textContent = 'Run as: ' + (mysqlCredentials?.username || 'root');
  $('#sqlite-check').textContent = mysql ? '' : '✓';
  $('#mysql-check').textContent = mysql ? '✓' : '';
  document.querySelector('[data-engine="sqlite"]').setAttribute('aria-current', String(!mysql));
  document.querySelector('[data-engine="mysql"]').setAttribute('aria-current', String(mysql));
  const note = $('#workspace-menu-note');
  note.dataset.state = !MYSQL_RUNNER_URL ? 'error' : 'ready';
  note.textContent = !MYSQL_RUNNER_URL
    ? 'MySQL Lab is not available yet. The hosted runner URL must be configured during deployment.'
    : mysql ? 'Your MySQL sandbox is temporary and will be deleted when you disconnect or when it expires.' : 'MySQL Lab starts a separate, disposable MySQL 8.4 database.';
}
async function switchToMysql() {
  $('#workspace-menu').hidden = true;
  $('#project-switcher').setAttribute('aria-expanded', 'false');
  if (!MYSQL_RUNNER_URL) {
    updateEngineChrome();
    return toast('MySQL Lab is not connected yet. The hosted runner has not been configured.', true);
  }
  if (activeEngine === 'mysql' && mysqlAdapter) return;
  const adapter = new MysqlSandboxAdapter({ baseUrl: MYSQL_RUNNER_URL });
  status('Starting isolated MySQL 8.4 sandbox…', 'busy');
  try {
    await adapter.connect();
    mysqlAdapter = adapter;
    mysqlCredentials = null;
    dbAdapter = adapter;
    activeEngine = 'mysql';
    ready = true;
    tableName = null;
    updateEngineChrome();
    await refreshTables();
    $('#schema-content').textContent = 'Create or select a database with SQL, then refresh the explorer.';
    try { localStorage.setItem('terminnia-engine-mode', 'mysql'); } catch {}
    status('Ready · MySQL 8.4 sandbox');
    toast('MySQL 8.4 sandbox connected. Create your coursework database with CREATE DATABASE.');
  } catch (error) {
    await adapter.disconnect().catch(() => {});
    mysqlAdapter = null;
    mysqlCredentials = null;
    activeEngine = 'sqlite';
    dbAdapter = localAdapter;
    ready = true;
    updateEngineChrome();
    status('MySQL connection failed', 'error');
    toast(error.message, true);
  }
}
async function switchToSqlite() {
  $('#workspace-menu').hidden = true;
  $('#project-switcher').setAttribute('aria-expanded', 'false');
  if (mysqlAdapter) {
    const old = mysqlAdapter;
    mysqlAdapter = null;
    await old.disconnect().catch(error => toast('MySQL sandbox cleanup will finish automatically: ' + error.message, true));
  }
  dbAdapter = localAdapter;
  mysqlCredentials = null;
  $('#run-as-popover').hidden = true;
  $('#run-as-toggle').setAttribute('aria-expanded', 'false');
  activeEngine = 'sqlite';
  ready = Boolean(localAdapter);
  tableName = null;
  updateEngineChrome();
  try { localStorage.setItem('terminnia-engine-mode', 'sqlite'); } catch {}
  await refreshTables();
  status('Ready · local database saved');
}
$('#project-switcher').onclick=()=>{
  const menu=$('#workspace-menu');
  menu.hidden=!menu.hidden;
  $('#project-switcher').setAttribute('aria-expanded', String(!menu.hidden));
  updateEngineChrome();
};
$('#run-as-toggle').onclick=()=>{
  const popover=$('#run-as-popover');
  popover.hidden=!popover.hidden;
  $('#run-as-toggle').setAttribute('aria-expanded',String(!popover.hidden));
  if(!popover.hidden)$('#run-as-username').focus();
};
$('#run-as-apply').onclick=()=>{
  const username=$('#run-as-username').value.trim();
  const password=$('#run-as-password').value;
  if(!/^[A-Za-z0-9_.$-]{1,80}$/.test(username))return toast('Enter a valid MySQL username.',true);
  if(!password)return toast('Enter the account password.',true);
  mysqlCredentials={username,password};
  $('#run-as-password').value='';
  $('#run-as-popover').hidden=true;
  $('#run-as-toggle').setAttribute('aria-expanded','false');
  updateEngineChrome();
  $('#run-as-note').textContent='SQL will now execute as '+username+'. Credentials are held in memory only.';
  toast('Execution account changed to '+username+'.');
};
$('#run-as-root').onclick=()=>{
  mysqlCredentials=null;
  $('#run-as-username').value='';
  $('#run-as-password').value='';
  $('#run-as-popover').hidden=true;
  $('#run-as-toggle').setAttribute('aria-expanded','false');
  updateEngineChrome();
  $('#run-as-note').textContent='SQL will execute as the sandbox administrator.';
  toast('Execution account changed to root.');
};
$('#workspace-menu').addEventListener('click',event=>{
  const choice=event.target.closest('[data-engine]');
  if(!choice)return;
  if(choice.dataset.engine==='mysql')void switchToMysql();
  else void switchToSqlite();
});
$('#panel-resize').addEventListener('pointerdown',e=>{
  const panel=$('#output-section'),workspace=$('.editor-workspace'),startY=e.clientY,startHeight=panel.getBoundingClientRect().height;
  const move=ev=>{const next=Math.max(125,Math.min(workspace.clientHeight-190,startHeight+startY-ev.clientY));panel.style.height=next+'px';};
  const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);
});
document.addEventListener('click',e=>{if(!e.target.closest('#run-as-popover')&&!e.target.closest('#run-as-toggle')){$('#run-as-popover').hidden=true;$('#run-as-toggle').setAttribute('aria-expanded','false');}if(!e.target.closest('#settings-popover')&&!e.target.closest('#settings-toggle')&&!e.target.closest('[data-activity="settings"]'))$('#settings-popover').hidden=true;if(!e.target.closest('#workspace-menu')&&!e.target.closest('#project-switcher')){$('#workspace-menu').hidden=true;$('#project-switcher').setAttribute('aria-expanded','false');}});
