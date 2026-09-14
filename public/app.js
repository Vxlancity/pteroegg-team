const app = document.getElementById('app');
const state = { me: null, page: 'dashboard', data: {} };

async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Request fehlgeschlagen');
  return body;
}
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
const date = s => s ? new Date(s).toLocaleString('de-DE', { dateStyle:'medium', timeStyle:'short' }) : '—';
const toast = msg => { const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2500); };

async function boot() {
  try { const me = await api('/api/me'); state.me = me.user; state.settings = me.settings; render(); }
  catch { renderLogin(); }
}

function renderLogin() {
  app.innerHTML = `<main class="auth"><section class="auth-card"><div class="brand"><span class="brand-mark">VX</span><div><b>VxTeamPanel</b><small>Self-hosted Team Management</small></div></div><h1>Willkommen zurück</h1><p class="muted">Verwalte dein Team an einem Ort.</p><form id="login"><label>E-Mail<input name="email" type="email" required placeholder="admin@localhost"></label><label>Passwort<input name="password" type="password" required></label><button>Einloggen</button></form><div id="login-error" class="error"></div></section></main>`;
  document.getElementById('login').onsubmit = async e => { e.preventDefault(); const f=new FormData(e.currentTarget); try { const r=await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))}); state.me=r.user; const m=await api('/api/me'); state.settings=m.settings; render(); } catch(err) { document.getElementById('login-error').textContent=err.message; } };
}

function shell(content) {
  const nav = [['dashboard','Übersicht','⌂'],['members','Mitglieder','◉'],['tasks','Aufgaben','✓'],['meetings','Meetings','◷'],['applications','Bewerbungen','✦'],['settings','Einstellungen','⚙']];
  app.innerHTML = `<div class="layout"><aside><div class="brand"><span class="brand-mark">VX</span><div><b>${esc(state.settings?.teamName || 'VxTeam')}</b><small>TeamPanel</small></div></div><nav>${nav.map(([p,n,i])=>`<button class="nav ${state.page===p?'active':''}" data-page="${p}"><span>${i}</span>${n}</button>`).join('')}</nav><div class="side-bottom"><div class="user"><div class="avatar">${esc(state.me.name[0].toUpperCase())}</div><div><b>${esc(state.me.name)}</b><small>${esc(state.me.role)}</small></div></div><button id="logout" class="logout">Abmelden</button></div></aside><main class="main"><header><div><div class="eyebrow">TEAM WORKSPACE</div><h1>${esc(title())}</h1></div><div class="online"><i></i> Self-hosted</div></header>${content}</main></div>`;
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{state.page=b.dataset.page; render();});
  document.getElementById('logout').onclick=async()=>{await api('/api/auth/logout',{method:'POST'}); state.me=null; renderLogin();};
}
function title(){ return ({dashboard:'Übersicht',members:'Mitglieder',tasks:'Aufgaben',meetings:'Meetings',applications:'Bewerbungen',settings:'Einstellungen'})[state.page]; }
function card(label,value,sub,icon){return `<div class="stat"><span class="stat-icon">${icon}</span><div><small>${label}</small><strong>${value}</strong><em>${sub}</em></div></div>`;}

async function dashboard(){ const d=await api('/api/dashboard'); return `<section class="grid stats">${card('Mitglieder',d.members,'im Team','◉')}${card('Offene Aufgaben',d.tasks,'zu erledigen','✓')}${card('Meetings',d.meetings,'geplant','◷')}${card('Bewerbungen',d.applications,'offen','✦')}</section><section class="two"><div class="panel"><div class="panel-head"><div><h2>Letzte Ankündigungen</h2><p>Neuigkeiten für dein Team</p></div></div>${d.announcements.length?d.announcements.map(a=>`<article class="announcement"><b>${esc(a.title)}</b><p>${esc(a.text)}</p><small>${date(a.createdAt)}</small></article>`).join(''):'<div class="empty">Noch keine Ankündigungen vorhanden.</div>'}</div><div class="panel hero-panel"><span class="pill">SELF-HOSTED</span><h2>${esc(state.settings.teamName)}</h2><p>${esc(state.settings.description)}</p><div class="feature-list"><span>✓ Teamverwaltung</span><span>✓ Aufgaben & Meetings</span><span>✓ Bewerbungen</span><span>✓ Lokale Datenhaltung</span></div></div></section>`; }

async function members(){ const users=await api('/api/members'); return `<div class="panel"><div class="panel-head"><div><h2>Teammitglieder</h2><p>${users.length} Mitglied${users.length===1?'':'er'} im Team</p></div></div><div class="list">${users.map(u=>`<div class="row"><div class="avatar">${esc(u.name[0].toUpperCase())}</div><div class="grow"><b>${esc(u.name)}</b><small>${esc(u.email)}</small></div><span class="role">${esc(u.role)}</span>${['owner','admin'].includes(state.me.role)&&u.id!==state.me.id?`<button class="icon-btn del-member" data-id="${u.id}">×</button>`:''}</div>`).join('')}</div></div>`; }

