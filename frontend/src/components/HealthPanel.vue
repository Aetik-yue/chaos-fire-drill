<template>
  <div class="health-panel">
    <h3>{{ panelTitle }}</h3>

    <!-- REAL MODE: Signal lights only during DIAGNOSING -->
    <div v-if="isHiddenMode" class="signal-section">
      <p class="signal-hint">运维模式：请使用终端排查故障</p>
      <div class="signal-row">
        <span
          v-for="s in signalLights"
          :key="s.name"
          class="signal-dot"
          :class="s.status"
          :title="s.name"
        ></span>
      </div>
      <div class="signal-legend">
        <span class="legend-item"><span class="legend-dot green"></span>正常</span>
        <span class="legend-item"><span class="legend-dot yellow"></span>降级</span>
        <span class="legend-item"><span class="legend-dot red"></span>异常</span>
      </div>
    </div>

    <!-- PRACTICE MODE or SCORING: Full detailed view -->
    <div v-else>
      <div class="service-cards">
        <div
          v-for="svc in services"
          :key="svc.name"
          class="service-card"
          :class="svc.statusClass"
        >
          <div class="svc-header">
            <span class="svc-name">{{ svc.name }}</span>
            <span v-if="svc.infra" class="svc-infra">INFRA</span>
            <span class="svc-dot" :class="svc.statusClass"></span>
          </div>
          <div class="svc-pods">{{ svc.ready }}/{{ svc.total }} Pods</div>
          <div class="svc-resources" v-if="svc.cpu != null">
            <div class="resource-row">
              <span class="res-label">CPU</span>
              <div class="res-bar"><div class="res-fill" :class="svc.cpu > 80 ? 'danger' : 'normal'" :style="{width: svc.cpu + '%'}"></div></div>
              <span class="res-val" :class="svc.cpu > 80 ? 'danger' : ''">{{ svc.cpu }}%</span>
            </div>
            <div class="resource-row">
              <span class="res-label">MEM</span>
              <div class="res-bar"><div class="res-fill" :class="svc.memory > 80 ? 'danger' : 'normal'" :style="{width: svc.memory + '%'}"></div></div>
              <span class="res-val" :class="svc.memory > 80 ? 'danger' : ''">{{ svc.memory }}%</span>
            </div>
          </div>
          <div class="svc-age">{{ svc.age }}</div>
        </div>
      </div>

      <div v-if="gameStatus === 'DIAGNOSING' && hasFaults" class="fault-summary">
        <div class="fs-header">故障活跃中</div>
        <div class="fs-item" v-for="f in activeFaults" :key="f.target">
          <span class="fs-target">{{ f.target }}</span>
          <span class="fs-type">{{ f.description }}</span>
        </div>
        <div class="fs-hint">修复: kubectl scale deployment &lt;服务名&gt; --replicas=2</div>
      </div>
      <div v-else-if="gameStatus === 'SCORING'" class="fault-summary resolved">
        <div class="fs-header">故障已修复 &#10003;</div>
      </div>

      <div class="pod-toggle" @click="showPods = !showPods">
        Pod 详情 {{ showPods ? '▾' : '▸' }}
      </div>
      <div v-if="showPods" class="pod-list">
        <div v-for="pod in podList" :key="pod.name" class="pod-row">
          <span class="pod-indicator" :class="pod.status === 'Running' && pod.ready === '1/1' ? 'healthy' : 'unhealthy'"></span>
          <span class="pod-name">{{ pod.name }}</span>
          <span class="pod-status">{{ pod.ready }}</span>
          <span class="pod-restarts" v-if="pod.restarts > 0">R:{{ pod.restarts }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'HealthPanel',
  props: {
    snapshot: { type: Object, default: () => ({ pods: [], deployments: [], events: '' }) },
    gameStatus: { type: String, default: 'IDLE' },
    gameMode: { type: String, default: 'practice' },
  },
  emits: ['update-active-faults'],
  data() {
    return { showPods: false };
  },
  computed: {
    isHiddenMode() {
      return (this.gameMode === 'micro-demo' || this.gameMode === 'bookinfo') && this.gameStatus !== 'SCORING' && this.gameStatus !== 'TIMEOUT';
    },
    panelTitle() {
      if (this.isHiddenMode) return '服务信号灯';
      return '集群健康状态';
    },
    signalLights() {
      return this.services.map(s => ({
        name: s.name,
        status: s.statusClass,
      }));
    },
    deployments() { return this.snapshot.deployments || []; },
    pods() { return this.snapshot.pods || []; },
    hasFaults() {
      return this.services.some(s => s.statusClass !== 'healthy');
    },
    activeFaults() {
      return this.services
        .filter(s => s.statusClass !== 'healthy')
        .map(s => ({
          target: s.name,
          description: s.ready === 0 ? '缩容到 0 副本' : '缩容到 ' + s.ready + ' 副本',
        }));
    },
    modeServices() {
      if (this.gameMode === 'bookinfo') {
        return [
          { name: 'productpage' },
          { name: 'details' },
          { name: 'ratings' },
          { name: 'reviews' },
        ];
      }
      return [
        { name: 'frontend', infra: false },
        { name: 'order-service', infra: false },
        { name: 'product-service', infra: false },
        { name: 'game-server', infra: true },
      ];
    },
    services() {
      return this.modeServices.map(({ name, infra }) => {
        // Find all deployments matching this service (handles versioned names like productpage-v1)
        const deps = this.deployments.filter(d =>
          d.name === name || d.name.startsWith(name + '-'));
        if (deps.length === 0) return null;

        // Aggregate ready/total across all matching deployments
        let totalReady = 0, totalExpected = 0;
        for (const dep of deps) {
          const [r, t] = (dep.ready || '0/0').split('/').map(Number);
          totalReady += r;
          totalExpected += t;
        }

        const svcPods = this.pods.filter(p => p.name.startsWith(name));
        const avgCpu = svcPods.length > 0 ? Math.round(svcPods.reduce((s, p) => s + (p.cpu || 0), 0) / svcPods.length) : null;
        const avgMem = svcPods.length > 0 ? Math.round(svcPods.reduce((s, p) => s + (p.memory || 0), 0) / svcPods.length) : null;

        let statusClass = 'healthy';
        if (totalReady === 0) statusClass = 'critical';
        else if (totalReady < totalExpected) statusClass = 'degraded';
        else if (avgCpu > 80 || avgMem > 80) statusClass = 'degraded';

        return {
          name, infra, ready: totalReady, total: totalExpected,
          cpu: avgCpu, memory: avgMem,
          statusClass,
          age: deps[0].age || '',
        };
      }).filter(Boolean);
    },
    podList() {
      return this.pods.filter(p => !p.name.startsWith('game-server'));
    },
  },
};
</script>

