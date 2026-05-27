# Chaos Fire Drill — 云上消防演习

## 项目简介

一个 AI 驱动的混沌工程游戏。在 Kubernetes 集群中模拟故障，用户和 AI 同时诊断修复，竞速对比谁更快恢复服务。

**核心理念**：将混沌工程（Chaos Engineering）游戏化，通过"人 vs AI"的对决形式，直观展示云计算的核心能力——故障自愈、弹性伸缩、服务韧性。

**体现的云计算概念**：弹性伸缩、故障自愈、健康探针、服务韧性、容器编排、混沌工程

**AI 元素**：AI 自动故障诊断与根因分析（基于 LLM）

---

## 一、系统架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                     Frontend (Vue 3)                          │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ 集群状态  │  │   游戏控制台   │  │   AI 对决面板         │  │
│  │ Pod 健康  │  │ 开始/难度选择  │  │   人 🆚 AI 实时战况   │  │
│  │ 延迟图表  │  │  计时器/分数  │  │   AI 诊断过程可视化   │  │
│  └──────────┘  └──────────────┘  └───────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐   │
│  │              运维终端  $ _                              │   │
│  │  > kubectl get pods                                    │   │
│  │  > kubectl logs product-service-xxx                    │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────┬───────────────────────────────────┘
                           │ WebSocket (实时) + REST
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                Game Server (Node.js + Express)                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ 游戏状态机│ │ 混沌注入器│ │ AI 引擎  │ │   评分系统     │  │
│  │          │ │          │ │ (LLM API)│ │                │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         K8s Client (kubectl / k8s API)                │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬───────────────────────────────────┘
                           │ kubectl / exec
                           ▼
┌──────────────────────────────────────────────────────────────┐
│            K8s 集群 — Namespace: chaos-game                   │
│  ┌────────┐ ┌────────┐ ┌──────────┐                         │
│  │frontend│ │ order  │ │ product  │  ← 已有微服务             │
│  │  :3000 │ │service │ │ service  │                         │
│  └────────┘ └────────┘ └──────────┘                         │
└──────────────────────────────────────────────────────────────┘
```

**设计决策**：所有后端逻辑合并在一个 Game Server 中（非微服务），降低复杂度。目标系统复用已有的 3 个微服务。

---

## 二、游戏状态机

```
                  ┌─────────────┐
                  │   IDLE      │  ← 等待开始
                  │  (等待中)    │
                  └──────┬──────┘
                         │ 用户点击"开始游戏" + 选择难度
                         ▼
                  ┌─────────────┐
                  │  INJECTING  │  ← 混沌控制器注入故障
                  │  (故障注入中) │     (约 3-5 秒)
                  └──────┬──────┘
                         │ 故障注入完成
                         ▼
                  ┌─────────────┐
                  │  DIAGNOSING │  ← 用户和 AI 同时诊断修复
                  │  (诊断修复中) │     计时器开始计时
                  └──────┬──────┘
                         │
              ┌──────────┴──────────┐
              │ 服务恢复健康          │ 超时未修复 (5分钟)
              ▼                     ▼
       ┌─────────────┐      ┌─────────────┐
       │  SCORING    │      │   TIMEOUT   │
       │  (评分结算)  │      │  (超时结算)  │
       └──────┬──────┘      └──────┬──────┘
              │                    │
              └──────────┬─────────┘
                         │ 用户点击"再来一局"
                         ▼
                  ┌─────────────┐
                  │   IDLE      │
                  └─────────────┘
