const { ChaosInjector } = require('../chaos-injector');
const K8sClient = require('../k8s-client');

describe('ChaosInjector', () => {
  let k8s;
  let injector;

  beforeEach(() => {
    k8s = new K8sClient({ mockMode: true });
    injector = new ChaosInjector(k8s);
  });

  test('pickFault easy returns 1 fault', () => {
    const faults = injector.pickFault('easy');
    expect(faults.length).toBe(1);
    expect(faults[0]).toHaveProperty('id');
    expect(faults[0]).toHaveProperty('type');
    expect(faults[0]).toHaveProperty('target');
    expect(faults[0]).toHaveProperty('restoreFn');
  });

  test('pickFault hard returns 2 faults', () => {
    const faults = injector.pickFault('hard');
    expect(faults.length).toBe(2);
    expect(faults[0].target).not.toBe(faults[1].target);
  });

  test('pickFault returns only valid fault types', () => {
    for (let i = 0; i < 10; i++) {
      const faults = injector.pickFault('easy');
      expect(['kill-random-pod', 'scale-to-zero', 'cpu-stress', 'memory-leak', 'disk-full', 'process-crash']).toContain(faults[0].type);
    }
  });

  test('pickFault targets are valid services', () => {
    for (let i = 0; i < 10; i++) {
      const faults = injector.pickFault('easy');
      expect(['frontend', 'order-service', 'product-service']).toContain(faults[0].target);
    }
  });

  test('injectMock scale-to-zero makes cluster unhealthy', () => {
    const faults = injector.pickFault('easy');
    faults[0].type = 'scale-to-zero';
    faults[0].target = 'order-service';
    faults[0].restoreFn = { method: 'scale', replicas: 2, target: 'order-service' };

    injector.injectMock(faults);
    expect(k8s.isHealthy()).toBe(false);

    const pods = k8s.getPods();
    const orderPods = pods.filter(p => p.name.startsWith('order-service'));
    expect(orderPods.length).toBe(0);
  });

  test('injectMock kill-random-pod reduces pod count', () => {
    const before = k8s.getPods().length;
    const faults = injector.pickFault('easy');
    faults[0].type = 'kill-random-pod';
    faults[0].target = 'order-service';
    faults[0].restoreFn = { method: 'wait-recreate' };

    injector.injectMock(faults);
    const after = k8s.getPods().length;
    expect(after).toBe(before - 1);
  });

  test('restoreMock clears fault and restores health', () => {
    const faults = injector.pickFault('easy');
    faults[0].type = 'scale-to-zero';
    faults[0].target = 'order-service';
    faults[0].restoreFn = { method: 'scale', replicas: 2, target: 'order-service' };

    injector.injectMock(faults);
    expect(k8s.isHealthy()).toBe(false);

    injector.restoreMock(faults);
    expect(k8s.isHealthy()).toBe(true);
  });

  test('pickFault id is unique per call', () => {
    const f1 = injector.pickFault('easy');
    const f2 = injector.pickFault('easy');
    expect(f1[0].id).not.toBe(f2[0].id);
  });

  test('restoreFn for scale-to-zero includes correct command', () => {
    const faults = injector.pickFault('easy');
    faults[0].type = 'scale-to-zero';
    faults[0].target = 'product-service';
    faults[0].restoreFn = injector._getRestoreFn('scale-to-zero', 'product-service');

    expect(faults[0].restoreFn.method).toBe('scale');
    expect(faults[0].restoreFn.replicas).toBe(2);
    expect(faults[0].restoreFn.command).toContain('kubectl scale');
    expect(faults[0].restoreFn.command).toContain('product-service');
  });
});
