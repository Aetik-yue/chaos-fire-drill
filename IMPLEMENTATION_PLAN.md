# Chaos Fire Drill Implementation Plan

> **Goal:** Build MVP of Chaos Fire Drill — a Node.js game server + Vue 3 frontend that lets users race against AI to diagnose and fix K8s faults.

**Architecture:** Monolithic game server (Express + WebSocket) with mock K8s client for dev/testing. Vue 3 SPA frontend with 5 components. All communication via WebSocket for real-time updates.

**Tech Stack:** Node.js 18+, Express, ws, Vue 3 + Vite, Jest, xterm.js

---

## Phase 1: Game Server Core Modules

### Task 1: Initialize game-server project

**Files:**
- Create: `game-server/package.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "chaos-fire-drill-server",
  "version": "1.0.0",
  "description": "Game server for Chaos Fire Drill",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --experimental-vm-modules node_modules/.bin/jest --forceExit",
    "test:watch": "node --experimental-vm-modules node_modules/.bin/jest --watch --forceExit"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd "期末大项目/chaos-fire-drill/game-server" && npm install`

---

### Task 2: K8s Client (with mock mode)

**Files:**
- Create: `game-server/k8s-client.js`
- Create: `game-server/__tests__/k8s-client.test.js`

- [ ] **Step 1: Write k8s-client.js**

```javascript
// K8s Client — wraps kubectl commands with mock mode for dev/testing
const { execSync } = require('child_process');

class K8sClient {
  constructor(options = {}) {
    this.mockMode = options.mockMode || false;
    this.namespace = options.namespace || 'chaos-game';
    this._mockState = {
      pods: [
        { name: 'frontend-abc123', ready: '1/1', status: 'Running', restarts: 0, age: '5m' },
        { name: 'frontend-def456', ready: '1/1', status: 'Running', restarts: 0, age: '5m' },
        { name: 'order-service-abc123', ready: '1/1', status: 'Running', restarts: 0, age: '5m' },
        { name: 'order-service-def456', ready: '1/1', status: 'Running', restarts: 0, age: '5m' },
        { name: 'product-service-abc123', ready: '1/1', status: 'Running', restarts: 0, age: '5m' },
        { name: 'product-service-def456', ready: '1/1', status: 'Running', restarts: 0, age: '5m' },
      ],
      deployments: [
        { name: 'frontend', ready: '2/2', upToDate: 2, available: 2, age: '10m' },
        { name: 'order-service', ready: '2/2', upToDate: 2, available: 2, age: '10m' },
        { name: 'product-service', ready: '2/2', upToDate: 2, available: 2, age: '10m' },
      ],
      events: [],
      injectedFault: null,
    };
  }

  _exec(command) {
    if (this.mockMode) {
      return this._mockExec(command);
    }
    try {
      return execSync(command, { encoding: 'utf8', timeout: 10000 });
    } catch (err) {
      throw new Error(`kubectl failed: ${err.stderr || err.message}`);
    }
  }

  _mockExec(command) {
    if (command.includes('get pods')) {
      return this._formatPodsTable();
    }
    if (command.includes('get deployments')) {
      return this._formatDeploymentsTable();
    }
    if (command.includes('get events')) {
      return 'LAST SEEN   TYPE     REASON              OBJECT\n' +
        (this._mockState.events.length > 0
          ? this._mockState.events.map(e => `${e.lastSeen}   ${e.type}   ${e.reason}   ${e.object}`).join('\n')
          : '2m         Normal   Scheduled           pod/order-service-abc123\n');
    }
    if (command.includes('delete pod') || command.includes('delete pod/')) {
      const podName = command.match(/(\S+)$/)[1];
      this._mockState.pods = this._mockState.pods.filter(p => p.name !== podName);
      this._mockState.pods.push({
        name: podName.replace(/-\w+$/, '-xyz789'),
        ready: '1/1', status: 'Running', restarts: 0, age: '1s'
      });
      return `pod "${podName}" deleted`;
    }
    if (command.includes('scale deployment') && command.includes('--replicas=0')) {
      const deployName = command.match(/deployment\s+(\S+)/)[1];
      this._mockState.pods = this._mockState.pods.filter(p => !p.name.startsWith(deployName));
      this._mockState.deployments = this._mockState.deployments.map(d =>
        d.name === deployName ? { ...d, ready: '0/2', available: 0 } : d
      );
      return `deployment.apps/${deployName} scaled`;
    }
    if (command.includes('scale deployment') && command.includes('--replicas=')) {
      const deployName = command.match(/deployment\s+(\S+)/)[1];
      const replicas = parseInt(command.match(/--replicas=(\d+)/)[1]);
      this._mockState.deployments = this._mockState.deployments.map(d =>
        d.name === deployName ? { ...d, ready: `${replicas}/${replicas}`, available: replicas } : d
      );
      // Add pods back for restored deployment
      const existingCount = this._mockState.pods.filter(p => p.name.startsWith(deployName)).length;
      for (let i = existingCount; i < replicas; i++) {
        this._mockState.pods.push({
          name: `${deployName}-new${i}${i}`,
          ready: '1/1', status: 'Running', restarts: 0, age: '1s'
        });
      }
      return `deployment.apps/${deployName} scaled`;
    }
    if (command.includes('exec') && command.includes('pkill')) {
      return '';
    }
    return '';
  }

  _formatPodsTable() {
    const header = 'NAME                      READY   STATUS    RESTARTS   AGE';
    const rows = this._mockState.pods.map(p =>
      `${p.name.padEnd(25)} ${p.ready.padEnd(7)} ${p.status.padEnd(9)} ${String(p.restarts).padEnd(10)} ${p.age}`
    );
    return [header, ...rows].join('\n');
  }

  _formatDeploymentsTable() {
    const header = 'NAME             READY   UP-TO-DATE   AVAILABLE   AGE';
    const rows = this._mockState.deployments.map(d =>
      `${d.name.padEnd(16)} ${d.ready.padEnd(7)} ${String(d.upToDate).padEnd(12)} ${String(d.available).padEnd(12)} ${d.age}`
    );
    return [header, ...rows].join('\n');
  }

  getPods() {
    const output = this._exec(`kubectl get pods -n ${this.namespace}`);
    return this._parsePods(output);
  }

  _parsePods(output) {
    const lines = output.trim().split('\n');
    if (lines.length < 2) return [];
    return lines.slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        name: parts[0],
        ready: parts[1],
        status: parts[2],
        restarts: parseInt(parts[3]) || 0,
        age: parts[4] || '',
      };
    });
  }

  getDeployments() {
    const output = this._exec(`kubectl get deployments -n ${this.namespace}`);
    return this._parseDeployments(output);
  }

  _parseDeployments(output) {
    const lines = output.trim().split('\n');
    if (lines.length < 2) return [];
    return lines.slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        name: parts[0],
        ready: parts[1],
        upToDate: parseInt(parts[2]) || 0,
        available: parseInt(parts[3]) || 0,
        age: parts[4] || '',
      };
    });
  }

  getEvents() {
    const output = this._exec(`kubectl get events -n ${this.namespace} --sort-by='.lastTimestamp' | tail -10`);
    return output;
  }

  getClusterSnapshot() {
    return {
      pods: this.getPods(),
      deployments: this.getDeployments(),
      events: this.getEvents(),
      timestamp: Date.now(),
    };
  }

  deletePod(name) {
    return this._exec(`kubectl delete pod ${name} -n ${this.namespace}`);
  }

  scaleDeployment(name, replicas) {
    return this._exec(`kubectl scale deployment ${name} --replicas=${replicas} -n ${this.namespace}`);
  }

  execInPod(podName, command) {
    return this._exec(`kubectl exec ${podName} -n ${this.namespace} -- ${command}`);
  }

  isHealthy() {
    const pods = this.getPods();
    const allRunning = pods.every(p => p.status === 'Running');
    const deployments = this.getDeployments();
    if (deployments.length === 0) return false;
    const allAvailable = deployments.every(d => d.available > 0);
    return allRunning && allAvailable;
  }

  // Inject a fault into mock state (for testing without real K8s)
  injectMockFault(type, target) {
    this._mockState.injectedFault = { type, target, injectedAt: Date.now() };
    this._mockState.events.push({
      lastSeen: '0s',
      type: 'Warning',
      reason: 'FaultInjected',
      object: `deployment/${target}`,
    });

    if (type === 'kill-random-pod') {
      const targetPods = this._mockState.pods.filter(p => p.name.startsWith(target));
      if (targetPods.length > 0) {
        const pod = targetPods[0];
        this._mockState.pods = this._mockState.pods.filter(p => p.name !== pod.name);
      }
    } else if (type === 'scale-to-zero') {
      this._mockState.pods = this._mockState.pods.filter(p => !p.name.startsWith(target));
      this._mockState.deployments = this._mockState.deployments.map(d =>
        d.name === target ? { ...d, ready: '0/2', available: 0 } : d
      );
    }
  }

  // Clear injected fault from mock state
  clearMockFault() {
    const fault = this._mockState.injectedFault;
    if (!fault) return;

    if (fault.type === 'scale-to-zero') {
      this._mockState.deployments = this._mockState.deployments.map(d =>
        d.name === fault.target ? { ...d, ready: '2/2', available: 2 } : d
      );
      for (let i = 0; i < 2; i++) {
        this._mockState.pods.push({
          name: `${fault.target}-restored${i}`,
          ready: '1/1', status: 'Running', restarts: 0, age: '1s'
        });
      }
    } else if (fault.type === 'kill-random-pod') {
      this._mockState.pods.push({
        name: `${fault.target}-restored0`,
        ready: '1/1', status: 'Running', restarts: 0, age: '1s'
      });
    }
    this._mockState.injectedFault = null;
    this._mockState.events = [];
  }
}

module.exports = K8sClient;
```

- [ ] **Step 2: Write test file**

Create file `game-server/__tests__/k8s-client.test.js`:

```javascript
const K8sClient = require('../k8s-client');

describe('K8sClient (mock mode)', () => {
  let client;

  beforeEach(() => {
    client = new K8sClient({ mockMode: true });
  });

  test('getPods returns 6 pods initially', () => {
    const pods = client.getPods();
    expect(pods.length).toBe(6);
    expect(pods[0]).toHaveProperty('name');
    expect(pods[0]).toHaveProperty('status', 'Running');
  });

  test('getDeployments returns 3 deployments', () => {
    const deps = client.getDeployments();
    expect(deps.length).toBe(3);
    expect(deps.map(d => d.name).sort()).toEqual(
      ['frontend', 'order-service', 'product-service'].sort()
    );
  });

  test('isHealthy returns true initially', () => {
    expect(client.isHealthy()).toBe(true);
  });

  test('deletePod removes a pod', () => {
    client.deletePod('frontend-abc123');
    const pods = client.getPods();
    const frontendPods = pods.filter(p => p.name.startsWith('frontend'));
    expect(frontendPods.length).toBe(2); // Replaced: -abc123 removed, -xyz789 added
  });

  test('scaleDeployment to 0 removes pods', () => {
    client.scaleDeployment('order-service', 0);
    const pods = client.getPods();
    const orderPods = pods.filter(p => p.name.startsWith('order-service'));
    expect(orderPods.length).toBe(0);
  });

  test('isHealthy returns false after scale to 0', () => {
    client.scaleDeployment('order-service', 0);
    expect(client.isHealthy()).toBe(false);
  });

  test('injectMockFault kill-random-pod makes a pod disappear', () => {
    const before = client.getPods().filter(p => p.name.startsWith('order-service')).length;
    client.injectMockFault('kill-random-pod', 'order-service');
    const after = client.getPods().filter(p => p.name.startsWith('order-service')).length;
    expect(after).toBe(before - 1);
  });

  test('injectMockFault scale-to-zero removes all pods of target', () => {
    client.injectMockFault('scale-to-zero', 'product-service');
    const pods = client.getPods().filter(p => p.name.startsWith('product-service'));
    expect(pods.length).toBe(0);
  });

  test('clearMockFault restores scale-to-zero', () => {
    client.injectMockFault('scale-to-zero', 'product-service');
    client.clearMockFault();
    expect(client.isHealthy()).toBe(true);
    const pods = client.getPods().filter(p => p.name.startsWith('product-service'));
    expect(pods.length).toBeGreaterThan(0);
  });

  test('getClusterSnapshot returns expected shape', () => {
    const snap = client.getClusterSnapshot();
    expect(snap).toHaveProperty('pods');
    expect(snap).toHaveProperty('deployments');
    expect(snap).toHaveProperty('events');
    expect(snap).toHaveProperty('timestamp');
  });
});
```

