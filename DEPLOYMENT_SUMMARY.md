# AI 足球预测系统 - 部署总结

## 🎉 部署成功！真实数据 + AI 预测已上线！

系统已成功部署到云端，接入真实比赛数据和智能 AI 预测功能。

---

## 📍 访问地址

| 服务 | URL | 状态 |
|------|-----|------|
| **前端网站** | https://football-ai-live.vercel.app/ | ✅ 运行中 |
| **后端 API** | https://football-ai-live-production.up.railway.app | ✅ 运行中 |
| **健康检查** | https://football-ai-live-production.up.railway.app/health | ✅ 正常 |
| **比赛 API** | https://football-ai-live-production.up.railway.app/api/matches/live | ✅ 正常 |

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Vercel (前端托管)                         │
│                                                             │
│  • React + TypeScript + TailwindCSS                        │
│  • 实时比分显示界面                                          │
│  • WebSocket 客户端                                         │
│  • AI 预测可视化                                            │
│                                                             │
│  URL: https://football-ai-live.vercel.app/                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS / WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Railway (后端托管)                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Node.js 后端服务 (football-ai-live)        │   │
│  │                                                     │   │
│  │  • Express.js + Socket.IO                          │   │
│  │  • API-Football 真实数据接入                         │   │
│  │  • SmartPredict-v1 AI 预测引擎                      │   │
│  │  • 实时比分推送                                      │   │
│  │                                                     │   │
│  │  URL: https://football-ai-live-production.up.railway.app │
│  └─────────────────────────────────────────────────────┘   │
│                              │                              │
│                              │ Redis 内部连接               │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Redis 服务                        │   │
│  │                                                     │   │
│  │  • 比赛数据缓存                                      │   │
│  │  • 预测结果缓存                                      │   │
│  │                                                     │   │
│  │  内部地址: redis.railway.internal:6379              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🤖 AI 预测引擎 (SmartPredict-v1)

### 预测算法特点

SmartPredict-v1 是一个智能足球比赛预测算法，考虑以下因素：

| 因素 | 权重 | 说明 |
|------|------|------|
| **比分差距** | 最高 | 领先/落后的球数是最重要的预测因素 |
| **比赛时间** | 高 | 越接近比赛结束，当前比分越能反映最终结果 |
| **射门数据** | 中 | 射门次数和射正次数影响进球概率 |
| **控球率** | 中 | 控球优势方有更多进攻机会 |
| **红牌** | 中 | 人数劣势显著影响比赛走向 |
| **特殊情况** | 动态 | 大比分领先、比赛末段等特殊情况 |

### 预测示例

| 比赛状态 | 主胜 | 平局 | 客胜 | 说明 |
|----------|------|------|------|------|
| 0-0 (上半场) | 34% | 39% | 27% | 平局概率最高 |
| 1-0 (中场) | 60% | 19% | 21% | 领先方优势明显 |
| 2-0 (下半场) | 71% | 15% | 14% | 大比分领先，高置信度 |
| 0-1 (下半场) | 28% | 19% | 53% | 落后方逆转困难 |
| 2-2 (下半场) | 38% | 33% | 30% | 平局可能性增加 |

---

## 🔧 技术栈

### 前端 (Vercel)
- **框架**: React 18 + TypeScript
- **样式**: TailwindCSS
- **实时通信**: Socket.IO Client
- **状态管理**: 自定义 Store
- **图标**: Lucide React

### 后端 (Railway)
- **运行时**: Node.js 22
- **框架**: Express.js
- **实时通信**: Socket.IO
- **数据源**: API-Football (真实比赛数据)
- **预测引擎**: SmartPredict-v1 (内置)
- **缓存**: Redis

---

## 📊 功能特性

### 已实现 ✅
- ✅ **真实比赛数据** - API-Football 实时数据
- ✅ **AI 智能预测** - SmartPredict-v1 算法
- ✅ **实时比分更新** - WebSocket 推送
- ✅ **多场比赛监控** - 同时显示所有进行中的比赛
- ✅ **预测概率显示** - 主胜/平局/客胜百分比
- ✅ **置信度指示** - 预测可靠性评估
- ✅ **响应式界面** - 适配各种屏幕
- ✅ **连接状态指示** - 实时显示连接状态
- ✅ **Redis 数据缓存** - 提高响应速度

