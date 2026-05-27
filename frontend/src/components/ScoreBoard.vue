<template>
  <div class="score-overlay">
    <div class="score-board">
      <h2>{{ state.status === 'TIMEOUT' ? '超时！' : '本轮结算' }}</h2>
      <p class="summary">{{ state.roundSummary }}</p>

      <div class="score-detail" v-if="state.human">
        <div class="score-section">
          <h4>你的表现</h4>
          <div class="stat">总分: <strong>{{ state.human.total || 0 }}</strong></div>
          <div class="stat">修复耗时: <strong>{{ ((state.human.repairTime || 0) / 1000).toFixed(1) }}s</strong></div>
          <div class="stat">使用命令: <code>{{ state.human.command || '无' }}</code></div>
        </div>
        <div class="score-section">
          <h4>AI 的表现</h4>
          <div class="stat">总分: <strong>{{ state.ai.total || 0 }}</strong></div>
          <div class="stat">修复耗时: <strong>{{ ((state.ai.repairTime || 0) / 1000).toFixed(1) }}s</strong></div>
          <div class="stat">使用命令: <code>{{ state.ai.command || '无' }}</code></div>
        </div>
      </div>

      <!-- Cost billing panel -->
      <div class="billing-panel" v-if="state.human && state.human.costBreakdown">
        <h3>云成本结算</h3>
        <div class="billing-columns">
          <div class="bill-col">
            <h4>你的账单</h4>
            <div class="bill-total">${{ state.human.cost }}</div>
            <div class="bill-item" v-for="b in state.human.costBreakdown" :key="b.label">
              <span class="bill-label">{{ b.label }}</span>
              <span class="bill-amount">${{ b.amount }}</span>
              <span class="bill-detail">{{ b.detail }}</span>
            </div>
            <div class="bill-score">成本分: +{{ state.human.costScore }}</div>
          </div>
          <div class="bill-col">
            <h4>AI 账单</h4>
            <div class="bill-total">${{ state.ai.cost }}</div>
            <div class="bill-item" v-for="b in state.ai.costBreakdown" :key="b.label">
              <span class="bill-label">{{ b.label }}</span>
              <span class="bill-amount">${{ b.amount }}</span>
              <span class="bill-detail">{{ b.detail }}</span>
            </div>
            <div class="bill-score">成本分: +{{ state.ai.costScore }}</div>
          </div>
        </div>
        <div class="billing-verdict">
          <span v-if="state.human.cost < state.ai.cost">你更省成本 ({{ state.human.costScore }} vs {{ state.ai.costScore }} 分)</span>
          <span v-else-if="state.ai.cost < state.human.cost">AI 更省成本 ({{ state.ai.costScore }} vs {{ state.human.costScore }} 分)</span>
          <span v-else>成本持平</span>
        </div>
      </div>

      <div v-if="state.status === 'TIMEOUT'" class="timeout-msg">
        <p>5 分钟内未能修复故障。系统已自动恢复。</p>
        <p class="tip">提示: 试试 kubectl get pods 查看 Pod 状态，kubectl scale deployment 调整副本数</p>
      </div>

      <div v-if="aiRepairState" class="ai-repair-panel">
        <h4>AI 自动修复</h4>
        <div class="repair-step" v-if="aiRepairState.step === 'diagnosing' || aiRepairState.step === 'start'">
          <div class="step-label">诊断中...</div>
          <div class="step-text repair-thinking">{{ aiRepairState.text || 'AI 正在分析集群状态...' }}</div>
        </div>
        <div class="repair-step" v-if="aiRepairState.step === 'diagnosed' || aiRepairState.step === 'repairing' || aiRepairState.step === 'repaired'">
          <div class="step-label">{{ aiRepairState.step === 'repaired' ? '修复完成' : '修复中...' }}</div>
          <div class="step-text">{{ aiRepairState.diagnosis }}</div>
          <div class="step-command"><code>{{ aiRepairState.repairCommand || aiRepairState.command }}</code></div>
        </div>
        <div class="repair-step" v-if="aiRepairState.step === 'failed'">
          <div class="step-label">修复失败</div>
          <div class="step-text">{{ aiRepairState.error || '无法自动修复' }}</div>
        </div>
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
    aiRepairState: { type: Object, default: null },
  },
  emits: ['reset'],
};
</script>

<style scoped>
.score-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(4px);
}

.score-board {
  background: #ffffff;
  border: 2px solid #d0d7de;
  padding: 30px;
  max-width: 720px;
  width: 92%;
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
}

.score-board h2 {
  text-align: center;
  color: #d73a49;
  font-size: 1.5rem;
  font-weight: 800;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 2px;
}

.summary {
  text-align: center;
  color: #57606a;
  margin-bottom: 20px;
  font-size: 0.95rem;
  font-weight: 600;
}

