const StateMachine = require('../state-machine');

describe('StateMachine', () => {
  let sm;

  beforeEach(() => {
    sm = new StateMachine();
  });

  test('initial state is IDLE', () => {
    expect(sm.getStatus()).toBe('IDLE');
  });

  test('startGame transitions IDLE -> INJECTING', () => {
    const state = sm.startGame('easy');
    expect(state.status).toBe('INJECTING');
    expect(state.difficulty).toBe('easy');
  });

  test('startDiagnosing transitions INJECTING -> DIAGNOSING', () => {
    sm.startGame('easy');
    const state = sm.startDiagnosing([{ type: 'scale-to-zero', target: 'order-service' }]);
    expect(state.status).toBe('DIAGNOSING');
    expect(state.faults.length).toBe(1);
    expect(state.startTime).not.toBeNull();
  });

  test('cannot startGame from non-IDLE state', () => {
    sm.startGame('easy');
    expect(() => sm.startGame('easy')).toThrow('Game already in progress');
  });

  test('cannot startDiagnosing from non-INJECTING state', () => {
    expect(() => sm.startDiagnosing([])).toThrow('Must be in INJECTING state');
  });

  test('markHumanRepaired records repair info', () => {
    sm.startGame('easy');
    sm.startDiagnosing([{ type: 'scale-to-zero', target: 'order-service' }]);
    sm.markHumanRepaired('kubectl scale deployment order-service --replicas=2');
    const state = sm.getState();
    expect(state.humanRepaired).toBe(true);
    expect(state.humanRepairCommand).toContain('kubectl scale');
    expect(state.humanRepairTime).toBeGreaterThanOrEqual(0);
  });

  test('markAiRepaired records AI repair info', () => {
    sm.startGame('easy');
    sm.startDiagnosing([{ type: 'kill-random-pod', target: 'product-service' }]);
    sm.markAiRepaired('kubectl scale deployment product-service --replicas=2');
    const state = sm.getState();
    expect(state.aiRepaired).toBe(true);
  });

  test('endGame transitions DIAGNOSING -> SCORING', () => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    const result = { winner: 'human', roundSummary: '你赢了' };
    const state = sm.endGame(result);
    expect(state.status).toBe('SCORING');
    expect(state.winner).toBe('human');
  });

  test('cannot endGame from non-DIAGNOSING', () => {
    expect(() => sm.endGame({})).toThrow('Must be in DIAGNOSING state');
  });

  test('timeout transitions DIAGNOSING -> TIMEOUT', () => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    const state = sm.timeout();
    expect(state.status).toBe('TIMEOUT');
  });

  test('reset transitions SCORING -> IDLE and increments round', () => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    sm.endGame({ winner: 'ai' });
    const state = sm.reset();
    expect(state.status).toBe('IDLE');
    expect(state.round).toBe(1);
  });

  test('reset transitions TIMEOUT -> IDLE and increments round', () => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    sm.timeout();
    const state = sm.reset();
    expect(state.status).toBe('IDLE');
    expect(state.round).toBe(1);
  });

  test('cannot reset from IDLE', () => {
    expect(() => sm.reset()).toThrow('Can only reset from SCORING or TIMEOUT');
  });

  test('onChange listener is called on transition', () => {
    const listener = jest.fn();
    sm.onChange(listener);
    sm.startGame('easy');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'INJECTING' }),
      expect.objectContaining({ action: 'start' })
    );
  });

  test('getElapsedSeconds returns seconds since DIAGNOSING start', (done) => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    setTimeout(() => {
      const elapsed = sm.getElapsedSeconds();
      expect(elapsed).toBeGreaterThanOrEqual(0);
      done();
    }, 100);
  });

  test('full game flow works end to end', () => {
    expect(sm.getStatus()).toBe('IDLE');

    sm.startGame('easy');
    expect(sm.getStatus()).toBe('INJECTING');

    sm.startDiagnosing([{ type: 'scale-to-zero', target: 'order-service' }]);
    expect(sm.getStatus()).toBe('DIAGNOSING');

    sm.markAiRepaired('kubectl scale deployment order-service --replicas=2');
    sm.endGame({ winner: 'ai', roundSummary: 'AI 先修复' });
    expect(sm.getStatus()).toBe('SCORING');

    sm.reset();
    expect(sm.getStatus()).toBe('IDLE');
    expect(sm.getState().round).toBe(1);
  });

  test('invalid transition throws error', () => {
    expect(() => sm.transition('DIAGNOSING')).toThrow('Invalid transition');
  });

  test('invalid state throws error', () => {
    expect(() => sm.transition('INVALID')).toThrow('Invalid state');
  });

  test('setAiDiagnosis writes diagnosis to state', () => {
    sm.startGame('easy');
    sm.startDiagnosing([{ type: 'scale-to-zero', target: 'order-service' }]);
    sm.setAiDiagnosis('测试诊断结果');
    expect(sm.getState().aiDiagnosis).toBe('测试诊断结果');
  });

  test('setAiDiagnosis persists across getState calls', () => {
    sm.startGame('easy');
    sm.startDiagnosing([]);
    sm.setAiDiagnosis('第二轮诊断');
    // getState returns a copy, but diagnosis should be in the source state
    const s1 = sm.getState();
    const s2 = sm.getState();
    expect(s1.aiDiagnosis).toBe('第二轮诊断');
    expect(s2.aiDiagnosis).toBe('第二轮诊断');
  });
});
