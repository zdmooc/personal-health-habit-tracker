export type EventKind = 'cigarette' | 'coffee' | 'craving' | 'patch_on' | 'patch_off' | 'lozenge' | 'sleep' | 'retract';
export type Context = 'cafe' | 'repas' | 'stress' | 'habitude' | 'marche' | 'alcool' | 'concentration' | 'autre';
export type Precision = 'minute' | 'approx' | 'unknown';
export interface HabitEvent {
  id: string;
  kind: EventKind;
  day: string; // Date du calendrier Europe/Paris, non date UTC
  occurredAt: string | null; // ISO 8601 UTC ou null si heure inconnue
  precision: Precision;
  createdAt: string;
  deviceId: string;
  source: 'device' | 'import';
  quantity: number;
  context?: Context;
  note?: string;
  doseMg?: number;
  durationMinutes?: number;
  targetId?: string; // Retract/annulation non destructive
  sequence?: number; // Position historique, sans inventer l'heure
}
const dayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
export function parisDay(date: Date = new Date()): string {
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
export function parisTime(iso: string | null | undefined): string {
  if (!iso) return 'Heure inconnue';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Heure inconnue' : new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(d);
}
export function newEvent(kind: EventKind, deviceId: string, extra: Partial<HabitEvent> = {}): HabitEvent {
  const now = new Date();
  return { id: crypto.randomUUID(), kind, day: parisDay(now), occurredAt: now.toISOString(), precision: 'minute', createdAt: now.toISOString(), deviceId, source: 'device', quantity: 1, ...extra };
}
export function activeEvents(all: HabitEvent[]): HabitEvent[] {
  const cancelled = new Set(all.filter(e => e.kind === 'retract' && e.targetId).map(e => e.targetId));
  return all.filter(e => e.kind !== 'retract' && !cancelled.has(e.id));
}
