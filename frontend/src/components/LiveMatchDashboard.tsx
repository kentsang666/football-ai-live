import { useEffect, useState } from 'react';
import { Activity, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { MatchCard } from './MatchCard';
import { matchStore } from '../store/matchStore';
import type { MatchState, MatchEvent, PredictionData } from '../store/matchStore';

// ===========================================
// 云端部署配置 - 运行时环境检测
// ===========================================
// 通过 window.location.hostname 判断是否为生产环境
// 生产环境使用 Railway 后端，开发环境使用本地后端
const getSocketUrl = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';
    console.log('🔧 Hostname:', hostname);
    console.log('🔧 Is Production:', isProduction);
    return isProduction 
      ? 'https://football-ai-live-production.up.railway.app'
      : 'http://localhost:4000';
  }
  return 'http://localhost:4000';
};

const SOCKET_URL = getSocketUrl();
console.log('🔧 WebSocket URL:', SOCKET_URL);

export function LiveMatchDashboard() {
  const [, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [matches, setMatches] = useState<MatchState[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  // 初始化 WebSocket 连接
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('✅ WebSocket 已连接');
      setConnected(true);
      // 连接成功后获取初始比赛列表
      fetchInitialMatches();
    });

    newSocket.on('disconnect', () => {
      console.log('❌ WebSocket 已断开');
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

    setSocket(newSocket);

    // 订阅 store 变化
    const unsubscribe = matchStore.subscribe(() => {
      setMatches(matchStore.getAllMatches());
    });

    return () => {
      newSocket.close();
      unsubscribe();
    };
  }, []);

  // 获取初始比赛列表
  const fetchInitialMatches = async () => {
    try {
      const response = await fetch(`${SOCKET_URL}/api/matches/live`);
      const data = await response.json();
      console.log('📋 初始比赛列表:', data);
      if (data.matches && Array.isArray(data.matches)) {
        matchStore.setMatches(data.matches);
      }
    } catch (error) {
      console.error('获取比赛列表失败:', error);
    }
  };

  // 手动刷新
  const handleRefresh = () => {
    fetchInitialMatches();
  };

  const liveCount = matches.filter(m => m.status === 'live' || m.status === 'halftime').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* 头部 */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 text-green-400" />
            <div>
              <h1 className="text-xl font-bold text-white">实时足球比分</h1>
              <p className="text-xs text-slate-400">Football Prediction System v2.1</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* 刷新按钮 */}
            <button 
              onClick={handleRefresh}
              className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 transition-colors"
              title="刷新比赛列表"
            >
              <RefreshCw className="w-4 h-4 text-slate-300" />
            </button>

            {/* 连接状态 */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
              connected 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-red-500/20 text-red-400'
            }`}>
              {connected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              <span>{connected ? '实时连接' : '连接断开'}</span>
            </div>
          </div>
        </header>

        {/* 统计信息 */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <div className="text-2xl font-bold text-green-400">{liveCount}</div>
            <div className="text-xs text-slate-400">进行中</div>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <div className="text-2xl font-bold text-white">{matches.length}</div>
            <div className="text-xs text-slate-400">总比赛数</div>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <div className="text-sm font-medium text-slate-300 truncate">
              {lastUpdate || '--:--:--'}
            </div>
            <div className="text-xs text-slate-400">最后更新</div>
          </div>
        </div>

        {/* 比赛列表 */}
        {matches.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {matches.map((match) => (
              <MatchCard key={match.match_id} match={match} />
            ))}
          </div>
        ) : (
          <div className="bg-slate-800/50 rounded-xl p-12 border border-slate-700/50 text-center">
            <Activity className="w-12 h-12 text-slate-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-300 mb-2">暂无比赛数据</h3>
            <p className="text-sm text-slate-500">
              {connected 
                ? '等待比赛数据...' 
                : '正在连接服务器...'}
            </p>
          </div>
        )}

        {/* 底部信息 */}
        <footer className="mt-8 text-center text-xs text-slate-500">
          <div className="flex items-center justify-center gap-4">
            <span>⚡ 零延迟比分更新</span>
            <span>🤖 AI 实时预测</span>
            <span>💾 数据持久化</span>
          </div>
          <div className="mt-2">Football Prediction System v2.1 - 多场比赛实时监控</div>
        </footer>
      </div>
    </div>
  );
}
