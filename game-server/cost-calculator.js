// Cost Calculator — cloud resource cost simulation for Chaos Fire Drill

const RATES = {
  podPerMinute: 0.03,       // per pod per minute
  downtimePerSecond: 0.05,  // per second of unavailability
  commandFee: 0.02,         // per terminal command
  overProvisionPerMinute: 0.15, // per extra pod per minute
};

class CostCalculator {
  calculate({ totalPods, diagnosisMinutes, downtimeSeconds, commandCount, overProvisionedPods }) {
    const podCost = parseFloat((totalPods * diagnosisMinutes * RATES.podPerMinute).toFixed(2));
    const downtimeCost = parseFloat((downtimeSeconds * RATES.downtimePerSecond).toFixed(2));
    const commandCost = parseFloat((commandCount * RATES.commandFee).toFixed(2));
    const remainingMinutes = diagnosisMinutes;
    const overProvisioningPenalty = parseFloat(
      (overProvisionedPods * remainingMinutes * RATES.overProvisionPerMinute).toFixed(2)
    );

    const total = parseFloat((podCost + downtimeCost + commandCost + overProvisioningPenalty).toFixed(2));

    return {
      podCost,
      downtimeCost,
      commandCost,
      overProvisioningPenalty,
      total,
      breakdown: [
        { label: '副本成本', detail: `${totalPods} 副本 × ${diagnosisMinutes.toFixed(1)} min`, amount: podCost },
        { label: '宕机成本', detail: `${downtimeSeconds}s 不可用`, amount: downtimeCost },
        { label: '操作费', detail: `${commandCount} 条命令`, amount: commandCost },
        { label: '过修惩罚', detail: `${overProvisionedPods} 多余副本 × ${remainingMinutes.toFixed(1)} min`, amount: overProvisioningPenalty },
      ],
    };
  }
}

module.exports = CostCalculator;