<style scoped>
.health-panel h3 { font-size: 0.9rem; color: #d73a49; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; }

/* Service Cards */
.service-cards { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.service-card {
  background: #f6f8fa; border: 2px solid #d0d7de; padding: 12px 14px;
  border-radius: 6px; transition: border-color 0.3s;
}
.service-card.healthy { border-color: #4ac26b; }
.service-card.degraded { border-color: #d4a72c; }
.service-card.critical { border-color: #ff8182; animation: card-pulse 1.5s infinite; }
@keyframes card-pulse {
  0%, 100% { box-shadow: 0 0 0 rgba(207,34,46,0); }
  50% { box-shadow: 0 0 12px rgba(207,34,46,0.3); }
}
.svc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.svc-name { font-size: 0.8rem; font-weight: 700; color: #1c1c2e; text-transform: uppercase; letter-spacing: 1px; }
.svc-dot { width: 8px; height: 8px; border-radius: 50%; }
.svc-dot.healthy { background: #1a7f37; }
.svc-dot.degraded { background: #d4a72c; }
.svc-dot.critical { background: #cf222e; animation: blink 0.8s infinite; }
@keyframes blink { 50% { opacity: 0.15; } }
.svc-pods { font-size: 0.95rem; font-weight: 600; color: #57606a; margin-bottom: 6px; }
.service-card.critical .svc-pods { color: #cf222e; }
.service-card.degraded .svc-pods { color: #9a6700; }

/* Resource bars */
.resource-row { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; font-size: 0.75rem; }
.res-label { width: 28px; color: #8b949e; font-weight: 600; flex-shrink: 0; }
.res-bar { flex: 1; height: 6px; background: #d0d7de; border-radius: 3px; overflow: hidden; }
.res-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
.res-fill.normal { background: #4ac26b; }
.res-fill.danger { background: #cf222e; }
.res-val { width: 32px; text-align: right; color: #57606a; font-weight: 600; flex-shrink: 0; }
.res-val.danger { color: #cf222e; }
.svc-age { font-size: 0.7rem; color: #8b949e; margin-top: 4px; }

/* Fault Summary */
.fault-summary {
  background: #ffebe9; border: 2px solid #ff8182; padding: 12px;
  border-radius: 6px; margin-bottom: 12px;
}
.fault-summary.resolved { background: #dafbe1; border-color: #4ac26b; }
.fs-header { font-size: 0.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.fault-summary.resolved .fs-header { color: #1a7f37; }
.fault-summary:not(.resolved) .fs-header { color: #cf222e; }
.fs-item { display: flex; justify-content: space-between; padding: 2px 0; font-size: 0.8rem; }
.fs-target { font-weight: 600; color: #1c1c2e; }
.fs-type { color: #cf222e; }
.fs-hint { margin-top: 6px; font-size: 0.75rem; color: #57606a; background: #f6f8fa; padding: 4px 8px; border-radius: 3px; font-family: monospace; }
.fault-summary.resolved .fs-hint { display: none; }

/* Pod toggle */
.pod-toggle { font-size: 0.8rem; color: #0969da; cursor: pointer; font-weight: 600; padding: 6px 0; user-select: none; }
.pod-toggle:hover { color: #0550ae; }
.pod-list { margin-top: 4px; max-height: 200px; overflow-y: auto; }
.pod-list::-webkit-scrollbar { width: 4px; }
.pod-list::-webkit-scrollbar-thumb { background: #d0d7de; border-radius: 2px; }
.pod-row {
  display: flex; align-items: center; gap: 8px; padding: 5px 0;
  border-bottom: 1px solid #f0f0f4; font-size: 0.82rem;
}
.pod-indicator { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.pod-indicator.healthy { background: #1a7f37; box-shadow: 0 0 4px rgba(26,127,55,0.3); }
.pod-indicator.unhealthy { background: #cf222e; animation: blink 0.8s infinite; }
.pod-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1c1c2e; font-weight: 500; }
.pod-status { color: #57606a; font-size: 0.78rem; }
.pod-restarts { color: #9a6700; font-size: 0.75rem; font-weight: 600; }

/* INFRA badge */
.svc-infra { font-size: 0.6rem; padding: 1px 6px; background: #f0f0f4; color: #8b949e; border: 1px solid #d0d7de; border-radius: 3px; font-weight: 700; text-transform: uppercase; }

/* Signal Lights (Real Mode) */
.signal-section { text-align: center; padding: 16px 0; }
.signal-hint { font-size: 0.85rem; color: #cf222e; margin-bottom: 18px; font-weight: 700; letter-spacing: 1px; }
.signal-row { display: flex; justify-content: center; gap: 22px; margin-bottom: 18px; }
.signal-dot {
  width: 40px; height: 40px; border-radius: 50%;
  border: 3px solid transparent; transition: all 0.4s;
  position: relative;
}
.signal-dot::after {
  content: ''; position: absolute; inset: -6px; border-radius: 50%;
  opacity: 0; transition: opacity 0.4s;
}
.signal-dot.healthy {
  background: radial-gradient(circle at 35% 35%, #4ac26b, #1a7f37);
  border-color: #4ac26b;
  box-shadow: 0 0 20px rgba(26,127,55,0.4), inset 0 2px 3px rgba(255,255,255,0.3);
  border-color: #2ea043;
}
.signal-dot.degraded {
  background: radial-gradient(circle at 35% 35%, #f0c950, #d4a72c);
  border-color: #d4a72c;
  box-shadow: 0 0 24px rgba(212,167,44,0.5), inset 0 2px 3px rgba(255,255,255,0.25);
}
.signal-dot.critical {
  background: radial-gradient(circle at 35% 35%, #ff6b6b, #cf222e);
  border-color: #ff8182;
  box-shadow: 0 0 32px rgba(207,34,46,0.7), inset 0 2px 3px rgba(255,255,255,0.2);
  animation: s-blink 0.8s infinite;
}
.signal-dot.critical::after {
  box-shadow: 0 0 20px rgba(207,34,46,0.5);
  opacity: 1;
  animation: s-glow 0.8s infinite;
}
@keyframes s-blink {
  50% { opacity: 0.4; box-shadow: 0 0 8px rgba(207,34,46,0.3), inset 0 1px 2px rgba(255,255,255,0.1); }
}
@keyframes s-glow {
  50% { opacity: 0.3; }
}
.signal-legend { display: flex; justify-content: center; gap: 20px; font-size: 0.8rem; color: #57606a; font-weight: 600; }
.legend-item { display: flex; align-items: center; gap: 6px; }
.legend-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; box-shadow: 0 0 6px currentColor; }
.legend-dot.green { background: #1a7f37; box-shadow: 0 0 8px rgba(26,127,55,0.5); }
.legend-dot.yellow { background: #d4a72c; box-shadow: 0 0 8px rgba(212,167,44,0.5); }
.legend-dot.red { background: #cf222e; box-shadow: 0 0 8px rgba(207,34,46,0.5); }
</style>
