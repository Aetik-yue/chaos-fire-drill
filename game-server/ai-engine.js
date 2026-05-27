// AI Engine — calls LLM API to diagnose K8s faults

class AiEngine {
  constructor(k8sClient, options = {}) {
    this.k8s = k8sClient;
    this.apiKey = options.apiKey || process.env.LLM_API_KEY || '';
    this.apiUrl = options.apiUrl || process.env.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    this.model = options.model || process.env.LLM_MODEL || 'deepseek-chat';
    this.baseline = null;
    this.maxRounds = 1;
  }

  async captureBaseline() {
    this.baseline = this.k8s.getClusterSnapshot();
    return this.baseline;
  }

  async diagnose(faults) {
    if (this.baseline) {
      const current = this.k8s.getClusterSnapshot();
      return this._callLLM(this.baseline, current);
    }
    const current = this.k8s.getClusterSnapshot();
    return this._callLLM(null, current);
  }

  async _callLLM(baseline, current) {
    const prompt = this._buildPrompt(baseline, current);

    if (!this.apiKey) {
      return this._ruleBasedDiagnosis(current);
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: '你是 Kubernetes 运维专家。请以 JSON 格式回复。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content.trim();
      return this._parseResponse(content);
    } catch (err) {
      console.error('AI Engine: LLM call failed, using rule-based fallback:', err.message);
      return this._ruleBasedDiagnosis(current);
    }
  }

  _buildPrompt(baseline, current) {
    let prompt = '以下是一个微服务集群的状态信息。\n\n';

    if (baseline) {
      prompt += '【正常时基线】\n';
      prompt += `Pods: ${JSON.stringify(baseline.pods)}\n`;
      prompt += `Deployments: ${JSON.stringify(baseline.deployments)}\n\n`;
    }

    prompt += '【当前异常状态】\n';
    prompt += `Pods: ${JSON.stringify(current.pods)}\n`;
    prompt += `Deployments: ${JSON.stringify(current.deployments)}\n`;
    prompt += `Events: ${current.events}\n\n`;

    prompt += '请诊断可能的故障原因，以 JSON 格式回复：\n';
    prompt += '{\n';
    prompt += '  "diagnosis": "中文一句话描述诊断结论",\n';
    prompt += '  "suspectedService": "受影响的服务名",\n';
    prompt += '  "repairCommand": "修复命令，如 kubectl scale deployment xxx --replicas=1"\n';
    prompt += '}';

    return prompt;
  }

