// Chaos Injector — injects faults into the K8s cluster

const FAULT_POOL = {
  easy: [
    { type: 'kill-random-pod', description: '将某个 Deployment 缩容到 1 副本' },
    { type: 'scale-to-zero', description: '将某个 Deployment 副本数缩为 0' },
    { type: 'cpu-stress', description: '对某个 Pod 注入 CPU 压力' },
    { type: 'memory-leak', description: '对某个 Pod 注入内存泄漏' },
    { type: 'disk-full', description: '将某个 Pod 的磁盘写满' },
    { type: 'process-crash', description: '将某个 Pod 的主进程杀死' },
  ],
  hard: [
    { type: 'kill-random-pod', description: '将某个 Deployment 缩容到 1 副本' },
    { type: 'scale-to-zero', description: '将某个 Deployment 副本数缩为 0' },
    { type: 'network-delay', description: '注入网络延迟' },
    { type: 'kill-two-pods', description: '同时将两个服务缩容到 1 副本' },
    { type: 'cpu-stress', description: '对某个 Pod 注入 CPU 压力' },
    { type: 'memory-leak', description: '对某个 Pod 注入内存泄漏' },
    { type: 'disk-full', description: '将某个 Pod 的磁盘写满' },
    { type: 'process-crash', description: '将某个 Pod 的主进程杀死' },
  ],
};

const TARGET_SERVICES = ['frontend', 'order-service', 'product-service'];

class ChaosInjector {
  constructor(k8sClient) {
    this.k8s = k8sClient;
    this.targets = TARGET_SERVICES;
    this.restoreReplicas = 2;
  }

  setTargets(targets, replicas = 2) {
    this.targets = targets;
    this.restoreReplicas = replicas;
  }

