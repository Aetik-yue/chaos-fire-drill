# Chaos Fire Drill — 训练模式设计规格

> **状态**: 待评审 | **日期**: 2026-05-21 | **关联**: DESIGN.md | GUIDE.md

## 1. 目标与动机

**痛点**：学生使用 OpenStack CLI 和 Linux 命令行不熟练，缺乏实战练习环境。

**方案**：在现有 Chaos Fire Drill 基础上新增"训练模式"——通过任务闯关和排错挑战两种玩法，让学生在终端中练习 CLI 命令，每关结束后获得 AI 评分和个性化建议。

**核心原则**：
- 不修改现有练习模式（K8s chaos-game）和实战模式（K8s demo-micro）
- 训练模式独立运行，mock 引擎模拟 OpenStack 和 Linux 环境
- 所有命令通过现有 TerminalPanel 输入，复用 WebSocket/终端代理架构

---

## 2. 整体架构

```
Chaos Fire Drill
├── 练习模式（K8s 混沌工程，chaos-game 命名空间，真实 kubectl）
├── 实战模式（K8s 混沌工程，demo-micro 命名空间，真实 kubectl）
└── 训练模式 ← NEW
    ├── OpenStack CLI 域
    │   ├── 任务闯关（A）—— 给定目标，敲正确命令
    │   └── 排错挑战（B）—— 系统破坏状态，玩家排查修复
    └── Linux CLI 域
        ├── 任务闯关（A）—— 给定目标，敲正确命令
        └── 排错挑战（B）—— 系统破坏状态，玩家排查修复
```

### 2.1 组件图

```
┌──────────────────────────────────────────────────────┐
│                     Frontend (Vue 3)                  │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────────┐ │
│  │ GameConsole │  │ Terminal │  │ TrainingPanel   │ │ ← NEW
│  │ (+训练按钮) │  │ (扩展白   │  │ (关卡描述/提示/ │ │
│  │             │  │  名单)    │  │  结算面板)      │ │
│  └─────────────┘  └──────────┘  └─────────────────┘ │
└──────────────────────┬───────────────────────────────┘
                       │ WebSocket + REST
┌──────────────────────┴───────────────────────────────┐
│                   Game Server (Node.js)               │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ terminal │  │ openstack-   │  │ linux-         │ │ ← NEW
│  │ -proxy   │  │ mock.js      │  │ sandbox.js     │ │
│  │ (扩展)   │  │ (NEW)        │  │ (NEW)          │ │
│  └──────────┘  └──────────────┘  └────────────────┘ │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ training │  │ level-       │  │ ai-engine      │ │
│  │ -engine  │  │ loader.js    │  │ (扩展)         │ │
│  │ (NEW)    │  │ (NEW)        │  │                │ │
│  └──────────┘  └──────────────┘  └────────────────┘ │
└──────────────────────────────────────────────────────┘
```

---

## 3. 核心组件详细设计

### 3.1 OpenStack Mock 引擎（`openstack-mock.js`）

**职责**：模拟 OpenStack CLI 的所有输出，维护内存状态，验证玩家命令。

**状态模型**：

```javascript
class OpenStackMock {
  constructor() {
    this.state = {
      images: [],
      flavors: [
        { name: 'm1.tiny',   vcpus: 1, ram: 512,   disk: 1 },
        { name: 'm1.small',  vcpus: 1, ram: 2048,  disk: 20 },
        { name: 'm1.medium', vcpus: 2, ram: 4096,  disk: 40 },
      ],
      networks: [],
      subnets: [],
      routers: [],
      securityGroups: [{ name: 'default', rules: [] }],
      keypairs: [],
      instances: [],
      volumes: [],
    };
  }
}
```

**支持的命令**（对应实验一 17 个任务）：

| 类别 | 命令 |
|------|------|
| 镜像 | `image list`, `image create`, `image show`, `image delete` |
| 网络 | `network create`, `network list`, `subnet create`, `subnet list`, `router create`, `router add subnet`, `router set --external-gateway` |
| 计算 | `flavor list`, `server create`, `server list`, `server show`, `server start/stop/reboot/delete`, `server resize`, `console url show` |
| 安全 | `keypair create`, `keypair list`, `security group rule create`, `security group list` |
| 存储 | `volume create`, `volume list`, `volume attach/detach/delete` |
| 快照 | `server image create` |

**命令解析**：接收玩家输入的 `openstack xxx yyy --flag value`，解析出命令、子命令、参数，执行对应状态修改，返回模拟输出（格式与真实 OpenStack CLI 一致）。

**命令白名单扩展**（`terminal-proxy.js`）：

