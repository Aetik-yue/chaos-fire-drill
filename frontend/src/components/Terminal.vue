<template>
  <div class="terminal-panel" :data-theme="theme">
    <div class="terminal-header">
      <span class="terminal-title">▐ 运维终端</span>
      <div class="terminal-controls">
        <div class="theme-switcher">
          <button
            v-for="t in themes"
            :key="t.id"
            class="theme-btn"
            :class="{ active: theme === t.id }"
            :title="t.label"
            @click="theme = t.id"
          >{{ t.icon }}</button>
        </div>
        <span class="terminal-hint">Enter 执行 · clear 清屏</span>
      </div>
    </div>

    <div class="terminal-output" ref="output">
      <div v-for="(line, i) in outputLines" :key="i" class="output-line"
           :class="{ 'is-error': line.isError, 'is-prompt': line.isPrompt }"
           v-html="line.html || line.text"></div>
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
    output: { type: String, default: '' },
  },
  emits: ['command'],
  data() {
    return {
      command: '',
      theme: 'white',
      themes: [
        { id: 'white', label: 'White', icon: '☀' },
        { id: 'blue', label: 'Light Blue', icon: '🌊' },
        { id: 'dark', label: 'Dark', icon: '🌙' },
      ],
      outputLines: [],
    };
  },
  created() {
    this._initWelcome();
  },
  watch: {
    output(newVal) {
      if (newVal) {
        const text = newVal.split('\0')[0];
        if (text) this.addOutput(text);
      }
    },
  },
  methods: {
    _initWelcome() {
      this.outputLines = [
        { text: '╔══════════════════════════════════════════════╗', html: '╔══════════════════════════════════════════════╗', isPrompt: false },
        { text: '║  CHAOS FIRE DRILL · 云上消防演习运维终端    ║', html: '║  CHAOS FIRE DRILL · 云上消防演习运维终端    ║', isPrompt: false },
        { text: '╚══════════════════════════════════════════════╝', html: '╚══════════════════════════════════════════════╝', isPrompt: false },
        { text: 'get pods | get deployments | describe pod <name> | logs <pod> | scale deployment <name> --replicas=<n> | get events', html: '<strong class="syn-cmd">get</strong> pods | <strong class="syn-cmd">get</strong> deployments | <strong class="syn-cmd">describe</strong> pod &lt;name&gt; | <strong class="syn-cmd">logs</strong> &lt;pod&gt; | <strong class="syn-cmd">scale</strong> deployment &lt;name&gt; <span class="syn-flag">--replicas</span>=&lt;n&gt; | <strong class="syn-cmd">get</strong> events', isPrompt: false },
        { text: '', html: '', isPrompt: false },
      ];
    },
    executeCommand() {
      const cmd = this.command.trim();
      if (!cmd) return;

      this.outputLines.push({ text: `$ ${cmd}`, html: `$ ${this._highlightSyntax(cmd)}`, isPrompt: true });

      if (cmd === 'clear') {
        this._initWelcome();
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
          this.outputLines.push({
            text: line,
            html: this._highlightSyntax(line),
            isError,
          });
        }
      }
      this.$nextTick(() => {
        const output = this.$refs.output;
        if (output) output.scrollTop = output.scrollHeight;
      });
    },
    _highlightSyntax(line) {
      // Escape HTML first
      let escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Highlight kubectl/Linux keywords
      escaped = escaped.replace(/\b(get|describe|scale|logs|exec|rollout|delete|create|apply|restart|list|show|start|stop|reboot|resize|attach|detach)\b/g,
        '<strong class="syn-cmd">$1</strong>');
      // Highlight flags (--xxx or -x)
      escaped = escaped.replace(/(--?[a-z-]+)/g, '<span class="syn-flag">$1</span>');
      // Highlight pod names (pattern: servicename-hexhash like frontend-abc123 or order-service-def456)
      escaped = escaped.replace(/\b([a-z-]+-[a-z0-9]{5,})\b/g, '<span class="syn-pod">$1</span>');
      return escaped;
    },
  },
};
</script>

<style scoped>
/* ═══════════════════════════════════════════════
   THEME CSS VARIABLES
   ═══════════════════════════════════════════════ */

/* White theme (default) */
[data-theme="white"] {
  --term-bg: #fafbfc;
  --term-border: #d0d7de;
  --term-text: #1c1c2e;
  --term-prompt: #1a7f37;
  --term-accent: #0969da;
  --term-placeholder: #8b949e;
  --term-scrollbar-track: #f0f0f4;
  --term-scrollbar-thumb: #d0d7de;
}

