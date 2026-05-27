const CostCalculator = require('../cost-calculator');

describe('CostCalculator', () => {
  let calc;

  beforeEach(() => {
    calc = new CostCalculator();
  });

  describe('pod cost', () => {
    test('cost scales with pod count', () => {
      const c1 = calc.calculate({ totalPods: 2, diagnosisMinutes: 1, downtimeSeconds: 0, commandCount: 0, overProvisionedPods: 0 });
      const c2 = calc.calculate({ totalPods: 10, diagnosisMinutes: 1, downtimeSeconds: 0, commandCount: 0, overProvisionedPods: 0 });
      expect(c2.podCost).toBeGreaterThan(c1.podCost);
      expect(c2.podCost).toBeCloseTo(10 * 1 * 0.03, 2);
    });

    test('zero pods means zero pod cost', () => {
      const c = calc.calculate({ totalPods: 0, diagnosisMinutes: 2, downtimeSeconds: 0, commandCount: 0, overProvisionedPods: 0 });
      expect(c.podCost).toBe(0);
    });
  });

  describe('downtime cost', () => {
    test('longer downtime costs more', () => {
      const c1 = calc.calculate({ totalPods: 2, diagnosisMinutes: 0.5, downtimeSeconds: 30, commandCount: 0, overProvisionedPods: 0 });
      const c2 = calc.calculate({ totalPods: 2, diagnosisMinutes: 0.5, downtimeSeconds: 120, commandCount: 0, overProvisionedPods: 0 });
      expect(c2.downtimeCost).toBeGreaterThan(c1.downtimeCost);
      expect(c2.downtimeCost).toBeCloseTo(120 * 0.05, 2);
    });

    test('zero downtime means zero downtime cost', () => {
      const c = calc.calculate({ totalPods: 2, diagnosisMinutes: 1, downtimeSeconds: 0, commandCount: 0, overProvisionedPods: 0 });
      expect(c.downtimeCost).toBe(0);
    });
  });

  describe('command cost', () => {
    test('each command costs a flat fee', () => {
      const c = calc.calculate({ totalPods: 2, diagnosisMinutes: 1, downtimeSeconds: 0, commandCount: 5, overProvisionedPods: 0 });
      expect(c.commandCost).toBeCloseTo(5 * 0.02, 2);
    });

    test('zero commands means zero command cost', () => {
      const c = calc.calculate({ totalPods: 2, diagnosisMinutes: 1, downtimeSeconds: 0, commandCount: 0, overProvisionedPods: 0 });
      expect(c.commandCost).toBe(0);
    });
  });

  describe('over-provisioning penalty', () => {
    test('extra pods incur penalty for remaining time', () => {
      const c = calc.calculate({ totalPods: 2, diagnosisMinutes: 1, downtimeSeconds: 0, commandCount: 0, overProvisionedPods: 8 });
      expect(c.overProvisioningPenalty).toBeCloseTo(8 * 1 * 0.15, 2);
    });

    test('zero over-provisioning means zero penalty', () => {
      const c = calc.calculate({ totalPods: 2, diagnosisMinutes: 1, downtimeSeconds: 0, commandCount: 0, overProvisionedPods: 0 });
      expect(c.overProvisioningPenalty).toBe(0);
    });
  });

  describe('total cost', () => {
    test('total is sum of all components', () => {
      const c = calc.calculate({ totalPods: 4, diagnosisMinutes: 1.5, downtimeSeconds: 50, commandCount: 3, overProvisionedPods: 2 });
      const expectedTotal = c.podCost + c.downtimeCost + c.commandCost + c.overProvisioningPenalty;
      expect(c.total).toBeCloseTo(expectedTotal, 2);
    });

    test('reasonable repair scenario', () => {
      // 2 pods × 0.5min × $0.03 + 45s × $0.05 + 3 commands × $0.02 = $2.34
      const c = calc.calculate({ totalPods: 2, diagnosisMinutes: 0.5, downtimeSeconds: 45, commandCount: 3, overProvisionedPods: 0 });
      expect(c.total).toBeCloseTo(2 * 0.5 * 0.03 + 45 * 0.05 + 3 * 0.02, 2);
      expect(c.breakdown).toHaveLength(4);
    });

    test('brute force repair scenario', () => {
      // 30 pods × 0.5min × $0.03 + 20s × $0.05 + 3 commands × $0.02 + 28 over × 0.5min × $0.15
      // = 0.45 + 1.00 + 0.06 + 2.10 = $3.61
      const c = calc.calculate({ totalPods: 30, diagnosisMinutes: 0.5, downtimeSeconds: 20, commandCount: 3, overProvisionedPods: 28 });
      expect(c.total).toBeCloseTo(0.45 + 1.00 + 0.06 + 2.10, 1);
    });
  });

  describe('breakdown format', () => {
    test('returns formatted breakdown array', () => {
      const c = calc.calculate({ totalPods: 2, diagnosisMinutes: 0.5, downtimeSeconds: 30, commandCount: 2, overProvisionedPods: 0 });
      expect(c.breakdown).toEqual([
        { label: '副本成本', detail: '2 副本 × 0.5 min', amount: expect.any(Number) },
        { label: '宕机成本', detail: '30s 不可用', amount: expect.any(Number) },
        { label: '操作费', detail: '2 条命令', amount: expect.any(Number) },
        { label: '过修惩罚', detail: '0 多余副本 × 0.5 min', amount: 0 },
      ]);
    });
  });
});
