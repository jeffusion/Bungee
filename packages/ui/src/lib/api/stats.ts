import { api } from './client';
import type { StatsSnapshot, StatsHistory } from '../types';

export async function getStatsSnapshot(): Promise<StatsSnapshot> {
  return api.get<StatsSnapshot>('/stats');
}

export async function getStatsHistory(interval: '10s' | '1m' | '5m' = '10s'): Promise<StatsHistory> {
  return api.get<StatsHistory>(`/stats/history?interval=${interval}`);
}
