const AiEngine = require('../ai-engine');
const K8sClient = require('../k8s-client');

describe('AiEngine', () => {
  let k8s;
  let ai;

  beforeEach(() => {
    k8s = new K8sClient({ mockMode: true });
    ai = new AiEngine(k8s);
  });

  test('captureBaseline records current cluster state', async () => {
    const baseline = await ai.captureBaseline();
    expect(baseline).toHaveProperty('pods');
    expect(baseline).toHaveProperty('deployments');
    expect(baseline.pods.length).toBe(6);
  });

  test('_ruleBasedDiagnosis detects scale-to-zero', () => {
    k8s.injectMockFault('scale-to-zero', 'order-service');
    const current = k8s.getClusterSnapshot();
    const result = ai._ruleBasedDiagnosis(current);
    expect(result.suspectedService).toBe('order-service');
    expect(result.repairCommand).toContain('kubectl scale');
    expect(result.repairCommand).toContain('order-service');
    expect(result.repairCommand).toContain('--replicas=2');
  });

  test('_ruleBasedDiagnosis detects kill-random-pod', () => {
    k8s.injectMockFault('kill-random-pod', 'order-service');
    const current = k8s.getClusterSnapshot();
    const result = ai._ruleBasedDiagnosis(current);
    expect(result.suspectedService).toBe('order-service');
    expect(result.diagnosis).toContain('order-service');
  });

  test('_ruleBasedDiagnosis reports healthy when no fault', () => {
    const current = k8s.getClusterSnapshot();
    const result = ai._ruleBasedDiagnosis(current);
    expect(result.diagnosis).toContain('正常');
    expect(result.suspectedService).toBe('none');
  });

  test('_buildPrompt returns a string with expected sections', () => {
    const baseline = k8s.getClusterSnapshot();
    const current = k8s.getClusterSnapshot();
    const prompt = ai._buildPrompt(baseline, current);
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('正常时基线');
    expect(prompt).toContain('当前异常状态');
    expect(prompt).toContain('diagnosis');
    expect(prompt).toContain('repairCommand');
  });

  test('_parseResponse extracts JSON from LLM response', () => {
    const raw = '```json\n{"diagnosis":"test","suspectedService":"x","repairCommand":"cmd"}\n```';
    const parsed = ai._parseResponse(raw);
    expect(parsed.diagnosis).toBe('test');
    expect(parsed.suspectedService).toBe('x');
  });

  test('_parseResponse returns default on invalid input', () => {
    const parsed = ai._parseResponse('not json at all');
    expect(parsed).toHaveProperty('diagnosis');
    expect(parsed).toHaveProperty('repairCommand');
  });

  test('attemptRepair returns success for scale commands', async () => {
    const result = await ai.attemptRepair({
      repairCommand: 'kubectl scale deployment order-service --replicas=2',
      suspectedService: 'order-service',
    });
    expect(result.success).toBe(true);
  });

  test('attemptRepair returns false for read-only commands', async () => {
    const result = await ai.attemptRepair({
      repairCommand: 'kubectl get pods',
      suspectedService: 'unknown',
    });
    expect(result.success).toBe(false);
  });
});
