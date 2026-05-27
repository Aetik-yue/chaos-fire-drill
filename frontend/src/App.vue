<template>
  <div class="app">
    <header class="app-header">
      <h1 class="logo">CHAOS</h1>
      <span class="mode-badge" :class="gameMode">
        {{ gameMode === 'practice' ? '练习' : gameMode === 'micro-demo' ? 'Micro-Demo' : 'Bookinfo' }}
      </span>
      <span class="round-badge" v-if="state.round > 0">ROUND {{ state.round }}</span>
      <span class="status-badge" :class="state.status">{{ statusText }}</span>
    </header>

    <AlertNotification
      :notification="alertNotification"
      @dismiss="alertNotification = null"
    />

    <div class="dashboard">
      <div class="panel panel-health">
        <HealthPanel :snapshot="snapshot" :game-status="state.status" :game-mode="gameMode" />
      </div>
      <div class="panel panel-console">
        <GameConsole
          :state="state"
          :game-mode="gameMode"
          @start-game="startGame"
          @stop-game="stopGame"
          @reset-game="resetGame"
          @switch-mode="switchMode"
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

    <ScoreBoard v-if="showScore" :state="state" @reset="resetGame" :ai-repair-state="aiRepairState" />
  </div>
</template>

<script>
import HealthPanel from './components/HealthPanel.vue';
import GameConsole from './components/GameConsole.vue';
import AiDuelPanel from './components/AiDuelPanel.vue';
import TerminalPanel from './components/Terminal.vue';
import ScoreBoard from './components/ScoreBoard.vue';
import AlertNotification from './components/AlertNotification.vue';

const WS_URL = `ws://${window.location.hostname}:3001`;

export default {
  name: 'App',
  components: { HealthPanel, GameConsole, AiDuelPanel, TerminalPanel, ScoreBoard, AlertNotification },
  data() {
    return {
      ws: null,
      reconnectTimer: null,
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
      gameMode: 'practice',
      aiDiagnosis: '',
      terminalOutput: '',
      showScore: false,
      aiRepairState: null,
      alertNotification: null,
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
    fetch('/api/mode').then(r => r.json()).then(d => { this.gameMode = d.mode; });
  },
  beforeUnmount() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
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
            break;
          case 'alert-notification':
            this.alertNotification = msg;
            break;
          case 'ai-diagnosis':
            this.aiDiagnosis = msg.diagnosis;
            break;
          case 'terminal-output':
            this.terminalOutput = (msg.output || '') + '\0' + Date.now();
            break;
          case 'ai-repair-progress':
            this.aiRepairState = msg;
            break;
          case 'mode-change':
            this.gameMode = msg.mode;
            break;
          case 'error':
        }
      };
      this.ws.onclose = () => {
        this.reconnectTimer = setTimeout(() => this.connectWs(), 3000);
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
    switchMode(mode) {
      fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
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
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  background: #f0f0f4;
  color: #1c1c2e;
  min-height: 100vh;
}

.app {
  max-width: 1500px;
  margin: 0 auto;
  padding: 12px 20px;
}

/* ── HEADER ── */
.app-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  border-bottom: 2px solid #d0d7de;
  margin-bottom: 16px;
}

.logo {
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  font-size: 1.8rem;
  font-weight: 900;
  color: #d73a49;
  letter-spacing: 2px;
}

.round-badge {
  background: #f0e6ff;
  color: #8250df;
  padding: 5px 14px;
  border: 2px solid #cb9eff;
  font-size: 0.9rem;
  font-weight: 700;
  text-transform: uppercase;
  border-radius: 4px;
}

.status-badge {
  margin-left: auto;
  padding: 6px 18px;
  border: 2px solid transparent;
  font-size: 0.9rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
  border-radius: 4px;
}

.mode-badge {
  padding: 5px 14px;
  border: 2px solid transparent;
  font-size: 0.9rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
  border-radius: 4px;
}
.mode-badge.practice   { background: #dafbe1; border-color: #4ac26b; color: #1a7f37; }
.mode-badge.micro-demo { background: #ffebe9; border-color: #ff8182; color: #cf222e; }
.mode-badge.bookinfo   { background: #ddf4ff; border-color: #80ccff; color: #0969da; }

.status-badge.IDLE       { background: #f6f8fa; border-color: #d0d7de; color: #57606a; }
.status-badge.INJECTING  { background: #fff8c5; border-color: #d4a72c; color: #9a6700; }
.status-badge.DIAGNOSING { background: #ffebe9; border-color: #ff8182; color: #cf222e; }
.status-badge.SCORING    { background: #dafbe1; border-color: #4ac26b; color: #1a7f37; }
.status-badge.TIMEOUT    { background: #f0e6ff; border-color: #cb9eff; color: #8250df; }

/* ── DASHBOARD GRID ── */
.dashboard {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}

@media (max-width: 1000px) {
  .dashboard { grid-template-columns: 1fr; }
}

.panel {
  background: #ffffff;
  border: 2px solid #d0d7de;
  padding: 18px;
  border-radius: 6px;
}

/* ── TERMINAL SECTION ── */
.terminal-section {
  background: #ffffff;
  border: 2px solid #d0d7de;
  padding: 18px;
  margin-bottom: 14px;
  border-radius: 6px;
}

</style>
