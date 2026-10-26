import { activeEvents, type HabitEvent } from '../domain/model';
import { insightsFor, statsFor } from '../domain/metrics';

export interface CoachResponse { kind: 'local'|'remote'; message: string }
export function localCoach(events: HabitEvent[], day: string, goal: number): CoachResponse {
  const data=statsFor(events,day,goal);
  const findings=insightsFor(events,day,goal);
  return {kind:'local',message:'Bilan du '+day+' : '+data.cigarettes+' cigarettes, '+data.coffees+' cafés, '+data.cravings+' envies signalées.\n'+findings.map(i=>'• '+i.title+' : '+i.detail).join('\n')+'\nLes données ne permettent pas un diagnostic médical.'};
}
// Port Strategy : fournisseur IA optionnel, hors du domaine métier.
// Envoi EXPLICITE uniquement d'agrégats, jamais du journal individuel ni du texte médical.
export async function remoteCoach(events: HabitEvent[], day: string, goal: number, endpoint: string): Promise<CoachResponse> {
  const url=new URL(endpoint);
  if (url.protocol!=='https:' && url.hostname!=='localhost') throw new Error('Le service IA doit être accessible en HTTPS.');
  const data=statsFor(events,day,goal);
  const contexts=activeEvents(events).filter(e=>e.day===day && e.kind==='cigarette').reduce<Record<string,number>>((acc,e)=>{
    const k=e.context??'non_precise';acc[k]=(acc[k]??0)+1;return acc;
  },{});
  const res=await fetch(url.toString(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:day,cigarettes:data.cigarettes,cafes:data.coffees,envies:data.cravings,objectifMinutes:goal,contexts,consigne:'Analyse comportementale factuelle, sans diagnostic ni prescription.'})});
  if(!res.ok) throw new Error('Service IA indisponible ('+res.status+').');
  const answer=await res.json() as {message?:string};
  if(typeof answer.message!=='string') throw new Error('Réponse IA invalide.');
  return {kind:'remote',message:answer.message};
}