- [ ] **Step 3: Run tests and verify they pass**

Run: `cd "期末大项目/chaos-fire-drill/game-server" && npx jest __tests__/k8s-client.test.js --forceExit`

Expected: All 9 tests pass.

---

### Task 3: Game State Machine

**Files:**
- Create: `game-server/state-machine.js`
- Create: `game-server/__tests__/state-machine.test.js`

- [ ] **Step 1: Write state-machine.js**

```javascript
// Game State Machine — manages the 5 game states and transitions

const VALID_STATES = ['IDLE', 'INJECTING', 'DIAGNOSING', 'SCORING', 'TIMEOUT'];
const VALID_TRANSITIONS = {
  IDLE: ['INJECTING'],
  INJECTING: ['DIAGNOSING'],
  DIAGNOSING: ['SCORING', 'TIMEOUT'],
  SCORING: ['IDLE'],
  TIMEOUT: ['IDLE'],
};

class StateMachine {
  constructor() {
    this.state = {
      status: 'IDLE',
      difficulty: 'easy',
      round: 0,
      faults: [],
      startTime: null,
      timeout: 300,
      humanRepaired: false,
      aiRepaired: false,
      humanScore: 0,
      aiScore: 0,
      winner: null,
      roundSummary: '',
    };
    this.listeners = [];
  }

  getState() {
    return { ...this.state };
  }

  getStatus() {
    return this.state.status;
  }

  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  _notify(event) {
    for (const listener of this.listeners) {
      try { listener(this.state, event); } catch (e) { /* ignore */ }
    }
  }

  transition(newStatus, eventData = {}) {
    const current = this.state.status;
    if (!VALID_STATES.includes(newStatus)) {
      throw new Error(`Invalid state: ${newStatus}`);
    }
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(`Invalid transition: ${current} -> ${newStatus}`);
    }

    this.state.status = newStatus;

    if (newStatus === 'INJECTING') {
      this.state.faults = [];
      this.state.humanRepaired = false;
      this.state.aiRepaired = false;
      this.state.winner = null;
      this.state.roundSummary = '';
    }

    if (newStatus === 'DIAGNOSING') {
      this.state.startTime = Date.now();
    }

    if (newStatus === 'SCORING' || newStatus === 'TIMEOUT') {
      // Scoring is handled externally by scorer module
    }

    if (newStatus === 'IDLE') {
      this.state.round += 1;
    }

    this._notify(eventData);
    return this.getState();
  }

  startGame(difficulty = 'easy') {
    if (this.state.status !== 'IDLE') {
      throw new Error('Game already in progress');
    }
    this.state.difficulty = difficulty;
    return this.transition('INJECTING', { action: 'start', difficulty });
  }

  startDiagnosing(faults) {
    if (this.state.status !== 'INJECTING') {
      throw new Error('Must be in INJECTING state');
    }
    this.state.faults = faults;
    return this.transition('DIAGNOSING', { action: 'diagnosing', faults });
  }

  markHumanRepaired(command) {
    if (this.state.status !== 'DIAGNOSING') return;
    this.state.humanRepaired = true;
    this.state.humanRepairCommand = command;
    this.state.humanRepairTime = Date.now() - this.state.startTime;
    this._notify({ action: 'human-repaired' });
  }

  markAiRepaired(command) {
    if (this.state.status !== 'DIAGNOSING') return;
    this.state.aiRepaired = true;
    this.state.aiRepairCommand = command;
    this.state.aiRepairTime = Date.now() - this.state.startTime;
    this._notify({ action: 'ai-repaired' });
  }

  endGame(scoringResult) {
    if (this.state.status !== 'DIAGNOSING') {
      throw new Error('Must be in DIAGNOSING state');
    }
    Object.assign(this.state, scoringResult);
    return this.transition('SCORING', { action: 'scoring', ...scoringResult });
  }

  timeout() {
    if (this.state.status !== 'DIAGNOSING') {
      throw new Error('Must be in DIAGNOSING state');
    }
    return this.transition('TIMEOUT', { action: 'timeout' });
  }

  reset() {
    if (this.state.status !== 'SCORING' && this.state.status !== 'TIMEOUT') {
      throw new Error('Can only reset from SCORING or TIMEOUT');
    }
    return this.transition('IDLE', { action: 'reset' });
  }

  getElapsedSeconds() {
    if (!this.state.startTime) return 0;
    return Math.floor((Date.now() - this.state.startTime) / 1000);
  }
}

module.exports = StateMachine;
```

- [ ] **Step 2: Write test file**

Create file `game-server/__tests__/state-machine.test.js`:

```javascript
const StateMachine = require('../state-machine');

describe('StateMachine', () => {
  let sm;

  beforeEach(() => {
    sm = new StateMachine();
  });

  test('initial state is IDLE', () => {
    expect(sm.getStatus()).toBe('IDLE');
  });

  test('startGame transitions IDLE -> INJECTING', () => {
    const state = sm.startGame('easy');
    expect(state.status).toBe('INJECTING');
    expect(state.difficulty).toBe('easy');
  });

  test('startDiagnosing transitions INJECTING -> DIAGNOSING', () => {
    sm.startGame('easy');
    const state = sm.startDiagnosing([{ type: 'scale-to-zero', target: 'order-service' }]);
    expect(state.status).toBe('DIAGNOSING');
    expect(state.faults.length).toBe(1);
    expect(state.startTime).not.toBeNull();
  });

  test('cannot startGame from non-IDLE state', () => {
    sm.startGame('easy');
    expect(() => sm.startGame('easy')).toThrow('Game already in progress');
  });

  test('cannot startDiagnosing from non-INJECTING state', () => {
    expect(() => sm.startDiagnosing([])).toThrow('Must be in INJECTING state');
  });

  test('markHumanRepaired records repair info', () => {
    sm.startGame('easy');
    sm.startDiagnosing([{ type: 'scale-to-zero', target: 'order-service' }]);
    sm.markHumanRepaired('kubectl scale deployment order-service --replicas=2');
    const state = sm.getState();
    expect(state.humanRepaired).toBe(true);
    expect(state.humanRepairCommand).toContain('kubectl scale');
    expect(state.humanRepairTime).toBeGreaterThanOrEqual(0);
  });

  test('markAiRepaired records AI repair info', () => {
    sm.startGame('easy');
    sm.startDiagnosing([{ type: 'kill-random-pod', target: 'product-service' }]);
    sm.markAiRepaired('kubectl scale deployment product-service --replicas=2');
    const state = sm.getState();
    expect(state.aiRepaired).toBe(true);
  });

  test('endGame transitions DIAGNOSING -> SCORING', () => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    const result = { winner: 'human', roundSummary: '你赢了' };
    const state = sm.endGame(result);
    expect(state.status).toBe('SCORING');
    expect(state.winner).toBe('human');
  });

  test('cannot endGame from non-DIAGNOSING', () => {
    expect(() => sm.endGame({})).toThrow('Must be in DIAGNOSING state');
  });

  test('timeout transitions DIAGNOSING -> TIMEOUT', () => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    const state = sm.timeout();
    expect(state.status).toBe('TIMEOUT');
  });

  test('reset transitions SCORING -> IDLE and increments round', () => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    sm.endGame({ winner: 'ai' });
    const state = sm.reset();
    expect(state.status).toBe('IDLE');
    expect(state.round).toBe(1);
  });

  test('reset transitions TIMEOUT -> IDLE and increments round', () => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    sm.timeout();
    const state = sm.reset();
    expect(state.status).toBe('IDLE');
    expect(state.round).toBe(1);
  });

  test('cannot reset from IDLE', () => {
    expect(() => sm.reset()).toThrow('Can only reset from SCORING or TIMEOUT');
  });

  test('onChange listener is called on transition', () => {
    const listener = jest.fn();
    sm.onChange(listener);
    sm.startGame('easy');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'INJECTING' }),
      expect.objectContaining({ action: 'start' })
    );
  });

  test('getElapsedSeconds returns seconds since DIAGNOSING start', (done) => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    setTimeout(() => {
      const elapsed = sm.getElapsedSeconds();
      expect(elapsed).toBeGreaterThanOrEqual(0);
      done();
    }, 100);
  });

  test('full game flow works end to end', () => {
    expect(sm.getStatus()).toBe('IDLE');

    sm.startGame('easy');
    expect(sm.getStatus()).toBe('INJECTING');

    sm.startDiagnosing([{ type: 'scale-to-zero', target: 'order-service' }]);
    expect(sm.getStatus()).toBe('DIAGNOSING');

    sm.markAiRepaired('kubectl scale deployment order-service --replicas=2');
    sm.endGame({ winner: 'ai', roundSummary: 'AI 先修复' });
    expect(sm.getStatus()).toBe('SCORING');

    sm.reset();
    expect(sm.getStatus()).toBe('IDLE');
    expect(sm.getState().round).toBe(1);
  });

  test('invalid transition throws error', () => {
    expect(() => sm.transition('DIAGNOSING')).toThrow('Invalid transition');
  });

  test('invalid state throws error', () => {
    expect(() => sm.transition('INVALID')).toThrow('Invalid state');
  });
});
```

- [ ] **Step 3: Run tests and verify they pass**

Run: `cd "期末大项目/chaos-fire-drill/game-server" && npx jest __tests__/state-machine.test.js --forceExit`

Expected: All 18 tests pass.

---

### Task 4: Chaos Injector

**Files:**
- Create: `game-server/chaos-injector.js`
- Create: `game-server/__tests__/chaos-injector.test.js`

- [ ] **Step 1: Write chaos-injector.js**