/* Light Blue theme */
[data-theme="blue"] {
  --term-bg: #f0f6ff;
  --term-border: #b3d4ff;
  --term-text: #1c1c2e;
  --term-prompt: #0550ae;
  --term-accent: #0969da;
  --term-placeholder: #6e7d99;
  --term-scrollbar-track: #e8effa;
  --term-scrollbar-thumb: #b3d4ff;
}

/* Dark theme */
[data-theme="dark"] {
  --term-bg: #1a1b26;
  --term-border: #313244;
  --term-text: #cdd6f4;
  --term-prompt: #a6e3a1;
  --term-accent: #89b4fa;
  --term-placeholder: #585b70;
  --term-scrollbar-track: #1e2030;
  --term-scrollbar-thumb: #45475a;
}

/* ═══════════════════════════════════════════════
   BASE TERMINAL STYLES
   ═══════════════════════════════════════════════ */
.terminal-panel {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', 'Courier New', monospace;
}

.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--term-border, #d0d7de);
}

.terminal-title {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--term-prompt, #1a7f37);
}

.terminal-controls {
  display: flex;
  align-items: center;
  gap: 14px;
}

.theme-switcher {
  display: flex;
  gap: 4px;
}

.theme-btn {
  width: 32px;
  height: 28px;
  border: 1px solid var(--term-border, #d0d7de);
  background: transparent;
  cursor: pointer;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  padding: 0;
  line-height: 1;
  color: var(--term-placeholder, #57606a);
  border-radius: 3px;
}

.theme-btn:hover {
  background: var(--term-scrollbar-track, #f0f0f4);
  color: var(--term-text, #1c1c2e);
  border-color: var(--term-accent, #0969da);
}

.theme-btn.active {
  background: var(--term-bg, #fafbfc);
  border-color: var(--term-accent, #0969da);
  color: var(--term-accent, #0969da);
}

.terminal-hint {
  font-size: 0.8rem;
  color: var(--term-placeholder, #57606a);
}

/* ── OUTPUT AREA ── */
.terminal-output {
  background: var(--term-bg, #fafbfc);
  border: 2px solid var(--term-border, #d0d7de);
  border-radius: 4px;
  padding: 16px 20px;
  height: 360px;
  overflow-y: auto;
  font-size: 1.1rem;
  line-height: 1.75;
  color: var(--term-text, #1c1c2e);
}

.terminal-output::-webkit-scrollbar {
  width: 8px;
}

.terminal-output::-webkit-scrollbar-track {
  background: var(--term-scrollbar-track, #f0f0f4);
}

.terminal-output::-webkit-scrollbar-thumb {
  background: var(--term-scrollbar-thumb, #d0d7de);
  border-radius: 4px;
}

.output-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.output-line.is-prompt {
  color: var(--term-prompt, #1a7f37);
}

.output-line.is-error {
  color: #cf222e;
}

/* ── SYNTAX HIGHLIGHTING ── */
.output-line :deep(.syn-cmd) { color: #1c1c2e; font-weight: 700; }
.output-line :deep(.syn-flag) { color: #0969da; }
.output-line :deep(.syn-pod) { color: #1a7f37; }
.output-line.is-prompt :deep(.syn-cmd) { color: #1a7f37; }
.output-line.is-error :deep(.syn-cmd),
.output-line.is-error :deep(.syn-flag),
.output-line.is-error :deep(.syn-pod) { color: inherit; }

/* ── INPUT ROW ── */
.terminal-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.prompt {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--term-prompt, #1a7f37);
  user-select: none;
}

.terminal-input {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 2px solid var(--term-border, #d0d7de);
  border-radius: 0;
  padding: 12px 4px;
  font-family: inherit;
  font-size: 1.2rem;
  color: var(--term-text, #1c1c2e);
  outline: none;
  caret-color: #0969da;
  transition: border-color 0.15s;
}

.terminal-input::placeholder {
  color: var(--term-placeholder, #8b949e);
  font-size: 0.95rem;
}

.terminal-input:focus {
  border-bottom-color: var(--term-accent, #0969da);
  animation: input-blink 1.2s ease-in-out;
}

@keyframes input-blink {
  0%, 100% { border-bottom-color: var(--term-accent, #0969da); }
  50% { border-bottom-color: var(--term-border, #d0d7de); }
}

.terminal-input:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: transparent;
}
</style>
