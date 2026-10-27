import React, { useState, useMemo } from 'react';
import { Candle, BacktestSummary, BacktestTrade, Timeframe } from '../types/crypto';
import {
  BarChart3,
  TrendingUp,
  Percent,
  Layers,
  Award,
  AlertCircle,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface BacktestModuleProps {
  candles: Candle[];
  symbol: string;
}

export const BacktestModule: React.FC<BacktestModuleProps> = ({ candles, symbol }) => {
  const [strategy, setStrategy] = useState<'SMC_OB_FVG' | 'BOS_MOMENTUM' | 'LIQUIDITY_SWEEP'>('SMC_OB_FVG');
  const [targetRRR, setTargetRRR] = useState<number>(2.0);
  const [simulatedTimeframe, setSimulatedTimeframe] = useState<Timeframe>('1h');
  const [feeRate, setFeeRate] = useState<number>(0.05); // 0.05% slippage + exchange fees per trade
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // Backtest calculation engine
  const summary: BacktestSummary = useMemo(() => {
    if (!candles || candles.length < 30) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        profitFactor: 0,
        avgWinPercent: 0,
        avgLossPercent: 0,
        maxDrawdownPercent: 0,
        grossReturnPercent: 0,
        netReturnPercent: 0,
        totalFeesPaidPercent: 0,
        equityCurve: [{ tradeIndex: 0, equity: 10000 }],
        regimeBreakdown: {},
      };
    }

    const trades: BacktestTrade[] = [];
    let equity = 10000;
    const equityCurve = [{ tradeIndex: 0, equity }];
    let peakEquity = equity;
    let maxDrawdown = 0;

    // Sequential walk-forward simulation without look-ahead bias
    // Step through candles with window size
    const lookback = 20;
    for (let i = lookback; i < candles.length - 8; i += 2) {
      const pastSlice = candles.slice(i - lookback, i);
      const triggerCandle = pastSlice[pastSlice.length - 1];
      const prevCandle = pastSlice[pastSlice.length - 2];

      let signal: 'LONG' | 'SHORT' | null = null;
      let entryPrice = triggerCandle.close;
      let slDistance = triggerCandle.close * 0.015; // 1.5% SL

      // Strategy Rules
      if (strategy === 'SMC_OB_FVG') {
        // Bullish OB retest: price touches lower boundary of recent down-candle
        const isUp = triggerCandle.close > triggerCandle.open;
        const priorLow = Math.min(...pastSlice.slice(-8, -2).map((c) => c.low));
        if (isUp && triggerCandle.low <= priorLow * 1.002) {
          signal = 'LONG';
          slDistance = Math.max(triggerCandle.close - triggerCandle.low, triggerCandle.close * 0.012);
        } else if (!isUp && triggerCandle.high >= Math.max(...pastSlice.slice(-8, -2).map((c) => c.high)) * 0.998) {
          signal = 'SHORT';
          slDistance = Math.max(triggerCandle.high - triggerCandle.close, triggerCandle.close * 0.012);
        }
      } else if (strategy === 'BOS_MOMENTUM') {
        const highestHigh = Math.max(...pastSlice.slice(0, -3).map((c) => c.high));
        const lowestLow = Math.min(...pastSlice.slice(0, -3).map((c) => c.low));
        if (triggerCandle.close > highestHigh) {
          signal = 'LONG';
          slDistance = triggerCandle.close * 0.018;
        } else if (triggerCandle.close < lowestLow) {
          signal = 'SHORT';
          slDistance = triggerCandle.close * 0.018;
        }
      } else {
        // LIQUIDITY SWEEP: wick sweeps past low/high then closes back inside
        const priorHigh = Math.max(...pastSlice.slice(0, -2).map((c) => c.high));
        const priorLow = Math.min(...pastSlice.slice(0, -2).map((c) => c.low));
        if (triggerCandle.high > priorHigh && triggerCandle.close < priorHigh) {
          signal = 'SHORT';
          slDistance = (triggerCandle.high - triggerCandle.close) + triggerCandle.close * 0.003;
        } else if (triggerCandle.low < priorLow && triggerCandle.close > priorLow) {
          signal = 'LONG';
          slDistance = (triggerCandle.close - triggerCandle.low) + triggerCandle.close * 0.003;
        }
      }

      if (!signal) continue;

      const stopLoss = signal === 'LONG' ? entryPrice - slDistance : entryPrice + slDistance;
      const targetGain = slDistance * targetRRR;
      const takeProfit = signal === 'LONG' ? entryPrice + targetGain : entryPrice - targetGain;

      // Determine market regime
      const emaStart = pastSlice[0].close;
      const emaEnd = pastSlice[pastSlice.length - 1].close;
      const regime =
        emaEnd > emaStart * 1.02 ? 'HAUSSIER' : emaEnd < emaStart * 0.98 ? 'BAISSIER' : 'RANGE';

      // Forward evaluation on upcoming candles
      const forwardSlice = candles.slice(i, i + 8);
      let tradeResult: 'WIN' | 'LOSS' = 'LOSS';
      let exitPrice = stopLoss;

      for (const fc of forwardSlice) {
        if (signal === 'LONG') {
          if (fc.high >= takeProfit) {
            tradeResult = 'WIN';
            exitPrice = takeProfit;
            break;
          }
          if (fc.low <= stopLoss) {
            tradeResult = 'LOSS';
            exitPrice = stopLoss;
            break;
          }
        } else {
          if (fc.low <= takeProfit) {
            tradeResult = 'WIN';
            exitPrice = takeProfit;
            break;
          }
          if (fc.high >= stopLoss) {
            tradeResult = 'LOSS';
            exitPrice = stopLoss;
            break;
          }
        }
      }

      const grossPnl = tradeResult === 'WIN' ? targetGain : -slDistance;
      const grossPnlPercent = (grossPnl / entryPrice) * 100;
      const netPnlPercent = grossPnlPercent - feeRate * 2; // Entry + exit fees
      const dollarImpact = (equity * 0.01 * (netPnlPercent / (slDistance / entryPrice * 100)));

      equity += dollarImpact;
      if (equity > peakEquity) peakEquity = equity;
      const currentDD = ((peakEquity - equity) / peakEquity) * 100;
      if (currentDD > maxDrawdown) maxDrawdown = currentDD;

      trades.push({
        id: `trade-${trades.length + 1}`,
        date: new Date(triggerCandle.time).toLocaleDateString('fr-FR'),
        type: signal,
        entryPrice,
        exitPrice,
        result: tradeResult,
        pnlPercent: grossPnlPercent,
        rrrRealized: tradeResult === 'WIN' ? targetRRR : -1.0,
        feesPaid: feeRate * 2,
        netPnlPercent,
        timeframe: simulatedTimeframe,
        marketRegime: regime,
      });

      equityCurve.push({
        tradeIndex: trades.length,
        equity: Math.round(equity),
      });
    }

    const totalTrades = trades.length;
    const winningTrades = trades.filter((t) => t.result === 'WIN').length;
    const losingTrades = totalTrades - winningTrades;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const winSum = trades.filter((t) => t.result === 'WIN').reduce((acc, t) => acc + t.netPnlPercent, 0);
    const lossSum = Math.abs(trades.filter((t) => t.result === 'LOSS').reduce((acc, t) => acc + t.netPnlPercent, 0));

    const avgWinPercent = winningTrades > 0 ? winSum / winningTrades : 0;
    const avgLossPercent = losingTrades > 0 ? lossSum / losingTrades : 0;
    const profitFactor = lossSum > 0 ? parseFloat((winSum / lossSum).toFixed(2)) : winSum > 0 ? 99 : 0;

    const netReturnPercent = ((equity - 10000) / 10000) * 100;
    const grossReturnPercent = netReturnPercent + totalTrades * feeRate * 2;

    // Regime breakdown
    const regimeBreakdown: Record<string, { trades: number; winRate: number; pnl: number }> = {};
    ['HAUSSIER', 'BAISSIER', 'RANGE'].forEach((reg) => {
      const regTrades = trades.filter((t) => t.marketRegime === reg);
      const regWins = regTrades.filter((t) => t.result === 'WIN').length;
      regimeBreakdown[reg] = {
        trades: regTrades.length,
        winRate: regTrades.length > 0 ? (regWins / regTrades.length) * 100 : 0,
        pnl: regTrades.reduce((acc, t) => acc + t.netPnlPercent, 0),
      };
    });

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      profitFactor,
      avgWinPercent,
      avgLossPercent,
      maxDrawdownPercent: maxDrawdown,
      grossReturnPercent,
      netReturnPercent,
      totalFeesPaidPercent: totalTrades * feeRate * 2,
      equityCurve,
      regimeBreakdown,
    };
  }, [candles, strategy, targetRRR, simulatedTimeframe, feeRate]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              Backtesting & Validation Statistique Rétrospective
            </h3>
            <p className="text-xs text-slate-400">
              Modélisation quantitative sans biais temporel prospectif (No Look-ahead Bias) sur l'historique {symbol}.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-400">
            Échantillon : {candles.length} bougies analysées
          </span>
        </div>
      </div>

      {/* Configuration Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div>
          <label className="block text-slate-300 font-medium mb-1">
            Stratégie Testée :
          </label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as any)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-hidden focus:border-blue-500"
          >
            <option value="SMC_OB_FVG">SMC : Re-test Order Block & FVG</option>
            <option value="BOS_MOMENTUM">Cassure de Structure (BOS Momentum)</option>
            <option value="LIQUIDITY_SWEEP">Chasse aux Liquidités (Sweep Reversal)</option>
          </select>
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">
            Ratio R/R Cible :
          </label>
          <select
            value={targetRRR}
            onChange={(e) => setTargetRRR(parseFloat(e.target.value))}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-hidden focus:border-blue-500"
          >
            <option value="1.5">1.5 : 1 (Conservateur)</option>
            <option value="2.0">2.0 : 1 (Standard SMC)</option>
            <option value="2.5">2.5 : 1 (Asymétrique)</option>
            <option value="3.0">3.0 : 1 (Haute extension)</option>
          </select>
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">
            Unité de Temps :
          </label>
          <select
            value={simulatedTimeframe}
            onChange={(e) => setSimulatedTimeframe(e.target.value as Timeframe)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-hidden focus:border-blue-500"
          >
            <option value="15m">15 Minutes (15M)</option>
            <option value="1h">1 Heure (1H)</option>
            <option value="4h">4 Heures (4H)</option>
          </select>
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">
            Frais + Slippage par Ordre :
          </label>
          <input
            type="number"
            step="0.01"
            value={feeRate}
            onChange={(e) => setFeeRate(Math.max(parseFloat(e.target.value) || 0.01, 0))}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-hidden focus:border-blue-500"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Trades Simulés</span>
          <div className="text-lg font-mono font-bold text-slate-100 mt-0.5">
            {summary.totalTrades}
          </div>
          <span className="text-[10px] text-slate-500">
            {summary.winningTrades} W / {summary.losingTrades} L
          </span>
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Taux de Réussite</span>
          <div className={`text-lg font-mono font-bold mt-0.5 ${summary.winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {summary.winRate.toFixed(1)} %
          </div>
          <span className="text-[10px] text-slate-500">
            Win Rate net
          </span>
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Facteur de Profit</span>
          <div className={`text-lg font-mono font-bold mt-0.5 ${summary.profitFactor >= 1.5 ? 'text-emerald-400' : 'text-slate-200'}`}>
            {summary.profitFactor.toFixed(2)}
          </div>
          <span className="text-[10px] text-slate-500">
            Gains / Pertes
          </span>
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Drawdown Max</span>
          <div className="text-lg font-mono font-bold text-rose-400 mt-0.5">
            -{summary.maxDrawdownPercent.toFixed(2)} %
          </div>
          <span className="text-[10px] text-slate-500">
            Pire repli
          </span>
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Gain Net Après Frais</span>
          <div className={`text-lg font-mono font-bold mt-0.5 ${summary.netReturnPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {summary.netReturnPercent >= 0 ? '+' : ''}{summary.netReturnPercent.toFixed(2)} %
          </div>
          <span className="text-[10px] text-slate-500">
            Frais déduits : {summary.totalFeesPaidPercent.toFixed(2)}%
          </span>
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Gain Moyen / Perte</span>
          <div className="text-sm font-mono font-bold text-slate-200 mt-1">
            <span className="text-emerald-400">+{summary.avgWinPercent.toFixed(1)}%</span> / <span className="text-rose-400">-{summary.avgLossPercent.toFixed(1)}%</span>
          </div>
          <span className="text-[10px] text-slate-500">
            Par trade
          </span>
        </div>
      </div>

      {/* Performance by Market Regime Breakdown */}
      <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl space-y-3">
        <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wide flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-blue-400" />
          Performance par Régime de Marché
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          {Object.entries(summary.regimeBreakdown).map(([regime, data]) => (
            <div key={regime} className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
              <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                <span className="font-semibold text-slate-300">Régime {regime}</span>
                <span className="font-mono text-[11px] text-slate-400">{data.trades} trades</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-slate-400 text-[11px]">Taux de réussite :</span>
                <span className="font-mono font-semibold text-slate-200">{data.winRate.toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-slate-400 text-[11px]">P&L cumulé :</span>
                <span className={`font-mono font-semibold ${data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {data.pnl >= 0 ? '+' : ''}{data.pnl.toFixed(2)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notice */}
      <div className="p-3 bg-slate-950/40 border border-slate-800 text-[11px] text-slate-400 rounded-xl leading-relaxed">
        <span className="text-amber-400 font-semibold">Distinction impérative :</span> Les résultats de backtest sont des simulations mathématiques sur données passées. Ils ne préjugent en rien des conditions de liquidité et des performances futures en trading réel.
      </div>
    </div>
  );
};
