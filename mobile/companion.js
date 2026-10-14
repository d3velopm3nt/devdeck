'use strict';
const $ = id => document.getElementById(id);
const CACHE = 'devdeck-companion-v1';
let snapshot = {nodes:[],conversations:[],recent:[],sessions:[],agents:[],approvals:[],claims:[],queue:[],cursor:0};
let outbox=[], bridgeId='', activityFilter='all', projectFilter='', detailId='', listening=false, preparingVoice=false, speaking=false, acceptedChimes=new Set();
let orbMode = '';
let startingMic = false;
const activeTurns = new Set();
const voiceReplyRequests = new Set();
let draftSignature = '';
let issueProject='', issueBoards={}, issueLoading=false, issueError='', issueAttempt=0;
const USER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></svg>';
const DEV_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7L12 2Z"/></svg>';
let messages = {}, current = '', online = false, paired = false, cursor = 0, before = 0, pending = null, draft = null, delta = '', lastSync = '', disposed = false, authLost = false;
try { const saved=JSON.parse(localStorage.getItem(CACHE)||'null'); if(saved?.version===1){snapshot=saved.snapshot;messages=saved.messages||{};current=saved.current||'';lastSync=saved.lastSync||'';draft=saved.draft||null;outbox=saved.outbox|| (draft?[{...draft,status:'unconfirmed'}]:[]);bridgeId=saved.bridgeId||'';issueBoards=saved.issueBoards||{};issueProject=saved.issueProject||'';} } catch { /* A damaged or unavailable cache is optional. */ }
function cache(){if(authLost||disposed)return;try{localStorage.setItem(CACHE,JSON.stringify({version:1,snapshot,messages,current,lastSync,draft,outbox,bridgeId,issueBoards,issueProject}));}catch{/* Private browsing may refuse persistence. */}}
function notice(text,kind='general'){$('notice').textContent=text;$('notice').dataset.kind=kind;}
function connection(on){if(on&&$('notice').dataset.kind==='connection')notice('');online=on;$('status').textContent=on?'PC connected':paired?'Offline · saved view':'Pairing required';$('status').className=on?'online':'';$('disconnect').hidden=!paired;$('freshness').textContent=lastSync?'Synced '+new Date(lastSync).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'';updateControls();renderDraft();updateOrb();}
function orb(state){orbMode=state;$('orb').className='orb '+state;$('orb').dataset.state=state||'idle';$('orb').setAttribute('aria-label',(listening?'Finish listening':startingMic?'Cancel microphone':'Start voice input')+' · Dev is '+(state||'idle'));$('orb-state').textContent=({connecting:'Starting microphone…',thinking:'Thinking…',speaking:'Speaking…',listening:'Listening…',preparing:'Preparing voice…',offline:'PC offline · tasks saved here'})[state]||'Ready when you are';}
function updateOrb(){const running=(snapshot.queue||[]).some(q=>q.conversation_id===current&&q.status==='running');orb(startingMic?'connecting':listening?'listening':speaking?'speaking':preparingVoice?'preparing':paired&&!online?'offline':running||pending||activeTurns.has(current)?'thinking':'');}
function updateControls(){if(!window.localVoiceReady)return;$('send').disabled=!paired||!$('text').value.trim()||outbox.length>=32;$('mute-voice').disabled=!speaking&&!preparingVoice;$('mute-voice').setAttribute('aria-pressed',String(speaking));$('mic').disabled=!recognitionAvailable||!online;$('mic').setAttribute('aria-pressed',String(listening));$('mic').setAttribute('aria-label',listening?'Finish listening':startingMic?'Cancel microphone':'Start voice input');$('mic').classList.toggle('starting',startingMic);$('orb').disabled=!recognitionAvailable||!online;$('mic').classList.toggle('active',listening);$('text').placeholder=online?'Ask Dev anything…':'Write a task · sends on reconnect';$('send').setAttribute('aria-label',online?'Send':'Save for reconnect');}
const navObserver=new ResizeObserver(([entry])=>document.documentElement.style.setProperty('--nav-height',entry.target.getBoundingClientRect().height+'px'));navObserver.observe(document.querySelector('nav'));
async function api(path,body,signal){
const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),path.startsWith('/api/issues/')?20000:15000);const abort=()=>controller.abort();if(signal)signal.addEventListener('abort',abort,{once:true});try{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});const data=await response.json();if(!response.ok){const error=new Error(data.error||'Connection failed');error.status=response.status;throw error;}return data;}finally{clearTimeout(timeout);if(signal)signal.removeEventListener('abort',abort);}}
function setTextMode(show){document.body.classList.toggle('text-mode',show);$('type-message').setAttribute('aria-label',show?'Hide chat':'Show chat');$('type-message').setAttribute('aria-pressed',String(show));if(show){renderChat(true);$('text').focus();}else $('text').blur();}
function focusChat(on){document.body.classList.toggle('focus-mode',on);$('exit-focus').hidden=!on;document.querySelector('.app').scrollTop=0;if(name==='activity')void refreshIssues();}
function view(name){if(name!=='chat')focusChat(false);if(name!=='chat'){localVoice.stop();stopListening();}for(const id of ['home','chat','spaces','folders','threads','team','activity'])$(id).hidden=id!==name;document.querySelectorAll('nav button').forEach(b=>{if(b.dataset.view===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});document.querySelector('.app').scrollTop=0;if(name==='activity')void refreshIssues();}
function bubble(message){const el=document.createElement('div');el.className='message '+message.from;const avatar=document.createElement('span');avatar.className='avatar';avatar.innerHTML=message.from==='user'?USER_ICON:DEV_ICON;avatar.setAttribute('aria-hidden','true');const body=document.createElement('div');const who=document.createElement('span');who.className='speaker';who.textContent=message.by||(message.from==='user'?'You':message.from==='tool'?'Work update':'Dev');body.append(who,document.createTextNode(message.text));el.append(avatar,body);return el;}
function renderChat(forceBottom=false){const transcript=$('transcript');const previousTop=transcript.scrollTop;const follow=forceBottom||transcript.scrollHeight-transcript.clientHeight-previousTop<48;const room=snapshot.conversations.find(c=>c.id===current);$('thread-title').textContent=room?.title||'Your main assistant';$('transcript').replaceChildren(...(messages[current]||[]).map(bubble));if(delta)$('transcript').append(bubble({from:'assistant',text:delta}));$('load-older').hidden=!current||before===0;updateControls();transcript.scrollTop=follow?transcript.scrollHeight:previousTop;}
function listItem(title,detail,click){const b=document.createElement('button');b.textContent=title;const s=document.createElement('small');s.textContent=detail;b.append(s);b.onclick=click;return b;}
function empty(box,text){const p=document.createElement('p');p.className='empty';p.textContent=text;box.append(p);}
function badge(text){const b=document.createElement('span');b.className='badge '+text.toLowerCase().replaceAll(' ','-');b.textContent=text;return b;}
function activeSession(s){return !['completed','failed','idle'].includes(s.status);}
function sessionLabel(s){if(!s.ended_at&&activeSession(s)&&Date.now()-Date.parse(s.transcript?.at(-1)?.at||s.started_at)>15*60000)return 'No recent checkpoint';return s.status||'Recorded';}
function timeLabel(at){if(!at)return '';const date=new Date(at);return Number.isNaN(date.getTime())?'':date.toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
function sessionCard(s){const title=s.agent_name||s.agent_id||'Agent';const b=listItem(title,s.summary||s.transcript?.at(-1)?.text||s.feature_id||'Recorded session',()=>openDetail(s.id));b.className='work-card';const meta=document.createElement('div');meta.className='card-meta';meta.append(badge(sessionLabel(s)));const t=document.createElement('span');t.textContent=[s.project_id,timeLabel(s.ended_at||s.started_at)].filter(Boolean).join(' · ');meta.append(t);b.append(meta);return b;}
function renderLists(){const rooms=snapshot.conversations||[];$('rooms').replaceChildren(...rooms.map(c=>listItem(c.title||'Conversation',c.preview||'',()=>openRoom(c.id))));if(!rooms.length)empty($('rooms'),'No conversations yet. Start one with Dev.');
const byId=new Map(snapshot.nodes.map(n=>[n.id,n]));$('nodes').replaceChildren(...snapshot.nodes.filter(n=>n.kind!=='folder').map(n=>listItem(n.name,(byId.get(n.parent_id)?.name||'Your workspace')+' · '+n.kind,()=>openNode(n.id))));
const folders=snapshot.nodes.filter(n=>n.kind==='folder');$('folder-nodes').replaceChildren(...folders.map(n=>listItem(n.name,byId.get(n.parent_id)?.name||'Folder',()=>openNode(n.id))));if(!folders.length)empty($('folder-nodes'),'No folders yet. Add them on your desktop.');
const sessions=snapshot.sessions||[], agents=snapshot.agents||[], approvals=snapshot.approvals||[];
$('home-active').textContent=sessions.filter(activeSession).length;$('home-waiting').textContent=approvals.length;$('home-queued').textContent=(snapshot.queue||[]).filter(q=>['queued','running'].includes(q.status)).length+outbox.filter(q=>q.status!=='accepted').length;
$('home-work').replaceChildren(...sessions.slice(0,3).map(sessionCard));if(!sessions.length)empty($('home-work'),'Your next idea starts here. Ask Dev to put it in motion.');
$('home-spaces').replaceChildren(...snapshot.nodes.filter(n=>n.kind!=='folder'&&!n.parent_id).slice(0,4).map(n=>listItem(n.name,n.kind,()=>openNode(n.id))));
$('team-members').replaceChildren(...agents.map(a=>{const runs=sessions.filter(s=>s.agent_id===a.id), live=runs.filter(activeSession), waiting=approvals.filter(x=>x.agent_id===a.id);const b=listItem(a.name,a.role||'Agent',()=>{view('chat');setTextMode(true);$('text').value='@'+a.id+' ';updateControls();$('text').focus();});b.className='agent-card';const monogram=document.createElement('span');monogram.className='agent-monogram';monogram.textContent=a.name.slice(0,2).toUpperCase();b.prepend(monogram);const meta=document.createElement('div');meta.className='card-meta';meta.append(badge(waiting.length?'Needs approval':live.length?sessionLabel(live[0]):'Available'));const note=document.createElement('span');note.textContent=live[0]?.project_id||'Tap to chat';meta.append(note);b.append(meta);return b;}));if(!agents.length)empty($('team-members'),'No agents configured yet. Add your team on the desktop.');$('team-count').textContent=agents.length+' agents';
const projects=[...new Set(sessions.map(s=>s.project_id).filter(Boolean))];$('project-filter').replaceChildren(new Option('All projects',''),...projects.map(p=>new Option(p,p)));$('project-filter').value=projectFilter;
renderIssueProjects();renderIssues();renderWorkflows();renderActivity();if(detailId)renderDetail();}
function renderActivity(){const sessions=(snapshot.sessions||[]).filter(s=>(!projectFilter||s.project_id===projectFilter)&&(activityFilter==='all'||activityFilter==='active'&&activeSession(s)||activityFilter==='waiting'&&['waiting','blocked'].includes(s.status)||activityFilter==='done'&&['completed','failed'].includes(s.status)));
$('runs').replaceChildren(...sessions.map(sessionCard));if(!sessions.length)empty($('runs'),'No work in this view yet.');
const approvals=(snapshot.approvals||[]).filter(a=>!projectFilter||a.project_id===projectFilter);$('approvals').replaceChildren(...approvals.map(a=>{const c=document.createElement('article');c.className='approval-card';const title=document.createElement('strong');title.textContent='Approval needed';const body=document.createElement('p');body.textContent=a.summary;const meta=document.createElement('small');meta.textContent=[a.agent_id,a.project_id,'Review on desktop'].filter(Boolean).join(' · ');c.append(title,body,meta);return c;}));$('approval-section').hidden=!approvals.length;
const queued=(snapshot.queue||[]).filter(q=>['queued','running'].includes(q.status));$('queue-list').replaceChildren(...queued.slice().reverse().slice(0,10).map(q=>{const b=listItem(q.text,q.status,()=>openRoom(q.conversation_id));b.className='queue-card';return b;}));$('queue-section').hidden=!queued.length;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===activityFilter)));}
function openDetail(id){detailId=id;renderDetail();$('run-detail').showModal();}
function renderDetail(){const s=(snapshot.sessions||[]).find(s=>s.id===detailId);if(!s)return;$('detail-title').textContent=s.agent_name||s.agent_id||'Agent session';$('detail-status').replaceChildren(badge(sessionLabel(s)));$('detail-summary').textContent=s.summary||s.feature_id||'Session details';$('detail-meta').textContent=[s.project_id,timeLabel(s.started_at),s.turns==null?'':s.turns+' turns'].filter(Boolean).join(' · ');$('detail-log').replaceChildren(...(s.transcript||[]).slice(-30).map(e=>{const p=document.createElement('p');p.textContent=timeLabel(e.at)+' · '+e.text;return p;}));$('detail-files').textContent=s.files_touched?.length?'Files: '+s.files_touched.join(', '):'';const claims=(snapshot.claims||[]).filter(c=>c.session_id===s.id);$('detail-claim').textContent=claims.map(c=>c.intent).join(' · ');}
function renderDraft(){const signature=JSON.stringify([outbox,online]);draft=outbox.find(q=>q.status!=='accepted')||null;document.querySelector('.app').classList.toggle('has-draft',!!draft);if(signature===draftSignature)return;draftSignature=signature;const box=$('drafts');box.replaceChildren();for(const q of outbox){const p=document.createElement('div');p.className='draft-row';const text=document.createElement('span');text.textContent=(q.status==='accepted'?'On desktop':q.status==='unconfirmed'?'Check before retry':'Saved for reconnect')+' · '+q.text;p.append(text);if(q.status!=='accepted'){const b=document.createElement('button');b.textContent='Retry saved request';b.disabled=!online;b.onclick=()=>{q.status='saved';void flushOutbox();};const discard=document.createElement('button');discard.textContent='Discard';discard.onclick=()=>{outbox=outbox.filter(x=>x!==q);cache();renderDraft();updateControls();};p.append(b,discard);}box.append(p);}updateControls();}
let refreshing;
function refresh(){refreshing ||= loadSnapshot().finally(()=>{refreshing=null;});return refreshing;}
async function loadSnapshot(){const data=await api('/api/snapshot');if(authLost||disposed)return;const changed=bridgeId&&data.bridge_id&&bridgeId!==data.bridge_id;if(changed){activeTurns.clear();voiceReplyRequests.clear();for(const q of outbox)q.status='unconfirmed';pending=null;notice('Desktop restarted. Check your conversations before retrying saved requests.');}bridgeId=data.bridge_id||bridgeId;snapshot=data;const appearance=DevOrb.normalize(data.orb_preferences);document.documentElement.style.setProperty('--orb-size',Math.round(330*appearance.size)+'px');const known=new Map((data.queue||[]).map(q=>[q.request_id,q]));outbox=outbox.filter(q=>{const r=known.get(q.request_id);if(!r)return true;if(r.status==='completed')return false;if(r.status==='failed'){q.status='unconfirmed';return true;}q.status='accepted';return true;});for(const room of data.recent||[]){if(!messages[room.id])messages[room.id]=room.messages;}if(!current&&data.conversations.length)current=data.conversations[0].id;lastSync=new Date().toISOString();paired=true;connection(true);cache();renderLists();renderChat();renderDraft();$('pairing').hidden=true;void flushOutbox();if(!$('activity').hidden)void refreshIssues();}
async function openRoom(id,navigate=true){const changed=current!==id;localVoice.stop();current=id;delta='';if(navigate)view('chat');before=0;updateOrb();renderChat(changed);try{const room=await api('/api/conversation/'+encodeURIComponent(id));if(current!==id)return;messages[id]=room.messages;before=room.before;lastSync=new Date().toISOString();connection(true);cache();renderChat();}catch(e){connection(false);notice('Showing saved conversation. '+e.message,'connection');}}
async function openNode(id){try{const room=await api('/api/node',{node_id:id});if(authLost||disposed)return;await refresh();await openRoom(room.id);}catch(e){notice(e.message);}}
async function newChat(){try{const room=await api('/api/conversations',{});if(authLost||disposed)return;await refresh();await openRoom(room.id);}catch(e){notice(e.message);}}
function requestId(){if(window.crypto?.randomUUID)return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');}
let flushing=false;
async function send(request){if(request.voice)voiceReplyRequests.add(request.request_id);stopListening();localVoice.stop();if(!outbox.some(q=>q.request_id===request.request_id))outbox.push({...request,status:'saved'});cache();renderDraft();if(!online){notice('Task saved. It will send when this desktop reconnects.','connection');return;}await flushOutbox();}
async function flushOutbox(){if(flushing||!online||!paired||authLost)return;flushing=true;try{for(const q of outbox){if(q.status!=='saved')continue;pending=q;updateOrb();try{await api('/api/send',{conversation_id:q.conversation_id,request_id:q.request_id,text:q.text});q.status='accepted';if(!q.chimed&&!acceptedChimes.has(q.request_id)){q.chimed=true;acceptedChimes.add(q.request_id);if(q.voice&&q.conversation_id===current&&!listening&&!startingMic&&voiceReplyRequests.has(q.request_id)&&localVoice.canSpeak())void localVoice.speak('Got it.').catch(()=>{});else void playOrbSound();}notice('Message accepted. Dev can delegate work while you keep chatting.');cache();renderDraft();}catch(e){pending=null;if(e.status===401){authLost=true;paired=false;q.status='unconfirmed';connection(false);notice('Pairing expired. Scan a new desktop QR.');}else if(e.status===400||e.status===409){q.status='unconfirmed';notice(e.message);}else{connection(false);notice('Connection interrupted. Your request is saved for reconnect.','connection');}cache();renderDraft();break;}}}finally{pending=null;flushing=false;updateOrb();updateControls();}}
async function events(signal){while(!signal.aborted&&!authLost){try{const result=await api('/api/events?after='+cursor,undefined,signal);cursor=result.cursor;const reconnecting=!online;connection(true);if(reconnecting)await refresh();if(result.reset){activeTurns.clear();if(pending){pending=null;updateOrb();notice('Reconnected after missed updates. Check the conversation before retrying.');}await refresh();if(current)await openRoom(current,false);}
for(const e of result.events){if(e.kind==='turn'){if(e.done)activeTurns.delete(e.conversation_id);else activeTurns.add(e.conversation_id);}if(e.kind==='done'||e.kind==='receipt')activeTurns.delete(e.conversation_id);if(e.conversation_id===current){if(e.kind==='delta'){delta+=e.text;renderChat();}if(e.kind==='turn')updateOrb();if(e.kind==='step')notice('Work update: '+e.message.text);if(e.kind==='done'){activeTurns.delete(current);delta='';await openRoom(current,false);}}
if(e.kind==='receipt'){const speakReply=voiceReplyRequests.delete(e.request_id)&&!e.error;outbox=outbox.filter(q=>q.request_id!==e.request_id);pending=null;delta='';if(e.error)notice(e.error);else notice('Reply saved in your desktop conversation.');cache();await refresh();if(e.conversation_id===current){await openRoom(current,false);if(speakReply&&!$('chat').hidden){const last=[...(messages[current]||[])].reverse().find(m=>m.from==='assistant'&&!m.tool);if(last&&localVoice.isReady())void localVoice.speak(last.text).catch(e=>notice(e.message));else if(!localVoice.isReady())notice('Download the voice to hear replies automatically.');}}renderDraft();updateOrb();}if(e.kind==='queue'){await refresh();updateOrb();}}
}catch(e){if(signal.aborted)break;connection(false);if(e.status===401){authLost=true;paired=false;connection(false);$('pairing').hidden=false;notice('Pairing expired or revoked. Scan a new desktop QR code.');break;}notice('PC disconnected. Saved history remains available.','connection');await new Promise(r=>setTimeout(r,2000));}}}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{view(b.dataset.view);if(b.dataset.view==='chat'){setTextMode(false);focusChat(true);}});
$('exit-focus').onclick=()=>{focusChat(false);view('home');};
$('go-home').onclick=()=>view('home');$('home-dev').onclick=()=>{view('chat');setTextMode(false);focusChat(true);};$('home-activity').onclick=()=>view('activity');$('home-teams').onclick=()=>{activityFilter='waiting';renderActivity();view('activity');};$('home-all-spaces').onclick=()=>view('spaces');$('detail-close').onclick=()=>{$('run-detail').close();detailId='';};$('run-detail').addEventListener('click',e=>{if(e.target===$('run-detail')){$('run-detail').close();detailId='';}});document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{activityFilter=b.dataset.filter;renderActivity();});$('project-filter').onchange=()=>{projectFilter=$('project-filter').value;renderActivity();};$('refresh-work').onclick=async()=>{const b=$('refresh-work');b.disabled=true;try{await refresh();}catch{connection(false);}finally{b.disabled=false;}};
let chimeContext;
function unlockSound(){try{const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){chimeContext ||= new Audio();void chimeContext.resume();}}catch{}}
async function playOrbSound(){try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;chimeContext ||= new Audio();await chimeContext.resume();const start=chimeContext.currentTime;for(const [offset,hz] of [[0,523.25],[.12,783.99]]){const oscillator=chimeContext.createOscillator(),gain=chimeContext.createGain();oscillator.type='sine';oscillator.frequency.value=hz;gain.gain.setValueAtTime(0,start+offset);gain.gain.linearRampToValueAtTime(.12,start+offset+.015);gain.gain.exponentialRampToValueAtTime(.001,start+offset+.24);oscillator.connect(gain);gain.connect(chimeContext.destination);oscillator.start(start+offset);oscillator.stop(start+offset+.25);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};}}catch{notice('Sound could not start. Check your phone audio settings.');}}
$('orb').onclick=()=>$('mic').click();
$('new-chat').onclick=newChat;$('new-thread').onclick=newChat;$('open-chats').onclick=()=>view('threads');$('all-chats').onclick=()=>view('threads');$('type-message').onclick=()=>setTextMode(!document.body.classList.contains('text-mode'));$('mute-voice').onclick=()=>localVoice.stop();$('text').oninput=()=>updateControls();
async function submitMessage(value,voice=false){
  const text=value.trim();if(!text)return;
  if(outbox.length>=32){notice('Message queue is full. Wait for accepted messages to finish.');return;}
  unlockSound();
  if(!current){if(!online){notice('Connect to the desktop to start your first conversation.');return;}await newChat();if(!current)return;}
  const request={conversation_id:current,request_id:requestId(),text,voice};
  $('text').value='';updateControls();
  await send(request);
}
$('compose').onsubmit=e=>{e.preventDefault();void submitMessage($('text').value).catch(e=>notice(e.message));};
$('load-older').onclick=async()=>{const id=current;try{const page=await api('/api/conversation/'+encodeURIComponent(id)+'?before='+before);if(current!==id)return;messages[id]=[...page.messages,...messages[id]];before=page.before;cache();renderChat();$('transcript').scrollTop=0;}catch(e){notice(e.message);}};
$('disconnect').onclick=async()=>{stopListening();localVoice.stop();authLost=true;try{await api('/api/unpair',{});}catch{/* Clear this device even if the PC is unavailable. */}authLost=true;paired=false;online=false;draft=null;messages={};outbox=[];bridgeId='';issueBoards={};issueProject='';snapshot={nodes:[],conversations:[],recent:[],sessions:[],agents:[],approvals:[],queue:[],cursor:0};view('home');current='';lastSync='';try{localStorage.removeItem(CACHE);}catch{}renderLists();renderChat();renderDraft();connection(false);$('pairing').hidden=false;notice('This device is unpaired. Stop the desktop companion to revoke all devices.');};
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
// SpeechRecognition support and microphone permission are browser decisions.
// Do not pre-emptively block browsers that expose it on a trusted LAN origin.
const recognitionAvailable=!!Recognition;
function recognitionError(code){
  if(code.includes(' '))return code;
  if(['not-allowed','service-not-allowed'].includes(code))return window.isSecureContext
    ?'Microphone access was denied. Allow microphone access in browser site settings and try again.'
    :'The browser denied microphone access on this HTTP address. Check site permissions; this browser may require a trusted HTTPS connection. Keyboard dictation still works.';
  return ({'audio-capture':'No microphone is available. Check your phone microphone and browser permissions.',network:'The browser speech service could not connect. Check your internet connection and try again.','no-speech':'No speech was detected. Tap the microphone and try again.',aborted:'Listening stopped.'})[code]||'Voice input could not start: '+code+'. Try again or use chat.';
}
const voiceInput=DevVoiceInput.create({
  onState:state=>{startingMic=state==='starting';listening=state==='listening';if(listening)notice('Listening. Speak, then pause to send.');updateOrb();updateControls();},
  onCaption:text=>{$('voice-caption').textContent=text;},
  onText:text=>submitMessage(text,true),
  onError:code=>notice(recognitionError(code))
});
function stopListening(discard=true){if(discard)voiceInput.cancel();else voiceInput.finish();}
$('mic').onclick=()=>{
  if(startingMic){voiceInput.cancel();return;}
  if(listening){voiceInput.finish();return;}
  if(!recognitionAvailable||!online)return;
  unlockSound();localVoice.stop();void localVoice.unlock().catch(e=>notice(e.message));voiceInput.start();
};
$('voice-help').textContent=recognitionAvailable?'Tap the orb or microphone to talk. Pause to send.':'Voice input is unavailable in this browser. Use keyboard dictation or open in a browser with speech recognition.';
const localVoice=createOfflineVoice({button:$('download-voice'),status:$('voice-status'),onPreparing:()=>{preparingVoice=true;speaking=false;updateOrb();},onSpeaking:()=>{preparingVoice=false;speaking=true;updateOrb();updateControls();},onIdle:()=>{preparingVoice=false;speaking=false;updateOrb();updateControls();},onChange:()=>queueMicrotask(()=>{window.localVoiceReady=true;document.querySelector('.app').classList.toggle('voice-ready',localVoice.isReady());updateControls();})});
const stopOrb=mountVoiceOrb($('voice-orb'),() => !$('chat').hidden,() => orbMode,() => orbMode==='listening'?voiceInput.level():localVoice.level());
const controller=new AbortController();window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});window.addEventListener('pagehide',()=>{disposed=true;navObserver.disconnect();void chimeContext?.close();controller.abort();stopOrb();localVoice.dispose();stopListening();clearInterval(syncTimer);});
let syncTimer=setInterval(()=>{if(!disposed&&!authLost&&paired)void refresh().catch(()=>connection(false));},5000);
renderLists();renderChat();renderDraft();connection(false);view('home');
(async()=>{try{const params=new URLSearchParams(location.hash.slice(1));const code=params.get('pair');if(code){history.replaceState(null,'',location.pathname);await api('/api/pair',{code});}await refresh();if(current){const room=await api('/api/conversation/'+encodeURIComponent(current));messages[current]=room.messages;before=room.before;renderChat();}void events(controller.signal);}catch(e){connection(false);$('pairing').hidden=true;if(e.status===401){authLost=true;paired=false;$('pairing').hidden=false;notice(e.message);}else{paired=!!lastSync;connection(false);notice('PC unavailable. Showing last saved state.','connection');if(paired)void events(controller.signal);}}})();


