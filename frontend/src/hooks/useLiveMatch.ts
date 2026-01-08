import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { matchStore } from '../store/matchStore';
import type { MatchState, MatchEvent, PredictionData } from '../store/matchStore';

// 导出类型供其他组件使用
export type { MatchState, MatchEvent, PredictionData };

// ===========================================
// 云端部署配置 - 硬编码生产环境 URL
// ===========================================
// 由于 Vite 环境变量配置问题，直接硬编码 URL
// 生产环境检测：window.location.hostname 不是 localhost
const isProduction = typeof window !== 'undefined' && 
  window.location.hostname !== 'localhost' && 
  window.location.hostname !== '127.0.0.1';

// 生产环境使用 Railway 后端，开发环境使用本地后端
const SOCKET_URL = isProduction 
  ? 'https://football-ai-live-production.up.railway.app'
  : 'http://localhost:4000';

// 调试信息
console.log('🔧 Is Production:', isProduction);
console.log('🔧 Hostname:', typeof window !== 'undefined' ? window.location.hostname : 'N/A');
console.log('🔧 WebSocket URL:', SOCKET_URL);

interface UseLiveMatchReturn {
  matches: MatchState[];
  connected: boolean;
  liveCount: number;
  totalCount: number;
  lastUpdate: string;
  refresh: () => void;
}

export function useLiveMatch(): UseLiveMatchReturn {
  const [, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [matches, setMatches] = useState<MatchState[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  // 获取初始比赛列表
  const fetchInitialMatches = useCallback(async () => {
    try {
      console.log('📡 Fetching matches from:', `${SOCKET_URL}/api/matches/live`);
      const response = await fetch(`${SOCKET_URL}/api/matches/live`);
      const data = await response.json();
      console.log('📋 获取比赛列表:', data);
      if (data.matches && Array.isArray(data.matches)) {
        matchStore.setMatches(data.matches);
      }
    } catch (error) {
      console.error('获取比赛列表失败:', error);
    }
  }, []);

  // 初始化 WebSocket 连接
  useEffect(() => {
    console.log('🔌 Connecting to WebSocket:', SOCKET_URL);
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      path: '/socket.io',
      forceNew: true,
    });

    newSocket.on('connect', () => {
      console.log('✅ WebSocket 已连接');
      setConnected(true);
      fetchInitialMatches();
    });

    newSocket.on('disconnect', (reason) => {
      console.log('❌ WebSocket 已断开:', reason);
      setConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('WebSocket 连接错误:', error.message);
      setConnected(false);
    });

    // 监听比分更新事件
    newSocket.on('score_update', (event: MatchEvent) => {
      console.log('📊 收到比分更新:', event);
      matchStore.updateMatch(event);
      setLastUpdate(new Date().toLocaleTimeString());
    });

    // 监听 AI 预测更新事件
    newSocket.on('prediction_update', (prediction: PredictionData) => {
      console.log('🤖 收到预测更新:', prediction);
      matchStore.updatePrediction(prediction);
    });

    // 监听批量比赛更新
    newSocket.on('matches_update', (matchList: MatchState[]) => {
      console.log('📋 收到批量比赛更新:', matchList.length);
      matchStore.setMatches(matchList);
      setLastUpdate(new Date().toLocaleTimeString());
    });

    setSocket(newSocket);

    // 订阅 store 变化
    const unsubscribe = matchStore.subscribe(() => {
      setMatches(matchStore.getAllMatches());
    });

    // 定期清理已结束的比赛
    const cleanupInterval = setInterval(() => {
      matchStore.cleanupFinished();
    }, 60000);

    return () => {
      newSocket.close();
      unsubscribe();
      clearInterval(cleanupInterval);
    };
  }, [fetchInitialMatches]);

  // 计算统计数据
  const liveCount = matches.filter(
    m => m.status === 'live' || m.status === 'halftime'
  ).length;

  return {
    matches,
    connected,
    liveCount,
    totalCount: matches.length,
    lastUpdate,
    refresh: fetchInitialMatches,
  };
}