```javascript
// Chaos Injector — injects faults into the K8s cluster

const FAULT_POOL = {
  easy: [
    { type: 'kill-random-pod', description: '随机杀死一个 Pod' },
    { type: 'scale-to-zero', description: '将某个 Deployment 副本数缩为 0' },
  ],
  hard: [
    { type: 'kill-random-pod', description: '随机杀死一个 Pod' },
    { type: 'scale-to-zero', description: '将某个 Deployment 副本数缩为 0' },
    { type: 'network-delay', description: '注入网络延迟' },
    { type: 'kill-two-pods', description: '同时杀死两个服务的 Pod' },
  ],
};

const TARGET_SERVICES = ['frontend', 'order-service', 'product-service'];

class ChaosInjector {
  constructor(k8sClient) {
    this.k8s = k8sClient;
  }

  pickFault(difficulty) {
    const pool = FAULT_POOL[difficulty] || FAULT_POOL.easy;
    const count = difficulty === 'hard' ? 2 : 1;
    const faults = [];
    const usedTargets = new Set();

    for (let i = 0; i < count; i++) {
      const availableTargets = TARGET_SERVICES.filter(t => !usedTargets.has(t));
      if (availableTargets.length === 0) break;

      const faultTemplate = pool[Math.floor(Math.random() * pool.length)];
      const target = availableTargets[Math.floor(Math.random() * availableTargets.length)];
      usedTargets.add(target);

      faults.push({
        id: `fault-${Date.now()}-${i}`,
        type: faultTemplate.type,
        description: faultTemplate.description,
        target,
        injectedAt: null,
        restoreFn: this._getRestoreFn(faultTemplate.type, target),
      });
    }
    return faults;
  }

  _getRestoreFn(type, target) {
    switch (type) {
      case 'kill-random-pod':
        return { method: 'wait-recreate', description: '等待 Deployment 自动重建 Pod' };
      case 'scale-to-zero':
        return { method: 'scale', replicas: 2, target, command: `kubectl scale deployment ${target} --replicas=2` };
      case 'network-delay':
        return { method: 'exec', target, command: 'tc qdisc del dev eth0 root' };
      case 'kill-two-pods':
        return { method: 'wait-recreate', description: '等待 Deployment 自动重建 Pod' };
      default:
        return { method: 'manual' };
    }
  }

  async inject(faults) {
    for (const fault of faults) {
      fault.injectedAt = Date.now();
      await this._executeFault(fault);
    }
    // Wait for fault to take effect
    await this._sleep(3000);
    return faults;
  }

  async _executeFault(fault) {
    switch (fault.type) {
      case 'kill-random-pod': {
        const pods = this.k8s.getPods();
        const targetPods = pods.filter(p => p.name.startsWith(fault.target));
        if (targetPods.length > 0) {
          const victim = targetPods[Math.floor(Math.random() * targetPods.length)];
          this.k8s.deletePod(victim.name);
          fault.podKilled = victim.name;
        }
        break;
      }
      case 'scale-to-zero': {
        this.k8s.scaleDeployment(fault.target, 0);
        break;
      }
      case 'network-delay': {
        const pods = this.k8s.getPods();
        const targetPods = pods.filter(p => p.name.startsWith(fault.target));
        if (targetPods.length > 0) {
          const victim = targetPods[0];
          this.k8s.execInPod(victim.name, 'tc qdisc add dev eth0 root netem delay 500ms');
          fault.podAffected = victim.name;
        }
        break;
      }
      case 'kill-two-pods': {
        // Handled specially — two separate kill-random-pod faults
        const servicePods = this.k8s.getPods();
        if (servicePods.length > 0) {
          const victim = servicePods[Math.floor(Math.random() * servicePods.length)];
          this.k8s.deletePod(victim.name);
          fault.podKilled = victim.name;
        }
        break;
      }
    }
  }

  async restore(faults) {
    for (const fault of faults) {
      await this._executeRestore(fault);
    }
  }

  async _executeRestore(fault) {
    const rf = fault.restoreFn;
    if (rf.method === 'scale') {
      this.k8s.scaleDeployment(rf.target, rf.replicas);
    } else if (rf.method === 'exec') {
      const pods = this.k8s.getPods();
      const targetPod = pods.find(p => p.name.startsWith(rf.target));
      if (targetPod) {
        this.k8s.execInPod(targetPod.name, rf.command);
      }
    }
    // wait-recreate: do nothing, K8s handles it
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // For mock mode: directly manipulate k8s client's mock state
  injectMock(faults) {
    for (const fault of faults) {
      fault.injectedAt = Date.now();
      if (this.k8s.injectMockFault) {
        this.k8s.injectMockFault(fault.type, fault.target);
      }
    }
    return faults;
  }

  restoreMock(faults) {
    for (const fault of faults) {
      if (this.k8s.clearMockFault) {
        this.k8s.clearMockFault();
      }
    }
  }
}

module.exports = { ChaosInjector, FAULT_POOL, TARGET_SERVICES };
```

- [ ] **Step 2: Write test file**

Create file `game-server/__tests__/chaos-injector.test.js`:

```javascript
const { ChaosInjector } = require('../chaos-injector');
const K8sClient = require('../k8s-client');

describe('ChaosInjector', () => {
  let k8s;
  let injector;

  beforeEach(() => {
    k8s = new K8sClient({ mockMode: true });
    injector = new ChaosInjector(k8s);
  });

  test('pickFault easy returns 1 fault', () => {
    const faults = injector.pickFault('easy');
    expect(faults.length).toBe(1);
    expect(faults[0]).toHaveProperty('id');
    expect(faults[0]).toHaveProperty('type');
    expect(faults[0]).toHaveProperty('target');
    expect(faults[0]).toHaveProperty('restoreFn');
  });

  test('pickFault hard returns 2 faults', () => {
    const faults = injector.pickFault('hard');
    expect(faults.length).toBe(2);
    // Different targets
    expect(faults[0].target).not.toBe(faults[1].target);
  });

  test('pickFault returns only valid fault types', () => {
    for (let i = 0; i < 10; i++) {
      const faults = injector.pickFault('easy');
      expect(['kill-random-pod', 'scale-to-zero']).toContain(faults[0].type);
    }
  });

  test('pickFault targets are valid services', () => {
    for (let i = 0; i < 10; i++) {
      const faults = injector.pickFault('easy');
      expect(['frontend', 'order-service', 'product-service']).toContain(faults[0].target);
    }
  });

  test('injectMock scale-to-zero makes cluster unhealthy', () => {
    const faults = injector.pickFault('easy');
    // Force scale-to-zero for predictable test
    faults[0].type = 'scale-to-zero';
    faults[0].target = 'order-service';
    faults[0].restoreFn = { method: 'scale', replicas: 2, target: 'order-service' };

    injector.injectMock(faults);
    expect(k8s.isHealthy()).toBe(false);

    const pods = k8s.getPods();
    const orderPods = pods.filter(p => p.name.startsWith('order-service'));
    expect(orderPods.length).toBe(0);
  });

  test('injectMock kill-random-pod reduces pod count', () => {
    const before = k8s.getPods().length;
    const faults = injector.pickFault('easy');
    faults[0].type = 'kill-random-pod';
    faults[0].target = 'order-service';
    faults[0].restoreFn = { method: 'wait-recreate' };

    injector.injectMock(faults);
    const after = k8s.getPods().length;
    expect(after).toBe(before - 1);
  });

  test('restoreMock clears fault and restores health', () => {
    const faults = injector.pickFault('easy');
    faults[0].type = 'scale-to-zero';
    faults[0].target = 'order-service';
    faults[0].restoreFn = { method: 'scale', replicas: 2, target: 'order-service' };

    injector.injectMock(faults);
    expect(k8s.isHealthy()).toBe(false);

    injector.restoreMock(faults);
    expect(k8s.isHealthy()).toBe(true);
  });

  test('pickFault id is unique per call', () => {
    const f1 = injector.pickFault('easy');
    const f2 = injector.pickFault('easy');
    expect(f1[0].id).not.toBe(f2[0].id);
  });

  test('restoreFn for scale-to-zero includes correct command', () => {
    const faults = injector.pickFault('easy');
    faults[0].type = 'scale-to-zero';
    faults[0].target = 'product-service';
    faults[0].restoreFn = injector._getRestoreFn('scale-to-zero', 'product-service');

    expect(faults[0].restoreFn.method).toBe('scale');
    expect(faults[0].restoreFn.replicas).toBe(2);
    expect(faults[0].restoreFn.command).toContain('kubectl scale');
    expect(faults[0].restoreFn.command).toContain('product-service');
  });
});
```

- [ ] **Step 3: Run tests and verify they pass**

Run: `cd "期末大项目/chaos-fire-drill/game-server" && npx jest __tests__/chaos-injector.test.js --forceExit`

Expected: All 9 tests pass.

---

### Task 5: Scoring System

**Files:**
- Create: `game-server/scorer.js`
- Create: `game-server/__tests__/scorer.test.js`

- [ ] **Step 1: Write scorer.js**

```javascript
// Scorer — calculates scores for human vs AI showdown

class Scorer {
  /**
   * @param {Object} options
   * @param {number} options.humanRepairTime - ms
   * @param {number} options.aiRepairTime - ms (null if AI didn't repair)
   * @param {string} options.humanCommand - the command the human used
   * @param {string} options.aiCommand - the command AI used
   * @param {string} options.actualFaultType - the actual fault type injected
   * @param {string} options.aiDiagnosis - AI's diagnosis text
   */
  score(options) {
    const {
      humanRepairTime,
      aiRepairTime,
      humanCommand = '',
      aiCommand = '',
      actualFaultType,
      aiDiagnosis = '',
    } = options;

    // Speed score (50 points) — proportional to who's faster
    const speedResult = this._scoreSpeed(humanRepairTime, aiRepairTime);

    // Accuracy score (30 points) — did you identify the right fault?
    const humanAccuracy = this._scoreAccuracy(humanCommand, actualFaultType);
    const aiAccuracy = this._scoreAccuracy(aiCommand + aiDiagnosis, actualFaultType);

    // Standardization score (20 points) — AI always gets 20, human gets based on command quality
    const humanStandard = this._scoreStandardization(humanCommand);
    const aiStandard = 20;

    const humanTotal = speedResult.human + humanAccuracy + humanStandard;
    const aiTotal = speedResult.ai + aiAccuracy + aiStandard;

    const winner = humanTotal > aiTotal ? 'human'
      : aiTotal > humanTotal ? 'ai'
      : 'draw';

    let roundSummary;
    if (winner === 'human') {
      roundSummary = `你赢了！修复耗时 ${(humanRepairTime / 1000).toFixed(1)}s vs AI ${(aiRepairTime / 1000).toFixed(1)}s`;
    } else if (winner === 'ai') {
      roundSummary = `AI 赢了！修复耗时 ${(aiRepairTime / 1000).toFixed(1)}s vs 你 ${(humanRepairTime / 1000).toFixed(1)}s`;
    } else {
      roundSummary = '平局！';
    }

    return {
      human: {
        repairTime: humanRepairTime,
        command: humanCommand,
        accuracy: humanAccuracy,
        standard: humanStandard,
        total: humanTotal,
      },
      ai: {
        repairTime: aiRepairTime,
        command: aiCommand,
        diagnosis: aiDiagnosis,
        accuracy: aiAccuracy,
        standard: aiStandard,
        total: aiTotal,
      },
      winner,
      roundSummary,
    };
  }

  _scoreSpeed(humanTime, aiTime) {
    if (!humanTime && !aiTime) return { human: 25, ai: 25 };
    if (!humanTime) return { human: 0, ai: 50 };
    if (!aiTime) return { human: 50, ai: 0 };

    // Faster one gets proportionally more points
    const total = humanTime + aiTime;
    const humanRatio = 1 - (humanTime / total);
    const aiRatio = 1 - (aiTime / total);

    return {
      human: Math.round(humanRatio * 50),
      ai: Math.round(aiRatio * 50),
    };
  }

  _scoreAccuracy(command, actualFaultType) {
    if (!command || !actualFaultType) return 15; // default middle score

    const cmd = command.toLowerCase();

    if (actualFaultType === 'scale-to-zero') {
      if (cmd.includes('scale') && cmd.includes('replicas')) return 30;
      if (cmd.includes('scale') || cmd.includes('replicas')) return 20;
      if (cmd.includes('deployment') || cmd.includes('pod')) return 10;
      return 5;
    }

    if (actualFaultType === 'kill-random-pod') {
      if (cmd.includes('get pods') || cmd.includes('describe pod') || cmd.includes('wait')) return 30;
      if (cmd.includes('pod') || cmd.includes('recreate') || cmd.includes('replicas')) return 20;
      return 10;
    }

    if (actualFaultType === 'cpu-stress' || actualFaultType === 'network-delay') {
      if (cmd.includes('exec') || cmd.includes('stress') || cmd.includes('delay') || cmd.includes('tc')) return 30;
      if (cmd.includes('pod') || cmd.includes('log')) return 15;
      return 10;
    }

    return 15;
  }

  _scoreStandardization(command) {
    if (!command) return 0;
    const cmd = command.trim();

    // Check if using proper kubectl syntax
    let score = 10;
    if (cmd.startsWith('kubectl')) score += 5;
    if (cmd.includes('-n chaos-game')) score += 3;
    if (cmd.includes('--replicas=') || cmd.includes('--replicas ')) score += 2;

    return Math.min(score, 20);
  }
}

module.exports = Scorer;
```

- [ ] **Step 2: Write test file**

Create file `game-server/__tests__/scorer.test.js`:

