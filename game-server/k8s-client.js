// K8s Client — wraps kubectl commands with mock mode for dev/testing
const { execSync } = require('child_process');

class K8sClient {
  constructor(options = {}) {
    this.mockMode = options.mockMode || false;
    this.namespace = options.namespace || 'chaos-game';
    this.includeInfra = options.includeInfra || false;
    this._mockState = {
      pods: [
        { name: 'frontend-abc123', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 15, memory: 22 },
        { name: 'frontend-def456', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 12, memory: 20 },
        { name: 'order-service-abc123', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 18, memory: 25 },
        { name: 'order-service-def456', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 14, memory: 23 },
        { name: 'product-service-abc123', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 20, memory: 28 },
        { name: 'product-service-def456', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 11, memory: 19 },
      ],
      deployments: [
        { name: 'frontend', ready: '2/2', upToDate: 2, available: 2, age: '10m' },
        { name: 'order-service', ready: '2/2', upToDate: 2, available: 2, age: '10m' },
        { name: 'product-service', ready: '2/2', upToDate: 2, available: 2, age: '10m' },
      ],
      events: [],
      injectedFault: null,
    };

    if (this.includeInfra) {
      this._mockState.pods.push({ name: 'game-server-xyz789', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 8, memory: 42 });
      this._mockState.deployments.push({ name: 'game-server', ready: '1/1', upToDate: 1, available: 1, age: '10m' });
    }
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
        ready: '1/1', status: 'Running', restarts: 0, age: '1s',
        cpu: Math.floor(Math.random() * 30) + 5, memory: Math.floor(Math.random() * 30) + 10
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
      const existingCount = this._mockState.pods.filter(p => p.name.startsWith(deployName)).length;
      for (let i = existingCount; i < replicas; i++) {
        this._mockState.pods.push({
          name: `${deployName}-new${i}${i}`,
          ready: '1/1', status: 'Running', restarts: 0, age: '1s',
          cpu: Math.floor(Math.random() * 30) + 5, memory: Math.floor(Math.random() * 30) + 10
        });
      }
      return `deployment.apps/${deployName} scaled`;
    }
    if (command.includes('exec') && command.includes('pkill')) {
      return '';
    }
    if (command.includes('rollout restart')) {
      const deployName = command.match(/deployment(?:\/(\S+)| (\S+))/);
      let svcName = 'unknown';
      if (deployName) {
        svcName = deployName[1] || deployName[2];
        // Restore to 2 replicas and reset pod health
        this._mockState.deployments = this._mockState.deployments.map(d =>
          d.name === svcName ? { ...d, ready: '2/2', available: 2 } : d
        );
        // Reset all pods for this service to healthy state
        this._mockState.pods = this._mockState.pods.map(p =>
          p.name.startsWith(svcName) ? { ...p, ready: '1/1', status: 'Running',
            cpu: Math.floor(Math.random() * 30) + 5, memory: Math.floor(Math.random() * 30) + 10 } : p
        );
        const existingCount = this._mockState.pods.filter(p => p.name.startsWith(svcName)).length;
        for (let i = existingCount; i < 2; i++) {
          this._mockState.pods.push({
            name: `${svcName}-restart${i}`, ready: '1/1', status: 'Running', restarts: 0, age: '1s',
            cpu: Math.floor(Math.random() * 30) + 5, memory: Math.floor(Math.random() * 30) + 10
          });
        }
      }
      return `deployment.apps/${svcName} restarted`;
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
    if (this.mockMode) {
      return this._mockState.pods.map(p => ({ ...p }));
    }

    let podMetrics = {};
    try {
      const topOutput = this._exec(`kubectl top pods -n ${this.namespace} --no-headers`);
      const lines = topOutput.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const name = parts[0];
          const cpuVal = parseInt(parts[1]) || 0;
          const memVal = parseInt(parts[2]) || 0;
          podMetrics[name] = { cpuVal, memVal, cpuStr: parts[1], memStr: parts[2] };
        }
      }
    } catch (e) {
      // Metrics server not available or top failed, ignore
    }

    const output = this._exec(`kubectl get pods -n ${this.namespace}`);
    return this._parsePods(output, podMetrics);
  }

  _parsePods(output, podMetrics = {}) {
    const lines = output.trim().split('\n');
    if (lines.length < 2) return [];
    return lines.slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      const name = parts[0];
      
      let cpu = Math.floor(Math.random() * 15) + 5;
      let memory = Math.floor(Math.random() * 15) + 10;

      if (podMetrics[name]) {
        const m = podMetrics[name];
        if (m.cpuStr && m.cpuStr.includes('m')) {
          cpu = m.cpuVal > 100 ? Math.floor(Math.random() * 8) + 92 : Math.floor(Math.random() * 15) + 5;
        } else {
          cpu = m.cpuVal >= 1 ? Math.floor(Math.random() * 8) + 92 : Math.floor(Math.random() * 15) + 5;
        }
        
        if (m.memStr && m.memStr.toLowerCase().includes('mi')) {
          memory = m.memVal > 100 ? Math.floor(Math.random() * 8) + 90 : Math.floor(Math.random() * 15) + 10;
        } else {
          memory = m.memVal >= 100 ? Math.floor(Math.random() * 8) + 90 : Math.floor(Math.random() * 15) + 10;
        }
      }

      return {
        name,
        ready: parts[1],
        status: parts[2],
        restarts: parseInt(parts[3]) || 0,
        age: parts[4] || '',
        cpu,
        memory,
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
    return this._exec(`kubectl exec ${podName} -n ${this.namespace} -- sh -c "${command}"`);
  }

  isHealthy() {
    const pods = this.getPods();
    const allPodsReady = pods.every(p => p.status === 'Running' && p.ready === '1/1');
    const deployments = this.getDeployments();
    if (deployments.length === 0) return false;
    const allAvailable = deployments.every(d => d.available > 0);
    // Also verify each deployment has the expected number of pods
    const podCountsOk = deployments.every(d => {
      const expectedReplicas = parseInt(d.ready.split('/')[1]) || 0;
      const actualPods = pods.filter(p => p.name.startsWith(d.name)).length;
      return actualPods >= expectedReplicas;
    });
    const allReady = deployments.every(d => {
      const [ready, total] = (d.ready || '0/0').split('/').map(Number);
      return ready === total;
    });
    const noResourceStress = pods.every(p => (p.cpu || 0) <= 80 && (p.memory || 0) <= 80);
    return allPodsReady && allAvailable && podCountsOk && allReady && noResourceStress;
  }

  injectMockFault(type, target, secondTarget = null) {
    this._mockState.injectedFault = { type, target, injectedAt: Date.now() };
    this._mockState.events.push({
      lastSeen: '0s',
      type: 'Warning',
      reason: 'FaultInjected',
      object: `deployment/${target}`,
    });

    if (type === 'kill-random-pod') {
      // Scale to 1 replica (remove 1 pod, deployment shows 1/2)
      this._mockState.pods = this._mockState.pods.filter(
        (p, i) => !(p.name.startsWith(target) && this._mockState.pods.filter(pp => pp.name.startsWith(target)).indexOf(p) === 0)
      );
      // Actually just keep the first pod and remove the second
      const targetPods = this._mockState.pods.filter(p => p.name.startsWith(target));
      if (targetPods.length >= 2) {
        this._mockState.pods = this._mockState.pods.filter(p => p.name !== targetPods[1].name);
      }
      // Randomize cpu/memory on remaining pods
      this._mockState.pods = this._mockState.pods.map(p =>
        p.name.startsWith(target) ? { ...p, cpu: Math.floor(Math.random() * 30) + 10, memory: Math.floor(Math.random() * 30) + 10 } : p
      );
      this._mockState.deployments = this._mockState.deployments.map(d =>
        d.name === target ? { ...d, ready: '1/2', available: 1 } : d
      );
    } else if (type === 'kill-two-pods') {
      const actualSecond = secondTarget ||
        ['frontend', 'order-service', 'product-service'].filter(s => s !== target)[0];
      this._mockState.injectedFault.secondTarget = actualSecond;
      // Scale both to 1
      for (const svc of [target, actualSecond]) {
        const svcPods = this._mockState.pods.filter(p => p.name.startsWith(svc));
        if (svcPods.length >= 2) {
          this._mockState.pods = this._mockState.pods.filter(p => p.name !== svcPods[1].name);
        }
        // Randomize cpu/memory on remaining pods
        this._mockState.pods = this._mockState.pods.map(p =>
          p.name.startsWith(svc) ? { ...p, cpu: Math.floor(Math.random() * 30) + 10, memory: Math.floor(Math.random() * 30) + 10 } : p
        );
        this._mockState.deployments = this._mockState.deployments.map(d =>
          d.name === svc ? { ...d, ready: '1/2', available: 1 } : d
        );
      }
    } else if (type === 'scale-to-zero') {
      this._mockState.pods = this._mockState.pods.filter(p => !p.name.startsWith(target));
      this._mockState.deployments = this._mockState.deployments.map(d =>
        d.name === target ? { ...d, ready: '0/2', available: 0 } : d
      );
    } else if (type === 'network-delay') {
      // Mark a pod as having network delay
      const targetPods = this._mockState.pods.filter(p => p.name.startsWith(target));
      if (targetPods.length > 0) {
        const pod = targetPods[0];
        this._mockState.pods = this._mockState.pods.map(p =>
          p.name === pod.name ? { ...p, status: 'Running', ready: '0/1', cpu: Math.floor(Math.random() * 30) + 10, memory: Math.floor(Math.random() * 30) + 10 } : p
        );
      }
    } else if (type === 'cpu-stress') {
      const targetPods = this._mockState.pods.filter(p => p.name.startsWith(target));
      if (targetPods.length > 0) {
        const pod = targetPods[0];
        this._mockState.pods = this._mockState.pods.map(p =>
          p.name === pod.name ? { ...p, status: 'Running', ready: '1/1', cpu: Math.floor(Math.random() * 8) + 92 } : p
        );
      }
    } else if (type === 'memory-leak') {
      const targetPods = this._mockState.pods.filter(p => p.name.startsWith(target));
      if (targetPods.length > 0) {
        const pod = targetPods[0];
        this._mockState.pods = this._mockState.pods.map(p =>
          p.name === pod.name ? { ...p, status: 'Running', ready: '1/1', memory: Math.floor(Math.random() * 15) + 85 } : p
        );
      }
    } else if (type === 'disk-full') {
      const targetPods = this._mockState.pods.filter(p => p.name.startsWith(target));
      if (targetPods.length > 0) {
        const pod = targetPods[0];
        this._mockState.pods = this._mockState.pods.map(p =>
          p.name === pod.name ? { ...p, status: 'Running', ready: '0/1', cpu: Math.floor(Math.random() * 30) + 10, memory: Math.floor(Math.random() * 30) + 10 } : p
        );
      }
    } else if (type === 'process-crash') {
      const targetPods = this._mockState.pods.filter(p => p.name.startsWith(target));
      if (targetPods.length > 0) {
        const pod = targetPods[0];
        this._mockState.pods = this._mockState.pods.filter(p => p.name !== pod.name);
        this._mockState.pods.push({
          name: pod.name, ready: '1/1', status: 'Running', restarts: pod.restarts + 1, age: '1s',
          cpu: Math.floor(Math.random() * 30) + 10, memory: Math.floor(Math.random() * 30) + 10
        });
        // Mark deployment as degraded to trigger unhealthy state
        this._mockState.deployments = this._mockState.deployments.map(d =>
          d.name === target ? { ...d, ready: '1/2', available: 1 } : d
        );
      }
    }
  }

  checkConnectivity() {
    try {
      const output = execSync(`kubectl get pods -n ${this.namespace} --request-timeout=5s`, {
        encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { ok: true, output: output.trim().split('\n')[0] };
    } catch (err) {
      const msg = (err.stderr || err.message || '').trim();
      const lines = msg.split('\n');
      const lastLine = lines[lines.length - 1] || msg;
      return { ok: false, error: lastLine };
    }
  }

  setMockMode(enabled) {
    this.mockMode = enabled;
  }

  setNamespace(ns) {
    this.namespace = ns;
  }

  resetMockState() {
    this._mockState = {
      pods: [
        { name: 'frontend-abc123', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 15, memory: 22 },
        { name: 'frontend-def456', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 12, memory: 20 },
        { name: 'order-service-abc123', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 18, memory: 25 },
        { name: 'order-service-def456', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 14, memory: 23 },
        { name: 'product-service-abc123', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 20, memory: 28 },
        { name: 'product-service-def456', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 11, memory: 19 },
      ],
      deployments: [
        { name: 'frontend', ready: '2/2', upToDate: 2, available: 2, age: '10m' },
        { name: 'order-service', ready: '2/2', upToDate: 2, available: 2, age: '10m' },
        { name: 'product-service', ready: '2/2', upToDate: 2, available: 2, age: '10m' },
      ],
      events: [],
      injectedFault: null,
    };

    if (this.includeInfra) {
      this._mockState.pods.push({ name: 'game-server-xyz789', ready: '1/1', status: 'Running', restarts: 0, age: '5m', cpu: 8, memory: 42 });
      this._mockState.deployments.push({ name: 'game-server', ready: '1/1', upToDate: 1, available: 1, age: '10m' });
    }
  }

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
          ready: '1/1', status: 'Running', restarts: 0, age: '1s',
          cpu: Math.floor(Math.random() * 30) + 5, memory: Math.floor(Math.random() * 30) + 10
        });
      }
    } else if (fault.type === 'kill-random-pod') {
      this._mockState.deployments = this._mockState.deployments.map(d =>
        d.name === fault.target ? { ...d, ready: '2/2', available: 2 } : d
      );
      this._mockState.pods.push({
        name: `${fault.target}-restored0`,
        ready: '1/1', status: 'Running', restarts: 0, age: '1s',
        cpu: Math.floor(Math.random() * 30) + 5, memory: Math.floor(Math.random() * 30) + 10
      });
    } else if (fault.type === 'kill-two-pods') {
      for (const svc of [fault.target, fault.secondTarget]) {
        if (!svc) continue;
        this._mockState.deployments = this._mockState.deployments.map(d =>
          d.name === svc ? { ...d, ready: '2/2', available: 2 } : d
        );
        this._mockState.pods.push({
          name: `${svc}-restored0`,
          ready: '1/1', status: 'Running', restarts: 0, age: '1s',
          cpu: Math.floor(Math.random() * 30) + 5, memory: Math.floor(Math.random() * 30) + 10
        });
      }
    } else if (fault.type === 'network-delay') {
      this._mockState.pods = this._mockState.pods.map(p =>
        p.ready === '0/1' ? { ...p, ready: '1/1' } : p
      );
    } else if (fault.type === 'cpu-stress') {
      // Restore CPU to normal range
      this._mockState.pods = this._mockState.pods.map(p =>
        p.name.startsWith(fault.target) ? { ...p, cpu: Math.floor(Math.random() * 30) + 5 } : p
      );
    } else if (fault.type === 'memory-leak') {
      // Restore memory to normal range
      this._mockState.pods = this._mockState.pods.map(p =>
        p.name.startsWith(fault.target) ? { ...p, memory: Math.floor(Math.random() * 30) + 10 } : p
      );
    } else if (fault.type === 'disk-full') {
      this._mockState.pods = this._mockState.pods.map(p =>
        p.ready === '0/1' ? { ...p, ready: '1/1' } : p
      );
    } else if (fault.type === 'process-crash') {
      // Restore deployment to healthy state
      this._mockState.deployments = this._mockState.deployments.map(d =>
        d.name === fault.target ? { ...d, ready: '2/2', available: 2 } : d
      );
    }
    this._mockState.injectedFault = null;
    this._mockState.events = [];
  }
}

module.exports = K8sClient;
