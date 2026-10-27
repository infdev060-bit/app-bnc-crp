import React from 'react';
import { SavedAnalysis } from '../types/crypto';
import { formatCryptoPrice } from '../utils/priceFormatter';
import { History, Trash2, Download, X, ExternalLink, TrendingUp, TrendingDown, ShieldAlert } from 'lucide-react';

interface AnalysisHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: SavedAnalysis[];
  onSelectSaved: (item: SavedAnalysis) => void;
  onClearHistory: () => void;
}

export const AnalysisHistoryModal: React.FC<AnalysisHistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  onSelectSaved,
  onClearHistory,
}) => {
  if (!isOpen) return null;

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(history, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `crypto-edge-ai-analyses-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Historique des Analyses & Délibérations
              </h3>
              <p className="text-xs text-slate-400">
                {history.length} analyse{history.length > 1 ? 's' : ''} enregistrée{history.length > 1 ? 's' : ''} en local
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content list */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          {history.length === 0 ? (
            <div className="py-12 text-center text-slate-500 space-y-2">
              <History className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-xs">Aucune analyse enregistrée pour le moment.</p>
              <p className="text-[11px] text-slate-600">
                Cliquez sur "Sauvegarder dans l’Historique" depuis la fiche de setup pour archiver vos analyses.
              </p>
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  onSelectSaved(item);
                  onClose();
                }}
                className="p-3.5 bg-slate-950/70 border border-slate-800 hover:border-slate-700 rounded-xl cursor-pointer transition-all space-y-2 group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-200 text-xs">
                      {item.symbol}
                    </span>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      {item.market}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded flex items-center gap-1 ${
                        item.verdict === 'LONG'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : item.verdict === 'SHORT'
                          ? 'bg-rose-950 text-rose-400 border border-rose-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}
                    >
                      {item.verdict === 'LONG' ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : item.verdict === 'SHORT' ? (
                        <TrendingDown className="w-3 h-3" />
                      ) : (
                        <ShieldAlert className="w-3 h-3" />
                      )}
                      {item.verdict}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span>Score: {item.qualityScore}/100</span>
                    <span className="text-slate-600">•</span>
                    <span>{new Date(item.timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 line-clamp-2">
                  {item.summary}
                </p>

                {item.verdict !== 'NO_TRADE' && (
                  <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
                    <span>Entrée: <strong className="text-slate-200">{formatCryptoPrice(item.entryPrice)}$</strong></span>
                    <span>SL: <strong className="text-rose-400">{formatCryptoPrice(item.stopLoss)}$</strong></span>
                    <span>TP1: <strong className="text-emerald-400">{formatCryptoPrice(item.tp1)}$</strong></span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs">
          {history.length > 0 ? (
            <>
              <button
                onClick={onClearHistory}
                className="flex items-center gap-1.5 text-rose-400 hover:text-rose-300 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Effacer tout
              </button>
              <button
                onClick={handleExportJSON}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Exporter en JSON
              </button>
            </>
          ) : (
            <div className="text-slate-500 text-[11px]">Crypto Edge AI Database</div>
          )}
        </div>
      </div>
    </div>
  );
};