async function tasks(){ const items=await api('/api/tasks'); return `<div class="panel"><div class="panel-head"><div><h2>Aufgaben</h2><p>Organisiere die Arbeit deines Teams.</p></div><button id="add-task">+ Aufgabe</button></div><div class="list">${items.length?items.map(t=>`<div class="row"><div class="check ${t.status==='done'?'done':''}" data-task="${t.id}">${t.status==='done'?'✓':''}</div><div class="grow"><b>${esc(t.title)}</b><small>${t.status==='progress'?'In Arbeit':t.status==='done'?'Erledigt':'Offen'} · ${esc(t.assignee||'Niemand')}</small></div><button class="icon-btn del-task" data-id="${t.id}">×</button></div>`).join(''):'<div class="empty">Keine Aufgaben. Erstelle deine erste Aufgabe.</div>'}</div></div>`; }

async function meetings(){ const items=await api('/api/meetings'); return `<div class="panel"><div class="panel-head"><div><h2>Meetings</h2><p>Termine und Besprechungen.</p></div><button id="add-meeting">+ Meeting</button></div><div class="cards">${items.length?items.map(m=>`<div class="meeting"><span class="date-badge">${new Date(m.date).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})}</span><div class="grow"><b>${esc(m.title)}</b><small>${date(m.date)}</small><p>${esc(m.note)}</p></div><button class="icon-btn del-meeting" data-id="${m.id}">×</button></div>`).join(''):'<div class="empty">Noch keine Meetings geplant.</div>'}</div></div>`; }

async function applications(){ const items=await api('/api/applications'); return `<div class="panel"><div class="panel-head"><div><h2>Bewerbungen</h2><p>Interne Bewerbungsverwaltung.</p></div><button id="add-app">+ Bewerbung</button></div><div class="cards">${items.length?items.map(a=>`<article class="application"><div class="row"><div class="avatar">${esc(a.name[0].toUpperCase())}</div><div class="grow"><b>${esc(a.name)}</b><small>${date(a.createdAt)}</small></div><select class="app-status" data-id="${a.id}"><option value="open" ${a.status==='open'?'selected':''}>Offen</option><option value="accepted" ${a.status==='accepted'?'selected':''}>Angenommen</option><option value="rejected" ${a.status==='rejected'?'selected':''}>Abgelehnt</option></select></div><p>${esc(a.text)}</p></article>`).join(''):'<div class="empty">Keine Bewerbungen vorhanden.</div>'}</div></div>`; }

async function settings(){ const s=await api('/api/settings'); return `<div class="panel narrow"><div class="panel-head"><div><h2>Team-Einstellungen</h2><p>Branding und Beschreibung des Teams.</p></div></div><form id="settings"><label>Teamname<input name="teamName" value="${esc(s.teamName)}" maxlength="80"></label><label>Beschreibung<textarea name="description" maxlength="240">${esc(s.description)}</textarea></label><button>Speichern</button></form><div class="notice">Daten werden lokal in <code>data/panel.json</code> gespeichert.</div></div>`; }

async function render(){
  if(!state.me) return renderLogin();
  try { let content=''; if(state.page==='dashboard') content=await dashboard(); else if(state.page==='members') content=await members(); else if(state.page==='tasks') content=await tasks(); else if(state.page==='meetings') content=await meetings(); else if(state.page==='applications') content=await applications(); else content=await settings(); shell(content); bind(); } catch(e){ toast(e.message); }
}
function bind(){
  document.getElementById('add-task')?.addEventListener('click',async()=>{const title=prompt('Aufgabe'); if(title) {await api('/api/tasks',{method:'POST',body:JSON.stringify({title})}); render();}});
  document.querySelectorAll('.check').forEach(x=>x.onclick=async()=>{const t=await api('/api/tasks'); const item=t.find(i=>i.id===x.dataset.task); await api('/api/tasks/'+x.dataset.task,{method:'PATCH',body:JSON.stringify({status:item.status==='done'?'open':'done'})}); render();});
  document.querySelectorAll('.del-task').forEach(x=>x.onclick=async()=>{await api('/api/tasks/'+x.dataset.id,{method:'DELETE'});render();});
  document.querySelectorAll('.del-member').forEach(x=>x.onclick=async()=>{if(confirm('Mitglied entfernen?')){await api('/api/members/'+x.dataset.id,{method:'DELETE'});render();}});
  document.getElementById('add-meeting')?.addEventListener('click',async()=>{const title=prompt('Meeting-Titel'); if(!title)return; const dateValue=prompt('Datum/Zeit (z.B. 2026-10-01T18:00)'); if(dateValue){await api('/api/meetings',{method:'POST',body:JSON.stringify({title,date:dateValue})});render();}});
  document.querySelectorAll('.del-meeting').forEach(x=>x.onclick=async()=>{await api('/api/meetings/'+x.dataset.id,{method:'DELETE'});render();});
  document.getElementById('add-app')?.addEventListener('click',async()=>{const name=prompt('Name'); if(!name)return; const text=prompt('Bewerbungstext'); if(text){await api('/api/applications',{method:'POST',body:JSON.stringify({name,text})});render();}});
  document.querySelectorAll('.app-status').forEach(x=>x.onchange=async()=>{await api('/api/applications/'+x.dataset.id,{method:'PATCH',body:JSON.stringify({status:x.value})});toast('Status gespeichert');});
  document.getElementById('settings')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);state.settings=await api('/api/settings',{method:'PUT',body:JSON.stringify(Object.fromEntries(f))});toast('Gespeichert');render();});
}
boot();
