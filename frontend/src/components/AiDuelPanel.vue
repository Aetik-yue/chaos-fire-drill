<template>
  <div class="ai-duel-panel">
    <h3>AI 对决</h3>

    <div class="score-row">
      <div class="player human">
        <span class="player-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d73a49" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 20c0-4 4-7 8-7s8 3 8 7"/>
          </svg>
        </span>
        <span class="player-name">你</span>
        <span class="player-score">{{ state.humanScore || 0 }}分</span>
      </div>
      <div class="vs">VS</div>
      <div class="player ai">
        <span class="player-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0969da" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="8" y="3" width="8" height="4" rx="1"/>
            <rect x="8" y="17" width="8" height="4" rx="1"/>
            <rect x="3" y="8" width="4" height="8" rx="1"/>
            <rect x="17" y="8" width="4" height="8" rx="1"/>
            <rect x="8" y="8" width="8" height="8" rx="1"/>
          </svg>
        </span>
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
      <span class="thinking-dots">AI 分析中...</span>
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
  font-size: 0.9rem;
  color: #d73a49;
  margin-bottom: 14px;
  text-transform: uppercase;
  letter-spacing: 2px;
  font-weight: 700;
}

.score-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-bottom: 18px;
}

.player {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.player-icon svg { display: block; }
.player-icon svg[stroke="#d73a49"] { stroke: #d73a49; }
.player-icon svg[stroke="#0969da"] { stroke: #0969da; }
.player-name { font-size: 0.8rem; color: #57606a; text-transform: uppercase; letter-spacing: 1px; }
.player-score { font-size: 1.6rem; font-weight: 800; color: #d73a49; }

.vs { color: #8b949e; font-weight: 800; font-size: 0.9rem; }

.status-row {
  display: flex;
  justify-content: space-around;
  margin-bottom: 18px;
  font-size: 0.95rem;
  font-weight: 600;
  color: #1c1c2e;
}

.status-dot {
  display: inline-block;
  width: 10px; height: 10px;
  margin-right: 6px;
  border-radius: 50%;
}

.status-dot.done { background: #1a7f37; box-shadow: 0 0 8px rgba(26, 127, 55, 0.4); }
.status-dot.waiting { background: #d4a72c; box-shadow: 0 0 8px rgba(212, 167, 44, 0.4); animation: pulse 1.2s infinite; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}

.time-badge {
  display: block;
  color: #1a7f37;
  font-weight: 800;
  font-size: 0.85rem;
  margin-top: 3px;
  font-family: 'JetBrains Mono', monospace;
}

.ai-thought {
  background: #ddf4ff;
  border: 2px solid #80ccff;
  padding: 14px;
  border-radius: 4px;
}

.thought-label {
  font-size: 0.8rem;
  color: #0969da;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 700;
}

.thought-content {
  font-size: 0.9rem;
  color: #1c1c2e;
  line-height: 1.6;
}

.ai-thinking {
  padding: 24px;
  text-align: center;
  color: #57606a;
  font-size: 0.9rem;
}

.winner-banner {
  margin-top: 18px;
  padding: 14px;
  text-align: center;
  font-weight: 800;
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  border-radius: 4px;
}

.winner-banner.human-wins { background: #dafbe1; color: #1a7f37; border: 2px solid #4ac26b; }
.winner-banner.ai-wins { background: #f0e6ff; color: #8250df; border: 2px solid #cb9eff; }
.winner-banner.draw { background: #fff8c5; color: #9a6700; border: 2px solid #d4a72c; }
</style>
