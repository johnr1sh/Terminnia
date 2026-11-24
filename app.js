import { basicSetup, EditorView } from 'https://esm.sh/codemirror@6.0.1';
import { sql } from 'https://esm.sh/@codemirror/lang-sql@6.10.0';
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark@6.1.2';
import { format as formatSQL } from 'https://esm.sh/sql-formatter@15.10.0';

const $ = s => document.querySelector(s);
const DB = 'terminnia-local', STORE = 'snapshots', KEY = 'main';
const QUERY = 'terminnia-query-v2', HISTORY = 'terminnia-history-v1';
const SAMPLE = 'SELECT e.name, e.department, e.salary, d.budget\nFROM employees AS e\nJOIN departments AS d ON d.name = e.department\nORDER BY e.salary DESC;';
let editor, worker, seq = 0, ready = false, tableName = null, results = [], currentResultIndex = 0, columns = [], rows = [];
const pending = new Map();
let saveQueue = Promise.resolve();

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
  saveQueue=saveQueue.then(async()=>{
    const d=await storage();
    try{await new Promise((resolve,reject)=>{
      const tx=d.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(buffer,KEY);
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
    });}finally{d.close();}
  });
  return saveQueue;
}
function startWorker() {
  worker=new Worker('./sql-worker.js');
  worker.onmessage=async e=>{
    const data=e.data, task=pending.get(data.id); if(!task)return;
    pending.delete(data.id); clearTimeout(task.timer);
    try{if(data.snapshot instanceof ArrayBuffer)await persist(data.snapshot);task.resolve(data);}
    catch(err){task.reject(err);}
  };
  worker.onerror=e=>{
    const err=new Error(e.message||'SQL worker stopped.');
    pending.forEach(p=>{clearTimeout(p.timer);p.reject(err);});pending.clear();status('Database worker error','error');
  };
}
function call(action,payload={}) {
  return new Promise((resolve,reject)=>{
    const id=++seq, timer=setTimeout(()=>{pending.delete(id);reject(new Error('SQL engine timed out. Reload and try again.'));},30000);
    pending.set(id,{resolve,reject,timer});worker.postMessage({id,action,...payload},payload.transfer||[]);
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
  const table=document.createElement('table');table.className='result-table';
  const head=document.createElement('thead'),hr=document.createElement('tr');
  columns.forEach(c=>{const th=document.createElement('th');th.textContent=c;hr.append(th);});head.append(hr);
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
  const r=await call('tables');if(!r.ok)throw new Error(r.error?.message||'Cannot read tables.');
  const host=$('#table-list');host.replaceChildren();$('#table-total').textContent=String(r.tables.length);
  if(!r.tables.length){const p=document.createElement('p');p.className='muted small';p.textContent='No tables yet. Run CREATE TABLE.';host.append(p);return;}
  const views=r.tables.filter(([,type])=>type==='view'), tables=r.tables.filter(([,type])=>type!=='view');
  $('#views-empty').textContent=views.length?views.map(([name])=>name).join(' · '):'No views';
  r.tables.forEach(([name,type])=>{const b=document.createElement('button');b.className='table-item'+(name===tableName?' active':'');b.textContent=(type==='view'?'◇ ':'▦ ')+name;b.onclick=()=>browse(name);host.append(b);});
}
async function browse(name) {
  tableName=name;await refreshTables();const s=await call('schema',{name});
  const host=$('#schema-content');host.replaceChildren();
  const t=document.createElement('table');t.className='schema-table';
  const h=document.createElement('thead');h.innerHTML='<tr><th>Column</th><th>Type</th><th>Null</th><th>Key</th></tr>';
  const body=document.createElement('tbody');
  (s.columns||[]).forEach(c=>{const tr=document.createElement('tr');[c.name,c.type||'—',c.notnull?'No':'Yes',c.pk?'Primary':'—'].forEach(v=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td);});body.append(tr);});
  t.append(h,body);host.append(t);
  editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:'SELECT * FROM "'+name.replace(/"/g,'""')+'" LIMIT 200;'}});
  await run();
  if(matchMedia('(max-width:760px)').matches)$('#sidebar').classList.remove('open');
}
function remember(text) {
  try{const old=JSON.parse(localStorage.getItem(HISTORY)||'[]');const list=[text,...old.filter(x=>x!==text)].slice(0,30);localStorage.setItem(HISTORY,JSON.stringify(list));renderHistory();}catch{}
}
function renderHistory() {
  let list=[];try{list=JSON.parse(localStorage.getItem(HISTORY)||'[]');}catch{}
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
    const r=await call('exec',{sql:query});
    results=r.results||[];currentResultIndex=0;
    if(results.length){renderResult(results[0]);renderResultTabs();}
    else{$('#result-content').textContent='Statement executed. No result set.';$('#row-count').textContent='0';$('#csv').disabled=true;$('#result-tabs').hidden=true;columns=[];rows=[];}
    if(r.ok){
      await refreshTables();remember(query);$('#duration').textContent=(r.durationMs||0).toFixed(1)+' ms';
      message('Query completed successfully.\nResult sets: '+results.length+'\nRows changed: '+r.rowsChanged+'\nExecution: '+(r.durationMs||0).toFixed(2)+' ms'+(r.snapshotDeferred?'\nSave will complete after the transaction is committed.':'\nDatabase snapshot saved locally.'));
      switchPanel(results.length?'results':'messages');status('Ready · local database saved');
    }else{message(r.error?.message||'SQL execution failed.',true);$('#duration').textContent='Failed';status('SQL execution failed','error');}
  }catch(e){message(e.message,true);status('Database operation failed','error');toast(e.message,true);}
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
    return formatSQL(source, { language: 'sqlite', keywordCase: 'upper', tabWidth: 2 });
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
  const buffer=await file.arrayBuffer(),r=await call('import',{buffer,transfer:[buffer]});
  if(!r.ok)throw new Error(r.error?.message||'Import failed.');
  if(r.snapshot instanceof ArrayBuffer)await persist(r.snapshot);
  tableName=null;await refreshTables();$('#schema-content').textContent='Select a table to inspect its columns.';toast('Database imported and saved.');
}
async function initialize() {
  try{
    status('Opening local database…','busy');startWorker();
    const saved=await loadSaved(),transfer=saved instanceof ArrayBuffer?[saved]:[];
    await call('init',{buffer:saved||undefined,transfer});
    editor=new EditorView({
      doc:localStorage.getItem(QUERY)||SAMPLE,
      extensions:[basicSetup,sql(),oneDark,EditorView.lineWrapping,EditorView.updateListener.of(u=>{
        if(u.docChanged){try{localStorage.setItem(QUERY,u.state.doc.toString());}catch{}}
        const pos=u.state.selection.main.head, line=u.state.doc.lineAt(pos);
        $('#cursor').textContent='Ln '+line.number+', Col '+(pos-line.from+1);
        $('#status-selection').textContent=u.state.selection.main.empty?'No selection':(u.state.selection.main.to-u.state.selection.main.from)+' selected';
      })],parent:$('#editor')
    });
    ready=true;$('#engine-label').textContent='SQLite WebAssembly · Local';$('#connection').textContent='● Local database ready';
    status('Ready · data stored in this browser');await refreshTables();renderHistory();
    if(!saved)toast('Welcome to Terminnia. Sample database loaded.');
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
$('#sidebar-toggle').onclick=()=>$('#sidebar').classList.toggle('open');
$('#new-table').onclick=()=>{editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:'CREATE TABLE new_table (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n);'}});editor.focus();};
$('#refresh-tables').onclick=()=>refreshTables().catch(e=>toast(e.message,true));
document.querySelectorAll('[data-panel-tab]').forEach(b=>b.onclick=()=>switchPanel(b.dataset.panelTab));
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run();}});
initialize();


