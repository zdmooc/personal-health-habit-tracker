import { db, deviceId, getSetting, setSetting } from '../storage/db';
import { parseImport } from '../import/journal';
import type { HabitEvent } from '../domain/model';

interface DriveFile { id: string; name: string; mimeType?: string }
interface DriveFiles { files?: DriveFile[]; nextPageToken?: string }
interface TokenResponse { access_token?: string; expires_in?: number; error?: string }
interface TokenClient { requestAccessToken(options?: { prompt?: string }): void }
interface GIS {
  accounts: { oauth2: { initTokenClient(options: {client_id:string;scope:string;callback:(response:TokenResponse)=>void;error_callback?:(error:unknown)=>void}): TokenClient } };
}
declare global { interface Window { google?: GIS } }
const API='https://www.googleapis.com/drive/v3';
const UPLOAD='https://www.googleapis.com/upload/drive/v3';
const FOLDER='Personal Health Habit Tracker';
let token='';
let tokenExpires=0;
export const isDriveConfigured=()=>Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);
export const isDriveConnected=()=>Boolean(token && Date.now()<tokenExpires);
async function loadGIS():Promise<void> {
  if(window.google?.accounts?.oauth2)return;
  await new Promise<void>((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://accounts.google.com/gsi/client';
    script.async=true;
    script.onload=()=>resolve();script.onerror=()=>reject(new Error('Impossible de charger la connexion Google.'));
    document.head.appendChild(script);
  });
}
export async function authorizeDrive():Promise<void> {
  const clientId=import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if(!clientId) throw new Error('Configurer VITE_GOOGLE_CLIENT_ID dans .env ou GitHub Actions.');
  await loadGIS();
  const response=await new Promise<TokenResponse>((resolve,reject)=>{
    const client=window.google!.accounts.oauth2.initTokenClient({
      client_id:clientId,scope:'https://www.googleapis.com/auth/drive.file',
      callback:resolve,error_callback:()=>reject(new Error('Connexion Google annulée.'))
    });
    client.requestAccessToken({prompt:''});
  });
  if(!response.access_token)throw new Error(response.error||'Autorisation Google refusée.');
  token=response.access_token;
  tokenExpires=Date.now()+Math.max(1,(response.expires_in??3600)-90)*1000;
}
async function request<T>(url:string,init:RequestInit={}):Promise<T> {
  if(!isDriveConnected()) throw new Error('Connexion Drive expirée : cliquer sur Synchroniser.');
  const res=await fetch(url,{...init,headers:{Authorization:'Bearer '+token,...init.headers}});
  if(!res.ok){
    const err=await res.text().catch(()=>res.statusText);
    throw new Error('Drive ('+res.status+') : '+err.slice(0,180));
  }
  return await res.json() as T;
}
async function list(q:string):Promise<DriveFile[]> {
  let pageToken: string|undefined; const all: DriveFile[]=[];
  do {
    const u=new URL(API+'/files');
    u.searchParams.set('q',q);u.searchParams.set('fields','nextPageToken,files(id,name,mimeType)');
    u.searchParams.set('pageSize','1000');
    if(pageToken)u.searchParams.set('pageToken',pageToken);
    const page=await request<DriveFiles>(u.toString());
    all.push(...page.files??[]);pageToken=page.nextPageToken;
  } while(pageToken);
  return all;
}
async function folder():Promise<string> {
  const cached=await getSetting('driveFolder');
  if(cached)return cached;
  const matches=await list("name = '"+FOLDER+"' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const found=matches[0];
  const id=found?.id??(await request<{id:string}>(API+'/files?fields=id',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:FOLDER,mimeType:'application/vnd.google-apps.folder'})
  })).id;
  await setSetting('driveFolder',id);
  return id;
}
async function readEvents(id:string):Promise<HabitEvent[]> {
  const response=await request<{events?:unknown[]}>(API+'/files/'+encodeURIComponent(id)+'?alt=media');
  return parseImport({format:'personal-health-habit-tracker',events:response.events??[]});
}
async function uploadEvents(parent:string,name:string,events:HabitEvent[]):Promise<void> {
  const boundary='pht-'+crypto.randomUUID();
  const metadata=JSON.stringify({name,parents:[parent],mimeType:'application/json'});
  const data=JSON.stringify({format:'personal-health-habit-tracker',version:1,events});
  const payload=new Blob([
    '--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',metadata,
    '\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n',data,
    '\r\n--'+boundary+'--\r\n'
  ],{type:'multipart/related; boundary='+boundary});
  await request(UPLOAD+'/files?uploadType=multipart&fields=id',{
    method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:payload
  });
}
async function replaceEvents(id:string,events:HabitEvent[]):Promise<void> {
  await request(UPLOAD+'/files/'+encodeURIComponent(id)+'?uploadType=media&fields=id',{
    method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({format:'personal-health-habit-tracker',version:1,events})
  });
}
export interface SyncResult { downloaded:number; uploaded:number; total:number }
let running:Promise<SyncResult>|null=null;
async function doSync():Promise<SyncResult> {
  const dest=await folder();
  const files=await list("'"+dest+"' in parents and trashed = false");
  const shards=files.filter(f=>f.name.startsWith('events-') && f.name.endsWith('.json'));
  const remote=new Map<string,{id:string;events:HabitEvent[]}>();
  let downloaded=0;
  for(const f of shards) {
    const items=await readEvents(f.id);
    remote.set(f.name,{id:f.id,events:items});
    if(items.length) { await db.events.bulkPut(items); downloaded+=items.length; }
  }
  // Chaque appareil écrit exclusivement ses propres partitions (appareil/jour).
  const local=(await db.events.toArray()).filter(e=>e.deviceId===deviceId());
  const groups=new Map<string,HabitEvent[]>();
  for(const e of local) {
    const name='events-'+e.day+'-'+deviceId()+'.json';
    const batch=groups.get(name)??[];batch.push(e);groups.set(name,batch);
  }
  let uploaded=0;
  for(const [name,items] of groups) {
    const theirs=remote.get(name);
    const byId=new Map<string,HabitEvent>();
    for(const e of theirs?.events??[])byId.set(e.id,e);
    const size=byId.size;
    for(const e of items)byId.set(e.id,e);
    if(byId.size===size && theirs)continue;
    const merged=[...byId.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    if(theirs)await replaceEvents(theirs.id,merged);
    else await uploadEvents(dest,name,merged);
    uploaded+=items.length;
  }
  await setSetting('lastSync',new Date().toISOString());
  return {downloaded,uploaded,total:await db.events.count()};
}
export async function syncDrive():Promise<SyncResult> {
  if(running)return running;
  running=(async()=>{
    if(navigator.locks) return await navigator.locks.request('personal-health-habit-tracker-drive',async()=>await doSync());
    return await doSync();
  })();
  try{return await running;}finally{running=null;}
}