```

### 状态说明

| 状态 | 用户可操作 | 说明 |
|------|-----------|------|
| IDLE | 选难度、开始 | 仪表盘显示正常集群状态 |
| INJECTING | 不可操作 | 3 秒倒计时，故障正在注入 |
| DIAGNOSING | 查看仪表盘、终端输入指令 | 核心游戏阶段 |
| SCORING/TIMEOUT | 查看结算面板 | 展示人和 AI 的诊断对比 |

### 数据结构

```javascript
gameState = {
  status: 'IDLE',           // IDLE | INJECTING | DIAGNOSING | SCORING | TIMEOUT
  difficulty: 'easy',       // easy | hard
  round: 0,                 // 当前轮次
  faults: [],               // 本轮注入的故障列表 [{id, type, target, injectedAt}]
  startTime: null,          // DIAGNOSING 阶段开始时间
  timeout: 300,             // 超时秒数
  humanRepaired: false,     // 人是否修复
  aiRepaired: false,        // AI 是否修复
}
```

---

## 三、混沌注入器

### Easy 模式故障池

| 故障 | 注入方式 | 现象 |
|------|---------|------|
| kill-random-pod | `kubectl delete pod <random> -n chaos-game` | 服务短暂不可用，Deployment 自动拉起新 Pod |
| scale-to-zero | `kubectl scale deployment <random> --replicas=0 -n chaos-game` | 服务完全挂掉 |
| cpu-stress | `kubectl exec <random> -- stress-ng --cpu 2 --timeout 300s` | 响应变慢，但服务还在 |

### Hard 模式故障池

| 故障 | 注入方式 | 现象 |
|------|---------|------|
| network-delay | `kubectl exec <random> -- tc qdisc add dev eth0 root netem delay 500ms` | 请求超时、调用链断裂 |
| kill-two-pods | 同时 kill 两个不同服务的 Pod | 多服务同时受影响 |
| cascade | kill pod + 篡改一个 service 的 targetPort（模拟配置错误） | 服务运行但行为异常，更难排查 |

### 注入流程

```
1. 读取难度 → 从故障池随机选 1 个（hard 模式选 2 个）
2. 检查目标 Pod 是否存在（health check pre-condition）
3. 记录故障元数据 { id, type, target, injectedAt, restoreFn }
4. 执行注入命令
5. 等待 3 秒让故障生效
6. 推送事件到前端：{ event: "fault-injected", fault: {...} }
7. 触发状态切换 → DIAGNOSING，计时器启动
```

### 恢复机制

```javascript
faults = [
  { type: 'kill-random-pod', restoreFn: 'wait-replica-recreate' },
  { type: 'scale-to-zero',   restoreFn: 'kubectl scale --replicas=1' },
  { type: 'cpu-stress',      restoreFn: 'kubectl exec -- pkill stress-ng' },
  { type: 'network-delay',   restoreFn: 'kubectl exec -- tc qdisc del dev eth0 root' },
]
```

### 安全边界

- 所有操作限定在 `namespace: chaos-game`
- 注入前快照集群状态，超时未修复则自动调用 restoreFn 回滚
- 不碰 Node 级别资源，只动 Pod 和 Deployment

---

## 四、AI 诊断引擎

### 角色定位

AI 队友，和人同时诊断。不是人的对手，是对比对象。

### 工作流程

```
1. 每秒采集一次集群快照 → { pods, deployments, events, metrics }
2. 把当前快照 + 正常基线快照 拼接成 Prompt
3. 调用 LLM API（DeepSeek / 通义千问）
4. LLM 返回 JSON：{ diagnosis, suspectedFault, repairCommand }
5. 执行 repairCommand → 检查服务是否恢复
6. 如果恢复 → 记录 AI 修复时间；如果未恢复 → 继续下一轮诊断
```

### Prompt 模板

```
你是 Kubernetes 运维专家。以下是一个微服务集群的状态信息。

【正常时基线】
{pods_baseline}

【当前异常状态】
{pods_current}
{deployments_current}
{recent_events}

