import { writable } from 'svelte/store';
import type { StatsSnapshot } from '../types';

// 统计数据状态
export const statsStore = writable<StatsSnapshot | null>(null);

// 是否正在加载
export const statsLoading = writable<boolean>(false);

// 统计错误
export const statsError = writable<string | null>(null);

// 统计操作辅助函数
export const statsActions = {
  // 设置统计数据
  setStats(stats: StatsSnapshot) {
    statsStore.set(stats);
    statsError.set(null);
  },

  // 设置加载状态
  setLoading(loading: boolean) {
    statsLoading.set(loading);
  },

  // 设置错误
  setError(error: string | null) {
    statsError.set(error);
  },

  // 清空统计
  clear() {
    statsStore.set(null);
    statsError.set(null);
    statsLoading.set(false);
  }
};
