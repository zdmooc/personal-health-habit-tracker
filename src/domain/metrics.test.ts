import { describe, expect, it } from 'vitest';
import { activeEvents, parisDay, type HabitEvent } from './model';
import { statsFor } from './metrics';
const base=(id:string,occurredAt:string|null):HabitEvent=>({id,kind:'cigarette',day:'2026-10-25',occurredAt,precision:occurredAt?'minute':'unknown',createdAt:'2026-10-25T10:00:00Z',deviceId:'test',source:'import',quantity:1});
describe('métier',()=>{
  it('respecte le changement heure hiver Europe/Paris',()=>{expect(parisDay(new Date('2026-10-24T22:21:00Z'))).toBe('2026-10-25');});
  it('calcule les intervalles par timestamp UTC',()=>{
    const arr=[base('a','2026-10-25T09:37:00Z'),base('b','2026-10-25T10:39:00Z'),base('c','2026-10-25T11:41:00Z')];
    const s=statsFor(arr,'2026-10-25');expect(s.avgMinutes).toBe(62);expect(s.atLeastGoal).toBe(2);
  });
  it('refuse une moyenne lorsque les heures sont incomplètes',()=>{expect(statsFor([base('a',null),base('b','2026-10-25T09:37:00Z')],'2026-10-25').avgMinutes).toBeNull();});
  it('applique les annulations sans détruire le journal',()=>{
    const a=base('a','2026-10-25T09:37:00Z');
    const retract:HabitEvent={...a,id:'cancel',kind:'retract',targetId:'a'};
    expect(activeEvents([a,retract])).toHaveLength(0);
  });
});