请诊断可能的故障原因，以 JSON 格式回复：
{
  "diagnosis": "中文一句话描述诊断结论",
  "suspectedService": "受影响的服务名",
  "repairCommand": "修复命令，如 kubectl scale deployment xxx --replicas=1"
}
```

### 约束

- 最多 3 轮诊断，每轮间隔 5 秒
- AI 每轮的 `diagnosis` 实时推送到前端，用户可围观 AI 的诊断思路

---

## 五、评分系统

### 评分维度（满分 100）

| 维度 | 权重 | 评分规则 |
|------|------|---------|
| 修复速度 | 50% | 基于修复耗时排名，快者得满分 |
| 诊断准确度 | 30% | 是否正确识别了故障类型 |
| 操作规范度 | 20% | 命令是否合理（AI 得分固定满分，人看指令是否正确） |

### 结算数据格式

```json
{
  "human": { "repairTime": 42, "command": "kubectl scale...", "accuracy": "full" },
  "ai":   { "repairTime": 28, "command": "kubectl scale...", "accuracy": "full" },
  "winner": "ai",
  "roundSummary": "AI 比你快了 14 秒，但你们都正确识别了 scale-to-zero 故障"
}
```

---

## 六、前端仪表盘

### 页面布局

```
┌─────────────────────────────────────────────────────────────┐
│ 🚒 Chaos Fire Drill                             第 3 轮 🔥  │
├─────────────────────┬───────────────────┬───────────────────┤
│                     │                   │                   │
│   📊 集群健康面板    │   🎮 游戏控制台    │   🤖 AI 对决面板   │
│                     │                   │                   │
│  [🟢] frontend     │  难度: EASY       │  🧑 人类 |  0分    │
│  [🔴] order-svc    │  计时: 00:42      │  🤖 AI   |  0分    │
│  [🟢] product-svc  │  状态: 诊断中...  │                   │
│                     │                   │  AI 最新诊断:      │
│  请求成功率: 67%    │  [开始游戏]       │  "order-service   │
│  平均延迟: 2300ms   │  [终止游戏]       │   疑似被缩容了"    │
│                     │                   │                   │
├─────────────────────┴───────────────────┴───────────────────┤
│  > _ 运维终端                                               │
│  $ kubectl get pods -n chaos-game                           │
│  NAME                     READY   STATUS                     │
│  order-service-xxx        0/1     Terminating                │
│  ...                                                         │
│  $                                                           │
└─────────────────────────────────────────────────────────────┘
```

### 数据通道

| 面板 | 通信方式 |
|------|---------|
| 集群状态面板 | WebSocket 实时推送（每秒） |
| 游戏控制台 | REST（开始/结束/选难度） |
| AI 对决面板 | WebSocket（AI 诊断进度、最终分数） |
| 运维终端 | WebSocket（命令发送 + 结果返回） |

---

## 七、运维终端

前端用 xterm.js 渲染终端 UI，用户输入命令通过 WebSocket 发到 Game Server，后端 `child_process.exec()` 执行并返回输出。

### 命令白名单

- `kubectl get` — 查看资源
- `kubectl describe` — 查看资源详情
- `kubectl logs` — 查看日志
- `kubectl scale` — 扩缩容
- `kubectl exec` — 进入容器执行命令
- `kubectl rollout restart` — 滚动重启

### 安全措施

- 命令白名单硬校验
- 锁定 namespace 为 `chaos-game`
- 禁止 `kubectl delete`、`kubectl apply`、`kubectl create` 等破坏性命令

---

## 八、K8s 目标系统

复用已有微服务（`exp2 kubernetes/micro-demo/`），部署到独立 namespace：

| 服务 | 技术栈 | 端口 | 初始副本数 |
|------|--------|------|-----------|
| frontend | Vue 3 | 80 | 2 |
| order-service | Node.js | 3000 | 2 |
| product-service | Node.js | 3000 | 2 |

---

## 九、项目目录结构

```
期末大项目/chaos-fire-drill/
├── game-server/               # Game Server (Node.js)
│   ├── package.json
│   ├── server.js              # 入口，Express + WebSocket
│   ├── state-machine.js       # 游戏状态机
│   ├── chaos-injector.js      # 混沌注入器
│   ├── ai-engine.js           # AI 诊断引擎（LLM API 调用）
│   ├── scorer.js              # 评分系统
│   ├── terminal-proxy.js      # 终端命令代理
│   └── k8s-client.js          # K8s 操作封装
├── frontend/                  # Vue 3 前端
│   ├── src/
│   │   ├── App.vue
│   │   ├── components/
│   │   │   ├── HealthPanel.vue      # 集群健康面板
│   │   │   ├── GameConsole.vue      # 游戏控制台
│   │   │   ├── AiDuelPanel.vue      # AI 对决面板
│   │   │   ├── Terminal.vue         # 运维终端
│   │   │   └── ScoreBoard.vue       # 结算面板
│   │   └── main.js
│   └── package.json
├── k8s/
│   ├── namespace.yaml               # chaos-game
│   ├── frontend-deployment.yaml
│   ├── order-deployment.yaml
│   ├── product-deployment.yaml
│   └── game-server-deployment.yaml
└── DESIGN.md                        # 本文档
```

---

## 十、MVP 最小可行范围

| 模块 | MVP 范围 |
|------|---------|
| 游戏状态机 | 完整实现 5 个状态 |
| 混沌注入器 | 只做 Easy 模式：kill-random-pod + scale-to-zero |
| AI 引擎 | 调用一次 LLM API，单轮诊断 |
| 评分系统 | 只按修复速度排名（简化版） |
| 前端 | 4 个面板 + 终端，单次通信走通 |
| K8s | 复用已有微服务 + game-server 部署 |
| 难度选择 | 仅支持 Easy 模式 |

---

## 十一、核心玩法流程

一轮游戏的完整过程：

1. **选难度** → 仅支持 Easy 模式
2. **混沌控制器悄悄注入故障**（如：随机 kill 掉 product-service 的一个 Pod）
3. **仪表盘实时显示系统状态**：Pod 健康状态、请求成功率、响应延迟
4. **告警灯亮起** → 用户和 AI 同时开始诊断
5. **用户操作**：看日志 → 查 Pod 状态 → 在终端输入修复命令
6. **AI 队友**：自动分析指标 → 给出诊断推理 → 尝试自动修复
7. **服务恢复正常** → 评分引擎算出本轮得分
8. **结算页面**：谁先发现的？谁诊断更准？谁修得更快？
