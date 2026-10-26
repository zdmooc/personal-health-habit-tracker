import Dexie, { type EntityTable } from 'dexie';
import type { HabitEvent } from '../domain/model';

export interface RawBackup { id: string; name: string; importedAt: string; content: string }
export interface Setting { key: string; value: string }
class HabitDatabase extends Dexie {
  events!: EntityTable<HabitEvent,'id'>;
  backups!: EntityTable<RawBackup,'id'>;
  settings!: EntityTable<Setting,'key'>;
  constructor() {
    super('personal-health-habit-tracker');
    this.version(1).stores({ events: 'id,day,kind,deviceId,createdAt', backups:'id', settings:'key' });
  }
}
export const db = new HabitDatabase();
export function deviceId(): string {
  let id = localStorage.getItem('pht-device');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('pht-device',id); }
  return id;
}
export async function append(event: HabitEvent): Promise<void> { await db.events.put(event); }
export async function appendMany(events: HabitEvent[]): Promise<void> { await db.events.bulkPut(events); }
export async function getSetting(key: string): Promise<string | null> { return (await db.settings.get(key))?.value ?? null; }
export async function setSetting(key: string,value: string): Promise<void> { await db.settings.put({key,value}); }
