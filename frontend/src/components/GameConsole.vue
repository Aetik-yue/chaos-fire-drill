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
      <span class="label">模式</span>
      <span class="value mode-value">
        <button
          class="mode-btn"
          :class="{ active: gameMode === 'practice' }"
          :disabled="state.status !== 'IDLE'"
          @click="$emit('switch-mode', 'practice')"
        >练习</button>
        <button
          class="mode-btn"
          :class="{ active: gameMode === 'micro-demo' }"
          :disabled="state.status !== 'IDLE'"
          @click="$emit('switch-mode', 'micro-demo')"
        >Micro-Demo</button>
        <button
          class="mode-btn"
          :class="{ active: gameMode === 'bookinfo' }"
          :disabled="state.status !== 'IDLE'"
          @click="$emit('switch-mode', 'bookinfo')"
        >Bookinfo</button>
      </span>
    </div>
    <div class="info-row">
      <span class="label">状态</span>
      <span class="value" :class="state.status">{{ statusText }}</span>
    </div>

    <div v-if="(state.status === 'DIAGNOSING' || state.status === 'SCORING' || state.status === 'TIMEOUT')"
         class="fault-hint">
      <div class="hint-label">故障提示</div>
      <div class="hint-text">系统出现异常，请排查！</div>
      <div class="fault-types">
        <span class="fault-tag">可能: 服务不可用</span>
        <span class="fault-tag">可能: Pod 异常</span>
        <span v-if="state.difficulty === 'hard'" class="fault-tag">可能: 网络延迟</span>
        <span v-if="state.difficulty === 'hard'" class="fault-tag">可能: 多服务故障</span>
      </div>
    </div>

    <div class="actions">
      <div v-if="state.status === 'IDLE'" class="difficulty-actions">
        <button class="btn btn-start btn-easy" @click="$emit('start-game', 'easy')">
          简单模式
        </button>
        <button class="btn btn-start btn-hard" @click="$emit('start-game', 'hard')">
          困难模式
        </button>
        <div class="difficulty-desc">
          <div>简单: 单一故障 (缩容/杀Pod)</div>
          <div>困难: 双重故障 (网络延迟/多服务攻击)</div>
        </div>
      </div>

      <button
        v-if="state.status === 'DIAGNOSING'"
        class="btn btn-stop"
        @click="$emit('stop-game')"
      >
        放弃本轮
      </button>

      <button
        v-if="(state.status === 'SCORING' || state.status === 'TIMEOUT')"
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
    gameMode: { type: String, default: 'practice' },
  },
  emits: ['start-game', 'stop-game', 'reset-game', 'switch-mode'],
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
  font-size: 0.9rem;
  color: #d73a49;
  margin-bottom: 14px;
  text-transform: uppercase;
  letter-spacing: 2px;
  font-weight: 700;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px solid #f0f0f4;
  font-size: 1rem;
}

.label { color: #57606a; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 1px; }
.value { font-weight: 700; color: #1c1c2e; }
.value.IDLE { color: #57606a; }
.value.INJECTING { color: #9a6700; }
.value.DIAGNOSING { color: #cf222e; }

.timer {
  font-size: 2rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: #d73a49;
  font-weight: 800;
  letter-spacing: 2px;
}

.fault-hint {
  margin-top: 16px;
  padding: 14px;
  background: #fff8c5;
  border: 2px solid #d4a72c;
  border-radius: 4px;
}

.hint-label { color: #9a6700; font-size: 0.8rem; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
.hint-text { font-size: 0.95rem; margin-bottom: 10px; font-weight: 600; color: #1c1c2e; }
.fault-types { display: flex; gap: 8px; flex-wrap: wrap; }
.fault-tag {
  background: #fff8c5;
  color: #9a6700;
  padding: 4px 10px;
  border: 1px solid #d4a72c;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 3px;
}

.actions { margin-top: 20px; display: flex; flex-direction: column; gap: 10px; }

.btn {
  padding: 14px 24px;
  border: 2px solid transparent;
  cursor: pointer;
  font-size: 1.1rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: all 0.15s;
  border-radius: 4px;
}

.btn-start { color: #fff; }
.btn-easy { background: #1a7f37; border-color: #1a7f37; }
.btn-easy:hover { background: #2ea043; border-color: #2ea043; }
.btn-hard { background: #cf222e; border-color: #cf222e; }
.btn-hard:hover { background: #e03c31; border-color: #e03c31; }

.difficulty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.difficulty-desc {
  width: 100%;
  margin-top: 4px;
  font-size: 0.8rem;
  color: #57606a;
  line-height: 1.7;
}

.btn-stop { background: #f6f8fa; color: #57606a; border-color: #d0d7de; }
.btn-stop:hover { background: #eaeef2; color: #1c1c2e; border-color: #8b949e; }

.btn-reset {
  background: #dafbe1;
  color: #1a7f37;
  border: 2px solid #4ac26b;
}
.btn-reset:hover { background: #a3eab1; border-color: #1a7f37; }

.mode-value { display: flex; gap: 6px; }
.mode-btn {
  padding: 6px 14px;
  border: 2px solid #d0d7de;
  background: transparent;
  color: #57606a;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: all 0.15s;
  border-radius: 4px;
}
.mode-btn:hover:not(:disabled) { border-color: #8b949e; color: #1c1c2e; background: #f6f8fa; }
.mode-btn.active { background: #dafbe1; border-color: #4ac26b; color: #1a7f37; }
.mode-btn.active:nth-child(2) { background: #ffebe9; border-color: #ff8182; color: #cf222e; }
.mode-btn.active:nth-child(3) { background: #ddf4ff; border-color: #80ccff; color: #0969da; }
.mode-btn:disabled { opacity: 0.3; cursor: not-allowed; }
</style>
