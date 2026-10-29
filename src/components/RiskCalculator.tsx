import React, { useState, useEffect } from 'react';
import { MarketType, RiskCalculation, TradeSetup } from '../types/crypto';
import { formatCryptoPrice } from '../utils/priceFormatter';
import { Calculator, ShieldAlert, AlertTriangle, ArrowRight, DollarSign, Percent, TrendingUp } from 'lucide-react';

interface RiskCalculatorProps {
  initialSetup?: TradeSetup | null;
  currentPrice: number;
  symbol: string;
}

export const RiskCalculator: React.FC<RiskCalculatorProps> = ({
  initialSetup,
  currentPrice,
  symbol,
}) => {
  const [accountBalance, setAccountBalance] = useState<number>(10000);
  const [riskPercent, setRiskPercent] = useState<number>(1.0);
  const [entryPrice, setEntryPrice] = useState<number>(currentPrice || 65000);
  const [stopLoss, setStopLoss] = useState<number>(currentPrice ? currentPrice * 0.98 : 63700);
  const [market, setMarket] = useState<MarketType>('futures');
  const [leverage, setLeverage] = useState<number>(5);
  const [feeRole, setFeeRole] = useState<'taker' | 'maker'>('taker');
  const [feeRatePercent, setFeeRatePercent] = useState<number>(0.04); // 0.04% taker futures
  const [slippagePercent, setSlippagePercent] = useState<number>(0.02); // 0.02% estimated slippage
  const [fundingRatePercent, setFundingRatePercent] = useState<number>(0.01); // 0.01% / 8h estimated perpetual funding

  // Sync when initialSetup changes
  useEffect(() => {
    if (initialSetup && initialSetup.direction !== 'NO_TRADE') {
      setEntryPrice(initialSetup.entryPrice);
      setStopLoss(initialSetup.stopLoss);
      setMarket(initialSetup.market);
      setRiskPercent(initialSetup.suggestedRiskPercent || 1.0);
      if (initialSetup.market === 'spot') {
        setFeeRatePercent(0.10);
      } else {
        setFeeRatePercent(feeRole === 'taker' ? 0.04 : 0.02);
      }
    } else if (currentPrice > 0 && (!entryPrice || entryPrice === 0)) {
      setEntryPrice(currentPrice);
      setStopLoss(currentPrice * 0.98);
    }
  }, [initialSetup, currentPrice]);

  // Handle market switch
  const handleMarketChange = (newMarket: MarketType) => {
    setMarket(newMarket);
    if (newMarket === 'spot') {
      setFeeRatePercent(0.10);
    } else {
      setFeeRatePercent(feeRole === 'taker' ? 0.04 : 0.02);
    }
  };

  // Handle fee role switch
  const handleFeeRoleChange = (newRole: 'taker' | 'maker') => {
    setFeeRole(newRole);
    if (market === 'futures') {
      setFeeRatePercent(newRole === 'taker' ? 0.04 : 0.02);
    } else {
      setFeeRatePercent(0.10);
    }
  };

  // Compute Risk Metrics
  const calculation: RiskCalculation = React.useMemo(() => {
    const monetaryRisk = (accountBalance * riskPercent) / 100;
    const priceDiff = Math.abs(entryPrice - stopLoss);
    const stopLossDistancePercent = entryPrice > 0 ? (priceDiff / entryPrice) * 100 : 0;

    // Position size in crypto units so that hitting Stop Loss loses exactly monetaryRisk (excluding fees)
    const positionSizeCrypto = priceDiff > 0 ? monetaryRisk / priceDiff : 0;
    const positionSizeUsd = positionSizeCrypto * entryPrice;

    // Futures Margin & Liquidation
    const marginRequiredUsd = market === 'futures' && leverage > 0 ? positionSizeUsd / leverage : positionSizeUsd;

    // Approximate liquidation price:
    // For Long: Entry * (1 - 1/leverage + maintenance_margin 0.5%)
    // For Short: Entry * (1 + 1/leverage - maintenance_margin 0.5%)
    let estLiquidationPrice: number | null = null;
    if (market === 'futures' && leverage > 1 && entryPrice > 0) {
      const isLong = entryPrice >= stopLoss;
      const mmr = 0.005; // 0.5% maintenance margin
      if (isLong) {
        estLiquidationPrice = entryPrice * (1 - 1 / leverage + mmr);
      } else {
        estLiquidationPrice = entryPrice * (1 + 1 / leverage - mmr);
      }
    }

    // Fees: Entry + Exit fee estimation (Round-trip)
    const estTotalFeesUsd = positionSizeUsd * (feeRatePercent / 100) * 2;
    // Slippage: Entry + Exit round-trip
    const estTotalSlippageUsd = positionSizeUsd * (slippagePercent / 100) * 2;
    // Funding: holding period friction (Futures perpetual)
    const estFundingUsd = market === 'futures' ? positionSizeUsd * (fundingRatePercent / 100) : 0;
    // Total friction
    const estTotalFrictionUsd = estTotalFeesUsd + estTotalSlippageUsd + estFundingUsd;

    return {
      accountBalance,
      riskPercent,
      entryPrice,
      stopLoss,
      market,
      leverage,
      feeRatePercent,
      slippagePercent,
      fundingRatePercent,
      monetaryRisk,
      stopLossDistancePercent,
      positionSizeCrypto,
      positionSizeUsd,
      marginRequiredUsd,
      estLiquidationPrice,
      estTotalFeesUsd,
      estTotalFrictionUsd,
    };
  }, [accountBalance, riskPercent, entryPrice, stopLoss, market, leverage, feeRatePercent, slippagePercent, fundingRatePercent]);

  const isLiquidationBeforeStopLoss =
    calculation.estLiquidationPrice !== null &&
    ((entryPrice >= stopLoss && calculation.estLiquidationPrice >= stopLoss) ||
      (entryPrice <= stopLoss && calculation.estLiquidationPrice <= stopLoss));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Calculator className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              Calculateur de Risque & Dimensionnement de Position
            </h3>
            <p className="text-xs text-slate-400">
              Calcule la taille de position exacte pour ne jamais dépasser votre tolérance au risque.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          <button
            onClick={() => handleMarketChange('spot')}
            className={`px-3 py-1 rounded font-medium transition-colors ${
              market === 'spot' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Spot (Sans levier)
          </button>
          <button
            onClick={() => handleMarketChange('futures')}
            className={`px-3 py-1 rounded font-medium transition-colors ${
              market === 'futures' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Futures (USDT-M)
          </button>
        </div>
      </div>

      {/* Inputs Form */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        <div>
          <label className="block text-slate-300 font-medium mb-1">
            Capital du Compte ($)
          </label>
          <div className="relative">
            <DollarSign className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="number"
              value={accountBalance}
              onChange={(e) => setAccountBalance(Math.max(parseFloat(e.target.value) || 0, 10))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-slate-100 font-mono focus:border-blue-500 focus:outline-hidden"
            />
          </div>
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">
            Risque Maximal par Trade (%)
          </label>
          <div className="relative">
            <Percent className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="10"
              value={riskPercent}
              onChange={(e) => setRiskPercent(Math.max(parseFloat(e.target.value) || 0.1, 0.1))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-slate-100 font-mono focus:border-blue-500 focus:outline-hidden"
            />
          </div>
          <div className="flex gap-1 mt-1 text-[10px] text-slate-400">
            {[0.5, 1.0, 1.5, 2.0].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRiskPercent(r)}
                className={`px-1.5 py-0.5 rounded border ${
                  riskPercent === r ? 'bg-blue-900 border-blue-500 text-blue-200' : 'border-slate-800 hover:bg-slate-800'
                }`}
              >
                {r}%
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">
            Prix d'Entrée ($)
          </label>
          <input
            type="number"
            step="any"
            value={entryPrice}
            onChange={(e) => setEntryPrice(parseFloat(e.target.value) || 0)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:border-blue-500 focus:outline-hidden"
          />
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">
            Prix du Stop Loss ($)
          </label>
          <input
            type="number"
            step="any"
            value={stopLoss}
            onChange={(e) => setStopLoss(parseFloat(e.target.value) || 0)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-rose-300 font-mono focus:border-rose-500 focus:outline-hidden"
          />
        </div>
      </div>

      {/* Execution Cost Settings (Maker/Taker, Slippage, Funding) */}
      <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-2">
          <span className="font-semibold text-slate-200 flex items-center gap-1.5">
            Paramètres d'Exécution & Frottements Financiers
          </span>
          <span className="text-[10px] text-amber-400 font-medium">
            * Estimation indicative non garantie
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-300 font-medium">Frais Courtage ({feeRole})</label>
              <div className="flex gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => handleFeeRoleChange('taker')}
                  className={`px-1.5 py-0.5 rounded border ${
                    feeRole === 'taker' ? 'bg-blue-600 text-white border-blue-500' : 'border-slate-800 text-slate-400'
                  }`}
                >
                  Taker
                </button>
                <button
                  type="button"
                  onClick={() => handleFeeRoleChange('maker')}
                  className={`px-1.5 py-0.5 rounded border ${
                    feeRole === 'maker' ? 'bg-blue-600 text-white border-blue-500' : 'border-slate-800 text-slate-400'
                  }`}
                >
                  Maker
                </button>
              </div>
            </div>
            <input
              type="number"
              step="0.01"
              value={feeRatePercent}
              onChange={(e) => setFeeRatePercent(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono text-xs focus:border-blue-500 focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Slippage Estimé (%)
            </label>
            <input
              type="number"
              step="0.01"
              value={slippagePercent}
              onChange={(e) => setSlippagePercent(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono text-xs focus:border-blue-500 focus:outline-hidden"
            />
          </div>

          {market === 'futures' ? (
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Financement Perpétuel (% / 8h)
              </label>
              <input
                type="number"
                step="0.005"
                value={fundingRatePercent}
                onChange={(e) => setFundingRatePercent(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono text-xs focus:border-blue-500 focus:outline-hidden"
              />
            </div>
          ) : (
            <div className="text-slate-500 flex items-center pt-5">
              <span>Pas de frais de financement sur Spot</span>
            </div>
          )}
        </div>
      </div>

      {/* Futures leverage slider */}
      {market === 'futures' && (
        <div className="pt-1 text-xs">
          <div className="flex items-center justify-between mb-1">
            <label className="text-slate-300 font-medium">
              Effet de Levier ({leverage}x)
            </label>
            <span className="text-[11px] text-slate-400">
              Marge requise : {calculation.marginRequiredUsd.toFixed(2)}$
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="50"
            value={leverage}
            onChange={(e) => setLeverage(parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
            <span>1x</span>
            <span>5x</span>
            <span>10x</span>
            <span>20x</span>
            <span>50x</span>
          </div>
        </div>
      )}

      {/* Liquidation warning */}
      {isLiquidationBeforeStopLoss && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-xl flex items-start gap-2.5 text-xs text-rose-200">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Alerte Critique de Liquidation :</span> Le prix de liquidation estimé ({calculation.estLiquidationPrice !== null ? formatCryptoPrice(calculation.estLiquidationPrice, initialSetup?.tickSize) : 'N/A'}$)&nbsp;est atteint AVANT votre Stop Loss ({formatCryptoPrice(stopLoss, initialSetup?.tickSize)}$) en raison d'un levier excessif ({leverage}x). Réduisez immédiatement le levier !
          </div>
        </div>
      )}

      {/* Calculated Results Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Risque Monétaire Max</span>
          <div className="text-base font-mono font-bold text-slate-100 mt-0.5">
            {calculation.monetaryRisk.toFixed(2)} $
          </div>
          <span className="text-[10px] text-slate-500">
            {calculation.riskPercent}% du capital
          </span>
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Taille de Position</span>
          <div className="text-base font-mono font-bold text-blue-400 mt-0.5">
            {calculation.positionSizeCrypto >= 100
              ? calculation.positionSizeCrypto.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
              : calculation.positionSizeCrypto >= 1
              ? calculation.positionSizeCrypto.toFixed(4)
              : calculation.positionSizeCrypto.toFixed(6)}{' '}
            {symbol.replace('USDT', '')}
          </div>
          <span className="text-[10px] text-slate-500">
            Valeur nominale : {calculation.positionSizeUsd.toFixed(2)}$
          </span>
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Distance au Stop Loss</span>
          <div className="text-base font-mono font-bold text-rose-400 mt-0.5">
            {calculation.stopLossDistancePercent.toFixed(2)} %
          </div>
          <span className="text-[10px] text-slate-500">
            {formatCryptoPrice(Math.abs(entryPrice - stopLoss), initialSetup?.tickSize)}$ de spread
          </span>
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">
            {market === 'futures' ? 'Prix Liq. & Frottements' : 'Frais + Slippage Estimés'}
          </span>
          <div className="text-base font-mono font-bold text-amber-400 mt-0.5">
            {market === 'futures' && calculation.estLiquidationPrice !== null
              ? `${formatCryptoPrice(calculation.estLiquidationPrice, initialSetup?.tickSize)}$`
              : `~${(calculation.estTotalFrictionUsd || calculation.estTotalFeesUsd).toFixed(2)}$`}
          </div>
          <span className="text-[10px] text-slate-500">
            Frottements A/R: ~{(calculation.estTotalFrictionUsd || calculation.estTotalFeesUsd).toFixed(2)}$
          </span>
        </div>
      </div>

      {/* Target Profit Projections (TP1, TP2, TP3) */}
      {(initialSetup?.takeProfit1 || initialSetup?.takeProfit2 || initialSetup?.takeProfit3) && calculation.positionSizeCrypto > 0 && (
        <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 uppercase tracking-wide flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Projections Financières sur Objectifs (TP1, TP2, TP3)
            </span>
            <span className="text-[11px] text-slate-400">
              Gains nets calculés après déduction des frais, slippage et funding estimés
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            {/* TP1 */}
            {initialSetup?.takeProfit1 && (
              <div className="p-3 bg-slate-900/90 border border-emerald-950 rounded-lg">
                <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
                  <span className="font-semibold text-emerald-400">Objectif TP1</span>
                  <span className="font-mono text-slate-300">{formatCryptoPrice(initialSetup.takeProfit1, initialSetup.tickSize)}$</span>
                </div>
                {(() => {
                  const grossGain = calculation.positionSizeCrypto * Math.abs(initialSetup.takeProfit1 - entryPrice);
                  const entryFriction = calculation.positionSizeUsd * ((feeRatePercent + slippagePercent) / 100);
                  const exitFriction = (calculation.positionSizeCrypto * initialSetup.takeProfit1) * ((feeRatePercent + slippagePercent) / 100);
                  const fundingCost = market === 'futures' ? calculation.positionSizeUsd * (fundingRatePercent / 100) : 0;
                  const totalFriction = entryFriction + exitFriction + fundingCost;
                  const netGain = Math.max(0, grossGain - totalFriction);
                  const netRR = calculation.monetaryRisk > 0 ? (netGain / calculation.monetaryRisk) : 0;
                  return (
                    <div className="space-y-1">
                      <div className="text-base font-mono font-bold text-emerald-400">
                        +{netGain.toFixed(2)} $ <span className="text-xs font-normal text-slate-400">net</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>Gain brut: +{grossGain.toFixed(2)}$</span>
                        <span className="text-emerald-400 font-semibold">R/R Net: {netRR.toFixed(2)}:1</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TP2 */}
            {initialSetup?.takeProfit2 && (
              <div className="p-3 bg-slate-900/90 border border-emerald-950 rounded-lg">
                <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
                  <span className="font-semibold text-emerald-400">Objectif TP2</span>
                  <span className="font-mono text-slate-300">{formatCryptoPrice(initialSetup.takeProfit2, initialSetup.tickSize)}$</span>
                </div>
                {(() => {
                  const grossGain = calculation.positionSizeCrypto * Math.abs(initialSetup.takeProfit2 - entryPrice);
                  const entryFriction = calculation.positionSizeUsd * ((feeRatePercent + slippagePercent) / 100);
                  const exitFriction = (calculation.positionSizeCrypto * initialSetup.takeProfit2) * ((feeRatePercent + slippagePercent) / 100);
                  const fundingCost = market === 'futures' ? calculation.positionSizeUsd * (fundingRatePercent / 100) : 0;
                  const totalFriction = entryFriction + exitFriction + fundingCost;
                  const netGain = Math.max(0, grossGain - totalFriction);
                  const netRR = calculation.monetaryRisk > 0 ? (netGain / calculation.monetaryRisk) : 0;
                  return (
                    <div className="space-y-1">
                      <div className="text-base font-mono font-bold text-emerald-400">
                        +{netGain.toFixed(2)} $ <span className="text-xs font-normal text-slate-400">net</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>Gain brut: +{grossGain.toFixed(2)}$</span>
                        <span className="text-emerald-400 font-semibold">R/R Net: {netRR.toFixed(2)}:1</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TP3 */}
            {initialSetup?.takeProfit3 && (
              <div className="p-3 bg-slate-900/90 border border-emerald-950 rounded-lg">
                <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
                  <span className="font-semibold text-emerald-400">Objectif TP3</span>
                  <span className="font-mono text-slate-300">{formatCryptoPrice(initialSetup.takeProfit3, initialSetup.tickSize)}$</span>
                </div>
                {(() => {
                  const grossGain = calculation.positionSizeCrypto * Math.abs(initialSetup.takeProfit3 - entryPrice);
                  const entryFriction = calculation.positionSizeUsd * ((feeRatePercent + slippagePercent) / 100);
                  const exitFriction = (calculation.positionSizeCrypto * initialSetup.takeProfit3) * ((feeRatePercent + slippagePercent) / 100);
                  const fundingCost = market === 'futures' ? calculation.positionSizeUsd * (fundingRatePercent / 100) : 0;
                  const totalFriction = entryFriction + exitFriction + fundingCost;
                  const netGain = Math.max(0, grossGain - totalFriction);
                  const netRR = calculation.monetaryRisk > 0 ? (netGain / calculation.monetaryRisk) : 0;
                  return (
                    <div className="space-y-1">
                      <div className="text-base font-mono font-bold text-emerald-400">
                        +{netGain.toFixed(2)} $ <span className="text-xs font-normal text-slate-400">net</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>Gain brut: +{grossGain.toFixed(2)}$</span>
                        <span className="text-emerald-400 font-semibold">R/R Net: {netRR.toFixed(2)}:1</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rigorous Education Notice */}
      <div className="p-3.5 bg-slate-950/50 border border-slate-800/80 rounded-xl flex items-start gap-3 text-[11px] text-slate-400 leading-relaxed">
        <ShieldAlert className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <strong className="text-slate-300">Rappel fondamental de gestion du risque :</strong> L’effet de levier modifie uniquement l’exigence de marge et le risque de liquidation forcée, mais n'élimine ni ne diminue le risque intrinsèque du trade. Ne jamais augmenter le levier pour compenser une perte précédente. Crypto Edge AI n'exécute aucun ordre automatique.
        </div>
      </div>
    </div>
  );
};