```
新增允许前缀：
  'openstack '   — 允许所有 openstack 子命令
  'ls', 'cat', 'grep', 'find', 'chmod', 'chown',
  'ps', 'kill', 'df', 'du', 'netstat', 'ss', 'curl',
  'tar', 'gzip', 'echo', 'mkdir', 'touch', 'cp', 'mv',
  'rm', 'ping', 'traceroute', 'ip', 'ifconfig', 'systemctl',
  'journalctl', 'dmesg', 'head', 'tail', 'wc', 'sort', 'uniq'
```

新增禁止模式：
```
/rm\s+-rf\s+\//     — 禁止 rm -rf /
/>\s*\/dev\/sda/    — 禁止写入磁盘设备
```

### 3.2 Linux 沙箱引擎（`linux-sandbox.js`）

**职责**：直接在 Node.js 容器内执行 Linux 命令，返回真实输出。对危险命令做白名单拦截。

**为什么不用 mock**：Linux 命令太多，mock 不现实。直接在容器的 Linux 环境执行能获得真实的输出，学生学习的就是真实环境。

**安全模型**：

```javascript
class LinuxSandbox {
  execute(command) {
    // 1. 危险命令黑名单拦截
    if (DANGEROUS_PATTERNS.some(p => p.test(command))) {
      return { success: false, output: '命令被安全策略拦截', command };
    }
    // 2. 工作目录限制到 /home/trainee 和 /tmp
    // 3. execSync(command, { timeout: 10000, cwd: '/home/trainee' })
  }
}
```

**工作目录**：每个训练会话维护一个 `/home/trainee` 目录，`reset()` 时清理恢复到初始状态（几个预设文件）。

**排错模式的状态注入**：系统在 `/home/trainee` 下制造问题——
- 改错文件权限（`chmod 000 important.conf`）
- 创建大文件占满磁盘（`dd if=/dev/zero of=/tmp/bigfile bs=1M count=500`）
- 修改配置文件引入语法错误
- 杀掉某进程

### 3.3 训练引擎（`training-engine.js`）

**职责**：关卡状态机——加载关卡、初始化环境、监听命令、验证完成、触发结算。

```javascript
class TrainingEngine {
  constructor(openstackMock, linuxSandbox, terminalProxy, aiEngine) { ... }

  // 加载关卡
  loadLevel(levelId) { ... }

  // 初始化关卡环境（排错模式先执行破坏操作）
  async setupLevel() { ... }

  // 监听终端命令，检测是否完成目标
  onCommand(command, result) {
    if (this.level.mode === 'task') {
      // 检查命令是否匹配 goal
      if (this.matchGoal(command, this.level.goal)) {
        this.completeLevel(command);
      }
    } else if (this.level.mode === 'debug') {
      // 检查系统状态是否恢复到健康
      if (this.validateState()) {
        this.completeLevel(command);
      }
    }
  }

  // 结算：基础评分 + AI 点评
  async completeLevel(lastCommand) {
    const score = this.scorer.score(this.session);
    const review = await this.aiEngine.reviewTraining(this.session);
    return { score, review, session: this.session };
  }
}
```

**关卡加载器**（`level-loader.js`）：

```javascript
// 从 levels/ 目录加载关卡 JSON 文件
function loadLevels() {
  const levels = [];
  const dir = path.join(__dirname, 'levels');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    levels.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  }
  return levels;
}
```

### 3.4 AI 评分与建议（扩展 `ai-engine.js`）

**新增方法**：`reviewTraining(session)`

```javascript
async reviewTraining(session) {
  const prompt = `你是一位云计算课程的助教。请点评学生的 CLI 操作。

关卡目标：${session.level.title}
关卡类型：${session.level.mode === 'task' ? '任务闯关' : '排错挑战'}
期望命令：${session.level.aiContext?.expectedCommand || '无'}
学生用时：${session.elapsed}s
学生命令历史：
${session.commandHistory.join('\n')}

请以 JSON 格式回复：
{
  "praise": "一句话肯定学生的优点（中文，20字以内）",
  "improvement": "一条可改进的建议（中文，30字以内）",
  "alternative": "一个替代命令方案（中文，30字以内，可选）",
  "learningTip": "建议学习的相关命令（中文，20字以内）"
}`;

  if (!this.apiKey) return this._ruleBasedReview(session);
  // ... 调 LLM ...
}
```

**规则回退**（无 API Key 时）：

