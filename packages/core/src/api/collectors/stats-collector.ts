import type { StatsSnapshot, HistoryEntry } from '../types';

class StatsCollector {
  private requests = 0;
  private errors = 0;
  private responseTimes: number[] = [];
  private history: HistoryEntry[] = [];
  private startTime = Date.now();
  private lastSnapshotTime = Date.now();

  recordRequest(success: boolean, responseTime: number) {
    this.requests++;
    if (!success) this.errors++;
    this.responseTimes.push(responseTime);

    // 保留最近1000个响应时间
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift();
    }

    // 每10秒记录一次历史快照
    const now = Date.now();
    if (now - this.lastSnapshotTime >= 10000) {
      this.saveSnapshot();
      this.lastSnapshotTime = now;
    }
  }

  private saveSnapshot() {
    const snapshot = this.calculateSnapshot();
    this.history.push({
      ...snapshot,
      errors: this.errors
    });

    // 保留最近1小时的数据（360个快照）
    if (this.history.length > 360) {
      this.history.shift();
    }
  }

  private calculateSnapshot(): StatsSnapshot {
    const now = Date.now();
    const uptime = (now - this.startTime) / 1000;
    const qps = uptime > 0 ? this.requests / uptime : 0;
    const successRate = this.requests > 0
      ? ((this.requests - this.errors) / this.requests) * 100
      : 100;
    const avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;

    return {
      totalRequests: this.requests,
      requestsPerSecond: parseFloat(qps.toFixed(2)),
      successRate: parseFloat(successRate.toFixed(2)),
      averageResponseTime: parseFloat(avgResponseTime.toFixed(2)),
      timestamp: new Date().toISOString()
    };
  }

  getSnapshot(): StatsSnapshot {
    return this.calculateSnapshot();
  }

  getHistory(): HistoryEntry[] {
    return this.history;
  }

  reset() {
    this.requests = 0;
    this.errors = 0;
    this.responseTimes = [];
    this.history = [];
    this.startTime = Date.now();
    this.lastSnapshotTime = Date.now();
  }
}

export const statsCollector = new StatsCollector();
