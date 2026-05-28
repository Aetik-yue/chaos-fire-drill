# Chaos Fire Drill — 期末汇报文档

> **项目**: Chaos Fire Drill (云上消防演习)
> **定位**: 云计算课程期末大项目 | 融合实验一+实验二+混沌工程+AI
> **汇报版本**: v2.0 — 2026-05-28

---

## 一、项目简介

**Chaos Fire Drill** 是一个 gamified Kubernetes 混沌工程训练平台。

核心玩法：系统随机注入 K8s 集群故障，玩家和 AI 同时竞速排查修复。练习模式无风险练手 → Micro-Demo 攻击自己的微服务集群 → Bookinfo 挑战 Istio 生产级应用。

一句话总结：**"用游戏对抗 AI，在对抗中学习云计算"**。

---

## 二、为什么做这个项目

### 课程痛点

1. **K8s 概念抽象** — 学生知道 Pod/Deployment/Service，但从未真正排查过故障
2. **没有实战排错经验** — 实际运维中最重要的是"出问题了怎么办"，但课堂上很少教
3. **AI 只是工具不是老师** — ChatGPT 能回答问题，但不能创造学习动机

### 我们的答案

把混沌工程变成竞速游戏。AI 不是助手，是对手——它跟你比谁先修好。输了就知道自己哪里不足，赢了就有成就感。这就是"竞争驱动学习"。

---

## 三、整体架构

```
浏览器 (Vue 3 + WebSocket)
    │
    ▼
game-server (Node.js + Express + ws)
    ├── StateMachine     (游戏状态机)
    ├── ChaosInjector    (故障注入：8种)
    ├── AiEngine         (DeepSeek LLM + 规则引擎)
    ├── Scorer+C      (4维评分 + 云成本)
    ├── K8sClient        (Mock/Real 双模式)
    └── TerminalProxy    (命令安全代理)
    │
    ▼ (kubectl)
Kubernetes Cluster
    ├── chaos-game ns    (练习靶子: nginx ×3)
    ├── demo-micro ns    (Micro-Demo: 实验二的集群)
    └── default ns       (Bookinfo: Istio 微服务)
```

**技术栈**: Node.js + Express + WebSocket + Vue 3 + Vite + Docker + Kubernetes

### 关键架构决策

| 决策 | 理由 |
|------|------|
| 单体容器部署 | 一个 Pod 包含前端+后端+kubectl，一键部署 |
| Mock 模式优先 | 零依赖运行，不需要真实 K8s 集群 |
| WebSocket 广播 | 服务端单向推送，客户端 REST 操作，架构简洁 |
| 状态机与 IO 分离 | StateMachine 对 K8s/HTTP 完全无感知 |

---

## 四、游戏流程

```
玩家选模式+难度
    │
    ▼
[IDLE] ──start──▶ [INJECTING] ──3秒──▶ [DIAGNOSING]
                     ▲                        │
                     │ 故障注入                │ 人/AI 竞速修复
                     │                        ▼
                     │              [SCORING] 或 [TIMEOUT]
                     │                        │
                     └────reset()─────────────┘
```

### 详细时序

```
T=0s    故障注入 (3秒延迟)
T=3s    游戏进入 DIAGNOSING 阶段
        ├── 告警通知弹出 (右上角滑入)
        ├── 集群快照每秒更新
        └── 人类开始用 kubectl 排查

T=13s   AI 开始诊断 (给人类10秒先手)
T=16-21s AI 执行修复

T=任意  人类修复 → 系统检测 → 结算
T=300s  超时 → AI 流式自动修复 → 结算
```

---

## 五、核心模块详解

### 5.1 故障注入体系 (8 种)

| # | 故障 | 机制 | 检测方式 | Easy | Hard |
|---|------|------|---------|------|------|
| 1 | scale-to-zero | Deployment → 0 副本 | `kubectl get deployments` | ✓ | ✓ |
| 2 | kill-random-pod | Deployment → 1 副本 | `kubectl get deployments` | ✓ | ✓ |
| 3 | cpu-stress | Pod 内死循环 | `kubectl top pod` | ✓ | ✓ |
| 4 | memory-leak | Pod 内存泄漏 | `kubectl top pod` | ✓ | ✓ |
| 5 | disk-full | Pod 磁盘写满 | `kubectl exec ... df -h` | ✓ | ✓ |
| 6 | process-crash | 杀死 Pod 主进程 | `kubectl get pods` RESTARTS | ✓ | ✓ |
| 7 | network-delay | tc netem 注入延迟 | Pod ready=0/1 | — | ✓ |
| 8 | kill-two-pods | 两个服务同时缩容 | `kubectl get deployments` | — | ✓ |

**Easy: 6 选 1 | Hard: 8 选 2 (不同服务)**

