// Game State Machine — manages the 5 game states and transitions

const VALID_STATES = ['IDLE', 'INJECTING', 'DIAGNOSING', 'SCORING', 'TIMEOUT'];
const VALID_TRANSITIONS = {
  IDLE: ['INJECTING'],
  INJECTING: ['DIAGNOSING'],
  DIAGNOSING: ['SCORING', 'TIMEOUT'],
  SCORING: ['IDLE'],
  TIMEOUT: ['IDLE'],
};

class StateMachine {
  constructor() {
    this.state = {
      status: 'IDLE',
      difficulty: 'easy',
      round: 0,
      faults: [],
      startTime: null,
      timeout: 300,
      humanRepaired: false,
      aiRepaired: false,
      humanScore: 0,
      aiScore: 0,
      winner: null,
      roundSummary: '',
    };
    this.listeners = [];
  }

  getState() {
    return { ...this.state };
  }

  getStatus() {
    return this.state.status;
  }

  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  _notify(event) {
    for (const listener of this.listeners) {
      try { listener(this.state, event); } catch (e) { /* ignore */ }
    }
  }

  transition(newStatus, eventData = {}) {
    const current = this.state.status;
    if (!VALID_STATES.includes(newStatus)) {
      throw new Error(`Invalid state: ${newStatus}`);
    }
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(`Invalid transition: ${current} -> ${newStatus}`);
    }

    this.state.status = newStatus;

    if (newStatus === 'INJECTING') {
      this.state.faults = [];
      this.state.humanRepaired = false;
      this.state.aiRepaired = false;
      this.state.humanRepairTime = undefined;
      this.state.aiRepairTime = undefined;
      this.state.humanRepairCommand = '';
      this.state.aiRepairCommand = '';
      this.state.aiDiagnosis = '';
      this.state.humanScore = 0;
      this.state.aiScore = 0;
      this.state.winner = null;
      this.state.roundSummary = '';
      delete this.state.human;
      delete this.state.ai;
    }

    if (newStatus === 'DIAGNOSING') {
      this.state.startTime = Date.now();
    }

    if (newStatus === 'IDLE') {
      this.state.round += 1;
    }

    this._notify(eventData);
    return this.getState();
  }

  startGame(difficulty = 'easy') {
    if (this.state.status !== 'IDLE') {
      throw new Error('Game already in progress');
    }
    this.state.difficulty = difficulty;
    return this.transition('INJECTING', { action: 'start', difficulty });
  }

  startDiagnosing(faults) {
    if (this.state.status !== 'INJECTING') {
      throw new Error('Must be in INJECTING state');
    }
    this.state.faults = faults;
    return this.transition('DIAGNOSING', { action: 'diagnosing', faults });
  }

  markHumanRepaired(command) {
    if (this.state.status !== 'DIAGNOSING') return;
    this.state.humanRepaired = true;
    this.state.humanRepairCommand = command;
    this.state.humanRepairTime = Date.now() - this.state.startTime;
    this._notify({ action: 'human-repaired' });
  }

  setAiDiagnosis(diagnosis) {
    this.state.aiDiagnosis = diagnosis;
  }

  markAiRepaired(command) {
    if (this.state.status !== 'DIAGNOSING') return;
    this.state.aiRepaired = true;
    this.state.aiRepairCommand = command;
    this.state.aiRepairTime = Date.now() - this.state.startTime;
    this._notify({ action: 'ai-repaired' });
  }

  endGame(scoringResult) {
    if (this.state.status !== 'DIAGNOSING') {
      throw new Error('Must be in DIAGNOSING state');
    }
    Object.assign(this.state, scoringResult);
    if (scoringResult.human && typeof scoringResult.human.total === 'number') {
      this.state.humanScore = scoringResult.human.total;
    }
    if (scoringResult.ai && typeof scoringResult.ai.total === 'number') {
      this.state.aiScore = scoringResult.ai.total;
    }
    return this.transition('SCORING', { action: 'scoring', ...scoringResult });
  }

  timeout() {
    if (this.state.status !== 'DIAGNOSING') {
      throw new Error('Must be in DIAGNOSING state');
    }
    return this.transition('TIMEOUT', { action: 'timeout' });
  }

  reset() {
    if (this.state.status !== 'SCORING' && this.state.status !== 'TIMEOUT') {
      throw new Error('Can only reset from SCORING or TIMEOUT');
    }
    return this.transition('IDLE', { action: 'reset' });
  }

  getElapsedSeconds() {
    if (!this.state.startTime) return 0;
    return Math.floor((Date.now() - this.state.startTime) / 1000);
  }
}

module.exports = StateMachine;
