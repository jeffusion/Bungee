import { statsCollector } from '../collectors/stats-collector';
import type { StatsHistory } from '../types';

export class StatsHandler {
  static getSnapshot(): Response {
    const snapshot = statsCollector.getSnapshot();
    return new Response(JSON.stringify(snapshot), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  static getHistory(req: Request): Response {
    const url = new URL(req.url);
    const interval = url.searchParams.get('interval') || '10s';

    const history = statsCollector.getHistory();

    // 根据interval参数采样数据
    let sampledHistory = history;
    if (interval === '1m') {
      sampledHistory = this.sampleData(history, 6); // 每6个点取1个
    } else if (interval === '5m') {
      sampledHistory = this.sampleData(history, 30); // 每30个点取1个
    }

    const result: StatsHistory = {
      timestamps: sampledHistory.map(h => h.timestamp),
      requests: sampledHistory.map(h => h.totalRequests),
      errors: sampledHistory.map(h => h.errors),
      responseTime: sampledHistory.map(h => h.averageResponseTime)
    };

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private static sampleData<T>(data: T[], step: number): T[] {
    if (step <= 1) return data;
    return data.filter((_, index) => index % step === 0);
  }
}
