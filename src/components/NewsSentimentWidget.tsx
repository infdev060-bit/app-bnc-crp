import React, { useState, useEffect, useCallback } from 'react';
import { CryptoNewsItem, NewsIntelligenceSummary, MarketType, TradeSetup } from '../types/crypto';
import { combineTechnicalAndNewsVerdict } from '../utils/newsAnalyzer';
import {
  Newspaper,
  ExternalLink,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  ArrowRight,
  ShieldCheck,
  CheckCircle,
  Clock,
  Sparkles,
} from 'lucide-react';

interface NewsSentimentWidgetProps {
  symbol: string;
  market: MarketType;
  technicalVerdict: 'LONG' | 'SHORT' | 'NO_TRADE';
  technicalScore: number;
  setup?: TradeSetup;
  onOpenNewsTab: () => void;
}

export const NewsSentimentWidget: React.FC<NewsSentimentWidgetProps> = ({
  symbol,
  market,
  technicalVerdict,
  technicalScore,
  setup,
  onOpenNewsTab,
}) => {
  const [news, setNews] = useState<CryptoNewsItem[]>([]);
  const [summary, setSummary] = useState<NewsIntelligenceSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/news/crypto?symbol=${symbol}&market=${market}`);
      if (!res.ok) {
        throw new Error(`Erreur serveur (${res.status})`);
      }
      const data = await res.json();
      setNews(data.articles || []);
      setSummary(data.summary || null);
    } catch (err: any) {
      console.warn('NewsWidget fetch warning:', err);
      setError('Flux actualités momentanément indisponible');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, market]);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  const score = summary?.overallImpactScore ?? 0;
  const combined = summary
    ? combineTechnicalAndNewsVerdict({
        technicalVerdict,
        technicalScore,
        newsImpactScore: summary.overallImpactScore,
        setup,
        symbol,
      })
    : null;

  const scoreColor =
    score >= 25
      ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800/80'
      : score <= -25
      ? 'text-rose-400 bg-rose-950/40 border-rose-800/80'
      : 'text-amber-400 bg-amber-950/40 border-amber-800/80';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-blue-950/80 border border-blue-800/70 text-blue-400">
            <Newspaper className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-100">
                News Intelligence & Décryptage en Darija
              </h4>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                الدارجة المغربية
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Veille en direct sur {symbol} : Binance, CoinTelegraph & CoinDesk
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchNews}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
            title="Rafraîchir les actualités"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
          <button
            onClick={onOpenNewsTab}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600/90 hover:bg-blue-600 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <span>Détails & Analyse</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
          <span>Récupération des dépêches en direct de Binance et CoinTelegraph...</span>
        </div>
      ) : error ? (
        <div className="py-4 text-center text-xs text-slate-400">
          <p>{error}</p>
          <button
            onClick={fetchNews}
            className="mt-2 text-blue-400 hover:underline inline-flex items-center gap-1 text-[11px]"
          >
            <RefreshCw className="w-3 h-3" /> Réessayer
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Top Score & Confluence Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Impact Score Gauge */}
            <div className={`p-3 rounded-lg border ${scoreColor} flex flex-col justify-between`}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">Score d'Impact News</span>
                <span className="text-[10px] font-mono opacity-80">-100 à +100</span>
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold font-mono">
                  {score > 0 ? `+${score}` : score}
                </span>
                <span className="text-xs font-semibold">
                  {score >= 25 ? 'Haussier' : score <= -25 ? 'Baissier' : 'Neutre / Modéré'}
                </span>
              </div>
            </div>

            {/* Combined Confluence Verdict */}
            <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col justify-between sm:col-span-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                  Verdict Technique + Fondamental
                </span>
                {combined && (
                  <span
                    className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${
                      combined.combinedVerdict === 'LONG'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : combined.combinedVerdict === 'SHORT'
                        ? 'bg-rose-950 text-rose-400 border border-rose-800'
                        : combined.combinedVerdict === 'WAIT'
                        ? 'bg-amber-950 text-amber-300 border border-amber-800 animate-pulse'
                        : 'bg-slate-900 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {combined.combinedVerdict === 'WAIT' ? 'ATTENDRE (WAIT)' : combined.combinedVerdict}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300 mt-1 line-clamp-2">
                {combined?.verdictRationale || 'Analyse de confluence des signaux en cours...'}
              </p>
            </div>
          </div>

          {/* Moroccan Darija Quick Insight */}
          {summary?.generalSummaryDarija && (
            <div className="p-3 rounded-lg bg-gradient-to-r from-amber-950/30 via-slate-950 to-slate-950 border border-amber-800/40 space-y-1 text-right" dir="rtl">
              <div className="flex items-center justify-end gap-1.5 text-amber-400 text-xs font-bold font-mono">
                <Sparkles className="w-3.5 h-3.5" />
                <span>الخلاصة بالدارجة المغربية :</span>
              </div>
              <p className="text-xs text-slate-200 leading-relaxed font-sans">
                {summary.generalSummaryDarija}
              </p>
            </div>
          )}

          {/* Latest 2 Headlines Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
              <span>Dernières dépêches vérifiées ({news.length} détectées) :</span>
              <button
                onClick={onOpenNewsTab}
                className="text-blue-400 hover:text-blue-300 text-[11px] flex items-center gap-0.5"
              >
                <span>Voir tout avec explications détaillées</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {news.slice(0, 2).map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col justify-between space-y-2 text-left"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span
                        className={`px-1.5 py-0.2 rounded font-semibold ${
                          item.isOfficial
                            ? 'bg-blue-900/60 text-blue-300 border border-blue-700'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {item.source}
                      </span>
                      <span className="text-slate-500 flex items-center gap-1 font-mono">
                        <Clock className="w-2.5 h-2.5" />
                        {new Date(item.publishedAt).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-slate-200 hover:text-blue-400 line-clamp-2 transition-colors flex items-start gap-1"
                    >
                      <span className="flex-1">{item.title}</span>
                      <ExternalLink className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />
                    </a>
                  </div>

                  {item.darijaExplanation && (
                    <div className="text-[11px] text-amber-200/90 bg-amber-950/20 rounded p-1.5 border border-amber-900/30 text-right line-clamp-2" dir="rtl">
                      <strong className="text-amber-400">شنو وقع : </strong>
                      {item.darijaExplanation.whatHappened}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