function renderIssueProjects(){
  const products=snapshot.products||[];
  if(!products.some(p=>p.id===issueProject))issueProject=products[0]?.id||'';
  $('issue-project').replaceChildren(...products.map(p=>new Option(p.name,p.id)));
  $('issue-project').value=issueProject;
  for(const source of snapshot.issue_monitor?.sources||[]){
    for(const product of products.filter(p=>p.repository===source.repository)){
      const saved=issueBoards[product.id];
      if(source.fetched_at&&(!saved||Date.parse(source.fetched_at)>=Date.parse(saved.fetched_at)))issueBoards[product.id]={...source};
    }
  }
}
function renderIssues(){
  const board=issueBoards[issueProject], items=(board?.items||[]).filter(i=>!i.pull_request);
  $('refresh-issues').disabled=issueLoading||!online||!issueProject;
  const status=issueLoading?'Refreshing GitHub issues…':issueError?`Refresh failed: ${issueError}. Showing saved issues.`:!issueProject?'Connect a GitHub project on the desktop to see its issues here.':board?`${online?'Last fetched':'Offline · saved issues'} ${timeLabel(board.fetched_at)}${board.truncated?' · Partial history':''}`:'Issues have not been fetched yet.';
  const monitor=snapshot.issue_monitor;const source=monitor?.sources?.find(s=>s.repository===(snapshot.products||[]).find(p=>p.id===issueProject)?.repository);
  $('issue-status').textContent=[monitor?.enabled?'Automatic issue monitor enabled.':'',source?.error?`Monitor refresh failed: ${source.error}. Previous issues retained.`:'',status,...(board?.warnings||[]),...(snapshot.visibility_warnings||[])].join(' ');
  $('issue-list').replaceChildren(...items.map(issue=>{
    const card=document.createElement('article');card.className='work-card';
    const title=document.createElement('strong');title.textContent=`#${issue.number} · ${issue.title}`;
    const meta=document.createElement('p');meta.textContent=`${issue.state} · ${issue.assignees?.length?issue.assignees.join(', '):'Unassigned'} · ${timeLabel(issue.updated_at)}`;
    const progress=document.createElement('p');
    const linked=(snapshot.workflows?.items||[]).find(w=>w.definition.ticket_url===issue.url);
    const steps=linked?.definition.steps||[];
    const active=steps.filter(s=>['running','starting','review','blocked'].includes(s.status));
    progress.textContent=linked?`${linked.definition.title} · ${steps.filter(s=>s.status==='done').length}/${steps.length} accepted · ${active.length?active.map(s=>s.title+' · '+s.status).join('; '):'Waiting for next step'}`:'No workflow linked';
    card.append(title,meta,progress);
    // Construct GitHub link from trusted connected repository and numeric issue ID.
    const product=(snapshot.products||[]).find(p=>p.id===issueProject);
    if(product&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(product.repository)&&Number.isSafeInteger(issue.number)&&issue.number>0){
      const link=document.createElement('a');link.href=`https://github.com/${product.repository}/issues/${issue.number}`;link.textContent='Open on GitHub';link.target='_blank';link.rel='noopener noreferrer';card.append(link);
    }
    return card;
  }));
  if(board&&!items.length)empty($('issue-list'),'No issues in the fetched history.');
}
async function refreshIssues(force=false){
  if(issueLoading||!online||!issueProject||authLost||disposed)return;
  if(!force&&snapshot.issue_monitor?.enabled)return;
  if(!force&&Date.now()-issueAttempt<60000)return;
  const product=issueProject;issueAttempt=Date.now();issueLoading=true;issueError='';renderIssues();
  try{const board=await api('/api/issues/'+encodeURIComponent(product));if(authLost||disposed)return;issueBoards[product]=board;cache();}
  catch(e){if(!authLost&&!disposed)issueError=e.message;}
  finally{issueLoading=false;renderIssues();}
}
function renderWorkflows(){
  const workflows=snapshot.workflows?.items||[];
  $('workflow-warning').textContent=(snapshot.workflows?.warnings||[]).join(' ');
  $('workflow-list').replaceChildren(...workflows.map(w=>{
    const card=document.createElement('article');card.className='work-card';
    const title=document.createElement('strong');title.textContent=w.definition.title;
    const folder=document.createElement('p');folder.textContent=w.folder;
    card.append(title,folder);
    for(const step of w.definition.steps){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=`${step.title} · @${step.worker} · ${step.status} · ${step.updated_at?timeLabel(step.updated_at):'No update yet'}`;details.append(summary);const body=document.createElement('p');body.textContent=[step.run?'Run: '+step.run:'',step.evidence,step.next_action].filter(Boolean).join(' · ')||step.instructions;details.append(body);card.append(details);}
    return card;
  }));
  if(!workflows.length)empty($('workflow-list'),'No workflows configured yet. Create one in a folder on the desktop.');
}
$('refresh-issues').onclick=()=>void refreshIssues(true);
$('issue-project').onchange=()=>{issueProject=$('issue-project').value;issueAttempt=0;issueError='';cache();renderIssues();void refreshIssues(true);};
