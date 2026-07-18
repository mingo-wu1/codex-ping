const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

/**
 * Calculate an explainable ranking score from verified trade aggregates.
 * Comments, page views, and merchant-entered values are intentionally absent.
 */
export function rankTradeStats(stats) {
  const completed = Math.max(0, Number(stats.completedOrders) || 0);
  const repeatBuyers = Math.max(0, Number(stats.repeatBuyers) || 0);
  const paid = Math.max(completed, Number(stats.paidOrders) || 0);
  const refunds = Math.max(0, Number(stats.refunds) || 0);
  const disputes = Math.max(0, Number(stats.disputes) || 0);
  const fulfilledOnTime = Math.max(0, Number(stats.fulfilledOnTime) || 0);

  const refundRate = paid ? clamp01(refunds / paid) : 0;
  const disputeRate = paid ? clamp01(disputes / paid) : 0;
  const fulfillmentRate = completed ? clamp01(fulfilledOnTime / completed) : 0;
  const confidence = paid / (paid + 20);
  const volume = completed + repeatBuyers * 2;

  const score =
    confidence *
    volume *
    fulfillmentRate *
    (1 - refundRate) *
    (1 - Math.min(1, disputeRate * 2));

  return {
    score: Number(score.toFixed(6)),
    explanation: {
      sampleSize: paid,
      completedOrders: completed,
      repeatBuyers,
      confidence: Number(confidence.toFixed(6)),
      fulfillmentRate: Number(fulfillmentRate.toFixed(6)),
      refundRate: Number(refundRate.toFixed(6)),
      disputeRate: Number(disputeRate.toFixed(6)),
    },
  };
}
