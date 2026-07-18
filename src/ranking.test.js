import test from "node:test";
import assert from "node:assert/strict";
import { rankTradeStats } from "./ranking.js";

test("comments and views cannot influence ranking", () => {
  const base = {
    paidOrders: 100,
    completedOrders: 90,
    repeatBuyers: 20,
    fulfilledOnTime: 85,
    refunds: 5,
    disputes: 1,
  };
  assert.equal(
    rankTradeStats(base).score,
    rankTradeStats({ ...base, comments: 99999, pageViews: 999999 }).score,
  );
});

test("refunds and disputes reduce score", () => {
  const healthy = rankTradeStats({
    paidOrders: 50,
    completedOrders: 45,
    repeatBuyers: 10,
    fulfilledOnTime: 44,
    refunds: 1,
    disputes: 0,
  });
  const risky = rankTradeStats({
    paidOrders: 50,
    completedOrders: 45,
    repeatBuyers: 10,
    fulfilledOnTime: 44,
    refunds: 10,
    disputes: 8,
  });
  assert.ok(healthy.score > risky.score);
});

test("small samples are confidence-weighted", () => {
  const small = rankTradeStats({
    paidOrders: 1,
    completedOrders: 1,
    repeatBuyers: 1,
    fulfilledOnTime: 1,
  });
  const established = rankTradeStats({
    paidOrders: 40,
    completedOrders: 40,
    repeatBuyers: 20,
    fulfilledOnTime: 40,
  });
  assert.ok(established.score > small.score);
  assert.equal(small.explanation.sampleSize, 1);
});
