import { describe, expect, it } from 'vitest';
import { parseImport } from './journal';
import { statsFor } from '../domain/metrics';

describe('migration JSON',()=>{
  const input={
    format:'declic-historique-migration-source',
    historique:[
      {date:'2026-10-23',cigarettes:[{numero:1,heure_locale:'2026-10-23T15:52',occurredAt_utc:'2026-10-23T13:52:00Z'}],envies:{episodes_non_concretises_sur_le_moment:3}},
      {date:'2026-10-24',cigarettes:[{numero:1,heure_locale:null},{numero:2,heure_locale:'2026-10-24T10:25',occurredAt_utc:'2026-10-24T08:25:00Z'}],cafes:{nombreMinimumDeclare:7}}
    ],
    jourEnCours:{date:'2026-10-26',cigarettes:[{numero:1,heure_locale:null}],cafes:{nombreDeclare:4}}
  };
  it('importe uniquement les événements confirmés sans inventer d’heure',()=>{
    const events=parseImport(input,'device-test');
    const count=events.filter(e=>e.kind==='cigarette').length;
    expect(count).toBe(4);
    expect(events.find(e=>e.id==='historique:2026-10-24:cigarette:1')?.occurredAt).toBeNull();
    expect(statsFor(events,'2026-10-24').avgMinutes).toBeNull();
    expect(statsFor(events,'2026-10-24').coffees).toBe(7);
    expect(statsFor(events,'2026-10-26').coffees).toBe(4);
  });
  it('attribue des identifiants stables pour éviter les doublons au réimport',()=>{
    expect(parseImport(input,'test1').map(e=>e.id)).toEqual(parseImport(input,'test2').map(e=>e.id));
  });
  it('refuse les fichiers non reconnus',()=>expect(()=>parseImport({format:'autre'},'test')).toThrow());
});
