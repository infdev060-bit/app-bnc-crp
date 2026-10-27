import React from 'react';
import { TradeSetup, QualityScore, VerificationCheck } from '../types/crypto';
import { formatCryptoPrice } from '../utils/priceFormatter';
import {
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  CheckCircle,
  XCircle,
  Copy,
  Calculator,
  BookmarkPlus,
  Info,
  Sliders,
  Sparkles,
} from 'lucide-react';

interface TradeSetupCardProps {
  outcome: 'LONG' | 'SHORT' | 'NO_TRADE';
  setup?: TradeSetup;
  qualityScore: QualityScore;
  checklist: VerificationCheck[];
  noTradeReasons: string[];
  executiveSummary: string;
  onApplyToCalculator?: (setup: TradeSetup) => void;
  onSaveToHistory?: () => void;
  onRunAiAudit?: () => void;
  isAiVerifying?: boolean;
  aiRateLimited?: boolean;
  isAiAudited?: boolean;
}

export const TradeSetupCard: React.FC<TradeSetupCardProps> = ({
  outcome,
  setup,
  qualityScore,
  checklist,
  noTradeReasons,
  executiveSummary,
  onApplyToCalculator,
  onSaveToHistory,
  onRunAiAudit,
  isAiVerifying,
  aiRateLimited,
  isAiAudited,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [showChecklistDetails, setShowChecklistDetails] = React.useState(false);

  const handleCopy = () => {
    if (!setup) return;
    const text = `=== CRYPTO EDGE AI - PLAN DE TRADE ===
Actif: ${setup.pair} (${setup.market === 'futures' ? 'Binance Futures' : 'Binance Spot'})
Sens: ${setup.direction}
Zone d'Entrée: ${setup.entryZone} (Réf: ${formatCryptoPrice(setup.entryPrice, setup.tickSize)}$)
Stop Loss: ${formatCryptoPrice(setup.stopLoss, setup.tickSize)}$ (Invalidation: ${setup.invalidationCondition})
Objectif 1 (TP1): ${formatCryptoPrice(setup.takeProfit1, setup.tickSize)}$ (R/R Brut: ${setup.riskRewardRatioTP1}:1 | Net: ${setup.netRiskRewardRatioTP1 ?? setup.riskRewardRatioTP1}:1)
Objectif 2 (TP2): ${formatCryptoPrice(setup.takeProfit2, setup.tickSize)}$ (R/R Brut: ${setup.riskRewardRatioTP2}:1 | Net: ${setup.netRiskRewardRatioTP2 ?? setup.riskRewardRatioTP2}:1)
${setup.takeProfit3 ? `Objectif 3 (TP3): ${formatCryptoPrice(setup.takeProfit3, setup.tickSize)}$ (R/R Brut: ${setup.riskRewardRatioTP3 ?? (setup.riskRewardRatioTP2 * 1.5).toFixed(2)}:1 | Net: ${setup.netRiskRewardRatioTP3 ?? setup.netRiskRewardRatioTP2 ?? setup.riskRewardRatioTP3}:1)\n` : ''}Risque suggéré: ${setup.suggestedRiskPercent}% du capital
Score de Qualité: ${qualityScore.total}/100 (${qualityScore.ratingLabel})
=======================================`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Header Banner based on outcome */}
      <div
        className={`px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3 ${
          outcome === 'LONG'
            ? 'bg-emerald-950/70 border-emerald-800 text-emerald-300'
            : outcome === 'SHORT'
            ? 'bg-rose-950/70 border-rose-800 text-rose-300'
            : 'bg-amber-950/60 border-amber-800 text-amber-300'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-md ${
              outcome === 'LONG'
                ? 'bg-emerald-600 text-white'
                : outcome === 'SHORT'
                ? 'bg-rose-600 text-white'
                : 'bg-amber-600 text-white'
            }`}
          >
            {outcome === 'LONG' ? (
              <TrendingUp className="w-6 h-6" />
            ) : outcome === 'SHORT' ? (
              <TrendingDown className="w-6 h-6" />
            ) : (
              <ShieldAlert className="w-6 h-6" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300">
                Verdict du Modèle
              </span>
              <span className="text-xs px-2 py-0.5 rounded font-mono font-bold bg-slate-900/80 border border-current">
                {outcome === 'LONG'
                  ? 'CONFIGURATION ACHAT (LONG)'
                  : outcome === 'SHORT'
                  ? 'CONFIGURATION VENTE (SHORT)'
                  : 'AUCUN TRADE RECOMMANDÉ (NO TRADE)'}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5 font-medium">
              {executiveSummary}
            </p>
          </div>
        </div>

        {/* Quality Score Badge */}
        <div className="flex items-center gap-3 bg-slate-950/70 px-3.5 py-2 rounded-xl border border-slate-800">
          <div className="text-right">
            <div className="text-[10px] text-slate-400 font-medium uppercase">
              Score de Qualité
            </div>
            <div className="text-xs font-semibold text-slate-200">
              {qualityScore.ratingLabel}
            </div>
          </div>
          <div
            className={`text-2xl font-black font-mono px-2.5 py-1 rounded-lg ${
              qualityScore.total >= 75
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : qualityScore.total >= 60
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
            }`}
          >
            {qualityScore.total}
            <span className="text-xs font-normal text-slate-400">/100</span>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Quota rate-limit indicator */}
        {aiRateLimited && (
          <div className="p-3 bg-blue-950/30 border border-blue-800/60 rounded-xl flex items-start gap-2.5 text-xs text-blue-200">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-100">Moteur Algorithmique Local Actif :</span> Le quota journalier de requêtes de l'API Gemini (20 req/jour sur Free Tier) est temporairement atteint. Toutes les analyses techniques (SMC, indicateurs MTF, ratios R/R bruts/nets, et gestion du risque) restent 100% opérationnelles en direct grâce au moteur local.
            </div>
          </div>
        )}

        {/* If NO TRADE, Show clear reasons & failed checks */}
        {outcome === 'NO_TRADE' ? (
          <div className="space-y-4">
            <div className="p-4 bg-amber-950/20 border border-amber-900/60 rounded-xl space-y-2">
              <h4 className="text-xs font-semibold text-amber-300 flex items-center gap-2 uppercase tracking-wide">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                Critères d’invalidation ou de non-conformité :
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                {noTradeReasons.map((reason, index) => (
                  <li key={index} className="leading-relaxed">
                    <span className="text-amber-200 font-medium">{reason}</span>
                  </li>
                ))}
              </ul>
              <div className="pt-2 text-[11px] text-slate-400 italic">
                Règle Crypto Edge AI : Ne jamais forcer un trade. En l'absence d'un avantage statistique net et d'un ratio favorable, l'abstention protège votre capital.
              </div>
            </div>
          </div>
        ) : setup ? (
          /* Active Validated Trade Setup Details */
          <div className="space-y-5">
            {/* Price Levels Grid */}
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${setup.takeProfit3 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-3`}>
              {/* Entry */}
              <div className="p-3.5 bg-slate-950/70 border border-blue-900/60 rounded-xl">
                <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wide">
                  Zone d'Entrée
                </span>
                <div className="text-lg font-mono font-bold text-slate-100 mt-1">
                  {formatCryptoPrice(setup.entryPrice, setup.tickSize)}$
                </div>
                <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate" title={`Zone : ${setup.entryZone}`}>
                  Zone : {setup.entryZone}
                </div>
              </div>

              {/* Stop Loss */}
              <div className="p-3.5 bg-slate-950/70 border border-rose-900/60 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-rose-400 uppercase tracking-wide">
                    Stop Loss (SL)
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800 font-mono">
                    {setup.riskPercent !== undefined
                      ? `-${setup.riskPercent.toFixed(2)}%`
                      : outcome === 'LONG'
                      ? `-${(((setup.entryPrice - setup.stopLoss) / setup.entryPrice) * 100).toFixed(2)}%`
                      : `-${(((setup.stopLoss - setup.entryPrice) / setup.entryPrice) * 100).toFixed(2)}%`}
                  </span>
                </div>
                <div className="text-lg font-mono font-bold text-rose-300 mt-1">
                  {formatCryptoPrice(setup.stopLoss, setup.tickSize)}$
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate" title={setup.invalidationCondition}>
                  Invalidation structurelle
                </div>
              </div>

              {/* TP1 */}
              <div className="p-3.5 bg-slate-950/70 border border-emerald-900/60 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">
                    Take Profit 1 (TP1)
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800" title="Ratio brut (gain potentiel / risque)">
                    Brut {setup.riskRewardRatioTP1}:1
                  </span>
                </div>
                <div className="text-lg font-mono font-bold text-emerald-300 mt-1">
                  {formatCryptoPrice(setup.takeProfit1, setup.tickSize)}$
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono mt-0.5 text-slate-400">
                  <span>
                    +{setup.grossGainPercentTP1 !== undefined
                      ? setup.grossGainPercentTP1.toFixed(2)
                      : (((Math.abs(setup.takeProfit1 - setup.entryPrice)) / setup.entryPrice) * 100).toFixed(2)}%
                  </span>
                  {setup.netRiskRewardRatioTP1 !== undefined && (
                    <span className="text-emerald-400 font-semibold" title="Ratio net après déduction des frais de courtage et slippage">
                      Net: {setup.netRiskRewardRatioTP1}:1
                    </span>
                  )}
                </div>
              </div>

              {/* TP2 */}
              <div className="p-3.5 bg-slate-950/70 border border-emerald-900/40 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">
                    Take Profit 2 (TP2)
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800" title="Ratio brut">
                    Brut {setup.riskRewardRatioTP2}:1
                  </span>
                </div>
                <div className="text-lg font-mono font-bold text-emerald-300 mt-1">
                  {formatCryptoPrice(setup.takeProfit2, setup.tickSize)}$
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono mt-0.5 text-slate-400">
                  <span>
                    +{setup.grossGainPercentTP2 !== undefined
                      ? setup.grossGainPercentTP2.toFixed(2)
                      : (((Math.abs(setup.takeProfit2 - setup.entryPrice)) / setup.entryPrice) * 100).toFixed(2)}%
                  </span>
                  {setup.netRiskRewardRatioTP2 !== undefined && (
                    <span className="text-emerald-400 font-semibold" title="Ratio net après déduction des frais de courtage et slippage">
                      Net: {setup.netRiskRewardRatioTP2}:1
                    </span>
                  )}
                </div>
              </div>

              {/* TP3 if present */}
              {setup.takeProfit3 !== undefined && (
                <div className="p-3.5 bg-slate-950/70 border border-emerald-900/40 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">
                      Take Profit 3 (TP3)
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800" title="Ratio brut">
                      Brut {setup.riskRewardRatioTP3 ?? (setup.riskRewardRatioTP2 * 1.5).toFixed(2)}:1
                    </span>
                  </div>
                  <div className="text-lg font-mono font-bold text-emerald-300 mt-1">
                    {formatCryptoPrice(setup.takeProfit3, setup.tickSize)}$
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono mt-0.5 text-slate-400">
                    <span>
                      +{setup.grossGainPercentTP3 !== undefined
                        ? setup.grossGainPercentTP3.toFixed(2)
                        : (((Math.abs(setup.takeProfit3 - setup.entryPrice)) / setup.entryPrice) * 100).toFixed(2)}%
                    </span>
                    {setup.netRiskRewardRatioTP3 !== undefined && (
                      <span className="text-emerald-400 font-semibold" title="Ratio net après déduction des frais de courtage et slippage">
                        Net: {setup.netRiskRewardRatioTP3}:1
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Invalidation rule */}
            <div className="p-3.5 bg-slate-950/50 border border-slate-800 rounded-xl text-xs space-y-1">
              <span className="text-rose-400 font-semibold uppercase text-[11px] tracking-wide">
                Condition formelle d'invalidation du trade :
              </span>
              <p className="text-slate-300 font-medium">
                {setup.invalidationCondition}
              </p>
            </div>

            {/* Confluences & Risks Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
                <h5 className="font-semibold text-emerald-400 flex items-center gap-1.5 uppercase text-[11px]">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Confluences techniques clés
                </h5>
                <ul className="space-y-1.5 text-slate-300">
                  {setup.keyConfluences.map((conf, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0"></span>
                      <span>{conf}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
                <h5 className="font-semibold text-rose-400 flex items-center gap-1.5 uppercase text-[11px]">
                  <XCircle className="w-3.5 h-3.5" />
                  Principaux facteurs de risque
                </h5>
                <ul className="space-y-1.5 text-slate-300">
                  {setup.mainRisks.map((risk, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0"></span>
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        {/* Quality Score Factors Breakdown */}
        <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 uppercase tracking-wide flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-blue-400" />
              Décomposition du Score de Qualité ({qualityScore.total}/100)
            </span>
            <span className="text-[11px] text-slate-400">
              Mesure de confluence technique (non prédictif)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
            <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg">
              <div className="text-slate-400">Alignement HTF</div>
              <div className="font-mono font-bold text-slate-200 mt-0.5">
                {qualityScore.breakdown.htfAlignment}/20
              </div>
            </div>
            <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg">
              <div className="text-slate-400">Structure SMC</div>
              <div className="font-mono font-bold text-slate-200 mt-0.5">
                {qualityScore.breakdown.marketStructure}/20
              </div>
            </div>
            <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg">
              <div className="text-slate-400">Qualité Entrée</div>
              <div className="font-mono font-bold text-slate-200 mt-0.5">
                {qualityScore.breakdown.entryQuality}/15
              </div>
            </div>
            <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg">
              <div className="text-slate-400">Confirmation Vol.</div>
              <div className="font-mono font-bold text-slate-200 mt-0.5">
                {qualityScore.breakdown.volumeConfirmation}/15
              </div>
            </div>
            <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg">
              <div className="text-slate-400">Ratio R/R</div>
              <div className="font-mono font-bold text-slate-200 mt-0.5">
                {qualityScore.breakdown.riskRewardScore}/15
              </div>
            </div>
            <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg">
              <div className="text-slate-400">Volatilité ATR</div>
              <div className="font-mono font-bold text-slate-200 mt-0.5">
                {qualityScore.breakdown.volatilityScore}/10
              </div>
            </div>
          </div>
        </div>

        {/* 10-Point Verification Checklist Accordion */}
        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowChecklistDetails(!showChecklistDetails)}
            className="w-full px-4 py-2.5 bg-slate-950/60 flex items-center justify-between text-xs text-slate-300 hover:bg-slate-800/40 transition-colors font-medium"
          >
            <span className="flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-blue-400" />
              Checklist de Vérification de Marché ({checklist.filter((c) => c.status === 'PASSED').length}/{checklist.length} validés)
            </span>
            <span className="text-blue-400 font-mono text-[11px]">
              {showChecklistDetails ? 'Masquer' : 'Afficher les 10 points'}
            </span>
          </button>

          {showChecklistDetails && (
            <div className="p-4 bg-slate-950/90 divide-y divide-slate-800/60 text-xs">
              {checklist.map((item) => (
                <div key={item.id} className="py-2 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    {item.status === 'PASSED' ? (
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : item.status === 'FAILED' ? (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-medium text-slate-200">{item.label}</span>
                      <p className="text-slate-400 text-[11px] mt-0.5">{item.comment}</p>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 ${
                      item.status === 'PASSED'
                        ? 'bg-emerald-950 text-emerald-400'
                        : item.status === 'FAILED'
                        ? 'bg-rose-950 text-rose-400'
                        : 'bg-amber-950 text-amber-400'
                    }`}
                  >
                    {item.status === 'PASSED' ? 'VALIDÉ' : item.status === 'FAILED' ? 'ÉCHEC' : 'ATTENTION'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            {onRunAiAudit && (
              <button
                onClick={onRunAiAudit}
                disabled={isAiVerifying}
                title="Lancer une analyse approfondie Gemini"
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold shadow-md transition-all ${
                  isAiAudited
                    ? 'bg-purple-950/80 border border-purple-600 text-purple-200'
                    : 'bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-600 hover:to-indigo-600 text-white'
                } disabled:opacity-50`}
              >
                <Sparkles className={`w-3.5 h-3.5 ${isAiVerifying ? 'animate-spin' : ''}`} />
                {isAiVerifying ? 'Vérification IA...' : isAiAudited ? 'Audit IA Validé' : 'Audit Approfondi IA'}
              </button>
            )}

            {setup && onApplyToCalculator && (
              <button
                onClick={() => onApplyToCalculator(setup)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors"
              >
                <Calculator className="w-3.5 h-3.5" />
                Appliquer au Calculateur de Risque
              </button>
            )}

            {setup && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Plan Copié !' : 'Copier le Plan'}
              </button>
            )}
          </div>

          {onSaveToHistory && (
            <button
              onClick={onSaveToHistory}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
            >
              <BookmarkPlus className="w-3.5 h-3.5 text-blue-400" />
              Sauvegarder dans l’Historique
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