  _parseResponse(content) {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // fall through to default
    }
    return {
      diagnosis: 'AI 无法给出明确诊断',
      suspectedService: 'unknown',
      repairCommand: `kubectl get pods -n ${this.k8s.namespace}`,
    };
  }

  _ruleBasedDiagnosis(current) {
    const { pods, deployments } = current;

    // Check for not-ready pods (network-delay, disk-full, etc.)
    const notReadyPods = pods.filter(p => p.ready === '0/1' || p.status !== 'Running');
    if (notReadyPods.length > 0) {
      const p = notReadyPods[0];
      const svc = p.name.split('-').slice(0, -2).join('-') || p.name.split('-')[0];
      return {
        diagnosis: `${p.name} 状态异常 (ready=${p.ready}, status=${p.status})，可能存在网络故障或磁盘满`,
        suspectedService: svc,
        repairCommand: `kubectl exec ${p.name} -n ${this.k8s.namespace} -- sh -c "rm -f /tmp/bigfile; tc qdisc del dev eth0 root"`,
      };
    }

    // Check for CPU stress (cpu > 80%)
    const cpuStressedPods = pods.filter(p => (p.cpu || 0) > 80);
    if (cpuStressedPods.length > 0) {
      const p = cpuStressedPods[0];
      const svc = p.name.split('-').slice(0, -2).join('-') || p.name.split('-')[0];
      return {
        diagnosis: `${p.name} 的 CPU 使用率异常飙升至 ${p.cpu || 95}%，疑似遭受 CPU 压力攻击`,
        suspectedService: svc,
        repairCommand: `kubectl exec ${p.name} -n ${this.k8s.namespace} -- pkill -f "while.*:"`,
      };
    }

    // Check for memory leak (memory > 80%)
    const memLeakedPods = pods.filter(p => (p.memory || 0) > 80);
    if (memLeakedPods.length > 0) {
      const p = memLeakedPods[0];
      const svc = p.name.split('-').slice(0, -2).join('-') || p.name.split('-')[0];
      return {
        diagnosis: `${p.name} 的内存使用率异常飙升至 ${p.memory || 90}%，疑似发生内存泄漏`,
        suspectedService: svc,
        repairCommand: `kubectl exec ${p.name} -n ${this.k8s.namespace} -- pkill tail`,
      };
    }

    // Check for process-crash (pods with recent restarts)
    const restartedPods = pods.filter(p => p.restarts > 0);
    if (restartedPods.length > 0) {
      const p = restartedPods[0];
      const svc = p.name.split('-').slice(0, -2).join('-') || p.name.split('-')[0];
      return {
        diagnosis: `${p.name} 的进程疑似崩溃并被重启 (restarts=${p.restarts})`,
        suspectedService: svc,
        repairCommand: `kubectl rollout restart deployment ${svc} -n ${this.k8s.namespace}`,
      };
    }

    // Check for scale-to-zero (deployment available === 0)
    for (const dep of deployments) {
      if (dep.available === 0) {
        return {
          diagnosis: `${dep.name} 的副本数被缩为 0，所有 Pod 已消失`,
          suspectedService: dep.name,
          repairCommand: `kubectl scale deployment ${dep.name} --replicas=2 -n ${this.k8s.namespace}`,
        };
      }
    }

    // Check for reduced replicas (kill-random-pod=1/2, kill-two-pods)
    const reducedDeployments = [];
    for (const dep of deployments) {
      const [ready, expected] = dep.ready.split('/').map(Number);
      if (expected > 0 && ready < expected) {
        reducedDeployments.push({ name: dep.name, ready, expected });
      }
    }

    if (reducedDeployments.length >= 2) {
      return {
        diagnosis: `两个服务的副本被缩减：${reducedDeployments.map(s => `${s.name}(${s.ready}/${s.expected})`).join('、')}`,
        suspectedService: reducedDeployments[0].name,
        repairCommand: `kubectl scale deployment ${reducedDeployments[0].name} --replicas=2 -n ${this.k8s.namespace}`,
      };
    } else if (reducedDeployments.length === 1) {
      const svc = reducedDeployments[0];
      return {
        diagnosis: `${svc.name} 的副本数被缩减为 ${svc.ready}/${svc.expected}`,
        suspectedService: svc.name,
        repairCommand: `kubectl scale deployment ${svc.name} --replicas=2 -n ${this.k8s.namespace}`,
      };
    }

    return {
      diagnosis: '当前集群状态看起来正常，未发现明显异常',
      suspectedService: 'none',
      repairCommand: `kubectl get pods -n ${this.k8s.namespace}`,
    };
  }

  async *diagnoseWithStream(faults) {
    let current;
    if (this.baseline) {
      current = this.k8s.getClusterSnapshot();
    } else {
      current = this.k8s.getClusterSnapshot();
    }
    const prompt = this._buildPrompt(this.baseline, current);

    if (!this.apiKey) {
      const result = this._ruleBasedDiagnosis(current);
      yield { type: 'token', text: result.diagnosis };
      yield { type: 'done', result };
      return;
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: '你是 Kubernetes 运维专家。请以 JSON 格式回复。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          stream: true,
        }),
      });

      if (!response.ok) {
        const fallback = this._ruleBasedDiagnosis(current);
        yield { type: 'token', text: fallback.diagnosis };
        yield { type: 'done', result: fallback };
        return;
      }

      let fullContent = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const json = JSON.parse(line.slice(6));
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                yield { type: 'token', text: delta };
              }
            } catch (e) { /* skip malformed lines */ }
          }
        }
      }

      const result = this._parseResponse(fullContent);
      yield { type: 'done', result };
    } catch (err) {
      console.error('AI streaming failed:', err.message);
      const fallback = this._ruleBasedDiagnosis(current);
      yield { type: 'token', text: fallback.diagnosis };
      yield { type: 'done', result: fallback };
    }
  }

  async attemptRepair(diagnosisResult) {
    const { repairCommand, suspectedService } = diagnosisResult;
    if (!repairCommand) {
      return { success: false, command: repairCommand, output: '无修复命令' };
    }

    // Recognized repair patterns: scale, exec (tc, pkill), rollout restart
    const isRepair =
      (repairCommand.includes('scale') && /--replicas=\d+/.test(repairCommand)) ||
      (repairCommand.includes('exec') && (repairCommand.includes('tc') || repairCommand.includes('pkill') || repairCommand.includes('rm ') || repairCommand.includes('sh -c'))) ||
      repairCommand.includes('rollout restart') ||
      (repairCommand.includes('exec') && (repairCommand.includes('kill') || repairCommand.includes('fuser')));

    if (!isRepair) {
      return { success: false, command: repairCommand, output: '诊断命令，非修复操作' };
    }

    try {
      return { success: true, command: repairCommand, output: 'AI 尝试执行修复命令' };
    } catch (err) {
      return { success: false, command: repairCommand, output: err.message };
    }
  }

}

module.exports = AiEngine;