.score-detail {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 20px;
}

.score-section {
  background: #f6f8fa;
  border: 2px solid #d0d7de;
  padding: 14px;
  border-radius: 4px;
}

.score-section h4 {
  color: #d73a49;
  margin-bottom: 8px;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.stat {
  font-size: 0.85rem;
  margin-bottom: 4px;
  color: #1c1c2e;
}
.stat strong { color: #1a7f37; font-size: 1rem; }
.stat code {
  background: #fafbfc;
  border: 1px solid #d0d7de;
  padding: 2px 6px;
  font-size: 0.8rem;
  word-break: break-all;
  display: inline-block;
  margin-top: 2px;
  border-radius: 3px;
  color: #1c1c2e;
}

/* ── Billing Panel ── */
.billing-panel {
  background: #f6f8fa;
  border: 2px solid #d0d7de;
  padding: 18px;
  margin-bottom: 18px;
  border-radius: 4px;
}

.billing-panel h3 {
  color: #1a7f37;
  font-size: 0.95rem;
  margin-bottom: 14px;
  text-transform: uppercase;
  letter-spacing: 2px;
  text-align: center;
}

.billing-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.bill-col {
  background: #ffffff;
  border: 1px solid #d0d7de;
  padding: 12px;
  border-radius: 4px;
}

.bill-col h4 {
  color: #1a7f37;
  font-size: 0.8rem;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.bill-total {
  font-size: 1.6rem;
  font-weight: 800;
  color: #d73a49;
  text-align: center;
  padding: 8px 0;
  border-bottom: 1px solid #d0d7de;
  margin-bottom: 8px;
  font-family: 'JetBrains Mono', monospace;
}

.bill-item {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto;
  padding: 5px 0;
  border-bottom: 1px solid #f0f0f4;
  font-size: 0.8rem;
}

.bill-label { color: #57606a; }
.bill-amount {
  text-align: right;
  color: #9a6700;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
}
.bill-detail {
  grid-column: 1 / -1;
  color: #8b949e;
  font-size: 0.8rem;
  margin-top: 1px;
}

.bill-score {
  text-align: right;
  padding-top: 8px;
  color: #1a7f37;
  font-weight: 700;
  font-size: 0.85rem;
}

.billing-verdict {
  text-align: center;
  padding: 10px;
  background: #dafbe1;
  border: 1px solid #4ac26b;
  color: #1a7f37;
  font-weight: 700;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  border-radius: 4px;
}

.ai-repair-panel {
  background: #ddf4ff; border: 2px solid #80ccff; padding: 14px;
  margin-bottom: 14px; border-radius: 4px;
}
.ai-repair-panel h4 {
  color: #0969da; font-size: 0.85rem; margin-bottom: 8px;
  text-transform: uppercase; letter-spacing: 1px;
}
.step-label { font-size: 0.8rem; font-weight: 700; color: #0969da; margin-bottom: 4px; }
.step-text { font-size: 0.85rem; color: #1c1c2e; line-height: 1.5; margin-bottom: 6px; }
.step-command { margin-top: 4px; }
.step-command code {
  background: #f0f6ff; border: 1px solid #b3d4ff; padding: 4px 8px;
  font-size: 0.8rem; border-radius: 3px; display: inline-block;
}
.repair-thinking { color: #0969da; min-height: 40px; white-space: pre-wrap; word-break: break-word; }

.timeout-msg {
  background: #f0e6ff;
  border: 2px solid #cb9eff;
  padding: 14px;
  margin-bottom: 14px;
  text-align: center;
  border-radius: 4px;
}
.timeout-msg p { color: #8250df; margin-bottom: 8px; font-weight: 600; }
.tip { font-size: 0.8rem; color: #8250df; font-weight: 400; opacity: 0.8; }

.fault-reveal {
  background: #f6f8fa;
  border: 2px solid #d0d7de;
  padding: 14px;
  margin-bottom: 20px;
  border-radius: 4px;
}
.fault-reveal h4 { color: #9a6700; margin-bottom: 8px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1px; }
.fault-item { display: flex; gap: 12px; padding: 4px 0; font-size: 0.85rem; }
.fault-type {
  background: #fff8c5;
  color: #9a6700;
  padding: 2px 10px;
  border: 1px solid #d4a72c;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 3px;
}
.fault-target { color: #57606a; font-weight: 500; }

.btn-reset {
  display: block;
  width: 100%;
  padding: 14px;
  background: #d73a49;
  color: #fff;
  border: none;
  font-size: 1.1rem;
  font-weight: 800;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 2px;
  border-radius: 4px;
  transition: background 0.15s;
}
.btn-reset:hover { background: #c42f3d; }
</style>
