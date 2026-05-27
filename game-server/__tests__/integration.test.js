// Integration test: full game flow through all modules
const K8sClient = require('../k8s-client');
const StateMachine = require('../state-machine');
const { ChaosInjector } = require('../chaos-injector');
const AiEngine = require('../ai-engine');
const Scorer = require('../scorer');
const { TerminalProxy } = require('../terminal-proxy');

describe('Full Game Integration', () => {
  test('complete game flow: IDLE -> INJECTING -> DIAGNOSING -> SCORING -> IDLE', async () => {
    // Setup
    const k8s = new K8sClient({ mockMode: true });
    const sm = new StateMachine();
    const injector = new ChaosInjector(k8s);
    const ai = new AiEngine(k8s);
    const scorer = new Scorer();
    const terminal = new TerminalProxy(k8s, { mockMode: true });

    // Phase 1: IDLE
    expect(sm.getStatus()).toBe('IDLE');
    expect(k8s.isHealthy()).toBe(true);

    // Phase 2: INJECTING
    sm.startGame('easy');
    expect(sm.getStatus()).toBe('INJECTING');

    await ai.captureBaseline();

    const faults = injector.pickFault('easy');
    injector.injectMock(faults);
    expect(k8s.isHealthy()).toBe(false);

    sm.startDiagnosing(faults);
    expect(sm.getStatus()).toBe('DIAGNOSING');

    // Phase 3: DIAGNOSING — Human tries to figure out the issue
    // Step 1: Check pods
    const podsResult = terminal.execute('kubectl get pods');
    expect(podsResult.success).toBe(true);

    // Step 2: AI diagnosis
    const diagnosis = await ai.diagnose(faults);
    expect(diagnosis).toHaveProperty('diagnosis');
    expect(diagnosis).toHaveProperty('repairCommand');

    // Step 3: Human uses the right repair command
    let repairCmd;
    for (const fault of faults) {
      if (fault.type === 'scale-to-zero' || fault.type === 'kill-random-pod') {
        repairCmd = `kubectl scale deployment ${fault.target} --replicas=2`;
      } else {
        repairCmd = `kubectl rollout restart deployment/${fault.target}`;
      }
    }

    if (repairCmd) {
      const repairResult = terminal.execute(repairCmd);
      expect(repairResult.success).toBe(true);
      sm.markHumanRepaired(repairCmd);
    }

    // After repair, cluster should be healthy
    expect(k8s.isHealthy()).toBe(true);

    // Phase 4: SCORING
    sm.markAiRepaired(diagnosis.repairCommand);
    const state = sm.getState();

    const scoringResult = scorer.score({
      humanRepairTime: state.humanRepairTime || 5000,
      aiRepairTime: state.aiRepairTime || 30000,
      humanCommand: state.humanRepairCommand || '',
      aiCommand: state.aiRepairCommand || '',
      actualFaultType: faults[0].type,
      aiDiagnosis: diagnosis.diagnosis,
    });

    sm.endGame(scoringResult);
    expect(sm.getStatus()).toBe('SCORING');
    expect(scoringResult).toHaveProperty('winner');

    // Phase 5: Reset to IDLE
    sm.reset();
    expect(sm.getStatus()).toBe('IDLE');
    expect(sm.getState().round).toBe(1);

    // Restore
    injector.restoreMock(faults);
    expect(k8s.isHealthy()).toBe(true);
  });

  test('human can repair scale-to-zero via terminal', () => {
    const k8s = new K8sClient({ mockMode: true });
    const terminal = new TerminalProxy(k8s, { mockMode: true });
    const injector = new ChaosInjector(k8s);

    // Inject fault
    const faults = [{ type: 'scale-to-zero', target: 'order-service',
      id: 'test-1', restoreFn: { method: 'scale', replicas: 2, target: 'order-service' } }];
    injector.injectMock(faults);
    expect(k8s.isHealthy()).toBe(false);

    // Human diagnoses
    const checkResult = terminal.execute('kubectl get deployments');
    expect(checkResult.success).toBe(true);

    // Human repairs
    const repairResult = terminal.execute('kubectl scale deployment order-service --replicas=2');
    expect(repairResult.success).toBe(true);
    expect(k8s.isHealthy()).toBe(true);
  });

  test('terminal rejects dangerous commands in game context', () => {
    const k8s = new K8sClient({ mockMode: true });
    const terminal = new TerminalProxy(k8s, { mockMode: true });

    const dangerous = [
      'kubectl delete pod test-pod',
      'kubectl apply -f evil.yaml',
      'kubectl get pods; rm -rf /',
    ];

    for (const cmd of dangerous) {
      const result = terminal.execute(cmd);
      expect(result.success).toBe(false);
    }
  });

  test('timeout path: game ends after timeout', () => {
    const sm = new StateMachine();
    sm.startGame('easy');
    sm.startDiagnosing([]);

    sm.timeout();
    expect(sm.getStatus()).toBe('TIMEOUT');

    sm.reset();
    expect(sm.getStatus()).toBe('IDLE');
  });

  test('mode switch: practice -> real -> practice', () => {
    const k8s = new K8sClient({ mockMode: true });
    const terminal = new TerminalProxy(k8s, { mockMode: true });

    // Start in practice mode
    expect(k8s.mockMode).toBe(true);
    expect(terminal.mockMode).toBe(true);

    // Switch to real mode
    k8s.setMockMode(false);
    terminal.setMockMode(false);
    expect(k8s.mockMode).toBe(false);
    expect(terminal.mockMode).toBe(false);

    // Switch back to practice mode and reset mock state
    k8s.setMockMode(true);
    terminal.setMockMode(true);
    k8s.resetMockState();
    expect(k8s.mockMode).toBe(true);
    expect(k8s.isHealthy()).toBe(true);
  });

  test('mode switch resets mock state to healthy', () => {
    const k8s = new K8sClient({ mockMode: true });

    // Inject fault in mock mode
    k8s.injectMockFault('scale-to-zero', 'order-service');
    expect(k8s.isHealthy()).toBe(false);

    // Switch to real and back
    k8s.setMockMode(false);
    k8s.setMockMode(true);
    k8s.resetMockState();

    // Should be healthy again
    expect(k8s.isHealthy()).toBe(true);
    expect(k8s.getPods().length).toBe(6);
  });

  test('rapid replay: aiDiagnosisInProgress does not block new game', async () => {
    const k8s = new K8sClient({ mockMode: true });
    const sm = new StateMachine();
    const injector = new ChaosInjector(k8s);
    const ai = new AiEngine(k8s);
    const terminal = new TerminalProxy(k8s, { mockMode: true });

    // First game
    sm.startGame('easy');
    await ai.captureBaseline();
    const faults1 = injector.pickFault('easy');
    injector.injectMock(faults1);
    sm.startDiagnosing(faults1);

    // AI diagnoses
    const diag1 = await ai.diagnose(faults1);
    sm.setAiDiagnosis(diag1.diagnosis);
    expect(sm.getState().aiDiagnosis).toBeTruthy();
    expect(sm.getState().aiDiagnosis.length).toBeGreaterThan(0);

    // End first game
    sm.markAiRepaired(diag1.repairCommand);
    sm.endGame({ winner: 'ai', roundSummary: 'AI won' });
    sm.reset();
    injector.restoreMock(faults1);

    // Second game — AI should work again
    sm.startGame('hard');
    await ai.captureBaseline();
    const faults2 = injector.pickFault('hard');
    injector.injectMock(faults2);
    sm.startDiagnosing(faults2);

    const diag2 = await ai.diagnose(faults2);
    sm.setAiDiagnosis(diag2.diagnosis);
    expect(sm.getState().aiDiagnosis).toBeTruthy();
    expect(sm.getState().aiDiagnosis.length).toBeGreaterThan(0);
  });

  test('AI rule-based diagnosis correctly identifies both fault types', async () => {
    const k8s = new K8sClient({ mockMode: true });
    const ai = new AiEngine(k8s);

    // Test scale-to-zero detection
    k8s.injectMockFault('scale-to-zero', 'product-service');
    let result = ai._ruleBasedDiagnosis(k8s.getClusterSnapshot());
    expect(result.repairCommand).toContain('kubectl scale');
    expect(result.suspectedService).toBe('product-service');

    // Reset and test kill-random-pod detection
    k8s.clearMockFault();
    k8s.injectMockFault('kill-random-pod', 'frontend');
    result = ai._ruleBasedDiagnosis(k8s.getClusterSnapshot());
    expect(result.suspectedService).toBe('frontend');
  });
});