// Spck-inspired workspace controls.
function setActivity(name) {
  document.querySelectorAll('[data-activity]').forEach(b=>b.classList.toggle('selected',b.dataset.activity===name));
  const titles={explorer:'EXPLORER',search:'SEARCH',database:'DATABASE',history:'HISTORY',settings:'SETTINGS'};
  $('#sidebar-title').textContent=titles[name]||'EXPLORER';
  const explorer=$('.explorer-section'), history=$('#history-section');
  if(explorer)explorer.hidden=!['explorer','database'].includes(name);
  if(history)history.hidden=name!=='history';
  if(name==='search') {
    if(!$('#sidebar-search')) {
      const wrap=document.createElement('div');wrap.className='sidebar-search-wrap';wrap.innerHTML='<input id="sidebar-search" type="search" placeholder="Search SQL in current file…" autocomplete="off"><div class="search-hint">Search is applied to the current SQL document.</div>';
      $('.sidebar-scroll').prepend(wrap);
      $('#sidebar-search').addEventListener('input',e=>{
        const q=e.target.value;if(!q)return;
        const doc=editor.state.doc.toString(),at=doc.toLowerCase().indexOf(q.toLowerCase());
        if(at>=0){editor.dispatch({selection:{anchor:at,head:at+q.length},scrollIntoView:true});editor.focus();}
      });
    }
    $('#sidebar-search').parentElement.hidden=false;
  } else if($('#sidebar-search')) $('#sidebar-search').parentElement.hidden=true;
  if(name==='settings') {$('#settings-popover').hidden=false;}
}
document.querySelectorAll('[data-activity]').forEach(b=>b.addEventListener('click',()=>{
  const mobile=matchMedia('(max-width:760px)').matches;
  if(mobile && ['explorer','database','history'].includes(b.dataset.activity)) $('#sidebar').classList.toggle('open');
  setActivity(b.dataset.activity);
}));
$('#sidebar-collapse').onclick=()=>$('#sidebar').classList.toggle('collapsed');
$('#project-tree-toggle').onclick=()=>{const node=$('.project-meta');node.hidden=!node.hidden;$('.explorer-section').classList.toggle('tree-collapsed',node.hidden);};
$('#tables-tree-toggle').onclick=()=>{$('#table-list').hidden=!$('#table-list').hidden;};
$('#views-tree-toggle').onclick=()=>{$('#views-empty').hidden=!$('#views-empty').hidden;};
$('#settings-toggle').onclick=()=>{$('#settings-popover').hidden=!$('#settings-popover').hidden;};
$('#font-size').onchange=e=>{document.querySelector('.cm-editor').style.fontSize=e.target.value+'px';};
$('#line-wrap').onchange=e=>{const content=document.querySelector('.cm-content');if(content)content.style.whiteSpace=e.target.checked?'pre-wrap':'pre';};
$('#zen-mode').onchange=e=>document.body.classList.toggle('zen-mode',e.target.checked);
$('#panel-toggle').onclick=()=>{const panel=$('#output-section'),resize=$('#panel-resize');const hidden=panel.hidden;panel.hidden=!hidden;resize.hidden=!hidden;$('#panel-toggle').textContent=hidden?'⌄':'⌃';};
$('#add-tab').onclick=()=>{if(!editor)return;editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:''}});editor.focus();$('#query-tab').querySelector('span:nth-child(2)').textContent='untitled.sql';toast('New SQL document ready. Download it to keep a copy.');};
$('#new-query').onclick=()=>$('#add-tab').click();
$('#project-switcher').onclick=()=>toast('This local workspace currently contains one database project.');
$('#panel-resize').addEventListener('pointerdown',e=>{
  const panel=$('#output-section'),workspace=$('.editor-workspace'),startY=e.clientY,startHeight=panel.getBoundingClientRect().height;
  const move=ev=>{const next=Math.max(125,Math.min(workspace.clientHeight-190,startHeight+startY-ev.clientY));panel.style.height=next+'px';};
  const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);
});
document.addEventListener('click',e=>{if(!e.target.closest('#settings-popover')&&!e.target.closest('#settings-toggle')&&!e.target.closest('[data-activity="settings"]'))$('#settings-popover').hidden=true;});