```javascript
_ruleBasedReview(session) {
  const praise = session.errors === 0
    ? '命令一次性执行成功，非常熟练'
    : '通过排查最终修复了问题，debug 能力不错';
  return {
    praise,
    improvement: '试着使用 --help 查看命令的更多选项',
    alternative: '',
    learningTip: session.level.aiContext?.relatedCommands?.join(', ') || '',
  };
}
```

### 3.5 关卡评分器（扩展 `scorer.js` 或新增 `training-scorer.js`）

```javascript
class TrainingScorer {
  score(session) {
    const speedScore = this._scoreSpeed(session.elapsed, session.level.timeLimit);
    const accuracyScore = this._scoreAccuracy(session);
    const standardScore = this._scoreStandard(session);

    return {
      speed: speedScore,     // 50分
      accuracy: accuracyScore, // 30分
      standard: standardScore, // 20分
      total: speedScore + accuracyScore + standardScore,
    };
  }

  _scoreSpeed(elapsed, timeLimit) {
    if (elapsed <= timeLimit * 0.3) return 50;      // 前30%时间 = 满分
    if (elapsed <= timeLimit * 0.6) return 40;
    if (elapsed <= timeLimit) return 30;
    return 10; // 超时但完成了
  }

  _scoreAccuracy(session) {
    // 检查：命令是否完全匹配目标、有无多余/错误的命令尝试
    const errors = session.commandHistory.filter(c => c.isError).length;
    if (errors === 0 && session.commandHistory.length <= 2) return 30; // 完美
    if (errors === 0) return 25;
    if (errors <= 2) return 20;
    return 10;
  }

  _scoreStandard(session) {
    // 检查：是否正确使用长参数名、有无使用 help
    let score = 10;
    const lastCmd = session.lastCommand || '';
    if (lastCmd.includes('--help')) score -= 3; // 查了 help = 扣分（说明不熟）
    if (lastCmd.match(/--[a-z-]+/g)?.length >= 2) score += 5; // 用了多个长参数
    if (this._hasTypo(session.commandHistory)) score -= 5;
    return Math.max(0, Math.min(20, score));
  }
}
```

---

## 4. 关卡定义（JSON Schema）

### 4.1 任务闯关格式

```json
{
  "id": "openstack-task-01",
  "category": "openstack",
  "mode": "task",
  "title": "创建租户网络",
  "description": "使用 openstack 命令创建一个名为 selfservice 的虚拟网络。这是 OpenStack 中最基础的操作之一，后续的实例启动都需要关联网络。",
  "initialState": {
    "networks": []
  },
  "goal": {
    "type": "state-check",
    "check": "state.networks.length == 1 && state.networks[0].name == 'selfservice'"
  },
  "expectedCommands": ["openstack network create selfservice"],
  "timeLimit": 120,
  "hints": [
    "试试 openstack network create --help",
    "网络名称放在命令的最后"
  ],
  "aiContext": {
    "expectedCommand": "openstack network create selfservice",
    "relatedCommands": ["openstack network list", "openstack subnet create", "openstack router create"],
    "tips": ["创建网络后通常需要创建子网和路由器", "用 openstack network list 确认创建成功"]
  }
}
```

### 4.2 排错挑战格式

```json
{
  "id": "linux-debug-01",
  "category": "linux",
  "mode": "debug",
  "title": "磁盘空间已满",
  "description": "系统报告磁盘空间不足。请找出哪些文件占用了大量空间，并清理出至少 100MB。",
  "setup": {
    "type": "linux-sandbox",
    "actions": [
      { "command": "dd if=/dev/zero of=/home/trainee/logs/app.log bs=1M count=200" },
      { "command": "dd if=/dev/zero of=/home/trainee/cache/temp.dat bs=1M count=150" }
    ]
  },
  "goal": {
    "type": "state-check",
    "check": "diskFree > 100"
  },
  "timeLimit": 180,
  "hints": [
    "用 du -sh 查看目录大小",
    "df -h 查看磁盘使用情况",
    "find 可以按文件大小搜索"
  ],
  "aiContext": {
    "expectedCommand": "find /home/trainee -size +10M -delete",
    "relatedCommands": ["du -sh *", "df -h", "find -size", "ncdu"],
    "tips": ["du -sh * | sort -h 可以按大小排序", "先 du 查看再 rm 删除更安全"]
  }
}
```

### 4.3 完整关卡规划（20 关）

