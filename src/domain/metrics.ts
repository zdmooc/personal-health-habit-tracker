import { activeEvents, parisDay, type HabitEvent } from './model';

export interface DayStats {
  day: string; cigarettes: number; coffees: number; cravings: number; lozenges: number;
  avgMinutes: number | null; validIntervals: number; atLeastGoal: number; lastCigarette: HabitEvent | null;
  targetAt: number | null; patchActive: boolean; patchAppliedAt: string | null;
}
export function statsFor(all: HabitEvent[], day: string = parisDay(), goal = 60): DayStats {
  const active = activeEvents(all);
  const daily = active.filter(e => e.day === day);
  const take = (kind: HabitEvent['kind']) => daily.filter(e => e.kind === kind);
  const cigarettes = take('cigarette');
  const chronological = [...cigarettes].sort((a,b) => {
    if (a.occurredAt && b.occurredAt) return a.occurredAt.localeCompare(b.occurredAt);
    return (a.sequence ?? 0) - (b.sequence ?? 0);
  });
  const unknown = chronological.some(e => !e.occurredAt);
  const timed = chronological.filter(e => e.occurredAt);
  const gaps: number[] = [];
  // Pas de moyenne trompeuse lorsqu'une cigarette de la journée a une heure inconnue.
  if (!unknown) for (let i = 1; i < timed.length; i++) {
    const delta = (new Date(timed[i].occurredAt!).getTime() - new Date(timed[i-1].occurredAt!).getTime()) / 60000;
    if (delta >= 0) gaps.push(delta);
  }
  const mostRecent = [...timed].sort((a,b) => b.occurredAt!.localeCompare(a.occurredAt!))[0] ?? null;
  const unknownAfterLast = mostRecent?.sequence != null && chronological.some(e => !e.occurredAt && e.sequence != null && e.sequence > mostRecent.sequence!);
  const patchEvents = active.filter(e => e.kind === 'patch_on' || e.kind === 'patch_off').filter(e => e.occurredAt)
    .sort((a,b) => a.occurredAt!.localeCompare(b.occurredAt!));
  const patch = patchEvents.at(-1);
  return {
    day,
    cigarettes: cigarettes.reduce((v,e) => v + e.quantity, 0),
    coffees: take('coffee').reduce((v,e) => v + e.quantity, 0),
    cravings: take('craving').reduce((v,e) => v + e.quantity, 0),
    lozenges: take('lozenge').reduce((v,e) => v + e.quantity, 0),
    avgMinutes: gaps.length ? gaps.reduce((a,b)=>a+b,0)/gaps.length : null,
    validIntervals: gaps.length, atLeastGoal: gaps.filter(n=>n>=goal).length,
    lastCigarette: mostRecent,
    targetAt: mostRecent?.occurredAt && !unknownAfterLast ? Date.parse(mostRecent.occurredAt) + goal*60000 : null,
    patchActive: patch?.kind === 'patch_on',
    patchAppliedAt: patch?.kind === 'patch_on' ? patch.occurredAt : null
  };
}
export interface Insight { title: string; detail: string; level: 'normal' | 'attention' }
export function insightsFor(all: HabitEvent[], day: string, goal = 60): Insight[] {
  const events = activeEvents(all).filter(e=>e.day===day);
  const data = statsFor(all,day,goal);
  const results: Insight[] = [];
  const coffeeRelated = events.filter(e=>e.kind==='cigarette' && e.context==='cafe').length;
  if (coffeeRelated>=2) results.push({title:'Association café–cigarette',detail:coffeeRelated+' cigarettes associées au café. Essayer une boisson sans caféine pour rompre le rituel.',level:'attention'});
  if (data.validIntervals && data.atLeastGoal<data.validIntervals) results.push({title:'Intervalles courts',detail:(data.validIntervals-data.atLeastGoal)+' intervalle(s) inférieur(s) à '+goal+' minutes.',level:'attention'});
  if (data.validIntervals && data.atLeastGoal===data.validIntervals) results.push({title:'Palier respecté',detail:'Tous les intervalles calculables atteignent '+goal+' minutes.',level:'normal'});
  if (data.cravings) results.push({title:'Envies observées',detail:data.cravings+' signalement(s) ; une envie déclarée ne signifie pas qu’elle a été résistée.',level:'normal'});
  if (!results.length) results.push({title:'Suivi',detail:'Ajoute des événements pour obtenir des tendances. Aucune analyse médicale automatique.',level:'normal'});
  return results;
}