### 5.2 AI 引擎

**两层架构**:

```
AiEngine
├── LLM 诊断 (DeepSeek API)
│   ├── 基线对比: 正常集群 vs 异常集群
│   ├── Prompt 工程: Pods + Deployments + Events JSON
│   ├── 流式输出: token-by-token → 前端实时展示
│   └── 回退: API 故障→规则引擎
│
├── 规则引擎 (本地)
│   ├── notReady Pods 检测
│   ├── CPU > 80% 检测
│   ├── 内存 > 80% 检测
│   ├── restarts > 0 检测
│   ├── available = 0 检测
│   └── ready < expected 检测
│
└── 修复验证 (attemptRepair)
    ├── scale/replicas
    ├── exec + pkill/tc/rm
    ├── rollout restart
    └── 拒绝诊断命令
```

**AI 竞速设计**: AI 给人类 10 秒先手，然后 3-8 秒内完成诊断→修复。这创造出真实的紧迫感。

### 5.3 评分体系 (100 分)

| 维度 | 分值 | 说明 |
|------|------|------|
| 速度 | 35 | 更快修复 = 更高分 (比例分配) |
| 准确性 | 20 | 命令是否精准匹配故障类型 |
| 规范性 | 15 | kubectl 语法规范 (AI 默认满分) |
| **成本** | **30** | **模拟云账单，越省钱分数越高** |

### 5.4 云成本模拟 (FinOps 教育)

| 收费项 | 费率 |
|--------|------|
| Pod 运行费 | $0.03/pod/分钟 |
| 停机损失 | $0.05/秒 |
| 命令执行费 | $0.02/条 |
| 过度配置罚款 | $0.15/多余 pod/分钟 |

**设计意图**: 让学生意识到——修得快 ≠ 修得好。过度配置、瞎猜命令都会增加成本。

---

## 六、三种模式对比

| | 练习模式 | Micro-Demo | Bookinfo |
|---|---|---|---|
| K8s | Mock 模拟 | 真实 K8s | 真实 K8s |
| 命名空间 | chaos-game | demo-micro | default |
| 靶子 | 3 × nginx 空壳 | 3 微服务 (实验二) | 4 微服务 (Istio) |
| 副本 | 2 | 2 | 1 |
| 仪表盘 | 完整详情 | 仅信号灯 | 仅信号灯 |
| 告警 | 显示故障详情 | 隐藏故障 → 给 URL | 隐藏故障 → 给 URL |
| 访问 URL | 无 | localhost:30080 | localhost:30090/productpage |
| 风险 | 零 | 低 (自己部署的) | 中 |

**渐进学习路径**: 练习→自己的集群→行业标准应用

---

## 七、实验联动

```
实验一 (OpenStack IaaS)
    │  学习: 虚拟机管理、CLI 操作、网络配置
    │  CFD 关联: 终端命令设计来源于 OpenStack CLI
    │
    ▼
实验二 (K8s 微服务)
    │  学习: Dockerfile、Deployment、Service、K8s 部署
    │  CFD 关联: Micro-Demo 模式直接攻击实验二的 demo-micro
    │
    ▼
CFD (混沌工程)
    │  融合: K8s 排错 + AI 竞速 + 成本意识
    │  进阶: Bookinfo 模式攻击 Istio 服务网格
    │
    ▼
综合能力: IaaS → CaaS → 混沌工程 → AIOps
```

**核心价值**: 三个实验不是孤立的——实验一打基础，实验二把服务部署上线，CFD 教你怎么在真实环境中排错。一条完整的云原生学习链路。

---

## 八、创新点汇总

### 云计算创新
1. **跨命名空间混沌攻击**: 一个 game-server pod，通过 ClusterRole 攻击 3 个不同命名空间
2. **FinOps 教育**: 成本权重 30%，培养云成本意识
3. **Dogfooding 部署**: 混沌引擎自身运行在被攻击的集群内
4. **三命名空间隔离**: 练习/实验/生产的资源完全隔离

### AI 创新
5. **AI 作为竞争者**: 不教你怎么做，而是跟你比谁快——驱动自主学习的动力远超"AI 辅助工具"
6. **流式 AI 诊断**: token-by-token 实时展示 AI 思考，让"黑盒 AI"变透明
7. **LLM + 规则混合**: LLM 优先但规则兜底，云端/本地都能用
8. **AI 自动修复**: 超时后 AI 自动诊断+修复，展示完整 AIOps 流程

### 混沌工程创新
9. **游戏化混沌实验**: 8 种故障 + 评分 + 竞速 = 可复现的混沌训练
10. **8 种故障全模拟**: Mock 引擎复现效果与真实 K8s 一致
11. **信息隐藏机制**: 实战模式只给信号灯，逼你用终端排查