| # | ID | 类别 | 模式 | 标题 | 核心命令 |
|---|-----|------|------|------|---------|
| 1 | openstack-task-01 | OpenStack | 闯关 | 上传镜像 | `openstack image create` |
| 2 | openstack-task-02 | OpenStack | 闯关 | 创建租户网络 | `openstack network create` + `subnet create` |
| 3 | openstack-task-03 | OpenStack | 闯关 | 创建路由器 | `openstack router create` + `add subnet` |
| 4 | openstack-task-04 | OpenStack | 闯关 | 启动云实例 | `openstack server create` |
| 5 | openstack-task-05 | OpenStack | 闯关 | 管理安全组 | `openstack security group rule create` |
| 6 | openstack-debug-01 | OpenStack | 排错 | 实例无法 SSH | 安全组规则被删，修复 |
| 7 | openstack-debug-02 | OpenStack | 排错 | 网络不通 | 路由器网关丢失，重新设置 |
| 8 | openstack-debug-03 | OpenStack | 排错 | 实例启动失败 | flavor 不存在，创建合适的 flavor |
| 9 | openstack-debug-04 | OpenStack | 排错 | 镜像不可用 | 镜像文件损坏需重新上传 |
| 10 | openstack-debug-05 | OpenStack | 排错 | 多实例故障 | 两个实例同时被停止，逐一排查恢复 |
| 11 | linux-task-01 | Linux | 闯关 | 文件查找与过滤 | `find` + `grep` 查找特定内容 |
| 12 | linux-task-02 | Linux | 闯关 | 权限管理 | `chmod` + `chown` 修复文件权限 |
| 13 | linux-task-03 | Linux | 闯关 | 进程管理 | `ps` + `kill` 管理进程 |
| 14 | linux-task-04 | Linux | 闯关 | 磁盘与空间 | `df` + `du` 分析磁盘使用 |
| 15 | linux-task-05 | Linux | 闯关 | 文件归档 | `tar` + `gzip` 打包压缩 |
| 16 | linux-debug-01 | Linux | 排错 | 磁盘满 | 找到大文件并清理 |
| 17 | linux-debug-02 | Linux | 排错 | 端口占用 | 找到占用端口的进程并处理 |
| 18 | linux-debug-03 | Linux | 排错 | 服务无法启动 | 查看日志、修复配置文件权限 |
| 19 | linux-debug-04 | Linux | 排错 | 网络不通 | `ping`/`traceroute`/`ip` 排查网络 |
| 20 | linux-debug-05 | Linux | 排错 | 组合故障 | 磁盘满 + 权限错误 + 进程僵死 |

---

## 5. 前端变化

### 5.1 新增组件：TrainingPanel.vue

位于终端右侧或终端上方，显示当前关卡信息：

```
┌─────────────────────────────────────┐
│  📋 关卡 3/20：创建路由器            │ ← 标题 + 进度
│  ─────────────────────────────────── │
│  🎯 使用 openstack 命令创建 router1， │ ← 关卡描述
│     连接 selfservice 子网，           │
│     并设置外部网关为 provider         │
│  ─────────────────────────────────── │
│  ⏱ 01:47 / 02:00     💡 提示 [1/2] │ ← 计时 + 提示按钮
│  ─────────────────────────────────── │
│  📊 当前得分: 85         关卡进度: 3/20│
└─────────────────────────────────────┘
```

### 5.2 新增组件：TrainingResultOverlay.vue

关卡完成后弹出：

```
┌──────────────────────────────────────┐
│          🎉 关卡完成！                │
│  ────────────────────────────────────│
│  📊 得分：85/100                      │
│     速度 40/50 | 准确性 28/30 | 规范 17/20│
│  ────────────────────────────────────│
│  🤖 AI 点评：                         │
│  ✅ 命令一次性成功，网络创建正确       │
│  💡 建议先 list 检查是否有同名网络     │
│  📚 下一步学习：openstack subnet create│
│  ────────────────────────────────────│
│  [🔄 重试本关]    [▶ 下一关]          │
└──────────────────────────────────────┘
```

### 5.3 修改 GameConsole.vue

在三模式按钮组中新增"训练模式"按钮，调整 `startGame` 逻辑发送 `mode: 'training'` + `levelId`。

### 5.4 修改 App.vue

- 新增 `trainingState` 状态（当前关卡、得分、AI 点评等）
- 新增 `showTrainingResult` 控制结算面板显隐
- WebSocket 消息处理新增 `training-update` 和 `training-complete` 类型

### 5.5 修改 Terminal.vue

- 训练模式下 prompt 符号可能从 `$` 变成 `🖥 $` 或保留不变
- 错误提示增加教学友好信息

---

