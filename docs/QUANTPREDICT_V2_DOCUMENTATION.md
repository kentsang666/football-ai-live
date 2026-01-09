# QuantPredict v2.0 - 足球滚球预测引擎技术文档

## 概述

QuantPredict v2.0 是一个专业的足球滚球（In-Play）预测引擎，核心逻辑是寻找"市场赔率"与"模型真实概率"之间的偏差。该系统已成功集成到 AI 足球预测系统中，替代了原有的 SmartPredict-v1 算法。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    QuantPredict v2.0 引擎                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │  PressureIndex   │───▶│  LiveProbability │                   │
│  │  (动量引擎)       │    │  (泊松模型)       │                   │
│  └──────────────────┘    └────────┬─────────┘                   │
│                                   │                              │
│                                   ▼                              │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ AsianHandicapPricer│◀──│ TradingSignalGen │                   │
│  │  (盘口转换器)      │    │  (信号生成器)     │                   │
│  └──────────────────┘    └──────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. PressureIndex（实时动量引擎）

**功能**：计算主客队的"压力值"（0-100），用于调整进球率。

**输入**：
- 实时比赛数据流（过去5分钟的进攻危险次数、射正次数、角球数等）

**权重配置**：
```python
WEIGHTS = {
    'dangerous_attacks': 0.1,   # 危险进攻
    'shots_on_target': 1.0,     # 射正
    'shots_off_target': 0.4,    # 射偏
    'corners': 0.3,             # 角球
    'possession': 0.05,         # 控球率
    'red_cards': -2.0           # 红牌惩罚
}
```

**输出**：
- 主队压力值 (0-100)
- 客队压力值 (0-100)
- 动量系数 (0.7-1.3)
- 场上主导方 (HOME/AWAY/BALANCED)

**算法逻辑**：
1. 计算原始压力值 = Σ(事件数量 × 权重)
2. 归一化到 0-100 范围
3. 使用指数移动平均平滑历史数据
4. 转换为动量系数用于调整 Lambda

### 2. LiveProbability（动态泊松模型）

**功能**：基于泊松分布计算比赛结果概率。

**输入**：
- 赛前预期进球数 (xG)：主队 1.45，客队 1.15
- 当前比分
- 剩余时间（分钟）
- 动量系数

**时间衰减模型**：
```python
# 线性衰减
Current_Lambda = Initial_Lambda × (Remaining_Time / 90)

# 指数衰减（可选）
Current_Lambda = Initial_Lambda × exp(-0.5 × (1 - time_ratio))
```

**动量调整**：
```python
Home_Lambda = Base_Lambda × Time_Decay × Home_Momentum_Factor
Away_Lambda = Base_Lambda × Time_Decay × Away_Momentum_Factor
```

**概率计算**：
使用 `scipy.stats.poisson` 计算剩余时间内各比分的概率分布，然后累加得出：
- 主胜概率 (Home Win)
- 平局概率 (Draw)
- 客胜概率 (Away Win)

### 3. AsianHandicapPricer（亚洲盘口转换器）

**功能**：将模型概率转换为公平的亚洲盘口赔率。

**支持的盘口类型**：
- 整数盘口：0, ±1, ±2, ±3
- 半球盘口：±0.5, ±1.5, ±2.5
- 四分之一盘口：±0.25, ±0.75, ±1.25, ±1.75

**四分之一盘口处理逻辑**：
```python
# -0.25 盘口 = 50% × (-0) + 50% × (-0.5)
split_prob = 0.5 × (win_prob_lower + 0.5 × push_prob_lower) +
             0.5 × (win_prob_upper + 0.5 × push_prob_upper)
```

**赔率转换**：
```python
fair_odds = 1 / probability
# 限制范围：1.10 - 20.00
```

### 4. TradingSignalGenerator（交易信号生成器）

**功能**：对比公平赔率和市场赔率，生成交易信号。

**信号类型**：
- `VALUE_BET`：Edge ≥ 5%，建议投注
- `NO_VALUE`：-10% < Edge < 5%，无价值
- `AVOID`：Edge ≤ -10%，避免投注

**Edge 计算**：
```python
edge = (market_odds / fair_odds) - 1
```