### 教育创新
12. **三模式学习脚手架**: 零风险 → 低风险 → 中风险
13. **告警通知模拟**: 右上角滑入 + ON-CALL 标签 = 真实 on-call 体验
14. **云成本可视化**: 每轮游戏出账单，看得见的成本
15. **语法高亮终端**: kubectl 关键词加粗 + 参数蓝色 + Pod 名绿色 = 降低学习曲线

---

## 九、技术亮点

| 技术点 | 具体实现 |
|--------|---------|
| Mock 双模式 | `k8s-client.js` 的 `mockMode` 切换，内存态完整模拟 K8s |
| 状态机 | 5 状态 FSM + 不可变快照 + Listener 模式 |
| WebSocket 实时通信 | 9 种消息类型，1 秒间隔健康快照 |
| 命令安全 | 白名单(7种)+黑名单+命名空间注入 |
| 流式 LLM | `AsyncGenerator` + SSE 解析，前端逐字渲染 |
| RBAC | ClusterRole + ServiceAccount + Secret 注入 |
| 多阶段构建 | Dockerfile: 前端构建 → Node 生产 → kubectl 安装 |
| 主题系统 | CSS Custom Properties + `data-theme` 属性切换 |

---

## 十、演示流程建议

1. **练习模式演示 (2 分钟)**
   - 选 Easy + 练习 → 点开始
   - 告警弹出 → 看仪表盘 (完整信息)
   - 终端输入 `kubectl get deployments` → 发现故障
   - `kubectl scale deployment xxx --replicas=2` → 修复
   - 结算面板 + 云成本对比

2. **Micro-Demo 演示 (2 分钟)**
   - 切 Micro-Demo → 仪表盘变成信号灯 (亮点!)
   - 点 Hard 开始 → 告警只显示 URL，不给故障原因
   - 打开 localhost:30080 看到页面报错
   - 终端排查 → 修复 → 页面恢复正常

3. **放弃/超时 → AI 修复演示 (1 分钟)**
   - 开一局 → 不修复，等待或点"放弃"
   - AI 流式诊断 → ScoreBoard 显示 AI 思路
   - AI 自动修复 → 集群恢复

4. **Bookinfo 演示 (1 分钟)**
   - 切 Bookinfo → 4 个信号灯
   - 故障注入 → productpage 挂了
   - localhost:30090/productpage 无法访问
   - 终端排查 + 修复 → 页面恢复

---

## 十一、未来方向

1. **多人竞速模式**: 两个玩家同时在同一集群上排错
2. **故障回放系统**: 录制并回放每轮游戏的操作序列
3. **Post-Mortem 报告**: AI 自动生成事故分析报告
4. **关卡进阶模式**: 10 关学习路径，每关有明确教学目标

---

## 附录

### A. 项目文件结构

```
chaos-fire-drill/
├── game-server/
│   ├── server.js            [442行] 主入口 + API + WebSocket
│   ├── state-machine.js     [157行] 5 状态 FSM
│   ├── k8s-client.js        [358行] K8s 客户端 (Mock/Real)
│   ├── chaos-injector.js    [173行] 8 种故障注入器
│   ├── ai-engine.js         [250行] LLM + 规则引擎
│   ├── scorer.js            [183行] 4 维评分器
│   ├── cost-calculator.js   [37行] 云成本模拟
│   ├── terminal-proxy.js    [174行] 命令安全代理
│   └── __tests__/           [8 套, 108 条测试]
├── frontend/
│   └── src/
│       ├── App.vue          [271行] 根组件 + WebSocket
│       └── components/
│           ├── HealthPanel.vue      集群健康 (双模式)
│           ├── GameConsole.vue      游戏控制台
│           ├── AiDuelPanel.vue      AI 对决面板
│           ├── Terminal.vue         运维终端 (3 主题)
│           ├── ScoreBoard.vue       结算面板
│           └── AlertNotification.vue 告警通知
├── k8s/
│   ├── namespace.yaml
│   ├── game-server-deployment.yaml (含 RBAC)
│   └── target-services.yaml
├── Dockerfile               [2 阶段构建]
└── GUIDE.md                 [游戏攻略]
```

### B. 测试覆盖

- 8 个测试套件
- 108 条测试用例
- 覆盖所有核心模块 (state-machine, k8s-client, chaos-injector, ai-engine, scorer, terminal-proxy, cost-calculator, integration)

### C. API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/state` | 当前游戏状态 |
| POST | `/api/game/start` | 开始新游戏 |
| POST | `/api/game/stop` | 放弃本轮 (触发 AI 自动修复) |
| POST | `/api/game/reset` | 重置游戏 |
| GET | `/api/mode` | 获取当前模式 |
| POST | `/api/mode` | 切换模式 (practice/micro-demo/bookinfo) |
