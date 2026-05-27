<template>
  <transition name="alert-slide">
    <div v-if="visible" class="alert-wrapper">
      <div class="alert-card" :class="severity">
        <div class="alert-header">
          <svg class="alert-bell" width="20" height="20" viewBox="0 0 24 24" fill="none" :stroke="severity === 'critical' ? '#cf222e' : '#d4a72c'" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="alert-title">{{ severity === 'critical' ? 'CRITICAL' : 'WARNING' }}</span>
          <span class="alert-badge">ON-CALL</span>
          <button class="alert-close" @click="dismiss">✕</button>
        </div>
        <div class="alert-body" v-if="!isHiddenFaultMode">
          <div class="fault-line" v-for="f in faults" :key="f.target">
            <span class="fault-target">{{ f.target }}</span>
            <span class="fault-desc">{{ f.description }}</span>
          </div>
        </div>
        <div class="alert-body real-mode" v-else>
          <div class="real-hint">服务出现异常，请访问页面排查</div>
          <a class="real-url" :href="notification?.webhookUrl" target="_blank">{{ notification?.webhookUrl }} →</a>
          <div class="real-cmd-hint">使用终端输入 kubectl 命令进行诊断</div>
        </div>
        <div class="alert-footer">
          <span class="alert-time">{{ alertTime }}</span>
          <span class="alert-escalate">⏱ 请立即响应</span>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
export default {
  name: 'AlertNotification',
  props: {
    notification: { type: Object, default: null },
  },
  emits: ['dismiss'],
  data() {
    return { visible: false, dismissTimer: null };
  },
  computed: {
    isHiddenFaultMode() { return this.notification?.mode === 'micro-demo' || this.notification?.mode === 'bookinfo'; },
    faults() { return this.notification?.faults || []; },
    severity() { return this.notification?.severity || 'warning'; },
    alertTime() {
      if (!this.notification?.timestamp) return '';
      return new Date(this.notification.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    },
  },
  watch: {
    notification(val) {
      if (val && val.faults?.length) {
        this.visible = true;
        if (this.dismissTimer) clearTimeout(this.dismissTimer);
        this.dismissTimer = setTimeout(() => this.dismiss(), 15000);
      }
    },
  },
  beforeUnmount() {
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
  },
  methods: {
    dismiss() {
      this.visible = false;
      if (this.dismissTimer) clearTimeout(this.dismissTimer);
      this.$emit('dismiss');
    },
  },
};
</script>

<style scoped>
.alert-wrapper {
  position: fixed; top: 16px; right: 16px; z-index: 200;
  max-width: 400px; width: 90%;
}
.alert-card {
  background: #ffffff; border: 3px solid #d0d7de; border-radius: 8px;
  padding: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.18);
}
.alert-card.warning { border-color: #d4a72c; }
.alert-card.critical { border-color: #cf222e; animation: alert-shake 0.5s; }
@keyframes alert-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
.alert-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.alert-title { font-size: 1rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
.alert-card.warning .alert-title { color: #9a6700; }
.alert-card.critical .alert-title { color: #cf222e; }
.alert-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 3px; font-weight: 700; letter-spacing: 1px; margin-left: 4px; }
.alert-card.warning .alert-badge { background: #fff8c5; color: #9a6700; border: 1px solid #d4a72c; }
.alert-card.critical .alert-badge { background: #ffebe9; color: #cf222e; border: 1px solid #ff8182; }
.alert-close { margin-left: auto; background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #8b949e; padding: 0 4px; }
.alert-close:hover { color: #1c1c2e; }
.alert-body { padding: 8px 0; }
.fault-line { display: flex; gap: 8px; padding: 4px 0; align-items: baseline; }
.fault-target { font-weight: 700; color: #1c1c2e; font-size: 0.85rem; min-width: 100px; }
.fault-desc { color: #57606a; font-size: 0.82rem; }
.real-mode { text-align: center; padding: 8px 0; }
.real-hint { font-size: 0.85rem; color: #cf222e; font-weight: 600; margin-bottom: 8px; }
.real-url {
  display: inline-block; font-size: 1rem; color: #0969da; font-weight: 700;
  text-decoration: none; padding: 4px 12px; background: #ddf4ff;
  border: 2px solid #80ccff; border-radius: 4px; margin-bottom: 8px;
  transition: all 0.15s;
}
.real-url:hover { background: #b3dfff; border-color: #0969da; }
.real-cmd-hint { font-size: 0.78rem; color: #57606a; }
.alert-footer { display: flex; justify-content: space-between; margin-top: 10px; padding-top: 8px; border-top: 1px solid #f0f0f4; }
.alert-time { font-size: 0.75rem; color: #8b949e; font-family: 'JetBrains Mono', monospace; }
.alert-escalate { font-size: 0.75rem; color: #cf222e; font-weight: 600; animation: pulse-text 2s infinite; }
@keyframes pulse-text {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Slide in animation */
.alert-slide-enter-active { transition: all 0.4s cubic-bezier(0.22, 1, 0.36, 1); }
.alert-slide-leave-active { transition: all 0.25s ease-in; }
.alert-slide-enter-from { transform: translateX(120%); opacity: 0; }
.alert-slide-leave-to { transform: translateX(120%); opacity: 0; }
</style>
