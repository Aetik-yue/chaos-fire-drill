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
  /rm\s+-rf\s+\//,
  /rm\s+-fr\s+\//,
  />\s*\/dev\/sda/,
  />\s*\/dev\/nvme/,
];

let ALLOWED_NAMESPACE = 'chaos-game';

class TerminalProxy {
  constructor(k8sClient, options = {}) {
    this.k8s = k8sClient;
    this.mockMode = options.mockMode || false;
    this.history = [];
  }

  setNamespace(ns) {
    ALLOWED_NAMESPACE = ns;
  }

  validate(command) {
    if (!command || typeof command !== 'string') {
      return { valid: false, error: '命令不能为空' };
    }

    const trimmed = command.trim();

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { valid: false, error: `命令包含禁止的模式: ${pattern}` };
      }
    }

    const isAllowed = COMMAND_WHITELIST.some(prefix => trimmed.startsWith(prefix));
    if (!isAllowed) {
      return {
        valid: false,
        error: `命令不在白名单中。`,
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

    let execCommand = command.trim();
    if (!execCommand.includes('-n ') && !execCommand.includes('--namespace')) {
      const needsNamespace = COMMAND_WHITELIST.some(p => execCommand.startsWith(p));
      if (needsNamespace) {
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
    const output = this.k8s._exec(command);

    return {
      success: true,
      output: output || '(命令执行成功，无输出)',
      command,
    };
  }

  setMockMode(enabled) {
    this.mockMode = enabled;
  }

  getHistory() {
    return [...this.history];
  }

  clearHistory() {
    this.history = [];
  }
}

module.exports = { TerminalProxy, COMMAND_WHITELIST, FORBIDDEN_PATTERNS };
