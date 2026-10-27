import React from 'react';
import { IndicatorSnapshot, Timeframe } from '../types/crypto';
import { formatCryptoPrice } from '../utils/priceFormatter';
import { TrendingUp, TrendingDown, Minus, Activity, Shield, Zap } from 'lucide-react';

interface MultiTimeframePanelProps {
  snapshots: Partial<Record<Timeframe, IndicatorSnapshot>>;
  activeTimeframe: Timeframe;
  onSelectTimeframe: (tf: Timeframe) => void;
}

export const MultiTimeframePanel: React.FC<MultiTimeframePanelProps> = ({
  snapshots,
  activeTimeframe,
  onSelectTimeframe,
}) => {
  const timeframes: Array<{ id: Timeframe; label: string; role: string }> = [
    { id: '4h', label: '4 Heures (4H)', role: 'Tendance Macro & Cadre Majeur' },
    { id: '1h', label: '1 Heure (1H)', role: 'Structure Intermédiaire' },
    { id: '15m', label: '15 Minutes (15M)', role: 'Timing de Structure & SMC' },
    { id: '5m', label: '5 Minutes (5M)', role: 'Déclencheur & Exécution' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            Analyse Multi-Unités de Temps (MTF Confluence)
          </h3>
          <p className="text-xs text-slate-400">
            Les unités de temps supérieures valident la direction, les unités inférieures cadrent le timing.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {timeframes.map(({ id, label, role }) => {
          const snap = snapshots[id];
          const isSelected = activeTimeframe === id;

          return (
            <div
              key={id}
              onClick={() => onSelectTimeframe(id)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                isSelected
                  ? 'bg-blue-950/40 border-blue-500 shadow-md ring-1 ring-blue-500/30'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                <span className="font-semibold text-xs text-slate-200">{label}</span>
                <span
                  className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${
                    snap?.trend === 'HAUSSIÈRE'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : snap?.trend === 'BAISSIÈRE'
                      ? 'bg-rose-950 text-rose-400 border border-rose-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {snap?.trend === 'HAUSSIÈRE' ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : snap?.trend === 'BAISSIÈRE' ? (
                    <TrendingDown className="w-3 h-3" />
                  ) : (
                    <Minus className="w-3 h-3" />
                  )}
                  {snap?.trend || 'CALCUL...'}
                </span>
              </div>

              <div className="text-[10px] text-slate-400 mt-1 mb-2.5 font-medium">{role}</div>

              {snap ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Structure SMC :</span>
                    <span
                      className={`font-semibold ${
                        snap.structure === 'BULLISH_STRUCTURE'
                          ? 'text-emerald-400'
                          : snap.structure === 'BEARISH_STRUCTURE'
                          ? 'text-rose-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {snap.structure === 'BULLISH_STRUCTURE'
                        ? 'HH / HL (Haussier)'
                        : snap.structure === 'BEARISH_STRUCTURE'
                        ? 'LH / LL (Baissier)'
                        : 'Range / Indécis'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">RSI (14) :</span>
                    <span
                      className={`font-mono font-medium ${
                        snap.rsi > 70 ? 'text-amber-400' : snap.rsi < 30 ? 'text-blue-400' : 'text-slate-200'
                      }`}
                    >
                      {snap.rsi.toFixed(1)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Volatilité (ATR) :</span>
                    <span className="font-mono text-slate-200">
                      {formatCryptoPrice(snap.atr)}$ ({snap.atrPercent.toFixed(2)}%)
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Zap className="w-3 h-3 text-amber-400" />
                      Signaux SMC :
                    </span>
                    <span className="text-slate-300 font-mono">
                      {snap.orderBlock ? 'OB' : ''} {snap.fvg ? '+ FVG' : ''} {snap.liquiditySweepDetected ? '+ Sweep' : ''}
                      {!snap.orderBlock && !snap.fvg && !snap.liquiditySweepDetected ? 'Neutre' : ''}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-slate-500 animate-pulse">
                  Synchronisation des bougies...
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
