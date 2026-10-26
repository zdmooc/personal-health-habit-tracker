import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity, Cloud, CloudOff, Coffee, Download, HeartPulse, Moon, Plus,
  RefreshCw, Save, Settings2, ShieldCheck, Sparkles, Trash2, Upload, Wind
} from 'lucide-react';
import { activeEvents, newEvent, parisDay, parisTime, type Context, type EventKind, type HabitEvent } from './domain/model';
import { insightsFor, statsFor } from './domain/metrics';
import { append, db, deviceId, getSetting, setSetting } from './storage/db';
import { exportFile, importFile } from './import/journal';
import { authorizeDrive, isDriveConfigured, isDriveConnected, syncDrive } from './sync/drive';
import { localCoach, remoteCoach } from './ai/coach';

const contexts: {id:Context;label:string}[]=[
  {id:'habitude',label:'Habitude'}, {id:'cafe',label:'Café'}, {id:'repas',label:'Après repas'},
  {id:'stress',label:'Stress'}, {id:'marche',label:'Marche'}, {id:'alcool',label:'Alcool'},
  {id:'concentration',label:'Concentration'}, {id:'autre',label:'Autre'}
];
const labels:Record<EventKind,string> = {
  cigarette:'Cigarette',coffee:'Café',craving:'Envie',patch_on:'Patch posé',
  patch_off:'Patch retiré',lozenge:'Pastille',sleep:'Sommeil',retract:'Annulation'
};
function dayOffset(days:number):string {
  const d=new Date();d.setDate(d.getDate()+days);return parisDay(d);
}
function minutesLabel(minutes:number|null):string {return minutes===null?'—':Math.round(minutes*10)/10+' min';}
function timeUntil(target:number|null,now:number):{text:string;done:boolean} {
  if(!target)return {text:'À calculer',done:false};
  const gap=Math.ceil((target-now)/60000);
  if(gap<=0)return {text:'Objectif atteint',done:true};
  return {text:Math.floor(gap/60)>0?Math.floor(gap/60)+' h '+String(gap%60).padStart(2,'0')+' min':gap+' min',done:false};
}
function DownloadLink({onClick,label}:{onClick:()=>void;label:string}) {
  return <button className="utility" onClick={onClick}><Download size={16}/>{label}</button>;
}
export default function App() {
  const all=useLiveQuery(()=>db.events.toArray(),[],[])??[];
  const [day,setDay]=useState(parisDay());
  const [goal,setGoal]=useState(60);
  const [context,setContext]=useState<Context>('habitude');
  const [note,setNote]=useState('');
  const [clock,setClock]=useState(Date.now());
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [connected,setConnected]=useState(false);
  const [lastSync,setLastSync]=useState<string|null>(null);
  const [coachText,setCoachText]=useState('');
  const [shareWithAI,setShareWithAI]=useState(false);
  const [sleepH,setSleepH]=useState('8');
  const [sleepM,setSleepM]=useState('00');
  const [sleepScore,setSleepScore]=useState('');
  const [showSettings,setShowSettings]=useState(false);
  const importRef=useRef<HTMLInputElement>(null);
  const ownToday=day===parisDay();
  const active=useMemo(()=>activeEvents(all),[all]);
  const stats=useMemo(()=>statsFor(all,day,goal),[all,day,goal]);
  const notices=useMemo(()=>insightsFor(all,day,goal),[all,day,goal]);
  const remaining=timeUntil(stats.targetAt,clock);
  const ordered=useMemo(()=>active.filter(e=>e.day===day).sort((a,b)=>{
    if(!a.occurredAt)return 1;if(!b.occurredAt)return -1;
    return b.occurredAt.localeCompare(a.occurredAt);
  }),[active,day]);
  const chart=useMemo(()=>Array.from({length:7},(_,i)=>{
    const d=dayOffset(i-6);return {date:d,value:statsFor(all,d,goal).cigarettes};
  }),[all,goal]);
  const peak=Math.max(1,...chart.map(c=>c.value));
  useEffect(()=>{
    void getSetting('goal').then(x=>{if(x&&Number(x)>=15&&Number(x)<=480)setGoal(Number(x));});
    void getSetting('lastSync').then(setLastSync);
    const timer=setInterval(()=>setClock(Date.now()),15000);
    const onFocus=()=>{if(document.visibilityState==='visible')setClock(Date.now());};
    document.addEventListener('visibilitychange',onFocus);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',onFocus);};
  },[]);
  useEffect(()=>{
    const timer=setInterval(()=>{if(isDriveConnected())void syncDrive().then(r=>{setLastSync(new Date().toISOString());setNotice('Drive à jour : '+r.total+' événements.');}).catch(()=>{});},60000);
    return ()=>clearInterval(timer);
  },[]);
  async function add(kind:EventKind,extra:Partial<HabitEvent>={}) {
    try {
      if(kind==='patch_on' && stats.patchActive) {
        if(!window.confirm('Confirmer que tu as retiré l’ancien patch avant d’en poser un nouveau ?'))return;
        await append(newEvent('patch_off',deviceId()));
      }
      await append(newEvent(kind,deviceId(),{
        ...(kind==='cigarette'||kind==='craving'?{context}:{}),
        ...(note.trim()?{note:note.trim()}:{}),...extra
      }));
      setNote('');setClock(Date.now());setNotice(labels[kind]+' enregistré(e) localement.');
      if(isDriveConnected())void syncDrive().then(()=>setLastSync(new Date().toISOString())).catch(()=>setNotice('Enregistré localement ; synchronisation à relancer.'));
    }catch(e){setNotice(String(e));}
  }
  async function undo(e:HabitEvent) {
    if(!window.confirm('Annuler cette entrée ? La correction restera dans l’historique.'))return;
    await append(newEvent('retract',deviceId(),{day:e.day,targetId:e.id}));
    setNotice('Entrée annulée sans suppression de l’historique.');
    if(isDriveConnected())void syncDrive().then(()=>setLastSync(new Date().toISOString())).catch(()=>{});
  }
  async function importJson(file:File|undefined) {
    if(!file)return;
    try{
      const count=await importFile(file);
      setNotice(count+' événements importés. Réimporter le même fichier ne crée pas de doublon.');
    }catch(e){setNotice(e instanceof Error?e.message:String(e));}
    if(importRef.current)importRef.current.value='';
  }
  async function sync() {
    setBusy(true);
    try{
      if(!isDriveConnected())await authorizeDrive();
      setConnected(true);
      const result=await syncDrive();
      setLastSync(new Date().toISOString());
      setNotice('Google Drive synchronisé : '+result.total+' événements ('+result.uploaded+' envoyés).');
    }catch(e){setNotice(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function changeGoal(value:string){
    const parsed=Math.min(480,Math.max(15,Number(value)||60));
    setGoal(parsed);await setSetting('goal',String(parsed));
  }
  async function saveSleep(){
    const duration=(Number(sleepH)||0)*60+(Number(sleepM)||0);
    if(duration<=0||duration>1440){setNotice('Durée de sommeil invalide.');return;}
    await add('sleep',{durationMinutes:duration,note:sleepScore?'Score de montre : '+sleepScore+'/100':undefined});
  }
  async function askCoach(remote=false) {
    setBusy(true);
    try{
      const answer=remote
        ? await remoteCoach(all,day,goal,import.meta.env.VITE_AI_ENDPOINT||'')
        : localCoach(all,day,goal);
      setCoachText(answer.message);
    }catch(e){setCoachText(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  return <main className="app">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><HeartPulse size={24}/></div><div><div className="brand-title">Mes habitudes</div><div className="brand-sub">Suivi personnel · Stockage local</div></div></div>
      <div className="top-actions">
        <span className="offline"><ShieldCheck size={15}/> Privé</span>
        <button className="settings-btn" aria-label="Réglages" onClick={()=>setShowSettings(s=>!s)}><Settings2 size={20}/></button>
      </div>
    </header>
    <div className="shell">
      <div className="page-heading">
        <div><p className="eyebrow">TABLEAU DE BORD</p><h1>Un jour à la fois.</h1><p className="muted">Chaque déclaration compte. Sans jugement, sans données perdues.</p></div>
        <div className="date-controls">
          <label htmlFor="journal-day">Journée</label><input id="journal-day" type="date" value={day} max={parisDay()} onChange={e=>setDay(e.target.value)}/>
        </div>
      </div>
      {notice&&<div role="status" className="notice"><span>{notice}</span><button aria-label="Fermer" onClick={()=>setNotice('')}>×</button></div>}
      {showSettings&&<section className="settings panel"><h2>Réglages</h2>
        <div className="settings-row"><label htmlFor="goal">Intervalle cible (minutes)</label><input id="goal" type="number" min="15" max="480" value={goal} onChange={e=>void changeGoal(e.target.value)}/></div>
        <p className="fine">Les données restent sur cet appareil. Google Drive est facultatif. L'IA externe nécessite un consentement séparé.</p>
      </section>}
      <section className="hero" aria-label="Prochaine cible">
        <div><div className="hero-label"><Activity size={18}/> PROCHAINE CIBLE CIGARETTE</div>
          <div className="hero-time">{stats.targetAt?parisTime(new Date(stats.targetAt).toISOString()):'—'}</div>
          <div className="hero-info">{remaining.done?'Palier atteint. Aucune obligation de fumer.':stats.targetAt?'Dans '+remaining.text:'Enregistre une cigarette horodatée pour démarrer.'}</div>
        </div>
        <div className="goal-badge"><Wind size={19}/><span>Espacement ≥ {goal} min</span></div>
      </section>
      <section className="summary" aria-label="Compteurs de la journée">
        <div className="metric"><div className="metric-label">Cigarettes</div><div className="metric-value">{stats.cigarettes}</div><div className="metric-foot">Objectif : rythme régulier</div></div>
        <div className="metric"><div className="metric-label">Cafés</div><div className="metric-value">{stats.coffees}</div><div className="metric-foot">Déclarés aujourd'hui</div></div>
        <div className="metric"><div className="metric-label">Envies</div><div className="metric-value">{stats.cravings}</div><div className="metric-foot">Signalées, pas forcément résistées</div></div>
        <div className="metric"><div className="metric-label">Intervalle moyen</div><div className="metric-value small">{minutesLabel(stats.avgMinutes)}</div><div className="metric-foot">{stats.atLeastGoal}/{stats.validIntervals} ≥ {goal} minutes</div></div>
      </section>
      <div className="two-columns">
        <section className="panel action-panel"><div className="section-heading"><div><p className="eyebrow">SAISIE IMMÉDIATE</p><h2>J'enregistre</h2></div><span className="tag">{ownToday?'Aujourd’hui':'Archives'}</span></div>
          <div className="field"><label htmlFor="context">Déclencheur cigarette / envie</label>
            <select id="context" value={context} onChange={e=>setContext(e.target.value as Context)}>{contexts.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select>
          </div>
          <div className="action-grid">
            <button className="action-btn primary" disabled={!ownToday} onClick={()=>void add('cigarette')}><Plus size={22}/><span>J'ai fumé</span></button>
            <button className="action-btn lavender" disabled={!ownToday} onClick={()=>void add('craving')}><Activity size={22}/><span>J'ai envie</span></button>
            <button className="action-btn pale" disabled={!ownToday} onClick={()=>void add('coffee')}><Coffee size={22}/><span>Un café</span></button>
            <button className="action-btn pale" disabled={!ownToday} onClick={()=>void add('lozenge',{doseMg:1.5})}><Plus size={22}/><span>Une pastille</span></button>
          </div>
          <div className="field"><label htmlFor="note">Note facultative</label><input id="note" value={note} onChange={e=>setNote(e.target.value)} placeholder="Ex. après les courses, sans envie"/></div>
          <div className="patch-controls"><div><strong>Patch nicotinique</strong><p>{stats.patchActive?'Patch déclaré en place':'Aucun patch actuellement confirmé'}{stats.patchAppliedAt?' · '+parisTime(stats.patchAppliedAt):''}</p></div>
            <div className="button-group"><button disabled={!ownToday} onClick={()=>void add('patch_on',{doseMg:21})}>Posé</button><button disabled={!ownToday||!stats.patchActive} onClick={()=>void add('patch_off')}>Retiré</button></div>
          </div>
          <details className="sleep-details"><summary><Moon size={16}/> Noter le sommeil</summary>
            <div className="sleep-fields"><label>Heures <input type="number" min="0" max="24" value={sleepH} onChange={e=>setSleepH(e.target.value)}/></label><label>Minutes <input type="number" min="0" max="59" value={sleepM} onChange={e=>setSleepM(e.target.value)}/></label><label>Score / 100 <input type="number" min="0" max="100" placeholder="—" value={sleepScore} onChange={e=>setSleepScore(e.target.value)}/></label></div>
            <button disabled={!ownToday} className="utility" onClick={()=>void saveSleep()}><Save size={16}/> Enregistrer le sommeil</button>
          </details>
        </section>
        <section className="panel history-panel"><div className="section-heading"><div><p className="eyebrow">CHRONOLOGIE</p><h2>Événements</h2></div><span className="tag">{ordered.length}</span></div>
          <div className="events-list">
            {ordered.length===0?<div className="empty-state">Aucune entrée sur cette journée.</div>:ordered.slice(0,45).map(e=><div className="event-row" key={e.id}>
              <div className={'event-icon '+e.kind}>{e.kind==='coffee'?<Coffee size={18}/>:e.kind==='sleep'?<Moon size={18}/>:<Activity size={18}/>}</div>
              <div className="event-main"><strong>{labels[e.kind]}{e.quantity>1?' × '+e.quantity:''}</strong>
                <small>{e.context?contexts.find(c=>c.id===e.context)?.label+' · ':''}{e.note??(e.precision==='unknown'?'Heure non renseignée':'')}</small></div>
              <div className="event-time">{parisTime(e.occurredAt)}{e.precision==='approx'?' ≈':''}</div>
              <button className="icon-btn" title="Annuler l’événement" aria-label={'Annuler '+labels[e.kind]} onClick={()=>void undo(e)}><Trash2 size={16}/></button>
            </div>)}
          </div>
        </section>
      </div>
      <div className="two-columns lower">
        <section className="panel"><div className="section-heading"><div><p className="eyebrow">ÉVOLUTION</p><h2>7 derniers jours</h2></div></div>
          <div className="chart">{chart.map(c=><div className="chart-cell" key={c.date}><span className="bar-value">{c.value}</span><div className="bar-track"><div className="bar" style={{height:(c.value/peak*100)+'%'}}/></div><span className="bar-day">{c.date.slice(8)}</span></div>)}</div>
          <div className="fine">La journée actuelle est provisoire. Les historiques incomplets restent identifiés.</div>
        </section>
        <section className="panel"><div className="section-heading"><div><p className="eyebrow">ANALYSE</p><h2>Déclencheurs</h2></div><Sparkles size={20}/></div>
          <div className="insights">{notices.map((i,j)=><div className="insight" key={j}><span className={'insight-mark '+i.level}></span><div><strong>{i.title}</strong><p>{i.detail}</p></div></div>)}</div>
          <button className="utility" onClick={()=>void askCoach()}><Sparkles size={16}/> Bilan local</button>
          {import.meta.env.VITE_AI_ENDPOINT&&<div className="ai-optin"><label><input type="checkbox" checked={shareWithAI} onChange={e=>setShareWithAI(e.target.checked)}/> Autoriser l'envoi des statistiques agrégées à une IA externe</label><button className="utility" disabled={!shareWithAI||busy} onClick={()=>void askCoach(true)}>Analyse IA</button></div>}
          {coachText&&<pre className="coach-output">{coachText}</pre>}
        </section>
      </div>
      <section className="panel sync-panel"><div className="section-heading"><div><p className="eyebrow">MES DONNÉES</p><h2>Sauvegarde et synchronisation</h2></div>{connected?<Cloud size={22}/>:<CloudOff size={22}/>}</div>
        <p className="muted">IndexedDB est prioritaire. Drive fusionne les événements par identifiant, sans remplacer l'historique du PC ou du téléphone.</p>
        <div className="sync-actions">
          <button className="sync-btn" onClick={()=>void sync()} disabled={busy||!isDriveConfigured()}><RefreshCw size={16} className={busy?'spin':''}/>{busy?'Synchronisation…':'Synchroniser Google Drive'}</button>
          <DownloadLink onClick={()=>void exportFile()} label="Exporter JSON"/>
          <button className="utility" onClick={()=>importRef.current?.click()}><Upload size={16}/> Importer JSON</button>
          <input aria-label="Importer fichier JSON" ref={importRef} hidden type="file" accept=".json,application/json" onChange={e=>void importJson(e.target.files?.[0])}/>
        </div>
        {!isDriveConfigured()&&<p className="config-note">Pour activer Drive, renseigner VITE_GOOGLE_CLIENT_ID lors du déploiement.</p>}
        <p className="fine">Dernière synchronisation : {lastSync?new Date(lastSync).toLocaleString('fr-FR'):'jamais'} · Aucun fichier personnel publié dans GitHub.</p>
      </section>
      <footer>Local-First · Données privées · Sans diagnostic médical</footer>
    </div>
  </main>;
}
