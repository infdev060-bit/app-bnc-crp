import React, { useState, useMemo } from 'react';
import {
  PaperTrade,
  PaperAccountConfig,
  PaperAccountState,
  PaperTradingStats,
} from '../types/paperTrading';
import { MarketType } from '../types/crypto';
import { formatCryptoPrice } from '../utils/priceFormatter';
import { exportPaperTradesToCSV, exportPaperTradesToJSON } from '../utils/paperTradingStorage';
import {
  Wallet,
  Play,
  Pause,
  Sliders,
  Download,
  Trash2,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Shield,
  Layers,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Filter,
  DollarSign,
  Percent,
  Check,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';

interface PaperTradingDashboardProps {
  accountState: PaperAccountState;
  stats: PaperTradingStats;
  openPositions: PaperTrade[];
  closedTrades: PaperTrade[];
  config: PaperAccountConfig;
  onUpdateConfig: (newConfig: Partial<PaperAccountConfig>) => void;
  onCloseManualTrade: (tradeId: string) => void;
  onResetAccount: () => void;
  onClearClosedHistory: () => void;
  onSelectPair?: (symbol: string, market: MarketType) => void;
}

export const PaperTradingDashboard: React.FC<PaperTradingDashboardProps> = ({
  accountState,
  stats,
  openPositions,
  closedTrades,
  config,
  onUpdateConfig,
  onCloseManualTrade,
  onResetAccount,
  onClearClosedHistory,
  onSelectPair,
}) => {
  // UI Tabs & Filters
  const [activeSection, setActiveSection] = useState<'positions' | 'history' | 'analytics'>('positions');
  const [filterSymbol, setFilterSymbol] = useState<string>('');
  const [filterDirection, setFilterDirection] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [filterMarket, setFilterMarket] = useState<'ALL' | 'spot' | 'futures'>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Modals
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState<boolean>(false);
  const [isClearHistoryConfirmOpen, setIsClearHistoryConfirmOpen] = useState<boolean>(false);

  // Form State for Config Modal
  const [formCapital, setFormCapital] = useState<number>(config.initialCapital);
  const [formRisk, setFormRisk] = useState<number>(config.riskPerTradePercent);
  const [formTp1, setFormTp1] = useState<number>(config.tp1ClosePercent);
  const [formTp2, setFormTp2] = useState<number>(config.tp2ClosePercent);
  const [formTp3, setFormTp3] = useState<number>(config.tp3ClosePercent);
  const [formMoveBe, setFormMoveBe] = useState<boolean>(config.moveToBreakEvenAfterTP1);
  const [formMaxPositions, setFormMaxPositions] = useState<number>(config.maxOpenPositions);
  const [formSlippage, setFormSlippage] = useState<number>(config.defaultSlippagePercent);
  const [formFunding, setFormFunding] = useState<number>(config.defaultFundingRatePercent);

  // Filtered Closed Trades
  const filteredHistory = useMemo(() => {
    return closedTrades.filter((t) => {
      if (filterSymbol && !t.symbol.toUpperCase().includes(filterSymbol.trim().toUpperCase())) {
        return false;
      }
      if (filterDirection !== 'ALL' && t.direction !== filterDirection) {
        return false;
      }
      if (filterMarket !== 'ALL' && t.market !== filterMarket) {
        return false;
      }
      if (filterStatus !== 'ALL') {
        if (filterStatus === 'WIN' && t.realizedNetPnl <= 0.01) return false;
        if (filterStatus === 'LOSS' && t.realizedNetPnl >= -0.01) return false;
        if (filterStatus === 'SL_HIT' && t.status !== 'SL_HIT') return false;
        if (filterStatus === 'TP3_HIT' && t.status !== 'TP3_HIT') return false;
        if (filterStatus === 'MANUAL_CLOSED' && t.status !== 'MANUAL_CLOSED') return false;
      }
      return true;
    });
  }, [closedTrades, filterSymbol, filterDirection, filterMarket, filterStatus]);

  // Export handlers
  const handleExportCSV = () => {
    const csv = exportPaperTradesToCSV(closedTrades.concat(openPositions));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `crypto_edge_paper_trades_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJSON = () => {
    const json = exportPaperTradesToJSON(closedTrades.concat(openPositions), config);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `crypto_edge_paper_trades_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateConfig({
      initialCapital: Math.max(100, formCapital),
      riskPerTradePercent: Math.min(Math.max(0.1, formRisk), 2.0),
      tp1ClosePercent: Math.min(Math.max(10, formTp1), 100),
      tp2ClosePercent: Math.min(Math.max(0, formTp2), 100),
      tp3ClosePercent: Math.min(Math.max(0, formTp3), 100),
      moveToBreakEvenAfterTP1: formMoveBe,
      maxOpenPositions: Math.min(Math.max(1, formMaxPositions), 20),
      defaultSlippagePercent: Math.max(0, formSlippage),
      defaultFundingRatePercent: Math.max(0, formFunding),
    });
    setIsConfigModalOpen(false);
  };

  return (
    <div className="space-y-5">
      {/* Simulation Header & Status Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-2xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-500/20 border border-emerald-400/30">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white flex items-center gap-1.5">
                Paper Trading Virtuel
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30 uppercase tracking-wide">
                Simulation Strict
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Exécution simulée en conditions réelles de marché avec slippage, frais et sorties partielles.
            </p>
          </div>
        </div>

        {/* Global Controls & State */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Main Activation Button */}
          <button
            onClick={() => onUpdateConfig({ isAutoTradingActive: !config.isAutoTradingActive })}
            className={`px-3.5 py-1.5 rounded-lg font-bold flex items-center gap-2 transition-all cursor-pointer shadow-md ${
              config.isAutoTradingActive
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40'
                : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700'
            }`}
          >
            {config.isAutoTradingActive ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping" />
                <span>Paper Trading ACTIF</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-slate-400" />
                <span>Activer le Paper Trading</span>
              </>
            )}
          </button>

          {/* Pause Button */}
          {config.isAutoTradingActive && (
            <button
              onClick={() => onUpdateConfig({ isPaused: !config.isPaused })}
              className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors cursor-pointer border ${
                config.isPaused
                  ? 'bg-amber-600 border-amber-500 text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Pause className="w-3.5 h-3.5" />
              <span>{config.isPaused ? 'En Pause' : 'Pause'}</span>
            </button>
          )}

          {/* Config Settings Button */}
          <button
            onClick={() => setIsConfigModalOpen(true)}
            className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
            title="Configurer les paramètres de simulation"
          >
            <Sliders className="w-4 h-4" />
          </button>

          {/* Export CSV / JSON */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleExportCSV}
              disabled={closedTrades.length === 0 && openPositions.length === 0}
              className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-colors cursor-pointer"
              title="Exporter l'historique en CSV"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>

          {/* Reset Account */}
          <button
            onClick={() => setIsResetConfirmOpen(true)}
            className="p-2 rounded-lg bg-rose-950/40 border border-rose-900/60 text-rose-300 hover:bg-rose-900/60 transition-colors cursor-pointer"
            title="Réinitialiser le compte virtuel (10 000 USDT)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Browser Active Lifecycle Notice */}
      <div className="p-3 bg-blue-950/30 border border-blue-900/60 rounded-xl flex items-start gap-3 text-xs text-slate-300">
        <Activity className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <strong className="text-blue-300">Suivi continu en temps réel :</strong> Les positions simulées sont valorisées au fil de l'eau via les flux publics Binance tant que l'application est ouverte dans votre navigateur. Fermer l'onglet interrompt la surveillance (aucun serveur tiers ni exécution cachée).
        </div>
      </div>

      {/* KPI Overview Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
        {/* Card 1: Capital & Solde */}
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Capital Initial</span>
          <div className="text-base font-mono font-bold text-slate-100 mt-0.5">
            {accountState.initialCapital.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}$
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">
            Solde dispo : {accountState.availableBalance.toFixed(2)}$
          </span>
        </div>

        {/* Card 2: Équité Totale */}
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Équité Totale</span>
          <div className={`text-base font-mono font-bold mt-0.5 ${accountState.equity >= accountState.initialCapital ? 'text-emerald-400' : 'text-rose-400'}`}>
            {accountState.equity.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}$
          </div>
          <span className="text-[10px] font-mono text-slate-400 block mt-1">
            {accountState.equity >= accountState.initialCapital ? '+' : ''}
            {(((accountState.equity - accountState.initialCapital) / accountState.initialCapital) * 100).toFixed(2)}%
          </span>
        </div>

        {/* Card 3: P&L Réalisé */}
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">P&L Net Réalisé</span>
          <div className={`text-base font-mono font-bold mt-0.5 ${accountState.realizedNetPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {accountState.realizedNetPnl >= 0 ? '+' : ''}{accountState.realizedNetPnl.toFixed(2)}$
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">
            Frais déduits: {accountState.cumulativeFees.toFixed(2)}$
          </span>
        </div>

        {/* Card 4: P&L Latent (Positions ouvertes) */}
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">P&L Latent (Ouvert)</span>
          <div className={`text-base font-mono font-bold mt-0.5 ${accountState.unrealizedNetPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {accountState.unrealizedNetPnl >= 0 ? '+' : ''}{accountState.unrealizedNetPnl.toFixed(2)}$
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">
            {accountState.openPositionsCount} position{accountState.openPositionsCount > 1 ? 's' : ''} en cours
          </span>
        </div>

        {/* Card 5: Taux de Réussite & Wilson CI */}
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Taux de Réussite</span>
          <div className={`text-base font-mono font-bold mt-0.5 ${stats.winRate >= 50 ? 'text-emerald-400' : stats.totalClosedTrades > 0 ? 'text-amber-400' : 'text-slate-200'}`}>
            {stats.winRate.toFixed(1)}%
          </div>
          <span className="text-[10px] font-mono text-slate-400 block mt-1" title="Intervalle de confiance Wilson à 95%">
            IC 95%: {stats.winRateConfidenceInterval}
          </span>
        </div>

        {/* Card 6: Expectancy & Profit Factor */}
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Espérance Nette</span>
          <div className={`text-base font-mono font-bold mt-0.5 ${stats.expectancyUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {stats.expectancyUsd >= 0 ? '+' : ''}{stats.expectancyUsd.toFixed(2)}$ <span className="text-[10px] font-normal text-slate-400">/ trade</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400 block mt-1">
            Profit Factor: {stats.profitFactor.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 text-xs">
        <button
          onClick={() => setActiveSection('positions')}
          className={`py-2 px-3 border-b-2 font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
            activeSection === 'positions'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Positions Actives</span>
          <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-slate-950 border border-slate-800 text-slate-300">
            {openPositions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveSection('history')}
          className={`py-2 px-3 border-b-2 font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
            activeSection === 'history'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Historique Clôturé</span>
          <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-slate-950 border border-slate-800 text-slate-300">
            {closedTrades.length}
          </span>
        </button>

        <button
          onClick={() => setActiveSection('analytics')}
          className={`py-2 px-3 border-b-2 font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
            activeSection === 'analytics'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Analyse de Performance</span>
        </button>
      </div>

      {/* SECTION 1: POSITIONS OUVERTES */}
      {activeSection === 'positions' && (
        <div className="space-y-4">
          {openPositions.length === 0 ? (
            <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl space-y-2">
              <Shield className="w-8 h-8 text-slate-600 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-300">Aucune position simulée ouverte</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Activez le Paper Trading pour capter automatiquement les signaux qualifiés du scanner ou cliquez sur « Ouvrir en Paper Trading » sur la fiche d'un setup.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5">
              {openPositions.map((p) => {
                const isLong = p.direction === 'LONG';
                const diffFromEntry = isLong
                  ? ((p.currentMarketPrice - p.entryPrice) / p.entryPrice) * 100
                  : ((p.entryPrice - p.currentMarketPrice) / p.entryPrice) * 100;

                return (
                  <div
                    key={p.id}
                    className={`bg-slate-900 border rounded-xl p-4 shadow-xl space-y-3 transition-colors ${
                      isLong ? 'border-emerald-950 hover:border-emerald-900' : 'border-rose-950 hover:border-rose-900'
                    }`}
                  >
                    {/* Header line */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                      <div className="flex items-center gap-2.5">
                        <span
                          onClick={() => onSelectPair && onSelectPair(p.symbol, p.market)}
                          className="font-mono font-bold text-base text-slate-100 hover:text-blue-400 cursor-pointer flex items-center gap-1.5"
                          title="Voir l'analyse détaillée sur le Dashboard"
                        >
                          {p.symbol}
                          <ExternalLink className="w-3 h-3 text-slate-500" />
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800 text-slate-400 uppercase">
                          {p.market}
                        </span>
                        <span
                          className={`text-xs font-mono font-bold px-2 py-0.5 rounded flex items-center gap-1 ${
                            isLong
                              ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                              : 'bg-rose-950/80 text-rose-400 border border-rose-800'
                          }`}
                        >
                          {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          <span>{p.direction}</span>
                        </span>
                        {p.breakEvenMoved && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-950 border border-blue-800 text-blue-300 font-mono">
                            SL @ Break-Even
                          </span>
                        )}
                        {p.isStalePrice && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 border border-amber-800 text-amber-300 font-mono flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>Prix figé</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-[11px] text-slate-400 block font-mono">
                            P&L Latent :
                          </span>
                          <span className={`text-sm font-mono font-bold ${p.unrealizedNetPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {p.unrealizedNetPnl >= 0 ? '+' : ''}{p.unrealizedNetPnl.toFixed(2)}$ ({diffFromEntry >= 0 ? '+' : ''}{diffFromEntry.toFixed(2)}%)
                          </span>
                        </div>

                        <button
                          onClick={() => onCloseManualTrade(p.id)}
                          className="px-2.5 py-1 bg-slate-950 hover:bg-rose-950/80 border border-slate-700 hover:border-rose-700 text-slate-300 hover:text-rose-300 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                          title="Clôturer immédiatement la position au prix actuel"
                        >
                          Fermer au Marché
                        </button>
                      </div>
                    </div>

                    {/* Price & Target levels grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs font-mono">
                      <div className="p-2 bg-slate-950/70 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 text-[10px] block">Entrée</span>
                        <span className="text-slate-200 font-bold">{formatCryptoPrice(p.entryPrice, p.tickSize)}$</span>
                      </div>

                      <div className="p-2 bg-slate-950/70 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 text-[10px] block">Prix Actuel</span>
                        <span className="text-blue-400 font-bold">{formatCryptoPrice(p.currentMarketPrice, p.tickSize)}$</span>
                      </div>

                      <div className="p-2 bg-slate-950/70 border border-rose-950/40 rounded-lg">
                        <span className="text-rose-400 text-[10px] block">Stop Loss</span>
                        <span className="text-rose-300 font-bold">{formatCryptoPrice(p.stopLoss, p.tickSize)}$</span>
                      </div>

                      <div className="p-2 bg-slate-950/70 border border-emerald-950/40 rounded-lg">
                        <span className="text-emerald-400 text-[10px] block">Objectif TP1</span>
                        <span className="text-emerald-300 font-bold">{formatCryptoPrice(p.takeProfit1, p.tickSize)}$</span>
                      </div>

                      <div className="p-2 bg-slate-950/70 border border-emerald-950/40 rounded-lg">
                        <span className="text-emerald-400 text-[10px] block">Objectif TP2</span>
                        <span className="text-emerald-300 font-bold">{formatCryptoPrice(p.takeProfit2, p.tickSize)}$</span>
                      </div>

                      <div className="p-2 bg-slate-950/70 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 text-[10px] block">Quantité Restante</span>
                        <span className="text-slate-200 font-bold">
                          {p.currentQuantity.toFixed(4)} / {p.initialQuantity.toFixed(4)}
                        </span>
                      </div>
                    </div>

                    {/* Partial fills history summary if any */}
                    {p.partialFills.length > 0 && (
                      <div className="p-2 bg-slate-950/90 border border-slate-800/80 rounded-lg text-[11px] font-mono space-y-1">
                        <span className="text-slate-400 font-semibold block text-[10px] uppercase">
                          Exécutions partielles enregistrées :
                        </span>
                        {p.partialFills.map((fill, idx) => (
                          <div key={idx} className="flex justify-between text-slate-300">
                            <span>
                              {fill.level} ({fill.percentageClosed}%) @ {formatCryptoPrice(fill.exitPrice, p.tickSize)}$
                            </span>
                            <span className={fill.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                              Net : {fill.netPnl >= 0 ? '+' : ''}{fill.netPnl.toFixed(2)}$ (Frais: {fill.feePaid.toFixed(2)}$)
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: HISTORIQUE DES TRADES CLÔTURÉS */}
      {activeSection === 'history' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Filtrer symbole..."
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-100 placeholder-slate-500 font-mono text-xs w-28 sm:w-36 focus:border-blue-500 focus:outline-hidden"
              />

              <select
                value={filterDirection}
                onChange={(e) => setFilterDirection(e.target.value as any)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 text-xs focus:border-blue-500 focus:outline-hidden"
              >
                <option value="ALL">Direction : Toutes</option>
                <option value="LONG">LONG uniquement</option>
                <option value="SHORT">SHORT uniquement</option>
              </select>

              <select
                value={filterMarket}
                onChange={(e) => setFilterMarket(e.target.value as any)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 text-xs focus:border-blue-500 focus:outline-hidden"
              >
                <option value="ALL">Marché : Tous</option>
                <option value="spot">Binance Spot</option>
                <option value="futures">Binance Futures</option>
              </select>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 text-xs focus:border-blue-500 focus:outline-hidden"
              >
                <option value="ALL">Résultat : Tous</option>
                <option value="WIN">Gagnants (P&L &gt; 0)</option>
                <option value="LOSS">Perdants (P&L &lt; 0)</option>
                <option value="SL_HIT">Stop Loss touché</option>
                <option value="TP3_HIT">TP3 Complété</option>
                <option value="MANUAL_CLOSED">Clôture manuelle</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 font-mono">
                {filteredHistory.length} / {closedTrades.length} trades
              </span>
              <button
                onClick={() => setIsClearHistoryConfirmOpen(true)}
                disabled={closedTrades.length === 0}
                className="px-2.5 py-1 text-rose-400 hover:text-rose-300 disabled:opacity-40 text-xs transition-colors cursor-pointer"
                title="Effacer les trades clôturés"
              >
                Vider l'historique
              </button>
            </div>
          </div>

          {/* Table */}
          {filteredHistory.length === 0 ? (
            <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl space-y-2">
              <Clock className="w-8 h-8 text-slate-600 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-300">Aucun trade clôturé dans l'historique</h3>
              <p className="text-xs text-slate-500">
                Les trades apparaîtront ici dès qu'ils auront atteint un Stop Loss, complété un TP3 ou été clôturés manuellement.
              </p>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 font-sans uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Symbole</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Entrée</th>
                      <th className="py-2.5 px-3">Sortie</th>
                      <th className="py-2.5 px-3">P&L Brut</th>
                      <th className="py-2.5 px-3">Frais</th>
                      <th className="py-2.5 px-3 font-semibold text-slate-200">P&L Net</th>
                      <th className="py-2.5 px-3">Statut & Motif</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredHistory.map((t) => {
                      const isWin = t.realizedNetPnl > 0.01;
                      const isLoss = t.realizedNetPnl < -0.01;

                      return (
                        <tr key={t.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-2 px-3 text-slate-400 text-[11px]">
                            {new Date(t.entryTime).toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2 px-3 font-bold text-slate-200">
                            {t.symbol} <span className="text-[10px] text-slate-500 font-normal">({t.market})</span>
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                t.direction === 'LONG'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-rose-950 text-rose-400 border border-rose-800'
                              }`}
                            >
                              {t.direction}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-300">
                            {formatCryptoPrice(t.entryPrice, t.tickSize)}$
                          </td>
                          <td className="py-2 px-3 text-slate-300">
                            {t.finalExitPrice ? `${formatCryptoPrice(t.finalExitPrice, t.tickSize)}$` : 'N/A'}
                          </td>
                          <td className="py-2 px-3 text-slate-400">
                            {t.realizedGrossPnl >= 0 ? '+' : ''}{t.realizedGrossPnl.toFixed(2)}$
                          </td>
                          <td className="py-2 px-3 text-slate-500">
                            -{t.totalFeesPaid.toFixed(2)}$
                          </td>
                          <td className={`py-2 px-3 font-bold ${isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-slate-400'}`}>
                            {t.realizedNetPnl >= 0 ? '+' : ''}{t.realizedNetPnl.toFixed(2)}$
                          </td>
                          <td className="py-2 px-3 text-slate-400 text-[11px]">
                            <span className="font-semibold text-slate-300">{t.status}</span>
                            <span className="block text-[10px] text-slate-500 truncate max-w-xs font-sans">
                              {t.exitReason || 'Clôturé'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: ANALYSE DE PERFORMANCE DÉTAILLÉE */}
      {activeSection === 'analytics' && (
        <div className="space-y-4">
          {!stats.isSampleSufficient && (
            <div className="p-3 bg-amber-950/30 border border-amber-800/60 rounded-xl flex items-start gap-2.5 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>Échantillon insuffisant ({stats.totalClosedTrades} trades clôturés) :</strong> Les ventilations statistiques ci-dessous nécessitent un minimum de 15 à 30 trades fermés pour être mathématiquement représentatives.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Long vs Short */}
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2.5">
              <h4 className="font-semibold text-slate-200 flex items-center justify-between pb-2 border-b border-slate-800">
                <span>Performance LONG vs SHORT</span>
                <span className="text-slate-400 text-[11px] font-mono">Sens du Marché</span>
              </h4>
              <div className="space-y-2 font-mono">
                <div className="flex justify-between items-center p-2 bg-slate-950 rounded-lg">
                  <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> LONG
                  </span>
                  <span className="text-slate-300">
                    {stats.performanceByDirection.LONG.trades} trades • Win {stats.performanceByDirection.LONG.winRate.toFixed(1)}%
                  </span>
                  <span className={`font-bold ${stats.performanceByDirection.LONG.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {stats.performanceByDirection.LONG.netPnl >= 0 ? '+' : ''}{stats.performanceByDirection.LONG.netPnl.toFixed(2)}$
                  </span>
                </div>

                <div className="flex justify-between items-center p-2 bg-slate-950 rounded-lg">
                  <span className="text-rose-400 font-bold flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5" /> SHORT
                  </span>
                  <span className="text-slate-300">
                    {stats.performanceByDirection.SHORT.trades} trades • Win {stats.performanceByDirection.SHORT.winRate.toFixed(1)}%
                  </span>
                  <span className={`font-bold ${stats.performanceByDirection.SHORT.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {stats.performanceByDirection.SHORT.netPnl >= 0 ? '+' : ''}{stats.performanceByDirection.SHORT.netPnl.toFixed(2)}$
                  </span>
                </div>
              </div>
            </div>

            {/* Spot vs Futures */}
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2.5">
              <h4 className="font-semibold text-slate-200 flex items-center justify-between pb-2 border-b border-slate-800">
                <span>Performance Spot vs Futures</span>
                <span className="text-slate-400 text-[11px] font-mono">Marché</span>
              </h4>
              <div className="space-y-2 font-mono">
                <div className="flex justify-between items-center p-2 bg-slate-950 rounded-lg">
                  <span className="text-blue-400 font-bold">Binance Spot</span>
                  <span className="text-slate-300">
                    {stats.performanceByMarket.spot.trades} trades • Win {stats.performanceByMarket.spot.winRate.toFixed(1)}%
                  </span>
                  <span className={`font-bold ${stats.performanceByMarket.spot.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {stats.performanceByMarket.spot.netPnl >= 0 ? '+' : ''}{stats.performanceByMarket.spot.netPnl.toFixed(2)}$
                  </span>
                </div>

                <div className="flex justify-between items-center p-2 bg-slate-950 rounded-lg">
                  <span className="text-indigo-400 font-bold">Binance Futures</span>
                  <span className="text-slate-300">
                    {stats.performanceByMarket.futures.trades} trades • Win {stats.performanceByMarket.futures.winRate.toFixed(1)}%
                  </span>
                  <span className={`font-bold ${stats.performanceByMarket.futures.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {stats.performanceByMarket.futures.netPnl >= 0 ? '+' : ''}{stats.performanceByMarket.futures.netPnl.toFixed(2)}$
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Performance by Score Bracket */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2.5 text-xs">
            <h4 className="font-semibold text-slate-200 pb-2 border-b border-slate-800">
              Efficacité Prédictive par Tranche de Score de Confluence
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
              {Object.entries(stats.performanceByScoreBracket).map(([bracket, bStats]) => (
                <div key={bracket} className="p-2.5 bg-slate-950 rounded-lg border border-slate-800/80">
                  <span className="text-slate-400 text-[10px] block font-sans font-bold">Score {bracket}</span>
                  <div className="text-sm font-bold text-slate-100 mt-0.5">
                    {bStats.trades} trades
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                    <span>Win: {bStats.winRate.toFixed(0)}%</span>
                    <span className={bStats.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {bStats.netPnl >= 0 ? '+' : ''}{bStats.netPnl.toFixed(1)}$
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: Configuration du Paper Trading */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-blue-400" />
                Paramètres de Simulation Paper Trading
              </h3>
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Capital Virtuel ($)</label>
                  <input
                    type="number"
                    step="500"
                    min="100"
                    value={formCapital}
                    onChange={(e) => setFormCapital(parseFloat(e.target.value) || 10000)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Risque Max / Trade (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="2.0"
                    value={formRisk}
                    onChange={(e) => setFormRisk(parseFloat(e.target.value) || 0.5)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                  />
                  <span className="text-[10px] text-slate-500">Recommandé : 0.5% (Max: 1.0%)</span>
                </div>
              </div>

              {/* Partial TP Settings */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <span className="font-semibold text-slate-300 block text-[11px]">Sorties Partielles Configurable (%)</span>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-slate-400 text-[10px] block">TP1 Clôture</label>
                    <input
                      type="number"
                      min="10"
                      max="100"
                      value={formTp1}
                      onChange={(e) => setFormTp1(parseInt(e.target.value, 10) || 50)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-[10px] block">TP2 Clôture</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formTp2}
                      onChange={(e) => setFormTp2(parseInt(e.target.value, 10) || 25)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-[10px] block">TP3 Clôture</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formTp3}
                      onChange={(e) => setFormTp3(parseInt(e.target.value, 10) || 25)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Break Even Toggle */}
              <div className="flex items-center justify-between p-2.5 bg-slate-950 rounded-lg border border-slate-800">
                <div>
                  <span className="text-slate-200 font-medium block">Stop Loss au Break-Even après TP1</span>
                  <span className="text-[10px] text-slate-400">Déplace le Stop au prix d'entrée + frais après TP1</span>
                </div>
                <input
                  type="checkbox"
                  checked={formMoveBe}
                  onChange={(e) => setFormMoveBe(e.target.checked)}
                  className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                />
              </div>

              {/* Slippage & Max Positions */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Slippage Simulé (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formSlippage}
                    onChange={(e) => setFormSlippage(parseFloat(e.target.value) || 0.02)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Max Positions Simultanées</label>
                  <input
                    type="number"
                    min="1"
                    max="15"
                    value={formMaxPositions}
                    onChange={(e) => setFormMaxPositions(parseInt(e.target.value, 10) || 5)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsConfigModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Confirmation Réinitialisation du Compte */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-xs">
            <div className="flex items-center gap-3 text-rose-400">
              <RotateCcw className="w-5 h-5" />
              <h3 className="text-sm font-bold text-slate-100">Réinitialiser le compte virtuel ?</h3>
            </div>
            <p className="text-slate-400">
              Cette action supprimera toutes les positions en cours et réinitialisera votre capital virtuel à 10 000 USDT. Cette opération est irréversible.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  onResetAccount();
                  setIsResetConfirmOpen(false);
                }}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer"
              >
                Confirmer la Réinitialisation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Confirmation Vider l'Historique Clôturé */}
      {isClearHistoryConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-xs">
            <div className="flex items-center gap-3 text-amber-400">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-sm font-bold text-slate-100">Vider l'historique clôturé ?</h3>
            </div>
            <p className="text-slate-400">
              Les positions actuellement ouvertes seront conservées. Seuls les trades terminés seront purgés de la table historique.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsClearHistoryConfirmOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  onClearClosedHistory();
                  setIsClearHistoryConfirmOpen(false);
                }}
                className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer"
              >
                Confirmer la Purge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