  pickFault(difficulty) {
    const pool = FAULT_POOL[difficulty] || FAULT_POOL.easy;
    const count = difficulty === 'hard' ? 2 : 1;
    const faults = [];
    const usedTargets = new Set();

    for (let i = 0; i < count; i++) {
      const availableTargets = this.targets.filter(t => !usedTargets.has(t));
      if (availableTargets.length === 0) break;

      const faultTemplate = pool[Math.floor(Math.random() * pool.length)];
      const target = availableTargets[Math.floor(Math.random() * availableTargets.length)];
      usedTargets.add(target);

      faults.push({
        id: `fault-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        type: faultTemplate.type,
        description: faultTemplate.description,
        target,
        injectedAt: null,
        restoreFn: this._getRestoreFn(faultTemplate.type, target),
      });
    }
    return faults;
  }

  _getRestoreFn(type, target) {
    switch (type) {
      case 'kill-random-pod':
        return { method: 'scale', replicas: this.restoreReplicas, target, command: `kubectl scale deployment ${target} --replicas=${this.restoreReplicas}` };
      case 'scale-to-zero':
        return { method: 'scale', replicas: this.restoreReplicas, target, command: `kubectl scale deployment ${target} --replicas=${this.restoreReplicas}` };
      case 'network-delay':
        return { method: 'exec', target, command: 'tc qdisc del dev eth0 root' };
      case 'kill-two-pods':
        return { method: 'scale', replicas: this.restoreReplicas, target, command: `kubectl scale deployment ${target} --replicas=${this.restoreReplicas}` };
      case 'cpu-stress':
        return { method: 'exec', target, command: 'pkill -f "while.*:"' };
      case 'memory-leak':
        return { method: 'exec', target, command: 'pkill tail' };
      case 'disk-full':
        return { method: 'exec', target, command: 'rm -f /tmp/bigfile' };
      case 'process-crash':
        return { method: 'wait-recreate', description: '等待 K8s 自动重启 Pod' };
      default:
        return { method: 'manual' };
    }
  }

  async inject(faults) {
    if (this.k8s.mockMode) {
      return this.injectMock(faults);
    }
    for (const fault of faults) {
      fault.injectedAt = Date.now();
      try {
        await this._executeFault(fault);
      } catch (err) {
        console.error(`Failed to inject fault ${fault.type} on ${fault.target}: ${err.message}`);
        throw err;
      }
    }
    await this._sleep(3000);
    return faults;
  }

  async _executeFault(fault) {
    switch (fault.type) {
      case 'kill-random-pod': {
        // Scale to 1 replica — prevents auto-heal, user must scale back to 2
        this.k8s.scaleDeployment(fault.target, 1);
        break;
      }
      case 'scale-to-zero': {
        this.k8s.scaleDeployment(fault.target, 0);
        break;
      }
      case 'network-delay': {
        const pods = this.k8s.getPods();
        const targetPods = pods.filter(p => p.name.startsWith(fault.target));
        if (targetPods.length > 0) {
          const victim = targetPods[0];
          this.k8s.execInPod(victim.name, 'tc qdisc add dev eth0 root netem delay 500ms');
          fault.podAffected = victim.name;
        }
        break;
      }
      case 'kill-two-pods': {
        // Scale to 1 replica on two different services
        const otherServices = this.targets.filter(s => s !== fault.target);
        const secondTarget = otherServices[Math.floor(Math.random() * otherServices.length)];
        fault.secondTarget = secondTarget;
        this.k8s.scaleDeployment(fault.target, 1);
        this.k8s.scaleDeployment(secondTarget, 1);
        break;
      }
      case 'cpu-stress': {
        const pods = this.k8s.getPods();
        const targetPods = pods.filter(p => p.name.startsWith(fault.target));
        if (targetPods.length > 0) {
          const victim = targetPods[0];
          this.k8s.execInPod(victim.name, 'yes > /dev/null &');
          fault.podAffected = victim.name;
        }
        break;
      }
      case 'memory-leak': {
        const pods = this.k8s.getPods();
        const targetPods = pods.filter(p => p.name.startsWith(fault.target));
        if (targetPods.length > 0) {
          const victim = targetPods[0];
          this.k8s.execInPod(victim.name, 'dd if=/dev/zero of=/dev/null bs=1M count=0 seek=9999 &');
          fault.podAffected = victim.name;
        }
        break;
      }
      case 'disk-full': {
        const pods = this.k8s.getPods();
        const targetPods = pods.filter(p => p.name.startsWith(fault.target));
        if (targetPods.length > 0) {
          const victim = targetPods[0];
          this.k8s.execInPod(victim.name, 'dd if=/dev/zero of=/tmp/bigfile bs=1M count=64');
          fault.podAffected = victim.name;
        }
        break;
      }
      case 'process-crash': {
        const pods = this.k8s.getPods();
        const targetPods = pods.filter(p => p.name.startsWith(fault.target));
        if (targetPods.length > 0) {
          const victim = targetPods[0];
          this.k8s.execInPod(victim.name, 'kill 1');
          fault.podAffected = victim.name;
        }
        break;
      }
    }
  }

  async restore(faults) {
    if (this.k8s.mockMode) {
      return this.restoreMock(faults);
    }
    for (const fault of faults) {
      await this._executeRestore(fault);
    }
  }

  async _executeRestore(fault) {
    const rf = fault.restoreFn;
    if (rf.method === 'scale') {
      this.k8s.scaleDeployment(rf.target, rf.replicas);
      if (fault.type === 'kill-two-pods' && fault.secondTarget) {
        this.k8s.scaleDeployment(fault.secondTarget, rf.replicas);
      }
    } else if (rf.method === 'exec') {
      const pods = this.k8s.getPods();
      const targetPod = pods.find(p => p.name.startsWith(rf.target));
      if (targetPod) {
        this.k8s.execInPod(targetPod.name, rf.command);
      }
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  injectMock(faults) {
    for (const fault of faults) {
      fault.injectedAt = Date.now();
      if (fault.type === 'kill-two-pods' && !fault.secondTarget) {
        const otherServices = this.targets.filter(s => s !== fault.target);
        fault.secondTarget = otherServices[Math.floor(Math.random() * otherServices.length)] || otherServices[0];
      }
      if (this.k8s.injectMockFault) {
        this.k8s.injectMockFault(fault.type, fault.target, fault.secondTarget);
      }
    }
    return faults;
  }

  restoreMock(faults) {
    for (const fault of faults) {
      if (this.k8s.clearMockFault) {
        this.k8s.clearMockFault();
      }
    }
  }
}

module.exports = { ChaosInjector, FAULT_POOL, TARGET_SERVICES };
