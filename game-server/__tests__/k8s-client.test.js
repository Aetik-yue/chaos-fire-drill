const K8sClient = require('../k8s-client');

describe('K8sClient (mock mode)', () => {
  let client;

  beforeEach(() => {
    client = new K8sClient({ mockMode: true });
  });

  test('getPods returns 6 pods initially', () => {
    const pods = client.getPods();
    expect(pods.length).toBe(6);
    expect(pods[0]).toHaveProperty('name');
    expect(pods[0]).toHaveProperty('status', 'Running');
  });

  test('getDeployments returns 3 deployments', () => {
    const deps = client.getDeployments();
    expect(deps.length).toBe(3);
    expect(deps.map(d => d.name).sort()).toEqual(
      ['frontend', 'order-service', 'product-service'].sort()
    );
  });

  test('isHealthy returns true initially', () => {
    expect(client.isHealthy()).toBe(true);
  });

  test('deletePod removes a pod', () => {
    client.deletePod('frontend-abc123');
    const pods = client.getPods();
    const frontendPods = pods.filter(p => p.name.startsWith('frontend'));
    expect(frontendPods.length).toBe(2); // Replaced: -abc123 removed, -xyz789 added
  });

  test('scaleDeployment to 0 removes pods', () => {
    client.scaleDeployment('order-service', 0);
    const pods = client.getPods();
    const orderPods = pods.filter(p => p.name.startsWith('order-service'));
    expect(orderPods.length).toBe(0);
  });

  test('isHealthy returns false after scale to 0', () => {
    client.scaleDeployment('order-service', 0);
    expect(client.isHealthy()).toBe(false);
  });

  test('injectMockFault kill-random-pod makes a pod disappear', () => {
    const before = client.getPods().filter(p => p.name.startsWith('order-service')).length;
    client.injectMockFault('kill-random-pod', 'order-service');
    const after = client.getPods().filter(p => p.name.startsWith('order-service')).length;
    expect(after).toBe(before - 1);
  });

  test('injectMockFault scale-to-zero removes all pods of target', () => {
    client.injectMockFault('scale-to-zero', 'product-service');
    const pods = client.getPods().filter(p => p.name.startsWith('product-service'));
    expect(pods.length).toBe(0);
  });

  test('clearMockFault restores scale-to-zero', () => {
    client.injectMockFault('scale-to-zero', 'product-service');
    client.clearMockFault();
    expect(client.isHealthy()).toBe(true);
    const pods = client.getPods().filter(p => p.name.startsWith('product-service'));
    expect(pods.length).toBeGreaterThan(0);
  });

  test('getClusterSnapshot returns expected shape', () => {
    const snap = client.getClusterSnapshot();
    expect(snap).toHaveProperty('pods');
    expect(snap).toHaveProperty('deployments');
    expect(snap).toHaveProperty('events');
    expect(snap).toHaveProperty('timestamp');
  });

  test('setMockMode toggles mockMode flag', () => {
    client.setMockMode(false);
    expect(client.mockMode).toBe(false);
    client.setMockMode(true);
    expect(client.mockMode).toBe(true);
  });

  test('resetMockState restores default healthy state', () => {
    client.injectMockFault('scale-to-zero', 'product-service');
    expect(client.isHealthy()).toBe(false);

    client.resetMockState();
    expect(client.isHealthy()).toBe(true);
    expect(client.getPods().length).toBe(6);
    expect(client.getDeployments().length).toBe(3);
  });

  test('injectMockFault kill-two-pods uses explicit secondTarget', () => {
    client.injectMockFault('kill-two-pods', 'frontend', 'product-service');
    const deps = client.getDeployments();
    const frontend = deps.find(d => d.name === 'frontend');
    const product = deps.find(d => d.name === 'product-service');
    expect(frontend.ready).toBe('1/2');
    expect(product.ready).toBe('1/2');
    // order-service should be untouched
    const order = deps.find(d => d.name === 'order-service');
    expect(order.ready).toBe('2/2');
  });

  test('injectMockFault kill-two-pods falls back when no secondTarget given', () => {
    client.injectMockFault('kill-two-pods', 'frontend');
    const deps = client.getDeployments();
    // frontend should be affected
    const frontend = deps.find(d => d.name === 'frontend');
    expect(frontend.ready).toBe('1/2');
    // some other service should also be affected (random or fallback)
    const affected = deps.filter(d => d.ready === '1/2');
    expect(affected.length).toBe(2);
  });

  test('clearMockFault for kill-two-pods restores both targets', () => {
    client.injectMockFault('kill-two-pods', 'frontend', 'product-service');
    expect(client.isHealthy()).toBe(false);
    client.clearMockFault();
    expect(client.isHealthy()).toBe(true);
    const deps = client.getDeployments();
    for (const dep of deps) {
      expect(dep.ready).toBe('2/2');
    }
  });

  test('rollout restart restores deployment to healthy', () => {
    client.injectMockFault('scale-to-zero', 'product-service');
    expect(client.isHealthy()).toBe(false);

    const output = client._exec('kubectl rollout restart deployment/product-service -n chaos-game');
    expect(output).toContain('restarted');
    expect(client.isHealthy()).toBe(true);
  });

  test('rollout restart with space syntax also works', () => {
    client.injectMockFault('scale-to-zero', 'order-service');
    client._exec('kubectl rollout restart deployment order-service -n chaos-game');
    expect(client.isHealthy()).toBe(true);
  });

  test('checkConnectivity returns result object', () => {
    const result = client.checkConnectivity();
    expect(result).toHaveProperty('ok');
    // In mock mode, kubectl still runs — just may or may not have a cluster
    expect(typeof result.ok).toBe('boolean');
  });
});
