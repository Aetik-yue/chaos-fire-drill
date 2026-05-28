# Chaos Fire Drill — 设计思路文档

> **项目名称**: Chaos Fire Drill (云上消防演习)
> **技术栈**: Node.js + Express + WebSocket + Vue 3 + Docker + Kubernetes
> **AI**: DeepSeek LLM API (流式输出) + 规则引擎回退
> **定位**: 云计算课程期末大项目，融合实验一(OpenStack)、实验二(K8s微服务)、混沌工程 + AI 竞速

---

## 目录

1. [项目定位与设计哲学](#1)
2. [整体架构](#2)
3. [核心模块设计](#3)
4. [三模式架构](#4)
5. [AI 集成设计](#5)
6. [混沌工程体系](#6)
7. [评分与云成本模型](#7)
8. [前端设计](#8)
9. [K8s 部署架构](#9)
10. [实验联动设计](#10)
11. [创新点总结](#11)

---

## <a id="1"></a>一、项目定位与设计哲学

### 1.1 痛点分析

云计算课程教学面临三个核心问题：

1. **理论知识抽象**：Kubernetes、容器编排、混沌工程等概念光听不行，必须动手
2. **缺乏真实排错场景**：学生只会 `kubectl apply`，遇到故障完全不知道从何排查
3. **AI 仅作为辅助工具**：市面上 AI 工具都是"教你做"，没有把 AI 设计为"对手"来激发学习动力

### 1.2 设计哲学

**"用游戏对抗 AI，在对抗中学习"** — 三个原则：

- **竞争驱动学习**：AI 不是辅助工具，是会和玩家抢时间的对手
- **渐进式复杂度**：练习(mock)→Micro-Demo(自己的集群)→Bookinfo(行业标准应用)
- **成本意识内化**：每一次操作都有模拟账单，修得快不代表修得好

---

## <a id="2"></a>二、整体架构

```
                          ┌─────────────────────────┐
                          │     Browser (Vue 3)      │
                          │  WebSocket + REST API    │
                          └─────────┬───────────────┘
                                    │ ws://host:3001
                          ┌─────────▼───────────────┐
                          │   game-server (Node.js)  │
                          │   ┌───────────────────┐  │
                          │   │   StateMachine    │  │  ← 5 状态 FSM
                          │   │   (IDLE→...→IDLE) │  │
                          │   └───────────────────┘  │
                          │   ┌───────────────────┐  │
                          │   │   ChaosInjector   │  │  ← 8 种故障
                          │   └───────────────────┘  │
                          │   ┌───────────────────┐  │
                          │   │   AiEngine        │──┼──→ DeepSeek API
                          │   └───────────────────┘  │
                          │   ┌───────────────────┐  │
                          │   │   Scorer          │  │  ← 4 维评分
                          │   │   + CostCalculator│  │
                          │   └───────────────────┘  │
                          └─────────┬───────────────┘
                                    │ kubectl
                          ┌─────────▼───────────────┐
                          │   Kubernetes Cluster     │
                          │   ┌───────────────────┐  │
                          │   │ chaos-game (target)│  │  ← 练习模式
                          │   │ demo-micro (real)  │  │  ← Micro-Demo
                          │   │ default (Bookinfo) │  │  ← Bookinfo
                          │   └───────────────────┘  │
                          └─────────────────────────┘
```

### 2.1 关键架构决策

**决策 1: 单体容器部署** — game-server 同时提供 Express API、WebSocket 和前端静态文件服务。无需独立的前端部署，一个 Pod 搞定全部。

**决策 2: Mock 模式作为第一公民** — K8sClient 从设计之初就支持 `mockMode`，所有 kubectl 操作都有对应的内存态模拟。这让游戏在没有任何 K8s 集群的情况下也能运行。

**决策 3: WebSocket 单向广播** — 服务端向所有客户端广播状态变化，客户端只通过 REST API 发起操作。这避免了客户端间状态同步的复杂性。

**决策 4: 状态机与 IO 分离** — `StateMachine` 对 K8s、HTTP、WebSocket 完全无感知，只管理 5 个状态的合法转换。所有副作用（故障注入、健康检查、AI 诊断）在 `server.js` 中编排。

---

## <a id="3"></a>三、核心模块设计

### 3.1 StateMachine — 游戏状态机

```
IDLE ──startGame()──▶ INJECTING ──startDiagnosing()──▶ DIAGNOSING
  ▲                                                      │
  │                                    ┌─────────────────┤
  │                                    ▼                  ▼
  └────reset()── SCORING ◀──endGame()  TIMEOUT ◀──timeout()
```

5 个状态之间只有合法转换路径。状态采用不可变快照模式（`getState()` 返回 `{ ...this.state }`），防止外部直接修改。

**状态跟踪内容**：当前状态、难度、回合数、故障列表、开始时间、人/AI 修复标志和耗时、人/AI 修复命令、AI 诊断文本、得分、赢家、回合总结。

### 3.2 ChaosInjector — 混沌注入器

**8 种故障类型**，按机制分为三类：

| 类别 | 故障 | 机制 | 检测方式 |
|------|------|------|---------|
| **副本操作** | kill-random-pod | scale → 1 | `get deployments` |
| | scale-to-zero | scale → 0 | `get deployments` |
| | kill-two-pods | 两个服务 scale → 1 | `get deployments` |
| **资源压力** | cpu-stress | `yes > /dev/null &` | `top pod` |
| | memory-leak | `dd ... /dev/shm &` | `top pod` |
| | disk-full | `dd ... /tmp/bigfile` | `exec df -h` |
| **服务破坏** | process-crash | `kill 1` | `get pods` RESTARTS |
| | network-delay | `tc qdisc ... netem` | pod ready=0/1 |

每个故障都有 `restoreFn`（恢复函数），支持自动清理。

### 3.3 K8sClient — K8s 客户端

**双模式架构**是核心设计：`mockMode=true` 时所有操作在内存态完成，`mockMode=false` 时执行真实 `kubectl` 命令。

Mock 维护完整状态：6 个 Pod（3 服务 × 2 副本）、3 个 Deployment、事件列表。每个 Pod 有 CPU/内存模拟值，`injectMockFault` 根据故障类型修改对应指标。

`isHealthy()` 五项检查：Pod Running 状态、ready 值、Deployment available 数、Pod 数量匹配、CPU/内存低于 80%。

### 3.4 AiEngine — AI 引擎

**LLM + 规则混合诊断**：

1. 游戏开始时捕获基线快照（`captureBaseline()`）
2. 诊断时对比基线与当前状态，构建 Prompt 发送给 DeepSeek API
3. 若 API 不可用，回退到**优先级级联规则引擎**：
   - notReady Pods → CPU > 80% → 内存 > 80% → restarts > 0 → available = 0 → ready < expected

**流式诊断** (`diagnoseWithStream()`)：AsyncGenerator 逐 token yield LLM 响应，前端实时展示 AI 思考过程。

### 3.5 Scorer + CostCalculator — 评分与成本

**四维评分（100 分）**：

| 维度 | 分值 | 计算方式 |
|------|------|---------|
| 速度 | 35 | 人与 AI 的时间比分配 |
| 准确性 | 20 | 命令与故障类型的模式匹配（8 级精度） |
| 规范性 | 15 | kubectl 语法规范（AI 默认满分） |
| 成本 | 30 | 谁的账单更低（30/15/0 三档） |

**成本计算器**模拟真实云账单：
- Pod 费: $0.03/个/分钟
- 停机费: $0.05/秒
- 命令费: $0.02/条
- 过度配置费: $0.15/多余 Pod/分钟

---

## <a id="4"></a>四、三模式架构

| 模式 | K8s | 命名空间 | 目标服务 | 健康面板 | 告警信息 |
|------|-----|---------|---------|---------|---------|
| **练习** | Mock | chaos-game | frontend, order-service, product-service (2 副本) | 完整详情+资源条 | 显示故障类型和目标 |
| **Micro-Demo** | 真实 | demo-micro | frontend, order-service, product-service (2 副本) | 仅信号灯 | 隐藏故障→提示访问 30080 |
| **Bookinfo** | 真实 | default | productpage, details, ratings, reviews (1 副本) | 仅信号灯 | 隐藏故障→提示访问 30090 |

**关键设计**: 实战模式中 HealthPanel 只显示信号灯（绿/黄/红），不暴露具体哪个服务挂了。玩家必须通过终端命令自行排查——模拟真实 on-call 体验。

---

## <a id="5"></a>五、AI 集成设计

### 5.1 AI 作为竞争者

```
故障注入
    │
    ├─ 人类: 终端输入 kubectl → 排查 → 修复 ──┐
    │                                        ├──▶ 谁先修好?
    └─ AI: 10s等待 → LLM诊断 → 执行修复 ────┘
```

- AI 获得 10 秒"先手让渡"，让人类有反应窗口
- AI 诊断通过 DeepSeek API 流式输出，3-8 秒完成
- 若人类未及时修复，AI 自动修复并赢得该轮

### 5.2 AI 流式自动修复

放弃比赛/超时时：
1. `ai-repair-progress: start` → 前端显示"AI 自动修复启动"
2. `diagnoseWithStream()` → 逐 token 输出诊断文本（前端实时展示 AI 思考）
3. `attemptRepair()` → 验证命令 → 执行修复
4. `repairResult` → 前端显示修复命令和结果

### 5.3 LLM 供应商无关

AiEngine 支持任何 OpenAI-compatible API（DeepSeek 默认），通过环境变量配置：
- `LLM_API_KEY`: API 密钥
- `LLM_API_URL`: API 端点
- `LLM_MODEL`: 模型名称

无 API Key 时自动切换到规则引擎，保证离线可用。

---

## <a id="6"></a>六、混沌工程体系

### 6.1 混沌实验五步法

1. **稳态定义**: `captureBaseline()` 记录健康集群快照
2. **假设**: 系统能承受单一/双重故障
3. **注入**: 8 种故障随机选择，3 秒延迟模拟真实故障传播
4. **观测**: 1 秒间隔健康检查 + 实时仪表盘
5. **恢复**: AI/人类修复 + `injector.restore()` 清理

### 6.2 故障分类完整映射

按 **Netflix Chaos Monkey** 进阶模型：

| 层级 | CFD 对应故障 |
|------|------------|
| 应用层 | process-crash（杀进程） |
| 资源层 | cpu-stress, memory-leak, disk-full |
| 网络层 | network-delay（tc netem 注入） |
| 基础设施层 | scale-to-zero, kill-random-pod, kill-two-pods |

---

## <a id="7"></a>七、评分与云成本模型

### 7.1 成本意识教育

评分中**成本权重 30%** 是刻意设计——比速度(35%)略低，但对胜负关键：
- 快速但过度配置 → 成本高 → 可能输
- 修复太慢导致长时间停机 → 成本高 → 可能输
- **最优策略**: 快速 + 精准 + 经济

### 7.2 计分公平性

AI 默认获得满分标准化(15)和较低成本，人类需要在速度和准确性上追回差距：

```
人速度分(35) + 准确(20) + 规范(0-15) + 成本(0-30) = 100
AI速度分(35) + 准确(20) + 规范(15) + 成本(0-30) = 100
```

---

## <a id="8"></a>八、前端设计

### 8.1 组件树

```
App.vue
├── AlertNotification.vue    ← 告警通知（右上角滑入）
├── HealthPanel.vue           ← 集群健康（左栏）
│   ├── 完整模式: 服务卡片 + 资源条 + 故障摘要
│   └── 信号灯模式: 4 色灯 + 图例
├── GameConsole.vue           ← 游戏控制（中栏）
│   ├── 模式切换(3按钮)
│   ├── 难度选择(Easy/Hard)
│   └── 计时器 + 故障提示
├── AiDuelPanel.vue           ← AI对决（右栏）
│   ├── SVG 人/AI 图标
│   └── 诊断思路气泡
├── TerminalPanel.vue         ← 运维终端（底部）
│   ├── 3 主题(白/蓝/暗)
│   └── kubectl 语法高亮
└── ScoreBoard.vue            ← 结算面板（弹窗）
    ├── 速度/准确/规范/成本明细
    ├── 云成本对比
    └── AI 自动修复过程
```

### 8.2 实时数据流

WebSocket 处理 9 种消息类型：
`state-change` → `cluster-snapshot` → `fault-injected` → `alert-notification` → `ai-diagnosis` → `terminal-output` → `ai-repair-progress` → `mode-change` → `error`

### 8.3 交互设计亮点

- **信号灯系统**: 实战模式中隐藏故障细节，仅显示绿/黄/红指示灯
- **告警通知模拟**: 右上角滑入，带 ON-CALL 标签和震动动画（critical 级别）
- **语法高亮终端**: kubectl 动词加粗、参数蓝色、Pod 名绿色
- **AI 思考实时流**: 逐字输出诊断文本

---

## <a id="9"></a>九、K8s 部署架构

```
┌──────────────────────────────────────────────────┐
│               Docker Desktop K8s                   │
│                                                    │
│  ┌─────────────────────────┐  ┌────────────────┐  │
│  │ namespace: chaos-game    │  │ namespace:      │  │
│  │ ┌────────────────────┐  │  │  demo-micro     │  │
│  │ │ game-server (pod)  │  │  │  3 microservices│  │
│  │ │ - Express:3001     │  │  │  (Exp 2 产物)   │  │
│  │ │ - kubectl binary   │  │  └────────────────┘  │
│  │ │ - SA: chaos-admin  │  │                      │
│  │ └────────────────────┘  │  ┌────────────────┐  │
│  │ ┌────────────────────┐  │  │ namespace:      │  │
│  │ │ target-services    │  │  │  default        │  │
│  │ │ 3× nginx:alpine   │  │  │  Bookinfo (Istio)│  │
│  │ │ (练习模式靶子)     │  │  │  (4 services)   │  │
│  │ └────────────────────┘  │  └────────────────┘  │
│  └─────────────────────────┘                      │
└──────────────────────────────────────────────────┘
```

**RBAC 设计**: `ClusterRole` + `ClusterRoleBinding` 给 game-server 跨命名空间权限，支持 pods/deployments/scale/logs/exec/events 操作。

**镜像设计**: 两阶段 Dockerfile（前端构建 + Node 生产镜像），内置 `kubectl` 二进制。

---

## <a id="10"></a>十、实验联动设计

### 10.1 三个实验的完整链路

```
实验一 (OpenStack IaaS)
    │  学习: 虚拟机管理、网络配置、CLI 操作
    │  关联: CFD 训练终端中 OpenStack 命令来源于此
    ▼
实验二 (K8s 微服务部署)
    │  学习: Dockerfile、Deployment、Service、命名空间
    │  关联: CFD Micro-Demo 模式直接攻击 demo-micro 集群
    ▼
实验三 (Chaos Fire Drill)
    │  融合: K8s 集群上的混沌工程 + AI 竞速
    │  进阶: Bookinfo 模式攻击 Istio 服务网格
    ▼
综合能力: IaaS → CaaS → 混沌工程 → AIOps
```

### 10.2 具体关联点

| 实验 | CFD 关联 |
|------|---------|
| 实验一 OpenStack CLI | 终端命令格式一致（`openstack xxx` → `kubectl xxx`），学习迁移 |
| 实验一 网络配置 | K8s 中 Service/Ingress 映射到 OpenStack 的 Network/Router |
| 实验二 micro-demo | **直接使用** — CFD 的 Micro-Demo 模式攻击实验二的部署 |
| 实验二 副本概念 | CFD 的 scale-to-zero/kill-pod 故障直接体现副本机制 |
| 实验二 Service/Deployment | CFD 的 `kubectl get pods/deployments` 排查命令来源 |

### 10.3 学习脚手架

练习(mock, 零风险) → Micro-Demo(自己的集群, 浏览器可观察) → Bookinfo(行业标准, 更大复杂度)

---

## <a id="11"></a>十一、创新点总结

### 云计算创新

1. **跨命名空间混沌攻击**: ClusterRole 授权使单个 game-server 能同时攻击 3 个命名空间的目标
2. **Dogfooding 部署模式**: 混沌引擎自身运行在它攻击的集群内
3. **FinOps 教育**: 每轮游戏附带模拟云账单，成本权重 30%
4. **IaaS→CaaS→AIOps 链路**: 通过三个实验的联动覆盖全栈

### AI 创新

5. **AI 作为竞争者**: 不是助手，是限时对手——创造紧迫感
6. **LLM + 规则混合**: LLM 优先但规则兜底，保证离线可用
7. **流式 AI 可视化**: token-by-token 实时展示 AI 思考过程
8. **LLM-agnostic**: 可以换任何 OpenAI-compatible API

### 混沌工程创新

9. **游戏化混沌工程**: 8 种故障 + 评分系统创造竞技性
10. **8 种故障全模拟**: Mock 引擎完整复现故障效果
11. **自动故障恢复**: AI 在超时后自动诊断+修复

### 教育创新

12. **双模终端**: 统一终端同时支持 kubectl 和 Linux 命令
13. **信息隐藏游戏机制**: 实战模式隐藏故障详情
14. **告警模拟**: 右上角滑入通知模拟真实 on-call
15. **三模式渐进**: Mock → 自己集群 → 标准应用
