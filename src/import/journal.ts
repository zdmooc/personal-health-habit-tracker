import type { HabitEvent, EventKind, Context } from '../domain/model';
import { appendMany, db, deviceId } from '../storage/db';

interface Raw { [key: string]: unknown }
const object = (x: unknown): Raw => x && typeof x === 'object' && !Array.isArray(x) ? x as Raw : {};
const arr = (x: unknown): unknown[] => Array.isArray(x) ? x : [];
const str = (x: unknown): string => typeof x === 'string' ? x : '';
const num = (x: unknown): number => typeof x === 'number' && Number.isFinite(x) ? Math.max(0,x) : 0;
const todayIso = (): string => new Date().toISOString();
const kinds: EventKind[] = ['cigarette','coffee','craving','patch_on','patch_off','lozenge','sleep','retract'];
function timeOf(record: Raw): string | null {
  const utc = str(record.occurredAt_utc);
  if (utc && !Number.isNaN(Date.parse(utc))) return new Date(utc).toISOString();
  const local = str(record.heure_locale);
  if (/Z$|[+-]\d\d:\d\d$/.test(local) && !Number.isNaN(Date.parse(local))) return new Date(local).toISOString();
  return null; // Une heure sans fuseau précis n'est pas inventée
}
function archiveEvent(day: string, sequence: number, record: Raw, device: string): HabitEvent {
  const t=timeOf(record);
  const rawContext=str(record.contexte);
  const allowed = ['cafe','repas','stress','habitude','marche','alcool','concentration','autre'];
  return {
    id:'historique:'+day+':cigarette:'+sequence, kind:'cigarette', day,
    occurredAt:t, precision:!t?'unknown':str(record.precision).includes('env')?'approx':'minute',
    createdAt:t??todayIso(),deviceId:device,source:'import',quantity:1, sequence,
    context:allowed.includes(rawContext)?rawContext as Context:undefined,
    note:str(record.note)||undefined
  };
}
export function parseImport(raw: unknown, device = deviceId()): HabitEvent[] {
  const json=object(raw);
  if (json.format==='personal-health-habit-tracker') {
    return arr(json.events).map(e=>object(e)).filter(e=>kinds.includes(str(e.kind) as EventKind) && !!str(e.id) && /^\d{4}-\d\d-\d\d$/.test(str(e.day)))
      .map(e=>({
        id:str(e.id), kind:e.kind as EventKind, day:str(e.day), occurredAt:e.occurredAt===null?null:str(e.occurredAt)||null,
        precision:(['minute','approx','unknown'].includes(str(e.precision))?e.precision:'unknown') as HabitEvent['precision'],
        createdAt:str(e.createdAt)||todayIso(),deviceId:str(e.deviceId)||device,
        source:e.source==='import'?'import':'device',
        quantity:num(e.quantity)||1, context:e.context as Context|undefined,
        note:str(e.note)||undefined,doseMg:typeof e.doseMg==='number'?e.doseMg:undefined,
        durationMinutes:typeof e.durationMinutes==='number'?e.durationMinutes:undefined,
        targetId:str(e.targetId)||undefined,sequence:typeof e.sequence==='number'?e.sequence:undefined
      }));
  }
  if (json.format!=='declic-historique-migration-source') throw new Error('Format inconnu : utiliser un export Habit Tracker ou le JSON de migration Declic.');
  const historical=[...arr(json.historique),...(json.jourEnCours?[json.jourEnCours]:[])];
  const result: HabitEvent[]=[];
  for (const item of historical) {
    const d=object(item);
    const day=str(d.date);
    if (!/^\d{4}-\d\d-\d\d$/.test(day)) continue;
    const cigarettes=arr(d.cigarettes);
    for (const [idx,c] of cigarettes.entries()) result.push(archiveEvent(day, num(object(c).numero)||idx+1, object(c), device));
    const coffee=object(d.cafes);
    const count=num(coffee.nombreDeclare ?? coffee.nombreMinimumDeclare);
    if (count) result.push({id:'historique:'+day+':cafes',kind:'coffee',day,occurredAt:null,precision:'unknown',createdAt:todayIso(),deviceId:device,source:'import',quantity:count,note:'Total déclaré ; heures non importables individuellement'});
    const craving=object(d.envies);
    const n=num(craving.signalements ?? craving.signalementsExplicites ?? craving.signalements_minimum ?? craving.episodes_non_concretises_sur_le_moment);
    if (n) result.push({id:'historique:'+day+':envies',kind:'craving',day,occurredAt:null,precision:'unknown',createdAt:todayIso(),deviceId:device,source:'import',quantity:n,note:'Signalements historiques, pas tous résistés'});
    for (const [i,rawPatch] of arr(d.substituts).entries()) {
      const patch=object(rawPatch);
      const kind:EventKind=str(patch.type)==='PatchPose'?'patch_on':'patch_off';
      const local=str(patch.heure_locale);
      const offset=day==='2026-10-25'?'+01:00':'+02:00';
      const parsed=local&&!Number.isNaN(Date.parse(local+offset))?new Date(local+offset).toISOString():null;
      result.push({id:'historique:'+day+':patch:'+i,kind,day,occurredAt:parsed,precision:parsed?'approx':'unknown',createdAt:parsed??todayIso(),deviceId:device,source:'import',quantity:1,doseMg:num(patch.dosageMg)||undefined});
    }
  }
  return result;
}
export async function importFile(file: File): Promise<number> {
  const content=await file.text();
  const raw=JSON.parse(content) as unknown;
  const events=parseImport(raw);
  const bytes=new TextEncoder().encode(content);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  await db.transaction('rw',db.events,db.backups, async()=>{
    await appendMany(events);
    await db.backups.put({id:hash,name:file.name,importedAt:todayIso(),content});
  });
  return events.length;
}
export async function exportFile(): Promise<void> {
  const data={format:'personal-health-habit-tracker',version:1,exportedAt:todayIso(),events:await db.events.toArray(),rawSources:await db.backups.toArray()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='mes-habitudes-'+new Date().toISOString().slice(0,10)+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