```javascript
const Scorer = require('../scorer');

describe('Scorer', () => {
  let scorer;

  beforeEach(() => {
    scorer = new Scorer();
  });

  test('human wins when faster', () => {
    const result = scorer.score({
      humanRepairTime: 15000,
      aiRepairTime: 45000,
      humanCommand: 'kubectl scale deployment order-service --replicas=2 -n chaos-game',
      aiCommand: 'kubectl scale deployment order-service --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: 'order-service 被缩容为 0',
    });
    expect(result.winner).toBe('human');
    expect(result.human.total).toBeGreaterThan(result.ai.total);
  });

  test('AI wins when faster', () => {
    const result = scorer.score({
      humanRepairTime: 60000,
      aiRepairTime: 20000,
      humanCommand: 'kubectl scale deployment order-service --replicas=2',
      aiCommand: 'kubectl scale deployment order-service --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: '检测到 order-service 副本数为 0',
    });
    expect(result.winner).toBe('ai');
    expect(result.ai.total).toBeGreaterThan(result.human.total);
  });

  test('both equal time results in draw', () => {
    const result = scorer.score({
      humanRepairTime: 30000,
      aiRepairTime: 30000,
      humanCommand: 'kubectl scale deployment order-service --replicas=2',
      aiCommand: 'kubectl scale deployment order-service --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: '',
    });
    // Speed scores should be equal
    expect(result.human.total).toBe(result.ai.total);
  });

  test('returns all required fields', () => {
    const result = scorer.score({
      humanRepairTime: 20000,
      aiRepairTime: 30000,
      humanCommand: 'kubectl get pods',
      aiCommand: 'kubectl scale deployment x --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: '副本被缩为 0',
    });
    expect(result).toHaveProperty('human');
    expect(result).toHaveProperty('ai');
    expect(result).toHaveProperty('winner');
    expect(result).toHaveProperty('roundSummary');
    expect(result.human).toHaveProperty('repairTime');
    expect(result.human).toHaveProperty('total');
    expect(result.ai).toHaveProperty('total');
  });

  test('accurate diagnosis of scale-to-zero gets full accuracy points', () => {
    const result = scorer.score({
      humanRepairTime: 30000,
      aiRepairTime: 30000,
      humanCommand: 'kubectl scale deployment product-service --replicas=2 -n chaos-game',
      aiCommand: 'kubectl scale deployment product-service --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: 'product-service 副本被缩为 0',
    });
    expect(result.human.accuracy).toBe(30);
    expect(result.ai.accuracy).toBe(30);
  });

  test('irrelevant command for kill-random-pod gives low accuracy', () => {
    const result = scorer.score({
      humanRepairTime: 30000,
      aiRepairTime: 30000,
      humanCommand: 'kubectl get nodes',
      aiCommand: 'kubectl get pods',
      actualFaultType: 'kill-random-pod',
      aiDiagnosis: '',
    });
    expect(result.human.accuracy).toBeLessThan(15);
  });

  test('AI always gets 20 for standardization', () => {
    const result = scorer.score({
      humanRepairTime: 30000,
      aiRepairTime: 30000,
      humanCommand: 'bad command',
      aiCommand: 'anything',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: '',
    });
    expect(result.ai.standard).toBe(20);
  });

  test('proper kubectl command with namespace gets higher standard score', () => {
    const result = scorer.score({
      humanRepairTime: 30000,
      aiRepairTime: 30000,
      humanCommand: 'kubectl scale deployment x --replicas=2 -n chaos-game',
      aiCommand: 'kubectl scale deployment x --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: '',
    });
    expect(result.human.standard).toBeGreaterThanOrEqual(17);
  });
});
```

- [ ] **Step 3: Run tests and verify they pass**

Run: `cd "期末大项目/chaos-fire-drill/game-server" && npx jest __tests__/scorer.test.js --forceExit`

Expected: All 8 tests pass.

---

### Task 6: AI Engine

**Files:**
- Create: `game-server/ai-engine.js`
- Create: `game-server/__tests__/ai-engine.test.js`

- [ ] **Step 1: Write ai-engine.js**

```javascript
// AI Engine — calls LLM API to diagnose K8s faults

class AiEngine {
  constructor(k8sClient, options = {}) {
    this.k8s = k8sClient;
    this.apiKey = options.apiKey || process.env.LLM_API_KEY || '';
    this.apiUrl = options.apiUrl || process.env.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    this.model = options.model || 'deepseek-chat';
    this.baseline = null;
    this.maxRounds = 1; // MVP: single round
  }

  async captureBaseline() {
    this.baseline = this.k8s.getClusterSnapshot();
    return this.baseline;
  }

  async diagnose(faults) {
    if (this.baseline) {
      // If we have a baseline, use it to compare
      const current = this.k8s.getClusterSnapshot();
      return this._callLLM(this.baseline, current);
    }
    // No baseline — just describe current state
    const current = this.k8s.getClusterSnapshot();
    return this._callLLM(null, current);
  }

  async _callLLM(baseline, current) {
    const prompt = this._buildPrompt(baseline, current);

    // If no API key configured, use rule-based fallback
    if (!this.apiKey) {
      return this._ruleBasedDiagnosis(current);
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: '你是 Kubernetes 运维专家。请以 JSON 格式回复。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content.trim();
      return this._parseResponse(content);
    } catch (err) {
      console.error('AI Engine: LLM call failed, using rule-based fallback:', err.message);
      return this._ruleBasedDiagnosis(current);
    }
  }

  _buildPrompt(baseline, current) {
    let prompt = '以下是一个微服务集群的状态信息。\n\n';

    if (baseline) {
      prompt += '【正常时基线】\n';
      prompt += `Pods: ${JSON.stringify(baseline.pods)}\n`;
      prompt += `Deployments: ${JSON.stringify(baseline.deployments)}\n\n`;
    }

    prompt += '【当前异常状态】\n';
    prompt += `Pods: ${JSON.stringify(current.pods)}\n`;
    prompt += `Deployments: ${JSON.stringify(current.deployments)}\n`;
    prompt += `Events: ${current.events}\n\n`;

    prompt += '请诊断可能的故障原因，以 JSON 格式回复：\n';
    prompt += '{\n';
    prompt += '  "diagnosis": "中文一句话描述诊断结论",\n';
    prompt += '  "suspectedService": "受影响的服务名",\n';
    prompt += '  "repairCommand": "修复命令，如 kubectl scale deployment xxx --replicas=1"\n';
    prompt += '}';

    return prompt;
  }

  _parseResponse(content) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // fall through to default
    }
    return {
      diagnosis: 'AI 无法给出明确诊断',
      suspectedService: 'unknown',
      repairCommand: 'kubectl get pods -n chaos-game',
    };
  }

  _ruleBasedDiagnosis(current) {
    const { pods, deployments } = current;

    // Check for scale-to-zero: deployment has 0 available replicas
    for (const dep of deployments) {
      if (dep.available === 0) {
        return {
          diagnosis: `${dep.name} 的副本数疑似被缩为 0，所有 Pod 已消失`,
          suspectedService: dep.name,
          repairCommand: `kubectl scale deployment ${dep.name} --replicas=2 -n chaos-game`,
        };
      }
    }

    // Check for missing pods (kill-random-pod)
    const podNames = pods.map(p => p.name);
    const expectedServices = ['frontend', 'order-service', 'product-service'];
    for (const svc of expectedServices) {
      const svcPods = podNames.filter(n => n.startsWith(svc));
      if (svcPods.length < 2) {
        // Check if deployment exists but pods are fewer
        const dep = deployments.find(d => d.name === svc);
        if (dep && dep.available > 0 && svcPods.length < dep.available) {
          return {
            diagnosis: `${svc} 的一个 Pod 疑似被删除，Pod 数量异常`,
            suspectedService: svc,
            repairCommand: `kubectl get pods -n chaos-game | grep ${svc}`,
          };
        }
      }
    }

    // Check if all pods are running
    const unhealthyPods = pods.filter(p => p.status !== 'Running');
    if (unhealthyPods.length > 0) {
      return {
        diagnosis: `${unhealthyPods[0].name} 状态异常 (${unhealthyPods[0].status})`,
        suspectedService: unhealthyPods[0].name.split('-')[0],
        repairCommand: `kubectl describe pod ${unhealthyPods[0].name} -n chaos-game`,
      };
    }

    return {
      diagnosis: '当前集群状态看起来正常，未发现明显异常',
      suspectedService: 'none',
      repairCommand: 'kubectl get pods -n chaos-game',
    };
  }

  async attemptRepair(diagnosisResult) {
    const { repairCommand, suspectedService } = diagnosisResult;
    if (!repairCommand || repairCommand.includes('get pods') || repairCommand.includes('describe')) {
      // Non-repair commands — skip execution, the command is for diagnosis only
      return { success: false, command: repairCommand, output: '诊断命令，非修复操作' };
    }

    try {
      // Execute through terminal proxy logic
      // But for the AI engine, we let the game server handle actual execution
      return { success: true, command: repairCommand, output: 'AI 尝试执行修复命令' };
    } catch (err) {
      return { success: false, command: repairCommand, output: err.message };
    }
  }
}

module.exports = AiEngine;
```

- [ ] **Step 2: Write test file**

Create file `game-server/__tests__/ai-engine.test.js`:

```javascript
const AiEngine = require('../ai-engine');
const K8sClient = require('../k8s-client');

describe('AiEngine', () => {
  let k8s;
  let ai;

  beforeEach(() => {
    k8s = new K8sClient({ mockMode: true });
    ai = new AiEngine(k8s);
  });

  test('captureBaseline records current cluster state', async () => {
    const baseline = await ai.captureBaseline();
    expect(baseline).toHaveProperty('pods');
    expect(baseline).toHaveProperty('deployments');
    expect(baseline.pods.length).toBe(6);
  });

  test('_ruleBasedDiagnosis detects scale-to-zero', () => {
    k8s.injectMockFault('scale-to-zero', 'order-service');
    const current = k8s.getClusterSnapshot();
    const result = ai._ruleBasedDiagnosis(current);
    expect(result.suspectedService).toBe('order-service');
    expect(result.repairCommand).toContain('kubectl scale');
    expect(result.repairCommand).toContain('order-service');
    expect(result.repairCommand).toContain('--replicas=2');
  });

  test('_ruleBasedDiagnosis detects kill-random-pod', () => {
    k8s.injectMockFault('kill-random-pod', 'order-service');
    const current = k8s.getClusterSnapshot();
    const result = ai._ruleBasedDiagnosis(current);
    expect(result.suspectedService).toBe('order-service');
    expect(result.diagnosis).toContain('order-service');
  });

  test('_ruleBasedDiagnosis reports healthy when no fault', () => {
    const current = k8s.getClusterSnapshot();
    const result = ai._ruleBasedDiagnosis(current);
    expect(result.diagnosis).toContain('正常');
    expect(result.suspectedService).toBe('none');
  });

  test('_buildPrompt returns a string with expected sections', () => {
    const baseline = k8s.getClusterSnapshot();
    const current = k8s.getClusterSnapshot();
    const prompt = ai._buildPrompt(baseline, current);
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('正常时基线');
    expect(prompt).toContain('当前异常状态');
    expect(prompt).toContain('diagnosis');
    expect(prompt).toContain('repairCommand');
  });

  test('_parseResponse extracts JSON from LLM response', () => {
    const raw = '```json\n{"diagnosis":"test","suspectedService":"x","repairCommand":"cmd"}\n```';
    const parsed = ai._parseResponse(raw);
    expect(parsed.diagnosis).toBe('test');
    expect(parsed.suspectedService).toBe('x');
  });

  test('_parseResponse returns default on invalid input', () => {
    const parsed = ai._parseResponse('not json at all');
    expect(parsed).toHaveProperty('diagnosis');
    expect(parsed).toHaveProperty('repairCommand');
  });

  test('attemptRepair returns success for scale commands', async () => {
    const result = await ai.attemptRepair({
      repairCommand: 'kubectl scale deployment order-service --replicas=2',
      suspectedService: 'order-service',
    });
    expect(result.success).toBe(true);
  });

  test('attemptRepair returns false for read-only commands', async () => {
    const result = await ai.attemptRepair({
      repairCommand: 'kubectl get pods',
      suspectedService: 'unknown',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests and verify they pass**

Run: `cd "期末大项目/chaos-fire-drill/game-server" && npx jest __tests__/ai-engine.test.js --forceExit`

Expected: All 9 tests pass.

---

### Task 7: Terminal Proxy

**Files:**
- Create: `game-server/terminal-proxy.js`
- Create: `game-server/__tests__/terminal-proxy.test.js`

- [ ] **Step 1: Write terminal-proxy.js**

```javascript
// Terminal Proxy — validates and executes user kubectl commands