## 6. API 端点扩展

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/training/levels` | 获取所有关卡列表（ID、标题、分类、状态） |
| POST | `/api/training/start` | 启动指定关卡 `{ levelId }` |
| POST | `/api/training/stop` | 放弃当前关卡 |
| GET | `/api/training/state` | 获取当前关卡状态（题目、计时、提示） |
| GET | `/api/training/progress` | 获取总体进度（哪些关已完成、分数） |

---

## 7. WebSocket 消息扩展

| 消息类型 | 方向 | 说明 |
|---------|------|------|
| `training-start` | Server→Client | 关卡开始，包含题目描述和初始环境 |
| `training-update` | Server→Client | 关卡进度更新（时间、尝试次数） |
| `training-complete` | Server→Client | 关卡完成，包含分数和 AI 点评 |
| `training-hint` | Server→Client | 返回提示内容 |
| `training-error` | Server→Client | 关卡加载失败等信息 |

---

## 8. 目录结构变化

```
game-server/
├── ai-engine.js           # 扩展：新增 reviewTraining()
├── server.js              # 扩展：新增 /api/training/* 路由
├── terminal-proxy.js      # 扩展：白名单新增 openstack + linux 命令
├── training/              # NEW
│   ├── training-engine.js # 训练引擎（关卡状态机）
│   ├── openstack-mock.js  # OpenStack CLI 模拟器
│   ├── linux-sandbox.js   # Linux 命令沙箱
│   ├── level-loader.js    # 关卡 JSON 加载器
│   ├── training-scorer.js # 训练评分器
│   └── levels/            # 关卡定义文件
│       ├── openstack-task-01.json
│       ├── openstack-task-02.json
│       ├── ...
│       ├── linux-debug-05.json
│       └── index.json     # 关卡索引
├── ...
frontend/src/components/
├── TrainingPanel.vue      # NEW
├── TrainingResultOverlay.vue # NEW
├── GameConsole.vue        # 修改：新增训练按钮
└── App.vue                # 修改：新增训练状态
```

---

## 9. 数据流：一次完整的任务闯关

```
1. 用户在 GameConsole 点「训练模式」，选择关卡 "openstack-task-01"
2. POST /api/training/start { levelId: "openstack-task-01" }
3. 服务端：
   a. level-loader 加载 openstack-task-01.json
   b. openstack-mock 初始化空状态（无镜像）
   c. training-engine 启动计时器
   d. broadcast { type: 'training-start', level, initialState }
4. 前端 TrainingPanel 显示关卡描述和计时
5. 玩家在终端输入：openstack image create ubuntu --disk-format qcow2 --file ...
6. terminal-proxy 识别 openstack 命令 → 转发到 openstack-mock
7. openstack-mock 解析命令、更新状态、返回模拟输出
8. training-engine.onCommand() 检查 goal.check(state) → 条件满足 → completeLevel()
9. training-scorer 计算分数，ai-engine.reviewTraining() 生成点评
10. broadcast { type: 'training-complete', score, review }
11. 前端弹出 TrainingResultOverlay
```

---

## 10. 实施策略

### Phase 1：核心引擎（3 个组件）
- `openstack-mock.js` + `linux-sandbox.js` + `level-loader.js`
- 5 个任务闯关 JSON（3 OpenStack + 2 Linux）
- terminal-proxy 白名单扩展
- 验证：单元测试 + 手动在终端敲命令

### Phase 2：训练引擎 + 前端
- `training-engine.js` + `training-scorer.js`
- API 端点 + WebSocket 消息
- `TrainingPanel.vue` + `TrainingResultOverlay.vue`
- 验证：端到端完成一关

### Phase 3：AI 评分
- `ai-engine.reviewTraining()` 
- 规则回退版本
- 验证：有/无 API Key 场景

### Phase 4：排错模式 + 全部 20 关
- 排错模式的 setup/goal 逻辑
- 剩余 15 个关卡 JSON
- 验证：全部关卡可通关

---

## 11. 与现有系统的隔离

| 方面 | 现有系统 | 训练模式 |
|------|---------|---------|
| 命名空间 | chaos-game / demo-micro | 无（不操作真实 K8s） |
| kubectl | 真实 kubectl | 不涉及 |
| 状态机 | StateMachine (IDLE→INJECTING→DIAGNOSING→SCORING) | TrainingEngine（独立关卡状态） |
| 评分 | Scorer (speed+accuracy+standard) | TrainingScorer (独立评分维度) |
| AI | AiEngine.diagnose() | AiEngine.reviewTraining()（新方法） |
| 终端代理 | 仅允许 kubectl 白名单 | 动态白名单（按模式切换） |

**关键原则**：训练模式是**纯 mock/sandbox**，不依赖 Docker Desktop K8s，即使 K8s 没启动也能玩。
