// Game Server — Express + WebSocket entry point
require('dotenv').config();
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
const MOCK_MODE = process.env.MOCK_MODE === 'true'; // only mock if explicitly set
let currentMode = 'practice';

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
const fs = require('fs');
let frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (!fs.existsSync(frontendDist)) {
  frontendDist = path.join(__dirname, 'frontend', 'dist');
}
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
    // Set targets based on current mode before picking faults
    if (currentMode === 'bookinfo') {
      injector.setTargets(['productpage', 'details', 'ratings', 'reviews'], 1);
    } else {
      injector.setTargets(['frontend', 'order-service', 'product-service'], 2);
    }
    const faults = injector.pickFault(difficulty);

    // Notify clients
    broadcast({ type: 'state-change', state: sm.getState() });

    // Inject after short delay (simulates injection time)
    setTimeout(async () => {
      await injector.inject(faults);

      sm.startDiagnosing(faults);

      // Broadcast fault injected event (but not the details — keep it hidden)
      broadcast({
        type: 'fault-injected',
        faultHint: `系统出现异常，请排查！（难度: ${difficulty}）`,
      });

      // Send alert notification after fault injected
      const webhookUrl = currentMode === 'bookinfo' ? 'http://localhost:30090/productpage' : 'http://localhost:30080';
      broadcast({
        type: 'alert-notification',
        faults: faults.map(f => ({
          type: f.type,
          target: f.target,
          description: f.description,
        })),
        mode: currentMode,
        webhookUrl: currentMode === 'practice' ? null : webhookUrl,
        severity: difficulty === 'hard' ? 'critical' : 'warning',
        timestamp: Date.now(),
      });

      broadcast({ type: 'state-change', state: sm.getState() });
      broadcast({ type: 'cluster-snapshot', snapshot: k8s.getClusterSnapshot() });

      // Reset and start AI diagnosis
      aiDiagnosisInProgress = false;
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

app.post('/api/game/reset', async (req, res) => {
  try {
    sm.reset();
    // Restore any remaining faults
    const state = sm.getState();
    if (state.faults.length > 0) {
      await injector.restore(state.faults);
    }
    if (k8s.mockMode) {
      k8s.resetMockState();
    }
    broadcast({ type: 'state-change', state: sm.getState() });
    res.json({ success: true, state: sm.getState() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/mode', (req, res) => {
    res.json({ mode: currentMode, mockMode: k8s.mockMode });
  });

  app.post('/api/mode', async (req, res) => {
    const { mode } = req.body;
    const validModes = ['practice', 'micro-demo', 'bookinfo'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ success: false, error: '模式必须为 practice、micro-demo 或 bookinfo' });
    }
    if (sm.getStatus() !== 'IDLE') {
      return res.status(400).json({ success: false, error: '只能在等待状态切换模式' });
    }

    // When switching to a real mode, verify kubectl can reach the cluster
    if (mode !== 'practice') {
      const check = k8s.checkConnectivity();
      if (!check.ok) {
        return res.status(400).json({
          success: false,
          error: `无法连接到 K8s 集群: ${check.error}`,
        });
      }
    }

    currentMode = mode;
    if (mode === 'practice') {
      k8s.setMockMode(true);
      terminal.setMockMode(true);
      k8s.setNamespace('chaos-game');
      terminal.setNamespace('chaos-game');
    } else if (mode === 'micro-demo') {
      k8s.setMockMode(false);
      terminal.setMockMode(false);
      k8s.setNamespace('demo-micro');
      terminal.setNamespace('demo-micro');
    } else if (mode === 'bookinfo') {
      k8s.setMockMode(false);
      terminal.setMockMode(false);
      k8s.setNamespace('default');
      terminal.setNamespace('default');
    }
    broadcast({ type: 'mode-change', mode: currentMode });
    broadcast({ type: 'cluster-snapshot', snapshot: k8s.getClusterSnapshot() });
    console.log(`Mode switched to: ${currentMode}`);
    res.json({ success: true, mode: currentMode });
  });

  app.post('/api/game/stop', async (req, res) => {
  try {
    const state = sm.getState();
    if (state.status === 'DIAGNOSING') {
      if (healthCheckInterval) { clearInterval(healthCheckInterval); healthCheckInterval = null; }
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }

      broadcast({ type: 'ai-repair-progress', step: 'start' });
      res.json({ success: true, state: sm.getState() });

      await performAiAutoRepair(state.faults);

      sm.timeout();
      broadcast({ type: 'state-change', state: sm.getState() });
      await injector.restore(state.faults);
    } else {
      res.json({ success: true, state: sm.getState() });
    }
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
      const wasUnhealthy = !k8s.isHealthy();
      const result = terminal.execute(message.command);
      ws.send(JSON.stringify({ type: 'terminal-output', ...result }));

      if (result.success) {
        checkRepair(result.command, 'human', wasUnhealthy);
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
      // Only end game if someone has actually repaired, not just auto-healed
      if (state.humanRepaired || state.aiRepaired) {
        // Gather cost data
        const snapshot = k8s.getClusterSnapshot();
        const currentPods = snapshot.pods.length;
        const expectedPods = snapshot.deployments.length * 2; // baseline 2 per deployment
        const humanCommands = terminal.getHistory().length;
        const aiCommands = 1; // AI always issues 1 repair command
        const now = Date.now();
        const diagnosisMs = now - (state.startTime || now);
        const diagnosisMin = parseFloat((diagnosisMs / 60000).toFixed(2));
        const humanTime = state.humanRepairTime || null;
        const aiTime = state.aiRepairTime || null;

        const scoringResult = scorer.score({
          humanRepairTime: humanTime,
          aiRepairTime: aiTime,
          humanCommand: state.humanRepairCommand || '',
          aiCommand: state.aiRepairCommand || '',
          actualFaultType: state.faults[0]?.type || 'unknown',
          aiDiagnosis: state.aiDiagnosis || '',
          // Cost parameters
          humanTotalPods: currentPods,
          humanCommandCount: humanCommands,
          humanOverProvisionedPods: Math.max(0, currentPods - expectedPods),
          humanDowntimeSeconds: humanTime ? humanTime / 1000 : diagnosisMs / 1000,
          aiTotalPods: currentPods,
          aiCommandCount: aiCommands,
          aiOverProvisionedPods: Math.max(0, currentPods - expectedPods),
          aiDowntimeSeconds: aiTime ? aiTime / 1000 : diagnosisMs / 1000,
          diagnosisMinutes: diagnosisMin > 0 ? diagnosisMin : 0.01,
          namespace: k8s.namespace,
        });
        sm.endGame(scoringResult);
        broadcast({ type: 'state-change', state: sm.getState() });

        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      }
    }
  }, 1000);
}

function startTimeoutTimer() {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  timeoutTimer = setTimeout(async () => {
    if (sm.getStatus() === 'DIAGNOSING') {
      if (healthCheckInterval) { clearInterval(healthCheckInterval); healthCheckInterval = null; }

      const state = sm.getState();
      broadcast({ type: 'ai-repair-progress', step: 'start' });
      await performAiAutoRepair(state.faults);

      // Transition to TIMEOUT
      sm.timeout();
      broadcast({ type: 'state-change', state: sm.getState() });
      await injector.restore(state.faults);
    }
  }, 300000); // 5 minutes
}

async function startAiDiagnosis() {
  if (aiDiagnosisInProgress) return;
  aiDiagnosisInProgress = true;

  // AI waits before starting diagnosis (giving human a head start)
  setTimeout(async () => {
    const diagnosis = await ai.diagnose(sm.getState().faults);
    sm.setAiDiagnosis(diagnosis.diagnosis);

    broadcast({
      type: 'ai-diagnosis',
      diagnosis: diagnosis.diagnosis,
      suspectedService: diagnosis.suspectedService,
    });

    // AI waits before attempting repair (simulating "thinking + typing")
    setTimeout(async () => {
      const repairResult = await ai.attemptRepair(diagnosis);
      if (repairResult.success) {
        const wasUnhealthy = !k8s.isHealthy();
        terminal.execute(diagnosis.repairCommand);
        checkRepair(diagnosis.repairCommand, 'ai', wasUnhealthy);
      }
      aiDiagnosisInProgress = false;
    }, 3000 + Math.random() * 5000); // AI takes 3-8s to execute repair
  }, 10000); // Wait 10s head start for human, then AI starts diagnosing immediately
}

async function performAiAutoRepair(faults) {
  let diagnosisResult = null;
  let diagnosisText = '';

  try {
    // Stream AI diagnosis
    broadcast({ type: 'ai-repair-progress', step: 'diagnosing', text: 'AI 正在分析集群状态...' });

    for await (const chunk of ai.diagnoseWithStream(faults)) {
      if (chunk.type === 'token') {
        diagnosisText += chunk.text;
        broadcast({ type: 'ai-repair-progress', step: 'diagnosing', text: diagnosisText });
      } else if (chunk.type === 'done') {
        diagnosisResult = chunk.result;
      }
    }

    if (!diagnosisResult) {
      diagnosisResult = { diagnosis: '无法诊断', suspectedService: 'unknown', repairCommand: 'kubectl get pods -n chaos-game' };
    }

    broadcast({
      type: 'ai-repair-progress',
      step: 'diagnosed',
      diagnosis: diagnosisResult.diagnosis,
      repairCommand: diagnosisResult.repairCommand,
    });

    // Attempt repair
    const repairResult = await ai.attemptRepair(diagnosisResult);
    if (repairResult.success) {
      broadcast({
        type: 'ai-repair-progress',
        step: 'repairing',
        command: diagnosisResult.repairCommand,
      });
      terminal.execute(diagnosisResult.repairCommand);

      broadcast({
        type: 'ai-repair-progress',
        step: 'repaired',
        command: diagnosisResult.repairCommand,
        output: '修复命令已执行',
      });
    } else {
      broadcast({
        type: 'ai-repair-progress',
        step: 'failed',
        diagnosis: diagnosisResult.diagnosis,
        error: '无法自动修复',
      });
    }
  } catch (err) {
    broadcast({
      type: 'ai-repair-progress',
      step: 'error',
      error: err.message,
    });
  }
}

function checkRepair(command, who, wasUnhealthy = false) {
  if (sm.getStatus() !== 'DIAGNOSING') return;

  const isRepair = (
    (command.includes('scale') && /--replicas=\d+/.test(command)) ||
    command.includes('rollout restart') ||
    (command.includes('exec') && (command.includes('tc qdisc') || command.includes('pkill') || command.includes('kill')))
  );

  if (!isRepair) return;

  // Only credit repair if the cluster was actually broken before the command
  if (!wasUnhealthy) return;

  if (who === 'human' && !sm.getState().humanRepaired) {
    sm.markHumanRepaired(command);
    broadcast({ type: 'state-change', state: sm.getState() });
  }
  if (who === 'ai' && !sm.getState().aiRepaired) {
    sm.markAiRepaired(command);
    broadcast({ type: 'state-change', state: sm.getState() });
  }
}

server.listen(PORT, () => {
  console.log(`Chaos Fire Drill server running on http://localhost:${PORT}`);
  const modeLabel = currentMode === 'practice' ? '练习模式 (Mock)' : currentMode === 'micro-demo' ? 'Micro-Demo (Live K8s)' : 'Bookinfo (Live K8s)';
  console.log(`Mode: ${modeLabel}`);
  console.log(`WebSocket available at ws://localhost:${PORT}`);
});