**输出示例**：
```json
{
  "signalType": "VALUE_BET",
  "market": "1X2",
  "selection": "HOME",
  "fairOdds": 1.288,
  "marketOdds": 1.45,
  "edge": 0.126,
  "confidence": 0.85
}
```

## 置信度计算

置信度基于以下因素：
```python
confidence = 0.5 + 0.3 × time_confidence + 0.2 × data_confidence

# time_confidence = min(1.0, minute / 45)
# data_confidence = min(1.0, (shots + corners) / 10)
```

## API 接口

### 健康检查
```bash
GET /health
```
响应：
```json
{
  "status": "ok",
  "mode": "live",
  "redis": "connected",
  "prediction_service": "QuantPredict-v2.0.0"
}
```

### 获取实时比赛和预测
```bash
GET /api/matches/live
```
响应包含每场比赛的预测数据：
```json
{
  "mode": "live",
  "matches": [
    {
      "match_id": "12345",
      "home_team": "Man City",
      "away_team": "Arsenal",
      "home_score": 1,
      "away_score": 0,
      "minute": 70,
      "prediction": {
        "home": 0.776,
        "draw": 0.190,
        "away": 0.034,
        "confidence": 0.85,
        "algorithm": "QuantPredict-v2.0"
      }
    }
  ]
}
```

### 获取单场比赛预测
```bash
GET /api/predictions/:matchId
```

### 批量预测
```bash
POST /api/predictions/batch
Content-Type: application/json

{
  "matches": [
    {
      "match_id": "12345",
      "home_team": "Man City",
      "away_team": "Arsenal",
      "home_score": 1,
      "away_score": 0,
      "minute": 70
    }
  ]
}
```

## 预测示例

### 场景 1：第70分钟，主队 1-0 领先，客队压力大

| 指标 | 值 |
|------|-----|
| 主队压力值 | 7.7/100 |
| 客队压力值 | 92.3/100 |
| 主队动量系数 | 0.746 |
| 客队动量系数 | 1.254 |
| 主胜概率 | 77.6% |
| 平局概率 | 19.0% |
| 客胜概率 | 3.4% |
| 置信度 | 100% |

### 场景 2：第45分钟，0-0 平局

| 指标 | 值 |
|------|-----|
| 主胜概率 | 34% |
| 平局概率 | 39% |
| 客胜概率 | 27% |
| 置信度 | 70% |

### 场景 3：第85分钟，主队 2-0 领先

| 指标 | 值 |
|------|-----|
| 主胜概率 | 95%+ |
| 平局概率 | 3% |
| 客胜概率 | 2% |
| 置信度 | 95% |

## 亚洲盘口示例

第70分钟，主队 1-0 领先：

| 盘口 | 主队赔率 | 客队赔率 |
|------|----------|----------|
| -0.50 | 1.288 | 4.474 |
| -0.25 | 1.214 | 5.681 |
| +0.00 | 1.147 | 7.781 |
| +0.25 | 1.100 | 12.342 |
| +0.50 | 1.100 | 20.000 |

## 技术栈

### Python 版本（prediction-service）
- Python 3.11
- NumPy
- SciPy
- Pandas
- FastAPI

### TypeScript 版本（backend）
- Node.js 18+
- TypeScript
- Express
- Socket.IO
- Redis

## 文件结构

```
football-prediction-system/
├── backend/
│   └── src/
│       └── services/
│           ├── quantPredictService.ts    # TypeScript 版本
│           └── predictionService.ts      # 服务封装
├── prediction-service/
│   └── app/
│       └── models/
│           └── live_prediction_model.py  # Python 版本
└── docs/
    └── QUANTPREDICT_V2_DOCUMENTATION.md  # 本文档
```

## 未来改进方向

1. **机器学习增强**：集成历史数据训练的 ML 模型
2. **实时统计数据**：接入更详细的实时统计数据
3. **市场赔率接入**：自动获取博彩公司赔率进行比较
4. **回测系统**：历史数据回测验证模型准确性
5. **多联赛参数调优**：针对不同联赛调整 xG 参数

## 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v1.0.0 | 2026-01-08 | SmartPredict 初始版本 |
| v2.0.0 | 2026-01-09 | QuantPredict 完整重构，添加泊松模型、动量引擎、亚盘转换器 |

---

**作者**：AI Football Prediction System Team  
**最后更新**：2026-01-09
