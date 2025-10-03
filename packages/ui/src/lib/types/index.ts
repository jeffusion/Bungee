import type { AppConfig } from '@jeffusion/bungee-shared';

export type { AppConfig };

export interface StatsSnapshot {
  totalRequests: number;
  requestsPerSecond: number;
  successRate: number;
  averageResponseTime: number;
  timestamp: string;
}

export interface StatsHistory {
  timestamps: string[];
  requests: number[];
  errors: number[];
  responseTime: number[];
}

export interface SystemInfo {
  version: string;
  uptime: number;
  workers: WorkerInfo[];
}

export interface WorkerInfo {
  workerId: number;
  pid: number;
  status: 'ready' | 'starting' | 'shutting_down' | 'stopped';
  startTime: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}
