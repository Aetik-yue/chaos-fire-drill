const Scorer = require('../scorer');

describe('Scorer', () => {
  let scorer;

  beforeEach(() => {
    scorer = new Scorer();
  });

  test('human wins when faster', () => {
    const result = scorer.score({
      humanRepairTime: 15000, aiRepairTime: 45000,
      humanCommand: 'kubectl scale deployment order-service --replicas=2 -n chaos-game',
      aiCommand: 'kubectl scale deployment order-service --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: 'order-service 被缩容为 0',
      humanDowntimeSeconds: 15, aiDowntimeSeconds: 45,
      diagnosisMinutes: 0.5,
    });
    expect(result.winner).toBe('human');
    expect(result.human.total).toBeGreaterThan(result.ai.total);
  });

  test('AI wins when faster', () => {
    const result = scorer.score({
      humanRepairTime: 60000, aiRepairTime: 20000,
      humanCommand: 'kubectl scale deployment order-service --replicas=2',
      aiCommand: 'kubectl scale deployment order-service --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: '检测到 order-service 副本数为 0',
      humanDowntimeSeconds: 60, aiDowntimeSeconds: 20,
      diagnosisMinutes: 0.5,
    });
    expect(result.winner).toBe('ai');
    expect(result.ai.total).toBeGreaterThan(result.human.total);
  });

  test('both equal time with same actions results in draw', () => {
    const result = scorer.score({
      humanRepairTime: 30000, aiRepairTime: 30000,
      humanCommand: 'kubectl scale deployment order-service --replicas=2',
      aiCommand: 'kubectl scale deployment order-service --replicas=2',
      actualFaultType: 'scale-to-zero', aiDiagnosis: '',
      humanDowntimeSeconds: 30, aiDowntimeSeconds: 30,
      humanTotalPods: 2, aiTotalPods: 2,
      humanCommandCount: 2, aiCommandCount: 2,
      humanOverProvisionedPods: 0, aiOverProvisionedPods: 0,
      diagnosisMinutes: 0.5,
    });
    expect(Math.abs(result.human.total - result.ai.total)).toBeLessThanOrEqual(2);
  });

  test('returns all required fields including cost', () => {
    const result = scorer.score({
      humanRepairTime: 20000, aiRepairTime: 30000,
      humanCommand: 'kubectl get pods',
      aiCommand: 'kubectl scale deployment x --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: '副本被缩为 0',
      humanDowntimeSeconds: 20, aiDowntimeSeconds: 30,
      diagnosisMinutes: 0.5,
    });
    expect(result).toHaveProperty('human');
    expect(result).toHaveProperty('ai');
    expect(result).toHaveProperty('winner');
    expect(result).toHaveProperty('roundSummary');
    // Cost fields
    expect(result.human).toHaveProperty('cost');
    expect(result.human).toHaveProperty('costScore');
    expect(result.human).toHaveProperty('costBreakdown');
    expect(result.ai).toHaveProperty('cost');
    expect(result.ai).toHaveProperty('costScore');
    expect(result.ai).toHaveProperty('costBreakdown');
  });

  test('full accuracy for scale-to-zero repair (max 20)', () => {
    const result = scorer.score({
      humanRepairTime: 30000, aiRepairTime: 30000,
      humanCommand: 'kubectl scale deployment product-service --replicas=2 -n chaos-game',
      aiCommand: 'kubectl scale deployment product-service --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: 'product-service 副本被缩为 0',
      humanDowntimeSeconds: 30, aiDowntimeSeconds: 30,
      diagnosisMinutes: 0.5,
    });
    expect(result.human.accuracy).toBe(20);
    expect(result.ai.accuracy).toBe(20);
  });

  test('irrelevant command for kill-random-pod gives low accuracy', () => {
    const result = scorer.score({
      humanRepairTime: 30000, aiRepairTime: 30000,
      humanCommand: 'kubectl get nodes', aiCommand: 'kubectl get pods',
      actualFaultType: 'kill-random-pod', aiDiagnosis: '',
      humanDowntimeSeconds: 30, aiDowntimeSeconds: 30,
      diagnosisMinutes: 0.5,
    });
    expect(result.human.accuracy).toBeLessThan(12);
    expect(result.ai.accuracy).toBeLessThan(12);
  });

  test('AI gets 15 for standardization (was 20)', () => {
    const result = scorer.score({
      humanRepairTime: 30000, aiRepairTime: 30000,
      humanCommand: 'bad command', aiCommand: 'anything',
      actualFaultType: 'scale-to-zero', aiDiagnosis: '',
      humanDowntimeSeconds: 30, aiDowntimeSeconds: 30,
      diagnosisMinutes: 0.5,
    });
    expect(result.ai.standard).toBe(15);
  });

  test('proper kubectl command with namespace gets higher standard score (max 15)', () => {
    const result = scorer.score({
      humanRepairTime: 30000, aiRepairTime: 30000,
      humanCommand: 'kubectl scale deployment x --replicas=2 -n chaos-game',
      aiCommand: 'kubectl scale deployment x --replicas=2',
      actualFaultType: 'scale-to-zero', aiDiagnosis: '',
      humanDowntimeSeconds: 30, aiDowntimeSeconds: 30,
      diagnosisMinutes: 0.5,
    });
    expect(result.human.standard).toBeGreaterThanOrEqual(13);
  });

  test('AI accuracy NOT boosted by diagnosis text (fairness)', () => {
    const result = scorer.score({
      humanRepairTime: 30000, aiRepairTime: 30000,
      humanCommand: 'kubectl scale deployment x --replicas=2 -n chaos-game',
      aiCommand: 'kubectl get pods',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: 'scale deployment to fix the replicas scale zero replicas issue',
      humanDowntimeSeconds: 30, aiDowntimeSeconds: 30,
      diagnosisMinutes: 0.5,
    });
    expect(result.ai.accuracy).toBeLessThan(15);
  });

  test('AI with proper repair command gets full accuracy (max 20)', () => {
    const result = scorer.score({
      humanRepairTime: 30000, aiRepairTime: 30000,
      humanCommand: 'kubectl scale deployment x --replicas=2 -n chaos-game',
      aiCommand: 'kubectl scale deployment x --replicas=2',
      actualFaultType: 'scale-to-zero',
      aiDiagnosis: 'some diagnosis',
      humanDowntimeSeconds: 30, aiDowntimeSeconds: 30,
      diagnosisMinutes: 0.5,
    });
    expect(result.ai.accuracy).toBe(20);
  });

  // ── Cost dimension tests ──

  test('lower cost gets full 30 cost score', () => {
    const result = scorer.score({
      humanRepairTime: 30000, aiRepairTime: 30000,
      humanCommand: 'kubectl scale deployment x --replicas=2 -n chaos-game',
      aiCommand: 'kubectl scale deployment x --replicas=2',
      actualFaultType: 'scale-to-zero', aiDiagnosis: '',
      // Human: cheaper (fewer pods, less downtime)
      humanTotalPods: 2, humanCommandCount: 2,
      humanDowntimeSeconds: 20, humanOverProvisionedPods: 0,
      // AI: more expensive
      aiTotalPods: 10, aiCommandCount: 5,
      aiDowntimeSeconds: 60, aiOverProvisionedPods: 8,
      diagnosisMinutes: 1,
    });
    expect(result.human.costScore).toBe(30);
    expect(result.human.cost).toBeLessThan(result.ai.cost);
  });

  test('reasonable repair vs brute force: cost tells them apart', () => {
    // Reasonable: 2 pods, 3 commands, 45s downtime, no waste
    // Brute force: 30 pods, 3 commands, 20s downtime, 28 wasted
    const reasonable = scorer.score({
      humanRepairTime: 45000, aiRepairTime: 20000,
      humanCommand: 'kubectl scale deployment x --replicas=2',
      aiCommand: 'kubectl scale deployment x --replicas=10',
      actualFaultType: 'scale-to-zero', aiDiagnosis: '',
      // Human = reasonable
      humanTotalPods: 2, humanCommandCount: 3,
      humanDowntimeSeconds: 45, humanOverProvisionedPods: 0,
      // AI = brute force (faster but wasteful) → costs 3.61 vs 2.34, within 2×
      aiTotalPods: 30, aiCommandCount: 3,
      aiDowntimeSeconds: 20, aiOverProvisionedPods: 28,
      diagnosisMinutes: 0.5,
    });
    // Human cost should be lower than AI cost
    expect(reasonable.human.cost).toBeLessThan(reasonable.ai.cost);
    // Human cheaper → full cost score
    expect(reasonable.human.costScore).toBe(30);
    // AI within 2× of human → partial cost score
    expect(reasonable.ai.costScore).toBe(15);
  });

  test('unrepaired gets 0 cost score', () => {
    const result = scorer.score({
      humanRepairTime: null, aiRepairTime: 30000,
      humanCommand: '', aiCommand: 'kubectl scale deployment x --replicas=2',
      actualFaultType: 'scale-to-zero', aiDiagnosis: '',
      humanDowntimeSeconds: 300, aiDowntimeSeconds: 30,
      diagnosisMinutes: 1,
    });
    expect(result.human.costScore).toBe(0);
    expect(result.ai.costScore).toBe(30);
  });

  test('cost within 2x opponent gets partial score', () => {
    // Human cost is 1.5x AI cost → partial
    const result = scorer.score({
      humanRepairTime: 30000, aiRepairTime: 30000,
      humanCommand: 'kubectl scale deployment x --replicas=2',
      aiCommand: 'kubectl scale deployment x --replicas=2',
      actualFaultType: 'scale-to-zero', aiDiagnosis: '',
      // Human slightly more expensive but within 2x
      humanTotalPods: 5, humanCommandCount: 4,
      humanDowntimeSeconds: 40, humanOverProvisionedPods: 3,
      // AI cheaper
      aiTotalPods: 2, aiCommandCount: 2,
      aiDowntimeSeconds: 30, aiOverProvisionedPods: 0,
      diagnosisMinutes: 0.5,
    });
    expect(result.human.costScore).toBe(15);
    expect(result.ai.costScore).toBe(30);
  });

  test('cost more than 2x opponent gets 0 cost score', () => {
    const result = scorer.score({
      humanRepairTime: 60000, aiRepairTime: 10000,
      humanCommand: 'kubectl get pods',
      aiCommand: 'kubectl scale deployment x --replicas=2',
      actualFaultType: 'scale-to-zero', aiDiagnosis: '',
      // Human: very expensive (100 pods, 10 commands, long downtime)
      humanTotalPods: 100, humanCommandCount: 10,
      humanDowntimeSeconds: 60, humanOverProvisionedPods: 98,
      // AI: cheap
      aiTotalPods: 2, aiCommandCount: 2,
      aiDowntimeSeconds: 10, aiOverProvisionedPods: 0,
      diagnosisMinutes: 1,
    });
    // Human cost > 2× AI cost → 0 cost score
    expect(result.human.costScore).toBe(0);
    expect(result.ai.costScore).toBe(30);
    expect(result.human.cost).toBeGreaterThan(result.ai.cost * 2);
  });

  test('speed score max is 35', () => {
    const result = scorer.score({
      humanRepairTime: 5000, aiRepairTime: 60000,
      humanCommand: 'kubectl scale deployment x --replicas=2',
      aiCommand: 'kubectl scale deployment x --replicas=2',
      actualFaultType: 'scale-to-zero', aiDiagnosis: '',
      humanDowntimeSeconds: 5, aiDowntimeSeconds: 60,
      diagnosisMinutes: 0.5,
    });
    expect(result.human.total).toBeGreaterThan(0);
    // Speed component max is 35
    expect(result.human.total - result.human.accuracy - result.human.standard - result.human.costScore).toBeLessThanOrEqual(35);
  });
});
