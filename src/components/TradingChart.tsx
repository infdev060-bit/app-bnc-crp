import React, { useState, useMemo, useRef } from 'react';
import { Candle, Timeframe, TradeSetup } from '../types/crypto';
import { calculateEMA } from '../utils/indicators';
import { formatCryptoPrice } from '../utils/priceFormatter';
import { ZoomIn, ZoomOut, RefreshCw, Layers } from 'lucide-react';

interface TradingChartProps {
  candles: Candle[];
  symbol: string;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  setup?: TradeSetup;
  showIndicators?: boolean;
  isLoading?: boolean;
  onRefresh?: () => void;
}

export const TradingChart: React.FC<TradingChartProps> = ({
  candles,
  symbol,
  timeframe,
  onTimeframeChange,
  setup,
  isLoading,
  onRefresh,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(60); // visible candles count
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showOverlays, setShowOverlays] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleCandles = useMemo(() => {
    if (!candles || candles.length === 0) return [];
    return candles.slice(-Math.min(zoomLevel, candles.length));
  }, [candles, zoomLevel]);

  // Compute EMAs
  const ema20 = useMemo(() => calculateEMA(candles, 20), [candles]);
  const ema50 = useMemo(() => calculateEMA(candles, 50), [candles]);

  const visibleEma20 = useMemo(() => ema20.slice(-visibleCandles.length), [ema20, visibleCandles.length]);
  const visibleEma50 = useMemo(() => ema50.slice(-visibleCandles.length), [ema50, visibleCandles.length]);

  // Scale calculations
  const { minPrice, maxPrice, maxVolume, priceRange } = useMemo(() => {
    if (visibleCandles.length === 0) {
      return { minPrice: 0, maxPrice: 100, maxVolume: 100, priceRange: 100 };
    }

    let min = Math.min(...visibleCandles.map((c) => c.low));
    let max = Math.max(...visibleCandles.map((c) => c.high));
    const maxVol = Math.max(...visibleCandles.map((c) => c.volume), 1);

    // If setup levels exist, expand bounds to include SL and TP1
    if (setup && setup.direction !== 'NO_TRADE') {
      min = Math.min(min, setup.stopLoss, setup.takeProfit1);
      max = Math.max(max, setup.stopLoss, setup.takeProfit1);
      if (setup.takeProfit2) max = Math.max(max, setup.takeProfit2);
    }

    const padding = (max - min) * 0.08 || 1;
    return {
      minPrice: min - padding,
      maxPrice: max + padding,
      maxVolume: maxVol,
      priceRange: (max + padding) - (min - padding) || 1,
    };
  }, [visibleCandles, setup]);

  const hoveredCandle = hoverIndex !== null && visibleCandles[hoverIndex] ? visibleCandles[hoverIndex] : visibleCandles[visibleCandles.length - 1];

  // Canvas / SVG Dimensions
  const chartHeight = 380;
  const volumeHeight = 70;
  const priceChartHeight = chartHeight - volumeHeight;

  const getY = (price: number) => {
    return priceChartHeight - ((price - minPrice) / priceRange) * priceChartHeight;
  };

  const handleZoom = (delta: number) => {
    setZoomLevel((prev) => Math.min(Math.max(prev + delta, 25), Math.min(candles.length || 100, 150)));
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col">
      {/* Chart Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-slate-950/80 border-b border-slate-800 gap-2 text-xs">
        {/* Left: Symbol & Timeframe buttons */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-mono font-semibold text-slate-100 text-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            {symbol}
          </div>

          <div className="flex items-center bg-slate-900 rounded-lg p-0.5 border border-slate-800">
            {(['5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  timeframe === tf
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-800 text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 bg-cyan-400 inline-block"></span> EMA 20
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 bg-amber-400 inline-block"></span> EMA 50
            </span>
          </div>
        </div>

        {/* Right: Controls & Indicators toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOverlays(!showOverlays)}
            title="Activer/Désactiver les tracés SMC & Setup"
            className={`flex items-center gap-1 px-2.5 py-1 rounded border transition-colors ${
              showOverlays
                ? 'bg-blue-950/60 border-blue-600 text-blue-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Niveaux & SMC</span>
          </button>

          <div className="flex items-center bg-slate-900 rounded border border-slate-800">
            <button
              onClick={() => handleZoom(-10)}
              className="p-1.5 text-slate-400 hover:text-slate-100 transition-colors"
              title="Zoom Avant"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleZoom(10)}
              className="p-1.5 text-slate-400 hover:text-slate-100 transition-colors border-l border-slate-800"
              title="Zoom Arrière"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              title="Rafraîchir les bougies"
              className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Candlestick HUD info */}
      {hoveredCandle && (
        <div className="px-4 py-1.5 bg-slate-950/50 border-b border-slate-800/60 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono text-slate-400">
          <div>
            <span className="text-slate-500">Date: </span>
            <span className="text-slate-300">
              {new Date(hoveredCandle.time).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
                day: '2-digit',
                month: '2-digit',
              })}
            </span>
          </div>
          <div>
            <span className="text-slate-500">O: </span>
            <span className="text-slate-200">{formatCryptoPrice(hoveredCandle.open, setup?.tickSize)}</span>
          </div>
          <div>
            <span className="text-slate-500">H: </span>
            <span className="text-emerald-400">{formatCryptoPrice(hoveredCandle.high, setup?.tickSize)}</span>
          </div>
          <div>
            <span className="text-slate-500">L: </span>
            <span className="text-rose-400">{formatCryptoPrice(hoveredCandle.low, setup?.tickSize)}</span>
          </div>
          <div>
            <span className="text-slate-500">C: </span>
            <span className={hoveredCandle.close >= hoveredCandle.open ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
              {formatCryptoPrice(hoveredCandle.close, setup?.tickSize)}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Vol: </span>
            <span className="text-slate-300">{hoveredCandle.volume.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</span>
          </div>
        </div>
      )}

      {/* Main Interactive SVG Chart */}
      <div
        ref={containerRef}
        className="relative w-full h-[380px] bg-slate-950/95 cursor-crosshair select-none"
        onMouseLeave={() => setHoverIndex(null)}
      >
        {isLoading && (
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-20">
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 shadow-xl">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
              <span>Chargement du flux {symbol} ({timeframe})...</span>
            </div>
          </div>
        )}

        {!isLoading && visibleCandles.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 text-slate-400 space-y-2 p-4 text-center">
            <Layers className="w-8 h-8 text-slate-600" />
            <p className="text-xs font-medium text-slate-300">
              Aucun chandelier OHLCV disponible pour {symbol} sur l'unité {timeframe}.
            </p>
            <p className="text-[11px] text-slate-500">
              Vérifiez la disponibilité de cette paire sur Binance Spot ou Binance Futures.
            </p>
          </div>
        )}

        <svg
          className="w-full h-full"
          viewBox={`0 0 1000 ${chartHeight}`}
          preserveAspectRatio="none"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const xRatio = (e.clientX - rect.left) / rect.width;
            const index = Math.floor(xRatio * visibleCandles.length);
            if (index >= 0 && index < visibleCandles.length) {
              setHoverIndex(index);
            }
          }}
        >
          <defs>
            <linearGradient id="bullVolumeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="bearVolumeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Grid lines horizontal */}
          {[0.2, 0.4, 0.6, 0.8].map((ratio) => {
            const y = priceChartHeight * ratio;
            const p = maxPrice - ratio * priceRange;
            return (
              <g key={ratio}>
                <line x1="0" y1={y} x2="1000" y2={y} stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
                <text x="990" y={y - 4} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="monospace">
                  {formatCryptoPrice(p, setup?.tickSize)}
                </text>
              </g>
            );
          })}

          {/* Volume separator */}
          <line x1="0" y1={priceChartHeight} x2="1000" y2={priceChartHeight} stroke="#334155" strokeWidth="1" />
          <text x="15" y={priceChartHeight + 14} fill="#64748b" fontSize="9" fontFamily="sans-serif">
            VOLUME
          </text>

          {/* Volume Bars */}
          {visibleCandles.map((c, i) => {
            const candleWidth = 1000 / visibleCandles.length;
            const x = i * candleWidth;
            const volRatio = c.volume / maxVolume;
            const barH = volRatio * (volumeHeight - 15);
            const y = chartHeight - barH;
            const isBull = c.close >= c.open;

            return (
              <rect
                key={`vol-${c.time}-${i}`}
                x={x + candleWidth * 0.2}
                y={y}
                width={Math.max(candleWidth * 0.6, 1)}
                height={Math.max(barH, 1)}
                fill={isBull ? 'url(#bullVolumeGrad)' : 'url(#bearVolumeGrad)'}
                stroke={isBull ? '#10b981' : '#f43f5e'}
                strokeWidth="0.5"
                opacity={0.8}
              />
            );
          })}

          {/* Candlesticks */}
          {visibleCandles.map((c, i) => {
            const candleWidth = 1000 / visibleCandles.length;
            const centerX = i * candleWidth + candleWidth / 2;
            const isBull = c.close >= c.open;

            const highY = getY(c.high);
            const lowY = getY(c.low);
            const openY = getY(c.open);
            const closeY = getY(c.close);

            const bodyTop = Math.min(openY, closeY);
            const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);
            const bodyWidth = Math.max(candleWidth * 0.7, 1.5);
            const bodyLeft = centerX - bodyWidth / 2;

            const color = isBull ? '#10b981' : '#f43f5e';

            return (
              <g key={`candle-${c.time}-${i}`}>
                {/* Wick */}
                <line
                  x1={centerX}
                  y1={highY}
                  x2={centerX}
                  y2={lowY}
                  stroke={color}
                  strokeWidth={Math.min(Math.max(candleWidth * 0.15, 1), 2)}
                />
                {/* Body */}
                <rect
                  x={bodyLeft}
                  y={bodyTop}
                  width={bodyWidth}
                  height={bodyHeight}
                  fill={isBull ? '#10b981' : '#f43f5e'}
                  rx="1"
                />
              </g>
            );
          })}

          {/* EMA 20 line (Cyan) */}
          {visibleEma20.length > 1 && (
            <polyline
              fill="none"
              stroke="#06b6d4"
              strokeWidth="1.5"
              strokeLinecap="round"
              points={visibleEma20
                .map((val, i) => {
                  const candleWidth = 1000 / visibleCandles.length;
                  const x = i * candleWidth + candleWidth / 2;
                  const y = getY(val);
                  return `${x},${y}`;
                })
                .join(' ')}
            />
          )}

          {/* EMA 50 line (Amber) */}
          {visibleEma50.length > 1 && (
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="4 2"
              points={visibleEma50
                .map((val, i) => {
                  const candleWidth = 1000 / visibleCandles.length;
                  const x = i * candleWidth + candleWidth / 2;
                  const y = getY(val);
                  return `${x},${y}`;
                })
                .join(' ')}
            />
          )}

          {/* Trade Setup Overlay Lines (Entry, SL, TP1, TP2) */}
          {showOverlays && setup && setup.direction !== 'NO_TRADE' && (
            <g>
              {/* Entry Line (Blue) */}
              <line
                x1="0"
                y1={getY(setup.entryPrice)}
                x2="1000"
                y2={getY(setup.entryPrice)}
                stroke="#3b82f6"
                strokeWidth="1.5"
                strokeDasharray="5 3"
              />
              <rect x="10" y={getY(setup.entryPrice) - 10} width="190" height="18" fill="#1e3a8a" rx="4" />
              <text x="16" y={getY(setup.entryPrice) + 3} fill="#93c5fd" fontSize="10" fontWeight="bold" fontFamily="monospace">
                ENTRÉE : {formatCryptoPrice(setup.entryPrice, setup.tickSize)}$
              </text>

              {/* Stop Loss Line (Red) */}
              <line
                x1="0"
                y1={getY(setup.stopLoss)}
                x2="1000"
                y2={getY(setup.stopLoss)}
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <rect x="10" y={getY(setup.stopLoss) - 10} width="190" height="18" fill="#7f1d1d" rx="4" />
              <text x="16" y={getY(setup.stopLoss) + 3} fill="#fca5a5" fontSize="10" fontWeight="bold" fontFamily="monospace">
                STOP LOSS : {formatCryptoPrice(setup.stopLoss, setup.tickSize)}$
              </text>

              {/* Take Profit 1 Line (Green) */}
              <line
                x1="0"
                y1={getY(setup.takeProfit1)}
                x2="1000"
                y2={getY(setup.takeProfit1)}
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <rect x="10" y={getY(setup.takeProfit1) - 10} width="220" height="18" fill="#064e3b" rx="4" />
              <text x="16" y={getY(setup.takeProfit1) + 3} fill="#6ee7b7" fontSize="10" fontWeight="bold" fontFamily="monospace">
                TP1 : {formatCryptoPrice(setup.takeProfit1, setup.tickSize)}$ (R/R {setup.riskRewardRatioTP1}:1)
              </text>

              {/* Take Profit 2 Line (Emerald) */}
              {setup.takeProfit2 && (
                <>
                  <line
                    x1="0"
                    y1={getY(setup.takeProfit2)}
                    x2="1000"
                    y2={getY(setup.takeProfit2)}
                    stroke="#059669"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <rect x="10" y={getY(setup.takeProfit2) - 9} width="220" height="16" fill="#064e3b" rx="4" opacity="0.9" />
                  <text x="16" y={getY(setup.takeProfit2) + 3} fill="#a7f3d0" fontSize="9" fontWeight="bold" fontFamily="monospace">
                    TP2 : {formatCryptoPrice(setup.takeProfit2, setup.tickSize)}$ (R/R {setup.riskRewardRatioTP2}:1)
                  </text>
                </>
              )}
            </g>
          )}

          {/* Interactive Crosshair */}
          {hoverIndex !== null && (
            <g>
              {(() => {
                const candleWidth = 1000 / visibleCandles.length;
                const x = hoverIndex * candleWidth + candleWidth / 2;
                const c = visibleCandles[hoverIndex];
                const y = getY(c.close);
                const formattedClose = formatCryptoPrice(c.close, setup?.tickSize);
                const badgeWidth = Math.max(75, formattedClose.length * 8 + 12);

                return (
                  <>
                    <line x1={x} y1="0" x2={x} y2={chartHeight} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
                    <line x1="0" y1={y} x2="1000" y2={y} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
                    <circle cx={x} cy={y} r="3" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
                    <rect x={1000 - badgeWidth - 5} y={y - 9} width={badgeWidth} height="18" fill="#0f172a" rx="2" stroke="#475569" />
                    <text x={1000 - badgeWidth} y={y + 3} fill="#f8fafc" fontSize="9" fontFamily="monospace">
                      {formattedClose}
                    </text>
                  </>
                );
              })()}
            </g>
          )}
        </svg>

        {/* Legend Overlay at bottom left */}
        <div className="absolute bottom-2 left-4 pointer-events-none flex items-center gap-3 text-[11px] text-slate-400 bg-slate-950/80 px-2 py-1 rounded border border-slate-800/80">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-xs"></span> Hausse
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-rose-500 rounded-xs"></span> Baisse
          </span>
          {setup && setup.direction !== 'NO_TRADE' && (
            <span className="flex items-center gap-1 text-blue-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span> Plan Actif ({setup.direction})
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
