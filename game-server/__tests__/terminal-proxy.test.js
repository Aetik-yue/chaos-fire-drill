const { TerminalProxy } = require('../terminal-proxy');
const K8sClient = require('../k8s-client');

describe('TerminalProxy', () => {
  let k8s;
  let proxy;

  beforeEach(() => {
    k8s = new K8sClient({ mockMode: true });
    proxy = new TerminalProxy(k8s, { mockMode: true });
  });

  test('validate accepts kubectl get pods', () => {
    expect(proxy.validate('kubectl get pods').valid).toBe(true);
  });

  test('validate accepts kubectl describe pod', () => {
    expect(proxy.validate('kubectl describe pod frontend-abc123').valid).toBe(true);
  });

  test('validate accepts kubectl logs', () => {
    expect(proxy.validate('kubectl logs order-service-abc123').valid).toBe(true);
  });

  test('validate accepts kubectl scale', () => {
    expect(proxy.validate('kubectl scale deployment order-service --replicas=2').valid).toBe(true);
  });

  test('validate rejects kubectl delete', () => {
    const result = proxy.validate('kubectl delete pod frontend-abc123');
    expect(result.valid).toBe(false);
  });

  test('validate rejects kubectl apply', () => {
    const result = proxy.validate('kubectl apply -f evil.yaml');
    expect(result.valid).toBe(false);
  });

  test('validate rejects command injection with semicolon', () => {
    const result = proxy.validate('kubectl get pods; rm -rf /');
    expect(result.valid).toBe(false);
  });

  test('validate rejects command injection with pipe', () => {
    const result = proxy.validate('kubectl get pods | bash');
    expect(result.valid).toBe(false);
  });

  test('validate rejects empty command', () => {
    expect(proxy.validate('').valid).toBe(false);
  });

  test('execute returns success for get pods', () => {
    const result = proxy.execute('kubectl get pods');
    expect(result.success).toBe(true);
    expect(result.output).toContain('NAME');
    expect(result.output).toContain('Running');
  });

  test('execute records command in history', () => {
    proxy.execute('kubectl get pods');
    proxy.execute('kubectl get deployments');
    expect(proxy.getHistory().length).toBe(2);
    expect(proxy.getHistory()[0].command).toContain('kubectl get pods');
  });

  test('execute rejects forbidden command', () => {
    const result = proxy.execute('kubectl delete pod x');
    expect(result.success).toBe(false);
  });

  test('execute adds namespace automatically for get pods', () => {
    const result = proxy.execute('kubectl get pods');
    expect(result.command).toContain('-n chaos-game');
  });

  test('execute scale with replicas > 0 restores deployment', () => {
    k8s.injectMockFault('scale-to-zero', 'order-service');
    expect(k8s.isHealthy()).toBe(false);

    const result = proxy.execute('kubectl scale deployment order-service --replicas=2');
    expect(result.success).toBe(true);
    expect(k8s.isHealthy()).toBe(true);
  });

  test('clearHistory empties history', () => {
    proxy.execute('kubectl get pods');
    proxy.clearHistory();
    expect(proxy.getHistory().length).toBe(0);
  });

  test('setMockMode toggles proxy mock mode', () => {
    proxy.setMockMode(false);
    expect(proxy.mockMode).toBe(false);
    proxy.setMockMode(true);
    expect(proxy.mockMode).toBe(true);
  });
});
