// Scorer — calculates scores for human vs AI showdown
// Weight distribution: speed(35) + accuracy(20) + standard(15) + cost(30) = 100

const CostCalculator = require('./cost-calculator');

class Scorer {
  constructor() {
    this.costCalc = new CostCalculator();
  }

  score(options) {
    const {
      humanRepairTime,
      aiRepairTime,
      humanCommand = '',
      aiCommand = '',
      actualFaultType,
      aiDiagnosis = '',
      // Cost parameters
      humanTotalPods = 2,
      humanCommandCount = 0,
      humanOverProvisionedPods = 0,
      aiTotalPods = 2,
      aiCommandCount = 0,
      aiOverProvisionedPods = 0,
      diagnosisMinutes = 0,
      humanDowntimeSeconds = 0,
      aiDowntimeSeconds = 0,
      namespace = 'chaos-game',
    } = options;

    const speedResult = this._scoreSpeed(humanRepairTime, aiRepairTime);
    const humanAccuracy = this._scoreAccuracy(humanCommand, actualFaultType);
    const aiAccuracy = this._scoreAccuracy(aiCommand, actualFaultType);
    const humanStandard = this._scoreStandardization(humanCommand, namespace);
    const aiStandard = 15;

    // Cost calculation
    const humanCost = this.costCalc.calculate({
      totalPods: humanTotalPods,
      diagnosisMinutes,
      downtimeSeconds: humanDowntimeSeconds,
      commandCount: humanCommandCount,
      overProvisionedPods: humanOverProvisionedPods,
    });

    const aiCost = this.costCalc.calculate({
      totalPods: aiTotalPods,
      diagnosisMinutes,
      downtimeSeconds: aiDowntimeSeconds,
      commandCount: aiCommandCount,
      overProvisionedPods: aiOverProvisionedPods,
    });

    const humanCostScore = this._scoreCost(humanCost.total, aiCost.total, humanRepairTime != null);
    const aiCostScore = this._scoreCost(aiCost.total, humanCost.total, aiRepairTime != null);

    const humanTotal = speedResult.human + humanAccuracy + humanStandard + humanCostScore;
    const aiTotal = speedResult.ai + aiAccuracy + aiStandard + aiCostScore;

    const winner = humanTotal > aiTotal ? 'human'
      : aiTotal > humanTotal ? 'ai'
      : 'draw';

    const humanTimeStr = humanRepairTime != null ? `${(humanRepairTime / 1000).toFixed(1)}s` : '未修复';
    const aiTimeStr = aiRepairTime != null ? `${(aiRepairTime / 1000).toFixed(1)}s` : '未修复';

    let roundSummary;
    if (winner === 'human') {
      if (humanCost.total < aiCost.total) {
        roundSummary = `你赢了！速度更快 (${humanTimeStr} vs ${aiTimeStr}) 且成本更低 ($${humanCost.total} vs $${aiCost.total})`;
      } else {
        roundSummary = `你赢了！修复耗时 ${humanTimeStr} vs AI ${aiTimeStr}`;
      }
    } else if (winner === 'ai') {
      if (aiCost.total < humanCost.total) {
        roundSummary = `AI 赢了！速度更快 (${aiTimeStr} vs ${humanTimeStr}) 且成本更低 ($${aiCost.total} vs $${humanCost.total})`;
      } else {
        roundSummary = `AI 赢了！修复耗时 ${aiTimeStr} vs 你 ${humanTimeStr}`;
      }
    } else {
      roundSummary = '平局！';
    }

    return {
      human: { repairTime: humanRepairTime, command: humanCommand,
        accuracy: humanAccuracy, standard: humanStandard, total: humanTotal,
        cost: humanCost.total, costScore: humanCostScore, costBreakdown: humanCost.breakdown },
      ai: { repairTime: aiRepairTime, command: aiCommand, diagnosis: aiDiagnosis,
        accuracy: aiAccuracy, standard: aiStandard, total: aiTotal,
        cost: aiCost.total, costScore: aiCostScore, costBreakdown: aiCost.breakdown },
      winner,
      roundSummary,
    };
  }

  _scoreSpeed(humanTime, aiTime) {
    const max = 35;
    if (humanTime == null && aiTime == null) return { human: Math.round(max / 2), ai: Math.round(max / 2) };
    if (humanTime == null) return { human: 0, ai: max };
    if (aiTime == null) return { human: max, ai: 0 };
    const total = humanTime + aiTime;
    const humanRatio = 1 - (humanTime / total);
    const aiRatio = 1 - (aiTime / total);
    return {
      human: Math.round(humanRatio * max),
      ai: Math.round(aiRatio * max),
    };
  }

  _scoreCost(myCost, opponentCost, repaired) {
    if (!repaired) return 0;
    if (myCost < opponentCost) return 30;
    if (myCost <= opponentCost * 2) return 15;
    return 0;
  }

  _scoreAccuracy(command, actualFaultType) {
    if (!command || !actualFaultType) return 10;
    const cmd = command.toLowerCase();

    if (actualFaultType === 'scale-to-zero') {
      if (cmd.includes('scale') && cmd.includes('replicas')) return 20;
      if (cmd.includes('scale') || cmd.includes('replicas')) return 15;
      if (cmd.includes('deployment') || cmd.includes('pod')) return 8;
      return 4;
    }

    if (actualFaultType === 'kill-random-pod') {
      if (cmd.includes('scale') && cmd.includes('replicas')) return 20;
      if (cmd.includes('scale') || cmd.includes('replicas') || cmd.includes('deployment')) return 15;
      return 8;
    }

    if (actualFaultType === 'kill-two-pods') {
      if (cmd.includes('scale') && cmd.includes('replicas')) return 20;
      if (cmd.includes('scale') || cmd.includes('replicas') || cmd.includes('deployment')) return 15;
      return 8;
    }

    if (actualFaultType === 'network-delay') {
      if (cmd.includes('exec') || cmd.includes('delay') || cmd.includes('tc')) return 20;
      if (cmd.includes('pod') || cmd.includes('log')) return 12;
      return 8;
    }

    if (actualFaultType === 'cpu-stress') {
      if (cmd.includes('exec') && (cmd.includes('pkill') || cmd.includes('kill'))) return 20;
      if (cmd.includes('top') || cmd.includes('describe')) return 15;
      return 10;
    }
    if (actualFaultType === 'memory-leak') {
      if (cmd.includes('exec') && (cmd.includes('pkill') || cmd.includes('kill'))) return 20;
      if (cmd.includes('top') || cmd.includes('describe')) return 15;
      return 10;
    }
    if (actualFaultType === 'disk-full') {
      if (cmd.includes('exec') && cmd.includes('rm')) return 20;
      if (cmd.includes('df') || cmd.includes('du') || cmd.includes('describe')) return 15;
      return 10;
    }
    if (actualFaultType === 'process-crash') {
      if (cmd.includes('get pods') || cmd.includes('describe pod')) return 20;
      if (cmd.includes('logs') || cmd.includes('describe')) return 15;
      return 10;
    }

    return 10;
  }

  _scoreStandardization(command, namespace = 'chaos-game') {
    if (!command) return 0;
    const cmd = command.trim();
    let score = 8;
    if (cmd.startsWith('kubectl')) score += 4;
    if (cmd.includes(`-n ${namespace}`)) score += 2;
    if (cmd.includes('--replicas=') || cmd.includes('--replicas ')) score += 1;
    return Math.min(score, 15);
  }
}

module.exports = Scorer;