### 待实现 ⏳
- ⏳ PostgreSQL 数据持久化
- ⏳ 历史数据分析
- ⏳ 预测准确率统计
- ⏳ 用户收藏功能

---

## 🔐 环境变量配置

### Railway - Node.js 后端
| 变量名 | 值 | 说明 |
|--------|-----|------|
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | Redis 连接 URL (引用) |
| `API_FOOTBALL_KEY` | `***` | API-Football API 密钥 |
| `DATA_MODE` | `live` | 数据模式 (live/mock) |

### Vercel - 前端
| 变量名 | 值 | 说明 |
|--------|-----|------|
| `VITE_API_URL` | `https://football-ai-live-production.up.railway.app` | 后端 API URL |
| `VITE_WS_URL` | `https://football-ai-live-production.up.railway.app` | WebSocket URL |

---

## 📁 项目结构

```
football-ai-live/
├── backend/                 # Node.js 后端
│   ├── src/
│   │   ├── index.ts        # 主入口
│   │   ├── services/
│   │   │   ├── footballService.ts   # API-Football 数据服务
│   │   │   └── predictionService.ts # SmartPredict AI 预测
│   │   └── types/          # 类型定义
│   ├── package.json
│   └── Dockerfile
│
├── frontend/               # React 前端
│   ├── src/
│   │   ├── components/     # UI 组件
│   │   ├── hooks/          # 自定义 Hooks
│   │   └── store/          # 状态管理
│   ├── package.json
│   └── vite.config.ts
│
├── prediction-service/     # Python 预测服务 (备用)
│   ├── app/
│   │   └── main.py
│   ├── requirements.txt
│   └── Dockerfile
│
└── README.md
```

---

## 🚀 API 端点

### 比赛数据
```
GET /api/matches/live
```
返回所有正在进行的比赛，包含 AI 预测：
```json
{
  "mode": "live",
  "matches": [
    {
      "match_id": "api-1436034",
      "home_team": "Al-Hilal Saudi FC",
      "away_team": "Al-Hazm",
      "home_score": 1,
      "away_score": 0,
      "minute": 45,
      "status": "halftime",
      "league": "Saudi-Arabia - Pro League",
      "prediction": {
        "home": 0.595,
        "draw": 0.1945,
        "away": 0.2105
      },
      "prediction_confidence": 0.75,
      "prediction_algorithm": "SmartPredict-v1"
    }
  ]
}
```

### 单场预测
```
GET /api/predictions/:matchId
```

### 批量预测
```
POST /api/predictions/batch
```

### 健康检查
```
GET /health
```
返回：
```json
{
  "status": "ok",
  "mode": "live",
  "redis": "connected",
  "prediction_service": "SmartPredict-v1.0.0"
}
```

---

## 📝 更新日志

### 2026-01-08 (v2.0)
- ✅ 接入 API-Football 真实比赛数据
- ✅ 实现 SmartPredict-v1 AI 预测引擎
- ✅ 添加预测置信度评估
- ✅ 优化前端预测显示
- ✅ 添加批量预测 API

### 2026-01-08 (v1.0)
- ✅ 修复 Redis 连接问题 (使用 Railway 变量引用)
- ✅ 修复前端环境变量问题 (运行时环境检测)
- ✅ 成功部署到 Railway 和 Vercel
- ✅ 验证 WebSocket 实时连接

---

## 🔗 相关链接

- **GitHub 仓库**: https://github.com/kentsang666/football-ai-live
- **Railway 项目**: https://railway.com/project/459966a7-12db-4b47-874b-a5be7a8d0e0d
- **Vercel 项目**: https://vercel.com/kentsang666s-projects/football-ai-live

---

## 📞 支持

如有问题，请在 GitHub 仓库提交 Issue。