const { execSync } = require('child_process');

const COMMAND_WHITELIST = [
  'kubectl get',
  'kubectl describe',
  'kubectl logs',
  'kubectl scale',
  'kubectl exec',
  'kubectl rollout restart',
  'kubectl top',
];

const FORBIDDEN_PATTERNS = [
  /kubectl\s+delete/i,
  /kubectl\s+apply/i,
  /kubectl\s+create/i,
  /kubectl\s+replace/i,
  /kubectl\s+patch/i,
  /kubectl\s+edit/i,
  /kubectl\s+taint/i,
  /kubectl\s+drain/i,
  /kubectl\s+cordon/i,
  /kubectl\s+uncordon/i,
  /rm\s+-rf/i,
  />/,
  /;/,
  /\|/,
  /&&/,
  /\|\|/,
  /`/,
  /\$\(/,
];

const ALLOWED_NAMESPACE = 'chaos-game';

class TerminalProxy {
  constructor(k8sClient, options = {}) {
    this.k8s = k8sClient;
    this.mockMode = options.mockMode || false;
    this.history = [];
  }

  validate(command) {
    if (!command || typeof command !== 'string') {
      return { valid: false, error: '命令不能为空' };
    }

    const trimmed = command.trim();

    // Check forbidden patterns first
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { valid: false, error: `命令包含禁止的模式: ${pattern}` };
      }
    }

    // Check whitelist
    const isAllowed = COMMAND_WHITELIST.some(prefix => trimmed.startsWith(prefix));
    if (!isAllowed) {
      return {
        valid: false,
        error: `命令不在白名单中。允许的命令: ${COMMAND_WHITELIST.join(', ')}`,
      };
    }

    return { valid: true };
  }

  execute(command) {
    const validation = this.validate(command);
    if (!validation.valid) {
      return {
        success: false,
        output: validation.error,
        command,
      };
    }

    // Attach namespace if not present in scale/describe/logs/exec commands
    let execCommand = command.trim();
    if (!execCommand.includes('-n ') && !execCommand.includes('--namespace')) {
      const needsNamespace = ['kubectl scale', 'kubectl describe', 'kubectl logs',
        'kubectl exec', 'kubectl rollout restart'].some(p => execCommand.startsWith(p));
      if (needsNamespace || execCommand === 'kubectl get pods' ||
          execCommand === 'kubectl get deployments' || execCommand === 'kubectl get events') {
        execCommand += ` -n ${ALLOWED_NAMESPACE}`;
      }
    }

    this.history.push({ command: execCommand, timestamp: Date.now() });

    if (this.mockMode) {
      return this._mockExecute(execCommand);
    }

    try {
      const output = execSync(execCommand, {
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      return {
        success: true,
        output: output || '(命令执行成功，无输出)',
        command: execCommand,
      };
    } catch (err) {
      return {
        success: false,
        output: err.stderr || err.message || '命令执行失败',
        command: execCommand,
      };
    }
  }

  _mockExecute(command) {
    // Delegate to k8s client's mock exec
    const output = this.k8s._exec(command);

    // For scale commands, check if this is a repair attempt
    if (command.includes('kubectl scale') && command.includes('--replicas=')) {
      const match = command.match(/--replicas=(\d+)/);
      if (match && parseInt(match[1]) > 0) {
        const deployMatch = command.match(/deployment\s+(\S+)/);
        if (deployMatch) {
          this.k8s.scaleDeployment(deployMatch[1], parseInt(match[1]));
        }
      }
    }

    return {
      success: true,
      output: output || '(命令执行成功，无输出)',
      command,
    };
  }

  getHistory() {
    return [...this.history];
  }

  clearHistory() {
    this.history = [];
  }
}

module.exports = { TerminalProxy, COMMAND_WHITELIST, FORBIDDEN_PATTERNS };
```

- [ ] **Step 2: Write test file**

Create file `game-server/__tests__/terminal-proxy.test.js`:

```javascript
const { TerminalProxy } = require('../terminal-proxy');
const K8sClient = require('../k8s-client');

describe('TerminalProxy', () => {
  let k8s;
  let proxy;

  beforeEach(() => {
    k8s = new K8sClient({ mockMode: true });
    proxy = new TerminalProxy(k8s, { mockMode: true });
  });

  test('validate accepts kubectl get pods', () => {
    expect(proxy.validate('kubectl get pods').valid).toBe(true);
  });

  test('validate accepts kubectl describe pod', () => {
    expect(proxy.validate('kubectl describe pod frontend-abc123').valid).toBe(true);
  });

  test('validate accepts kubectl logs', () => {
    expect(proxy.validate('kubectl logs order-service-abc123').valid).toBe(true);
  });

  test('validate accepts kubectl scale', () => {
    expect(proxy.validate('kubectl scale deployment order-service --replicas=2').valid).toBe(true);
  });

  test('validate rejects kubectl delete', () => {
    const result = proxy.validate('kubectl delete pod frontend-abc123');
    expect(result.valid).toBe(false);
  });

  test('validate rejects kubectl apply', () => {
    const result = proxy.validate('kubectl apply -f evil.yaml');
    expect(result.valid).toBe(false);
  });

  test('validate rejects command injection with semicolon', () => {
    const result = proxy.validate('kubectl get pods; rm -rf /');
    expect(result.valid).toBe(false);
  });

  test('validate rejects command injection with pipe', () => {
    const result = proxy.validate('kubectl get pods | bash');
    expect(result.valid).toBe(false);
  });

  test('validate rejects empty command', () => {
    expect(proxy.validate('').valid).toBe(false);
  });

  test('execute returns success for get pods', () => {
    const result = proxy.execute('kubectl get pods');
    expect(result.success).toBe(true);
    expect(result.output).toContain('NAME');
    expect(result.output).toContain('Running');
  });

  test('execute records command in history', () => {
    proxy.execute('kubectl get pods');
    proxy.execute('kubectl get deployments');
    expect(proxy.getHistory().length).toBe(2);
    expect(proxy.getHistory()[0].command).toContain('kubectl get pods');
  });

  test('execute rejects forbidden command', () => {
    const result = proxy.execute('kubectl delete pod x');
    expect(result.success).toBe(false);
  });

  test('execute adds namespace automatically for get pods', () => {
    const result = proxy.execute('kubectl get pods');
    expect(result.command).toContain('-n chaos-game');
  });

  test('execute scale with replicas > 0 restores deployment', () => {
    // First break it
    k8s.injectMockFault('scale-to-zero', 'order-service');
    expect(k8s.isHealthy()).toBe(false);

    // Then repair
    const result = proxy.execute('kubectl scale deployment order-service --replicas=2');
    expect(result.success).toBe(true);
    expect(k8s.isHealthy()).toBe(true);
  });

  test('clearHistory empties history', () => {
    proxy.execute('kubectl get pods');
    proxy.clearHistory();
    expect(proxy.getHistory().length).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests and verify they pass**

Run: `cd "期末大项目/chaos-fire-drill/game-server" && npx jest __tests__/terminal-proxy.test.js --forceExit`

Expected: All 15 tests pass.

---

## Phase 2: Game Server Integration

### Task 8: Game Server Entry Point

**Files:**
- Create: `game-server/server.js`

This is the Express + WebSocket server that ties all modules together. No separate test file — tested via manual HTTP/WS requests or integration test.

- [ ] **Step 1: Write server.js**

```javascript
// Game Server — Express + WebSocket entry point
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');

const K8sClient = require('./k8s-client');
const StateMachine = require('./state-machine');
const { ChaosInjector } = require('./chaos-injector');
const AiEngine = require('./ai-engine');
const Scorer = require('./scorer');
const { TerminalProxy } = require('./terminal-proxy');

// Configuration
const PORT = process.env.PORT || 3001;
const MOCK_MODE = process.env.MOCK_MODE !== 'false'; // default: mock mode ON

// Initialize modules
const k8s = new K8sClient({ mockMode: MOCK_MODE, namespace: 'chaos-game' });
const sm = new StateMachine();
const injector = new ChaosInjector(k8s);
const ai = new AiEngine(k8s);
const scorer = new Scorer();
const terminal = new TerminalProxy(k8s, { mockMode: MOCK_MODE });

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files in production
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// REST endpoints
app.get('/api/state', (req, res) => {
  res.json(sm.getState());
});

app.post('/api/game/start', async (req, res) => {
  try {
    const { difficulty = 'easy' } = req.body;
    sm.startGame(difficulty);

    // Capture baseline for AI
    await ai.captureBaseline();

    // Pick and inject faults
    const faults = injector.pickFault(difficulty);

    // Notify clients
    const state = sm.getState();
    broadcast({ type: 'state-change', state });

    // Inject after short delay (simulates injection time)
    setTimeout(async () => {
      if (MOCK_MODE) {
        injector.injectMock(faults);
      } else {
        await injector.inject(faults);
      }

      sm.startDiagnosing(faults);

      // Broadcast fault injected event (but not the details — keep it hidden)
      broadcast({
        type: 'fault-injected',
        faultHint: `系统出现异常，请排查！（难度: ${difficulty}）`,
      });

      broadcast({ type: 'state-change', state: sm.getState() });

      // Start AI diagnosis
      startAiDiagnosis();

      // Start health check loop
      startHealthCheckLoop(faults);

      // Start timeout timer
      startTimeoutTimer();
    }, 3000);

    res.json({ success: true, state: sm.getState() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/game/reset', (req, res) => {
  try {
    sm.reset();
    // Restore any remaining faults
    const state = sm.getState();
    if (state.faults.length > 0) {
      if (MOCK_MODE) {
        injector.restoreMock(state.faults);
      }
    }
    broadcast({ type: 'state-change', state: sm.getState() });
    res.json({ success: true, state: sm.getState() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/game/stop', (req, res) => {
  try {
    const state = sm.getState();
    if (state.status === 'DIAGNOSING') {
      sm.timeout();
      broadcast({ type: 'state-change', state: sm.getState() });
    }
    res.json({ success: true, state: sm.getState() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// HTTP server
const server = http.createServer(app);

// WebSocket
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Client connected');

  // Send current state on connect
  ws.send(JSON.stringify({ type: 'state-change', state: sm.getState() }));
  ws.send(JSON.stringify({ type: 'cluster-snapshot', snapshot: k8s.getClusterSnapshot() }));

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleWsMessage(ws, message);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

function broadcast(data) {
  const json = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(json);
    }
  });
}

async function handleWsMessage(ws, message) {
  switch (message.type) {
    case 'terminal-command': {
      const result = terminal.execute(message.command);
      ws.send(JSON.stringify({ type: 'terminal-output', ...result }));

      // Check if command fixed the issue
      if (result.success) {
        checkRepair(result.command, 'human');
      }
      break;
    }

    case 'request-snapshot': {
      const snapshot = k8s.getClusterSnapshot();
      ws.send(JSON.stringify({ type: 'cluster-snapshot', snapshot }));
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${message.type}` }));
  }
}

let healthCheckInterval = null;
let timeoutTimer = null;
let aiDiagnosisInProgress = false;

function startHealthCheckLoop(faults) {
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  healthCheckInterval = setInterval(() => {
    const healthy = k8s.isHealthy();
    const snapshot = k8s.getClusterSnapshot();
    broadcast({ type: 'cluster-snapshot', snapshot });

    if (healthy && sm.getStatus() === 'DIAGNOSING') {
      const state = sm.getState();
      const scoringResult = scorer.score({
        humanRepairTime: state.humanRepairTime || null,
        aiRepairTime: state.aiRepairTime || null,
        humanCommand: state.humanRepairCommand || '',
        aiCommand: state.aiRepairCommand || '',
        actualFaultType: state.faults[0]?.type || 'unknown',
        aiDiagnosis: state.aiDiagnosis || '',
      });
      sm.endGame(scoringResult);
      broadcast({ type: 'state-change', state: sm.getState() });

      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
    }
  }, 1000);
}

function startTimeoutTimer() {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  timeoutTimer = setTimeout(() => {
    if (sm.getStatus() === 'DIAGNOSING') {
      sm.timeout();
      broadcast({ type: 'state-change', state: sm.getState() });

      // Restore faults
      const state = sm.getState();
      if (MOCK_MODE) {
        injector.restoreMock(state.faults);
      }

      if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
      }
    }
  }, 300000); // 5 minutes
}

async function startAiDiagnosis() {
  if (aiDiagnosisInProgress) return;
  aiDiagnosisInProgress = true;

  // AI waits a moment then diagnoses
  setTimeout(async () => {
    const state = sm.getState();
    const diagnosis = await ai.diagnose(state.faults);
    state.aiDiagnosis = diagnosis.diagnosis;

    broadcast({
      type: 'ai-diagnosis',
      diagnosis: diagnosis.diagnosis,
      suspectedService: diagnosis.suspectedService,
    });

    // AI attempts repair
    const repairResult = await ai.attemptRepair(diagnosis);
    if (repairResult.success) {
      // In mock mode, execute through terminal proxy
      if (MOCK_MODE) {
        terminal.execute(diagnosis.repairCommand);
      }
      sm.markAiRepaired(repairResult.command);
      broadcast({ type: 'state-change', state: sm.getState() });
    }

    aiDiagnosisInProgress = false;
  }, 5000 + Math.random() * 10000); // AI takes 5-15 seconds to diagnose
}

function checkRepair(command, who) {
  if (sm.getStatus() !== 'DIAGNOSING') return;

  if (k8s.isHealthy()) {
    if (who === 'human') {
      sm.markHumanRepaired(command);
    } else {
      sm.markAiRepaired(command);
    }
    broadcast({ type: 'state-change', state: sm.getState() });
  }
}

server.listen(PORT, () => {
  console.log(`Chaos Fire Drill server running on http://localhost:${PORT}`);
  console.log(`Mode: ${MOCK_MODE ? 'MOCK (no real K8s required)' : 'LIVE (connected to K8s)'}`);
  console.log(`WebSocket available at ws://localhost:${PORT}`);
});
```

- [ ] **Step 2: Verify server starts**

Run: `cd "期末大项目/chaos-fire-drill/game-server" && node server.js`

Expected: Server starts on port 3001, log shows "Chaos Fire Drill server running..."

Stop server with Ctrl+C after verification.

---

## Phase 3: Frontend

### Task 9: Initialize Vue 3 Frontend

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/index.html`
- Create: `frontend/vite.config.js`
- Create: `frontend/src/main.js`
- Create: `frontend/src/App.vue`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "chaos-fire-drill-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.0",
    "xterm": "^5.3.0",
    "xterm-addon-fit": "^0.8.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chaos Fire Drill — 云上消防演习</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create vite.config.js**

```javascript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 4: Create src/main.js**

```javascript
import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
```

- [ ] **Step 5: Create src/App.vue**

```vue
<template>
  <div class="app">
    <header class="app-header">
      <h1>Chaos Fire Drill</h1>
      <span class="subtitle">云上消防演习</span>
      <span class="round-badge" v-if="state.round > 0">第 {{ state.round }} 轮</span>
      <span class="status-badge" :class="state.status">{{ statusText }}</span>
    </header>

    <div class="dashboard">
      <div class="panel panel-health">
        <HealthPanel :snapshot="snapshot" :game-status="state.status" />
      </div>
      <div class="panel panel-console">
        <GameConsole
          :state="state"
          @start-game="startGame"
          @stop-game="stopGame"
          @reset-game="resetGame"
        />
      </div>
      <div class="panel panel-ai">
        <AiDuelPanel
          :state="state"
          :ai-diagnosis="aiDiagnosis"
        />
      </div>
    </div>

    <div class="terminal-section">
      <TerminalPanel
        :disabled="state.status !== 'DIAGNOSING'"
        @command="sendCommand"
        :output="terminalOutput"
      />
    </div>

    <ScoreBoard v-if="showScore" :state="state" @reset="resetGame" />
  </div>
</template>

<script>
import HealthPanel from './components/HealthPanel.vue';
import GameConsole from './components/GameConsole.vue';
import AiDuelPanel from './components/AiDuelPanel.vue';
import TerminalPanel from './components/Terminal.vue';
import ScoreBoard from './components/ScoreBoard.vue';

const WS_URL = `ws://${window.location.hostname}:3001`;

export default {
  name: 'App',
  components: { HealthPanel, GameConsole, AiDuelPanel, TerminalPanel, ScoreBoard },
  data() {
    return {
      ws: null,
      state: {
        status: 'IDLE',
        difficulty: 'easy',
        round: 0,
        faults: [],
        humanScore: 0,
        aiScore: 0,
        winner: null,
        roundSummary: '',
      },
      snapshot: { pods: [], deployments: [], events: '' },
      aiDiagnosis: '',
      terminalOutput: '',
      showScore: false,
    };
  },
  computed: {
    statusText() {
      const map = { IDLE: '等待中', INJECTING: '故障注入中...', DIAGNOSING: '诊断中',
        SCORING: '结算中', TIMEOUT: '超时' };
      return map[this.state.status] || this.state.status;
    },
  },
  mounted() {
    this.connectWs();
  },
  beforeUnmount() {
    if (this.ws) this.ws.close();
  },
  methods: {
    connectWs() {
      this.ws = new WebSocket(WS_URL);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'state-change':
            this.state = msg.state;
            this.showScore = msg.state.status === 'SCORING' || msg.state.status === 'TIMEOUT';
            break;
          case 'cluster-snapshot':
            this.snapshot = msg.snapshot;
            break;
          case 'fault-injected':
            // Alert is handled by GameConsole
            break;
          case 'ai-diagnosis':
            this.aiDiagnosis = msg.diagnosis;
            break;
          case 'terminal-output':
            this.terminalOutput = msg.output || '';
            break;
          case 'error':
            console.error('Server error:', msg.error);
            break;
        }
      };
      this.ws.onclose = () => {
        setTimeout(() => this.connectWs(), 3000);
      };
    },
    startGame(difficulty) {
      fetch('/api/game/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty }),
      });
    },
    stopGame() {
      fetch('/api/game/stop', { method: 'POST' });
    },
    resetGame() {
      fetch('/api/game/reset', { method: 'POST' });
      this.showScore = false;
    },
    sendCommand(command) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'terminal-command', command }));
      }
    },
  },
};
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  background: #0a0e17;
  color: #e0e0e0;
  min-height: 100vh;
}
.app {
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px;
}
.app-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 2px solid #1a2a3a;
  margin-bottom: 16px;
}
.app-header h1 {
  font-size: 1.5rem;
  color: #ff6b35;
}
.subtitle { color: #8899aa; font-size: 0.9rem; }
.round-badge {
  background: #1a3a2a;
  color: #4caf50;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.85rem;
}
.status-badge {
  margin-left: auto;
  padding: 4px 16px;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: bold;
}
.status-badge.IDLE { background: #1a2a3a; color: #8899aa; }
.status-badge.INJECTING { background: #3a2a1a; color: #ff9800; }
.status-badge.DIAGNOSING { background: #3a1a1a; color: #f44336; }
.status-badge.SCORING { background: #1a3a2a; color: #4caf50; }
.status-badge.TIMEOUT { background: #2a1a3a; color: #9c27b0; }

.dashboard {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
@media (max-width: 960px) {
  .dashboard { grid-template-columns: 1fr; }
}
.panel {
  background: #111827;
  border: 1px solid #1e2d3d;
  border-radius: 8px;
  padding: 16px;
}
.terminal-section {
  background: #111827;
  border: 1px solid #1e2d3d;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
</style>
```

- [ ] **Step 2: Install dependencies and verify dev server starts**

Run: `cd "期末大项目/chaos-fire-drill/frontend" && npm install`

Then: `npm run dev`

Expected: Vite dev server starts on port 5173.

---

### Task 10: HealthPanel Component

**Files:**
- Create: `frontend/src/components/HealthPanel.vue`

- [ ] **Step 1: Write HealthPanel.vue**

```vue
<template>
  <div class="health-panel">
    <h3>集群健康状态</h3>
    <div class="pod-list">
      <div v-for="pod in snapshot.pods" :key="pod.name" class="pod-row">
        <span class="pod-indicator" :class="pod.status === 'Running' ? 'healthy' : 'unhealthy'"></span>
        <span class="pod-name">{{ pod.name }}</span>
        <span class="pod-status">{{ pod.status }}</span>
        <span class="pod-ready">{{ pod.ready }}</span>
        <span class="pod-restarts">重启: {{ pod.restarts }}</span>
      </div>
      <div v-if="snapshot.pods.length === 0" class="empty-state">
        Pod 数据加载中...
      </div>
    </div>

    <h3 style="margin-top: 16px;">Deployments</h3>
    <div class="deploy-list">
      <div v-for="dep in snapshot.deployments" :key="dep.name" class="deploy-row">
        <span class="deploy-name">{{ dep.name }}</span>
        <span class="deploy-ready" :class="dep.available > 0 ? 'healthy' : 'unhealthy'">
          {{ dep.ready }}
        </span>
        <span class="deploy-available">可用: {{ dep.available }}</span>
      </div>
    </div>

    <div class="health-summary" :class="allHealthy ? 'healthy' : 'unhealthy'">
      {{ allHealthy ? '所有服务正常运行' : '存在异常服务' }}
    </div>
  </div>
</template>

<script>
export default {
  name: 'HealthPanel',
  props: {
    snapshot: { type: Object, default: () => ({ pods: [], deployments: [] }) },
    gameStatus: { type: String, default: 'IDLE' },
  },
  computed: {
    allHealthy() {
      if (this.snapshot.deployments.length === 0) return true;
      return this.snapshot.deployments.every(d => d.available > 0) &&
             this.snapshot.pods.every(p => p.status === 'Running');
    },
  },
};
</script>

<style scoped>
.health-panel h3 {
  font-size: 0.95rem;
  color: #8899aa;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.pod-row, .deploy-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #1a2a3a;
  font-size: 0.8rem;
}
.pod-indicator {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.pod-indicator.healthy { background: #4caf50; box-shadow: 0 0 6px #4caf50; }
.pod-indicator.unhealthy { background: #f44336; box-shadow: 0 0 6px #f44336; animation: blink 1s infinite; }

@keyframes blink {
  50% { opacity: 0.3; }
}
.pod-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pod-status { color: #8899aa; }
.pod-ready { color: #66bb6a; }
.pod-restarts { color: #ff9800; }

.deploy-name { flex: 1; }
.deploy-ready { color: #8899aa; }
.deploy-available { color: #66bb6a; }
.deploy-ready.unhealthy { color: #f44336; }

.health-summary {
  margin-top: 16px;
  padding: 12px;
  border-radius: 6px;
  text-align: center;
  font-weight: bold;
  font-size: 0.9rem;
}
.health-summary.healthy { background: #0d2818; color: #4caf50; border: 1px solid #1a4a2a; }
.health-summary.unhealthy { background: #280d0d; color: #f44336; border: 1px solid #4a1a1a; }
.empty-state { color: #556; padding: 20px; text-align: center; }
</style>
```

---

### Task 11: GameConsole Component

**Files:**
- Create: `frontend/src/components/GameConsole.vue`

- [ ] **Step 1: Write GameConsole.vue**

```vue
<template>
  <div class="game-console">
    <h3>游戏控制台</h3>

    <div class="info-row">
      <span class="label">难度</span>
      <span class="value">{{ difficultyText }}</span>
    </div>
    <div class="info-row">
      <span class="label">计时</span>
      <span class="value timer">{{ elapsed }}</span>
    </div>
    <div class="info-row">
      <span class="label">状态</span>
      <span class="value" :class="state.status">{{ statusText }}</span>
    </div>

    <div v-if="state.status === 'DIAGNOSING' || state.status === 'SCORING' || state.status === 'TIMEOUT'"
         class="fault-hint">
      <div class="hint-label">故障提示</div>
      <div class="hint-text">系统出现异常，请排查！</div>
      <div class="fault-types">
        <span class="fault-tag">可能: 服务不可用</span>
        <span class="fault-tag">可能: Pod 异常</span>
      </div>
    </div>

    <div class="actions">
      <button
        v-if="state.status === 'IDLE'"
        class="btn btn-start"
        @click="$emit('start-game', 'easy')"
      >
        开始游戏 (Easy)
      </button>

      <button
        v-if="state.status === 'DIAGNOSING'"
        class="btn btn-stop"
        @click="$emit('stop-game')"
      >
        放弃本轮
      </button>

      <button
        v-if="state.status === 'SCORING' || state.status === 'TIMEOUT'"
        class="btn btn-reset"
        @click="$emit('reset-game')"
      >
        再来一局
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'GameConsole',
  props: {
    state: { type: Object, required: true },
  },
  emits: ['start-game', 'stop-game', 'reset-game'],
  data() {
    return {
      elapsedSeconds: 0,
      timerInterval: null,
    };
  },
  computed: {
    difficultyText() {
      return this.state.difficulty === 'easy' ? '简单' : '困难';
    },
    statusText() {
      const map = { IDLE: '等待开始', INJECTING: '故障注入中...', DIAGNOSING: '诊断修复中',
        SCORING: '结算', TIMEOUT: '超时' };
      return map[this.state.status] || this.state.status;
    },
    elapsed() {
      const s = this.elapsedSeconds;
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    },
  },
  watch: {
    'state.status'(val) {
      if (val === 'DIAGNOSING') {
        this.elapsedSeconds = 0;
        this.timerInterval = setInterval(() => {
          this.elapsedSeconds++;
        }, 1000);
      }
      if (val === 'SCORING' || val === 'TIMEOUT' || val === 'IDLE') {
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
      }
    },
  },
  beforeUnmount() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  },
};
</script>

<style scoped>
.game-console h3 {
  font-size: 0.95rem;
  color: #8899aa;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #1a2a3a;
  font-size: 0.85rem;
}
.label { color: #8899aa; }
.value { font-weight: bold; }
.value.IDLE { color: #8899aa; }
.value.INJECTING { color: #ff9800; }
.value.DIAGNOSING { color: #f44336; }
.timer { font-size: 1.3rem; font-family: 'JetBrains Mono', monospace; color: #ff6b35; }

.fault-hint {
  margin-top: 16px;
  padding: 12px;
  background: #1a0a0a;
  border: 1px solid #3a0a0a;
  border-radius: 6px;
}
.hint-label { color: #f44336; font-size: 0.8rem; margin-bottom: 4px; }
.hint-text { font-size: 0.9rem; margin-bottom: 8px; }
.fault-types { display: flex; gap: 8px; flex-wrap: wrap; }
.fault-tag {
  background: #2a1a1a;
  color: #ff9800;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
}

.actions { margin-top: 20px; display: flex; flex-direction: column; gap: 8px; }
.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: bold;
  transition: all 0.2s;
}
.btn-start { background: #ff6b35; color: #fff; }
.btn-start:hover { background: #e55a2b; }
.btn-stop { background: #555; color: #ccc; }
.btn-stop:hover { background: #444; }
.btn-reset { background: #1a4a2a; color: #4caf50; border: 1px solid #2a5a3a; }
.btn-reset:hover { background: #1a5a2a; }
</style>
```

---

### Task 12: AiDuelPanel Component

**Files:**
- Create: `frontend/src/components/AiDuelPanel.vue`

- [ ] **Step 1: Write AiDuelPanel.vue**

```vue
<template>
  <div class="ai-duel-panel">
    <h3>AI 对决</h3>

    <div class="score-row">
      <div class="player human">
        <span class="player-icon">🧑</span>
        <span class="player-name">你</span>
        <span class="player-score">{{ state.humanScore || 0 }}分</span>
      </div>
      <div class="vs">VS</div>
      <div class="player ai">
        <span class="player-icon">🤖</span>
        <span class="player-name">AI</span>
        <span class="player-score">{{ state.aiScore || 0 }}分</span>
      </div>
    </div>

    <div class="status-row">
      <div class="player">
        <span class="status-dot" :class="state.humanRepaired ? 'done' : 'waiting'"></span>
        {{ state.humanRepaired ? '已修复' : '诊断中...' }}
        <span v-if="state.humanRepairTime" class="time-badge">
          {{ (state.humanRepairTime / 1000).toFixed(1) }}s
        </span>
      </div>
      <div class="player">
        <span class="status-dot" :class="state.aiRepaired ? 'done' : 'waiting'"></span>
        {{ state.aiRepaired ? '已修复' : '诊断中...' }}
        <span v-if="state.aiRepairTime" class="time-badge">
          {{ (state.aiRepairTime / 1000).toFixed(1) }}s
        </span>
      </div>
    </div>

    <div v-if="aiDiagnosis" class="ai-thought">
      <div class="thought-label">AI 诊断思路</div>
      <div class="thought-content">{{ aiDiagnosis }}</div>
    </div>

    <div v-if="!aiDiagnosis && state.status === 'DIAGNOSING'" class="ai-thinking">
      <span class="thinking-dots">AI 分析中<span class="dots"></span></span>
    </div>

    <div v-if="winnerText" class="winner-banner" :class="winnerClass">
      {{ winnerText }}
    </div>
  </div>
</template>

<script>
export default {
  name: 'AiDuelPanel',
  props: {
    state: { type: Object, required: true },
    aiDiagnosis: { type: String, default: '' },
  },
  computed: {
    winnerText() {
      if (this.state.status !== 'SCORING') return '';
      if (this.state.winner === 'human') return '你赢了这轮！';
      if (this.state.winner === 'ai') return 'AI 赢得了这轮';
      return '平局！';
    },
    winnerClass() {
      if (this.state.winner === 'human') return 'human-wins';
      if (this.state.winner === 'ai') return 'ai-wins';
      return 'draw';
    },
  },
};
</script>

<style scoped>
.ai-duel-panel h3 {
  font-size: 0.95rem;
  color: #8899aa;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.score-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 16px;
}
.player {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.player-icon { font-size: 1.5rem; }
.player-name { font-size: 0.8rem; color: #8899aa; }
.player-score { font-size: 1.2rem; font-weight: bold; color: #ff6b35; }
.vs { color: #556; font-weight: bold; }
.status-row {
  display: flex;
  justify-content: space-around;
  margin-bottom: 16px;
  font-size: 0.8rem;
}
.status-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  margin-right: 4px;
}
.status-dot.done { background: #4caf50; }
.status-dot.waiting { background: #ff9800; animation: pulse 1.5s infinite; }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.time-badge {
  display: block;
  color: #66bb6a;
  font-weight: bold;
  font-size: 0.75rem;
  margin-top: 2px;
}
.ai-thought {
  background: #0d1520;
  border: 1px solid #1a2a4a;
  border-radius: 6px;
  padding: 12px;
}
.thought-label {
  font-size: 0.75rem;
  color: #4488cc;
  margin-bottom: 6px;
}
.thought-content {
  font-size: 0.85rem;
  color: #aabbcc;
  line-height: 1.5;
}
.ai-thinking {
  padding: 20px;
  text-align: center;
  color: #556;
}
.dots::after {
  content: '';
  animation: dots 1.5s steps(4, end) infinite;
}
@keyframes dots {
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  75% { content: '...'; }
  100% { content: ''; }
}
.winner-banner {
  margin-top: 16px;
  padding: 12px;
  border-radius: 6px;
  text-align: center;
  font-weight: bold;
  font-size: 0.95rem;
}
.winner-banner.human-wins { background: #0d2818; color: #4caf50; border: 1px solid #1a4a2a; }
.winner-banner.ai-wins { background: #1a0a1a; color: #ce93d8; border: 1px solid #3a1a3a; }
.winner-banner.draw { background: #1a1a0a; color: #ffc107; border: 1px solid #3a3a1a; }
</style>
```

---

### Task 13: Terminal Component

**Files:**
- Create: `frontend/src/components/Terminal.vue`

- [ ] **Step 1: Write Terminal.vue**

```vue
<template>
  <div class="terminal-panel">
    <div class="terminal-header">
      <span class="terminal-title">运维终端</span>
      <span class="terminal-hint">输入 kubectl 命令排查故障</span>
    </div>
    <div class="terminal-output" ref="output">
      <div v-for="(line, i) in outputLines" :key="i" class="output-line"
           :class="{ 'is-error': line.isError, 'is-prompt': line.isPrompt }">
        {{ line.text }}
      </div>
    </div>
    <div class="terminal-input-row">
      <span class="prompt">$</span>
      <input
        ref="cmdInput"
        v-model="command"
        class="terminal-input"
        :disabled="disabled"
        placeholder="kubectl get pods ..."
        @keyup.enter="executeCommand"
      />
    </div>
  </div>
</template>

<script>
export default {
  name: 'TerminalPanel',
  props: {
    disabled: { type: Boolean, default: false },
  },
  emits: ['command'],
  data() {
    return {
      command: '',
      outputLines: [
        { text: 'Chaos Fire Drill 运维终端', isPrompt: false },
        { text: '可用命令: kubectl get pods | kubectl describe pod <name> | kubectl logs <pod> | kubectl scale deployment <name> --replicas=<n>', isPrompt: false },
        { text: '', isPrompt: false },
      ],
    };
  },
  methods: {
    executeCommand() {
      const cmd = this.command.trim();
      if (!cmd) return;

      this.outputLines.push({ text: `$ ${cmd}`, isPrompt: true });

      if (cmd === 'clear') {
        this.outputLines = [];
        this.command = '';
        return;
      }

      this.$emit('command', cmd);
      this.command = '';
    },
    addOutput(text, isError = false) {
      if (!text) return;
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.outputLines.push({ text: line, isError });
        }
      }
      this.$nextTick(() => {
        const output = this.$refs.output;
        if (output) output.scrollTop = output.scrollHeight;
      });
    },
  },
};
</script>

<style scoped>
.terminal-panel {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}
.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.terminal-title { color: #ff6b35; font-size: 0.9rem; }
.terminal-hint { color: #556; font-size: 0.75rem; }
.terminal-output {
  background: #0a0a0a;
  border: 1px solid #1a2a1a;
  border-radius: 4px;
  padding: 12px;
  height: 200px;
  overflow-y: auto;
  font-size: 0.8rem;
  line-height: 1.6;
}
.output-line { white-space: pre-wrap; word-break: break-all; }
.output-line.is-error { color: #f44336; }
.output-line.is-prompt { color: #4caf50; }

.terminal-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.prompt { color: #4caf50; font-weight: bold; }
.terminal-input {
  flex: 1;
  background: #0a0a0a;
  border: 1px solid #1a2a2a;
  border-radius: 4px;
  padding: 8px 12px;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 0.85rem;
  outline: none;
}
.terminal-input:focus { border-color: #ff6b35; }
.terminal-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
```

**Note:** The Terminal component uses a simple text-based approach (not xterm.js) for MVP to avoid complexity. The xterm.js dependency is kept in package.json for future enhancement.

---

### Task 14: ScoreBoard Component

**Files:**
- Create: `frontend/src/components/ScoreBoard.vue`

- [ ] **Step 1: Write ScoreBoard.vue**

```vue
<template>
  <div class="score-overlay">
    <div class="score-board">
      <h2>{{ state.status === 'TIMEOUT' ? '超时！' : '本轮结算' }}</h2>
      <p class="summary">{{ state.roundSummary }}</p>

      <div class="score-detail" v-if="state.human">
        <div class="score-section">
          <h4>🧑 你的表现</h4>
          <div class="stat">总分: <strong>{{ state.human.total || 0 }}</strong></div>
          <div class="stat">修复耗时: <strong>{{ ((state.human.repairTime || 0) / 1000).toFixed(1) }}s</strong></div>
          <div class="stat">使用命令: <code>{{ state.human.command || '无' }}</code></div>
        </div>
        <div class="score-section">
          <h4>🤖 AI 的表现</h4>
          <div class="stat">总分: <strong>{{ state.ai.total || 0 }}</strong></div>
          <div class="stat">修复耗时: <strong>{{ ((state.ai.repairTime || 0) / 1000).toFixed(1) }}s</strong></div>
          <div class="stat">使用命令: <code>{{ state.ai.command || '无' }}</code></div>
        </div>
      </div>

      <div v-if="state.status === 'TIMEOUT'" class="timeout-msg">
        <p>5 分钟内未能修复故障。系统已自动恢复。</p>
        <p class="tip">提示: 试试 kubectl get pods 查看 Pod 状态，kubectl scale deployment 调整副本数</p>
      </div>

      <div class="fault-reveal">
        <h4>实际故障</h4>
        <div v-for="fault in state.faults" :key="fault.id" class="fault-item">
          <span class="fault-type">{{ fault.type }}</span>
          <span class="fault-target">目标: {{ fault.target }}</span>
        </div>
      </div>

      <button class="btn-reset" @click="$emit('reset')">再来一局</button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ScoreBoard',
  props: {
    state: { type: Object, required: true },
  },
  emits: ['reset'],
};
</script>

<style scoped>
.score-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.score-board {
  background: #111827;
  border: 1px solid #1e2d3d;
  border-radius: 12px;
  padding: 32px;
  max-width: 600px;
  width: 90%;
}
.score-board h2 {
  text-align: center;
  color: #ff6b35;
  font-size: 1.5rem;
  margin-bottom: 8px;
}
.summary { text-align: center; color: #8899aa; margin-bottom: 24px; }
.score-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
.score-section {
  background: #0d1520;
  border: 1px solid #1a2a3a;
  border-radius: 8px;
  padding: 16px;
}
.score-section h4 { color: #8899aa; margin-bottom: 8px; font-size: 0.9rem; }
.stat { font-size: 0.85rem; margin-bottom: 4px; color: #aabbcc; }
.stat strong { color: #ff6b35; }
.stat code {
  background: #0a0a0a;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.75rem;
  word-break: break-all;
}
.timeout-msg {
  background: #1a0a1a;
  border: 1px solid #3a1a3a;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  text-align: center;
}
.timeout-msg p { color: #ce93d8; margin-bottom: 8px; }
.tip { font-size: 0.8rem; color: #9988aa; }
.fault-reveal {
  background: #0d1520;
  border: 1px solid #1a2a3a;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}
.fault-reveal h4 { color: #ff9800; margin-bottom: 8px; }
.fault-item { display: flex; gap: 16px; padding: 4px 0; font-size: 0.85rem; }
.fault-type {
  background: #2a1a1a;
  color: #ff9800;
  padding: 2px 10px;
  border-radius: 4px;
  font-family: monospace;
}
.fault-target { color: #8899aa; }
.btn-reset {
  display: block;
  width: 100%;
  padding: 14px;
  background: #ff6b35;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 1.1rem;
  font-weight: bold;
  cursor: pointer;
}
.btn-reset:hover { background: #e55a2b; }
</style>
```

---

## Phase 4: Integration Testing & Debugging

### Task 15: Integration Test

**Files:**
- Create: `game-server/__tests__/integration.test.js`

- [ ] **Step 1: Write integration test**

```javascript
// Integration test: full game flow through all modules
const K8sClient = require('../k8s-client');
const StateMachine = require('../state-machine');
const { ChaosInjector } = require('../chaos-injector');
const AiEngine = require('../ai-engine');
const Scorer = require('../scorer');
const { TerminalProxy } = require('../terminal-proxy');

describe('Full Game Integration', () => {
  test('complete game flow: IDLE -> INJECTING -> DIAGNOSING -> SCORING -> IDLE', async () => {
    // Setup
    const k8s = new K8sClient({ mockMode: true });
    const sm = new StateMachine();
    const injector = new ChaosInjector(k8s);
    const ai = new AiEngine(k8s);
    const scorer = new Scorer();
    const terminal = new TerminalProxy(k8s, { mockMode: true });

    // Phase 1: IDLE
    expect(sm.getStatus()).toBe('IDLE');
    expect(k8s.isHealthy()).toBe(true);

    // Phase 2: INJECTING
    sm.startGame('easy');
    expect(sm.getStatus()).toBe('INJECTING');

    await ai.captureBaseline();

    const faults = injector.pickFault('easy');
    injector.injectMock(faults);
    expect(k8s.isHealthy()).toBe(false);

    sm.startDiagnosing(faults);
    expect(sm.getStatus()).toBe('DIAGNOSING');

    // Phase 3: DIAGNOSING — Human tries to figure out the issue
    // Step 1: Check pods
    const podsResult = terminal.execute('kubectl get pods');
    expect(podsResult.success).toBe(true);

    // Step 2: AI diagnosis
    const diagnosis = await ai.diagnose(faults);
    expect(diagnosis).toHaveProperty('diagnosis');
    expect(diagnosis).toHaveProperty('repairCommand');

    // Step 3: Human uses the right repair command
    let repairCmd;
    for (const fault of faults) {
      if (fault.type === 'scale-to-zero') {
        repairCmd = `kubectl scale deployment ${fault.target} --replicas=2`;
      } else if (fault.type === 'kill-random-pod') {
        repairCmd = `kubectl scale deployment ${fault.target} --replicas=2`;
      }
    }

    if (repairCmd) {
      const repairResult = terminal.execute(repairCmd);
      expect(repairResult.success).toBe(true);
      sm.markHumanRepaired(repairCmd);
    }

    // After repair, cluster should be healthy
    expect(k8s.isHealthy()).toBe(true);

    // Phase 4: SCORING
    sm.markAiRepaired(diagnosis.repairCommand);
    const state = sm.getState();

    const scoringResult = scorer.score({
      humanRepairTime: state.humanRepairTime || 5000,
      aiRepairTime: state.aiRepairTime || 30000,
      humanCommand: state.humanRepairCommand || '',
      aiCommand: state.aiRepairCommand || '',
      actualFaultType: faults[0].type,
      aiDiagnosis: diagnosis.diagnosis,
    });

    sm.endGame(scoringResult);
    expect(sm.getStatus()).toBe('SCORING');
    expect(scoringResult).toHaveProperty('winner');

    // Phase 5: Reset to IDLE
    sm.reset();
    expect(sm.getStatus()).toBe('IDLE');
    expect(sm.getState().round).toBe(1);

    // Restore
    injector.restoreMock(faults);
    expect(k8s.isHealthy()).toBe(true);
  });

  test('human can repair scale-to-zero via terminal', () => {
    const k8s = new K8sClient({ mockMode: true });
    const terminal = new TerminalProxy(k8s, { mockMode: true });
    const injector = new ChaosInjector(k8s);

    // Inject fault
    const faults = [{ type: 'scale-to-zero', target: 'order-service',
      id: 'test-1', restoreFn: { method: 'scale', replicas: 2, target: 'order-service' } }];
    injector.injectMock(faults);
    expect(k8s.isHealthy()).toBe(false);

    // Human diagnoses
    const checkResult = terminal.execute('kubectl get deployments');
    expect(checkResult.success).toBe(true);

    // Human repairs
    const repairResult = terminal.execute('kubectl scale deployment order-service --replicas=2');
    expect(repairResult.success).toBe(true);
    expect(k8s.isHealthy()).toBe(true);
  });

  test('terminal rejects dangerous commands in game context', () => {
    const k8s = new K8sClient({ mockMode: true });
    const terminal = new TerminalProxy(k8s, { mockMode: true });

    const dangerous = [
      'kubectl delete pod test-pod',
      'kubectl apply -f evil.yaml',
      'kubectl get pods; rm -rf /',
    ];

    for (const cmd of dangerous) {
      const result = terminal.execute(cmd);
      expect(result.success).toBe(false);
    }
  });

  test('timeout path: game ends after timeout', () => {
    const sm = new StateMachine();
    sm.startGame('easy');
    sm.startDiagnosing([]);

    sm.timeout();
    expect(sm.getStatus()).toBe('TIMEOUT');

    sm.reset();
    expect(sm.getStatus()).toBe('IDLE');
  });

  test('AI rule-based diagnosis correctly identifies both fault types', async () => {
    const k8s = new K8sClient({ mockMode: true });
    const ai = new AiEngine(k8s);

    // Test scale-to-zero detection
    k8s.injectMockFault('scale-to-zero', 'product-service');
    let result = ai._ruleBasedDiagnosis(k8s.getClusterSnapshot());
    expect(result.repairCommand).toContain('kubectl scale');
    expect(result.suspectedService).toBe('product-service');

    // Reset and test kill-random-pod detection
    k8s.clearMockFault();
    k8s.injectMockFault('kill-random-pod', 'frontend');
    result = ai._ruleBasedDiagnosis(k8s.getClusterSnapshot());
    expect(result.suspectedService).toBe('frontend');
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `cd "期末大项目/chaos-fire-drill/game-server" && npx jest __tests__/integration.test.js --forceExit`

Expected: All 5 integration tests pass.

---

## Phase 5: K8s Deployment Configs

### Task 16: K8s YAML Files

**Files:**
- Create: `k8s/namespace.yaml`
- Create: `k8s/game-server-deployment.yaml`

- [ ] **Step 1: Create namespace.yaml**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: chaos-game
```

- [ ] **Step 2: Create game-server-deployment.yaml**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: game-server
  namespace: chaos-game
spec:
  replicas: 1
  selector:
    matchLabels:
      app: game-server
  template:
    metadata:
      labels:
        app: game-server
    spec:
      serviceAccountName: chaos-game-admin
      containers:
        - name: game-server
          image: chaos-fire-drill-game-server:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3001
          env:
            - name: PORT
              value: "3001"
            - name: MOCK_MODE
              value: "false"
---
apiVersion: v1
kind: Service
metadata:
  name: game-server
  namespace: chaos-game
spec:
  selector:
    app: game-server
  ports:
    - port: 3001
      targetPort: 3001
  type: LoadBalancer
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: chaos-game-admin
  namespace: chaos-game
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: chaos-game-operator
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "deployments/scale"]
    verbs: ["get", "list", "watch", "update", "patch"]
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec", "events"]
    verbs: ["get", "list", "watch", "delete", "create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: chaos-game-operator-binding
subjects:
  - kind: ServiceAccount
    name: chaos-game-admin
    namespace: chaos-game
roleRef:
  kind: ClusterRole
  name: chaos-game-operator
  apiGroup: rbac.authorization.k8s.io
```

---

## Final Verification

- [ ] **Run all tests together**

```bash
cd "期末大项目/chaos-fire-drill/game-server" && npx jest --forceExit
```

Expected: All tests pass (approximately 50+ tests across 7 test files).

- [ ] **Start the full system and verify in browser**

```bash
# Terminal 1: Start game server
cd "期末大项目/chaos-fire-drill/game-server" && node server.js

# Terminal 2: Start frontend dev server
cd "期末大项目/chaos-fire-drill/frontend" && npm run dev
```

Open http://localhost:5173, click "开始游戏 (Easy)", verify:
1. Health panel shows pods becoming unhealthy after fault injection
2. Timer starts counting
3. AI diagnosis appears in the AI panel
4. Type `kubectl get pods` in terminal and see output
5. Type the repair command to fix the fault
6. Score board appears with results
7. Click "再来一局" to restart
