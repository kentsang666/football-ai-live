import { useEffect, useState, useCallback, useRef } from 'react';
import { Activity, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { MatchCard } from './MatchCard';
import { AlertToast } from './AlertToast';
import { DebugPanel } from './DebugPanel';
import { matchStore } from '../store/matchStore';
import { 
  usePredictionAlert, 
  alertSoundManager 
} from '../hooks/usePredictionAlert';
import type { MatchState, MatchEvent, PredictionData } from '../store/matchStore';

// ===========================================
// 云端部署配置 - 运行时环境检测
// ===========================================
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

// ===========================================
// 心跳检测配置
// ===========================================
const HEARTBEAT_INTERVAL = 30000;  // 30秒发送一次心跳
const HEARTBEAT_TIMEOUT = 10000;   // 10秒内未收到响应视为断连
const RECONNECT_INTERVAL = 5000;   // 断连后5秒尝试重连
const MAX_RECONNECT_ATTEMPTS = 10; // 最大重连次数

// ===========================================
// 连接状态类型
// ===========================================
type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | 'error';

export function LiveMatchDashboard() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [matches, setMatches] = useState<MatchState[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [lastHeartbeat, setLastHeartbeat] = useState<string>('');
  const [reconnectCount, setReconnectCount] = useState(0);
  const [connectionLog, setConnectionLog] = useState<string[]>([]);
  
  // 心跳检测相关 refs
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPongTimeRef = useRef<number>(Date.now());

  // 添加连接日志
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`🔌 ${logEntry}`);
    setConnectionLog(prev => [...prev.slice(-19), logEntry]); // 保留最近20条
  }, []);

  // 🔔 集成通知系统
  const {
    activeToasts,
    unreadCount,
    dismissToast,
    clearAllToasts,
    triggerTestAlert,
    isAudioEnabled,
    enableAudio,
    requestNotificationPermission,
    isNotificationGranted,
  } = usePredictionAlert(matches, {
    confidenceThreshold: 0.80,
    valueEdgeThreshold: 0.10,
    toastDuration: 10000,
    soundEnabled: true,
    titleFlashEnabled: true,
    browserNotificationEnabled: true,
  });

  // 用户首次交互时启用音频
  const handleUserInteraction = useCallback(() => {
    if (!alertSoundManager.isEnabled()) {
      alertSoundManager.enableAudio();
      console.log('🔊 用户交互，音频已启用');
    }
  }, []);

  // 监听用户首次交互
  useEffect(() => {
    const events = ['click', 'touchstart', 'keydown'];
    const handler = () => {
      handleUserInteraction();
      events.forEach(e => document.removeEventListener(e, handler));
    };
    events.forEach(e => document.addEventListener(e, handler, { once: true }));
    return () => {
      events.forEach(e => document.removeEventListener(e, handler));
    };
  }, [handleUserInteraction]);

  // ===========================================
  // 心跳检测逻辑
  // ===========================================
  const startHeartbeat = useCallback((sock: Socket) => {
    // 清除之前的心跳定时器
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }

    addLog('💓 启动心跳检测');

    // 定期发送心跳
    heartbeatIntervalRef.current = setInterval(() => {
      if (sock.connected) {
        const now = Date.now();
        sock.emit('heartbeat', { timestamp: now });
        addLog(`💓 发送心跳 ping`);

        // 设置心跳超时检测
        heartbeatTimeoutRef.current = setTimeout(() => {
          const timeSinceLastPong = Date.now() - lastPongTimeRef.current;
          if (timeSinceLastPong > HEARTBEAT_TIMEOUT) {
            addLog(`⚠️ 心跳超时 (${Math.round(timeSinceLastPong / 1000)}秒无响应)`);
            setConnectionStatus('error');
            // 强制重连
            sock.disconnect();
            sock.connect();
          }
        }, HEARTBEAT_TIMEOUT);
      }
    }, HEARTBEAT_INTERVAL);
  }, [addLog]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
    addLog('💔 停止心跳检测');
  }, [addLog]);

  // ===========================================
  // 初始化 WebSocket 连接
  // ===========================================
  useEffect(() => {
    addLog('🚀 初始化 WebSocket 连接...');
    
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: RECONNECT_INTERVAL,
      reconnectionDelayMax: 30000,
      timeout: 20000,
    });

    // 连接成功
    newSocket.on('connect', () => {
      addLog(`✅ WebSocket 已连接 (ID: ${newSocket.id})`);
      setConnectionStatus('connected');
      setReconnectCount(0);
      lastPongTimeRef.current = Date.now();
      
      // 启动心跳检测
      startHeartbeat(newSocket);
      
      // 获取初始比赛列表
      fetchInitialMatches();
    });

    // 连接断开
    newSocket.on('disconnect', (reason) => {
      addLog(`❌ WebSocket 已断开 (原因: ${reason})`);
      setConnectionStatus('disconnected');
      stopHeartbeat();
      
      // 如果是服务器主动断开，尝试重连
      if (reason === 'io server disconnect') {
        addLog('🔄 服务器主动断开，尝试重连...');
        newSocket.connect();
      }
    });

    // 重连中
    newSocket.on('reconnect_attempt', (attemptNumber) => {
      addLog(`🔄 正在重连... (第 ${attemptNumber} 次尝试)`);
      setConnectionStatus('reconnecting');
      setReconnectCount(attemptNumber);
    });

    // 重连成功
    newSocket.on('reconnect', (attemptNumber) => {
      addLog(`✅ 重连成功 (第 ${attemptNumber} 次尝试)`);
      setConnectionStatus('connected');
      setReconnectCount(0);
    });

    // 重连失败
    newSocket.on('reconnect_failed', () => {
      addLog('❌ 重连失败，已达到最大重试次数');
      setConnectionStatus('error');
    });

    // 连接错误
    newSocket.on('connect_error', (error) => {
      addLog(`⚠️ 连接错误: ${error.message}`);
      setConnectionStatus('error');
    });

    // 🔴 心跳响应 (pong)
    newSocket.on('heartbeat_ack', (data: { timestamp: number; serverTime: number }) => {
      const latency = Date.now() - data.timestamp;
      lastPongTimeRef.current = Date.now();
      setLastHeartbeat(new Date().toLocaleTimeString());
      addLog(`💓 收到心跳响应 (延迟: ${latency}ms)`);
      
      // 清除超时检测
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
      }
    });

    // 监听比分更新事件
    newSocket.on('score_update', (event: MatchEvent) => {
      console.log('📊 收到比分更新:', event);
      matchStore.updateMatch(event);
      setLastUpdate(new Date().toLocaleTimeString());
      addLog(`📊 比分更新: ${event.match_id}`);
    });

    // 监听 AI 预测更新事件
    newSocket.on('prediction_update', (prediction: PredictionData) => {
      console.log('🤖 收到预测更新:', prediction);
      matchStore.updatePrediction(prediction);
      addLog(`🤖 预测更新: ${prediction.match_id}`);
    });

    // 监听服务器状态广播
    newSocket.on('server_status', (status: { matches: number; clients: number }) => {
      addLog(`📡 服务器状态: ${status.matches}场比赛, ${status.clients}个客户端`);
    });

    setSocket(newSocket);

    // 订阅 store 变化
    const unsubscribe = matchStore.subscribe(() => {
      setMatches(matchStore.getAllMatches());
    });

    return () => {
      addLog('🔌 清理 WebSocket 连接');
      stopHeartbeat();
      newSocket.close();
      unsubscribe();
    };
  }, [addLog, startHeartbeat, stopHeartbeat]);

  // 获取初始比赛列表
  const fetchInitialMatches = async () => {
    try {
      addLog('📋 获取比赛列表...');
      const response = await fetch(`${SOCKET_URL}/api/matches/live`);
      const data = await response.json();
      console.log('📋 初始比赛列表:', data);
      if (data.matches && Array.isArray(data.matches)) {
        matchStore.setMatches(data.matches);
        addLog(`📋 获取到 ${data.matches.length} 场比赛`);
      } else {
        addLog('📋 暂无进行中的比赛');
      }
    } catch (error) {
      console.error('获取比赛列表失败:', error);
      addLog(`❌ 获取比赛列表失败: ${error}`);
    }
  };

  // 手动刷新
  const handleRefresh = () => {
    addLog('🔄 手动刷新');
    fetchInitialMatches();
  };

  // 手动重连
  const handleReconnect = () => {
    if (socket) {
      addLog('🔄 手动重连...');
      socket.disconnect();
      socket.connect();
    }
  };

  const liveCount = matches.filter(m => m.status === 'live' || m.status === 'halftime').length;

  // 连接状态显示
  const getConnectionStatusDisplay = () => {
    switch (connectionStatus) {
      case 'connected':
        return { text: '实时连接', color: 'bg-green-500/20 text-green-400', icon: Wifi };
      case 'reconnecting':
        return { text: `重连中(${reconnectCount})`, color: 'bg-yellow-500/20 text-yellow-400', icon: RefreshCw };
      case 'error':
        return { text: '连接异常', color: 'bg-red-500/20 text-red-400', icon: WifiOff };
      default:
        return { text: '连接断开', color: 'bg-red-500/20 text-red-400', icon: WifiOff };
    }
  };

  const statusDisplay = getConnectionStatusDisplay();
  const StatusIcon = statusDisplay.icon;

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
            {/* 🔔 未读通知指示器 */}
            {unreadCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 text-red-400 text-sm animate-pulse">
                <span>🔔</span>
                <span>{unreadCount} 新推荐</span>
              </div>
            )}

            {/* 历史记录链接 */}
            <Link 
              to="/history"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 transition-colors text-sm text-slate-300 hover:text-white"
            >
              <span>📜</span>
              <span>历史记录</span>
            </Link>

            {/* 刷新按钮 */}
            <button 
              onClick={handleRefresh}
              className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 transition-colors"
              title="刷新比赛列表"
            >
              <RefreshCw className="w-4 h-4 text-slate-300" />
            </button>

            {/* 连接状态 */}
            <button 
              onClick={handleReconnect}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${statusDisplay.color} cursor-pointer hover:opacity-80`}
              title="点击重连"
            >
              <StatusIcon className={`w-4 h-4 ${connectionStatus === 'reconnecting' ? 'animate-spin' : ''}`} />
              <span>{statusDisplay.text}</span>
            </button>
          </div>
        </header>

        {/* 统计信息 */}
        <div className="grid grid-cols-4 gap-4 mb-6">
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
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <div className="text-sm font-medium text-slate-300 truncate">
              {lastHeartbeat || '--:--:--'}
            </div>
            <div className="text-xs text-slate-400">心跳时间</div>
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
              {connectionStatus === 'connected' 
                ? '等待比赛数据...' 
                : connectionStatus === 'reconnecting'
                  ? '正在重新连接...'
                  : '正在连接服务器...'}
            </p>
          </div>
        )}

        {/* 连接日志面板 */}
        <div className="mt-6 bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-slate-400">📡 连接日志</h3>
            <button 
              onClick={() => setConnectionLog([])}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              清空
            </button>
          </div>
          <div className="h-32 overflow-y-auto text-xs font-mono text-slate-500 space-y-1">
            {connectionLog.length > 0 ? (
              connectionLog.map((log, index) => (
                <div key={index} className="truncate">{log}</div>
              ))
            ) : (
              <div className="text-slate-600">暂无日志</div>
            )}
          </div>
        </div>

        {/* 底部信息 */}
        <footer className="mt-8 text-center text-xs text-slate-500">
          <div className="flex items-center justify-center gap-4">
            <span>⚡ 零延迟比分更新</span>
            <span>🤖 AI 实时预测</span>
            <span>💓 心跳检测</span>
          </div>
          <div className="mt-2">Football Prediction System v2.1 - 多场比赛实时监控</div>
        </footer>
      </div>

      {/* 🔔 Toast 通知组件 */}
      <AlertToast
        alerts={activeToasts}
        onDismiss={dismissToast}
        onClearAll={clearAllToasts}
      />

      {/* 🔧 调试面板 */}
      <DebugPanel
        onTestNotification={triggerTestAlert}
        onEnableAudio={enableAudio}
        onRequestPermission={requestNotificationPermission}
        isAudioEnabled={isAudioEnabled}
        isNotificationGranted={isNotificationGranted}
        unreadCount={unreadCount}
      />
    </div>
  );
}
