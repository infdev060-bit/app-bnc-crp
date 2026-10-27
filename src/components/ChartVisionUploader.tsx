import React, { useState, useRef } from 'react';
import { VisionAnalysisResult, Timeframe } from '../types/crypto';
import { UploadCloud, Image as ImageIcon, Eye, CheckCircle2, AlertTriangle, X, ShieldAlert, Sparkles, RefreshCw } from 'lucide-react';

interface ChartVisionUploaderProps {
  currentSymbol: string;
  onAnalysisComplete: (result: VisionAnalysisResult) => void;
  activeVisionResult?: VisionAnalysisResult | null;
}

export const ChartVisionUploader: React.FC<ChartVisionUploaderProps> = ({
  currentSymbol,
  onAnalysisComplete,
  activeVisionResult,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [traderNotes, setTraderNotes] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (file: File) => {
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp', 'image/jpg'].includes(file.type)) {
      setErrorMessage('Format non supporté. Veuillez importer une image PNG, JPG ou WEBP.');
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      setErrorMessage('L’image est trop volumineuse (limite max: 12 Mo).');
      return;
    }

    setErrorMessage(null);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleAnalyze = async () => {
    if (!previewUrl) return;

    setIsAnalyzing(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/ai/analyze-chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: previewUrl,
          mimeType: selectedFile?.type || 'image/png',
          symbol: currentSymbol,
          timeframe,
          userNotes: traderNotes,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Échec de l’analyse visuelle du graphique.');
      }

      onAnalysisComplete(data.analysis);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erreur lors de la communication avec le module IA.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Eye className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              Analyse Visuelle de Graphique (IA Vision SMC)
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-950 text-blue-400 border border-blue-800">
                Gemini 3.8
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Détection des Order Blocks, Fair Value Gaps, Liquidity Sweeps, BOS & CHoCH par reconnaissance d’image.
            </p>
          </div>
        </div>
      </div>

      {/* Upload Zone */}
      {!previewUrl ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
            isDragOver
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-slate-700 bg-slate-950/40 hover:border-slate-500 hover:bg-slate-800/40'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
            accept="image/png,image/jpeg,image/webp,image/jpg"
            className="hidden"
          />
          <div className="w-12 h-12 rounded-full bg-slate-800 text-blue-400 mx-auto flex items-center justify-center mb-3">
            <UploadCloud className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-slate-200">
            Glissez-déposez une capture de votre graphique ici
          </p>
          <p className="text-xs text-slate-400 mt-1">
            ou cliquez pour parcourir vos fichiers (PNG, JPG, WEBP jusqu'à 12 Mo)
          </p>
          <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-amber-400" />
              L'IA n'invente aucun niveau non lisible sur l'image
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Preview & Controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Image Thumbnail */}
            <div className="relative rounded-lg overflow-hidden border border-slate-700 bg-slate-950 max-h-48 flex items-center justify-center group">
              <img
                src={previewUrl}
                alt="Capture de graphique"
                className="max-h-48 w-full object-contain"
              />
              <button
                onClick={clearSelection}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-slate-900/80 text-slate-300 hover:text-white hover:bg-rose-600 transition-colors"
                title="Supprimer cette image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form configuration */}
            <div className="md:col-span-2 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Unité de temps du graphique :
                  </label>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-blue-500"
                  >
                    <option value="5m">5 Minutes (5M - Scalping / Exécution)</option>
                    <option value="15m">15 Minutes (15M - Structure Intraday)</option>
                    <option value="1h">1 Heure (1H - Structure Intermédiaire)</option>
                    <option value="4h">4 Heures (4H - Swing / Tendance Macro)</option>
                    <option value="1d">1 Jour (1J - Cadre Majeur)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Actif référencé :
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={currentSymbol}
                    className="w-full bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-400 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Notes ou intentions (optionnel) :
                </label>
                <input
                  type="text"
                  value={traderNotes}
                  onChange={(e) => setTraderNotes(e.target.value)}
                  placeholder="Ex : Rejet sur Order Block H4, attente d'un CHoCH en 15M..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-md transition-colors"
                >
                  {isAnalyzing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Analyse visuelle en cours par Gemini...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-blue-200" />
                      Lancer l’Audit Visuel SMC
                    </>
                  )}
                </button>
                <button
                  onClick={clearSelection}
                  className="px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                >
                  Remplacer
                </button>
              </div>
            </div>
          </div>

          {errorMessage && (
            <div className="flex items-center gap-2 p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded-lg text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      )}

      {/* Vision Result Card */}
      {activeVisionResult && (
        <div className="mt-5 pt-4 border-t border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Rapport d'Audit Visuel IA
              </h4>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                Lisibilité: {activeVisionResult.chartReadability}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Verdict Image :</span>
              <span
                className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
                  activeVisionResult.tradeVerdict === 'CONFIG_LONG_ENVISAGEABLE'
                    ? 'bg-emerald-950 border border-emerald-700 text-emerald-300'
                    : activeVisionResult.tradeVerdict === 'CONFIG_SHORT_ENVISAGEABLE'
                    ? 'bg-rose-950 border border-rose-700 text-rose-300'
                    : 'bg-slate-800 border border-slate-700 text-slate-300'
                }`}
              >
                {activeVisionResult.tradeVerdict.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          {/* Grid of SMC Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            {/* Trend & Candlestick */}
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg space-y-1.5">
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                Dynamique & Chandeliers
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Tendance détectée:</span>
                <span className="font-semibold text-slate-200">
                  {activeVisionResult.trend.direction} ({activeVisionResult.trend.strength})
                </span>
              </div>
              <p className="text-slate-400 text-[11px] line-clamp-2">
                {activeVisionResult.candlestickStructure.description}
              </p>
            </div>

            {/* Order Blocks & FVG */}
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg space-y-1.5">
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                Order Blocks & Déséquilibres
              </div>
              <div className="text-slate-300">
                {activeVisionResult.smcElements.orderBlocks.length > 0 ? (
                  activeVisionResult.smcElements.orderBlocks.map((ob, idx) => (
                    <div key={idx} className="flex items-center justify-between py-0.5">
                      <span className={ob.type === 'BULLISH' ? 'text-emerald-400' : 'text-rose-400'}>
                        {ob.type} OB :
                      </span>
                      <span className="font-mono text-slate-200">{ob.priceZone}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-slate-500 italic">Aucun Order Block formel visible.</span>
                )}
              </div>
              <div className="text-[11px] text-slate-400">
                FVG :{' '}
                {activeVisionResult.smcElements.fairValueGaps.length > 0
                  ? activeVisionResult.smcElements.fairValueGaps.map((f) => f.priceZone).join(', ')
                  : 'Aucun comblement en attente'}
              </div>
            </div>

            {/* Liquidity & Structure */}
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg space-y-1.5">
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                Structure (BOS / CHoCH)
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Break of Structure (BOS):</span>
                <span className={activeVisionResult.smcElements.breakOfStructure.present ? 'text-blue-400 font-semibold' : 'text-slate-500'}>
                  {activeVisionResult.smcElements.breakOfStructure.present ? 'OUI' : 'NON'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Change of Character (CHoCH):</span>
                <span className={activeVisionResult.smcElements.changeOfCharacter.present ? 'text-amber-400 font-semibold' : 'text-slate-500'}>
                  {activeVisionResult.smcElements.changeOfCharacter.present ? 'OUI' : 'NON'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                Chasse liquidités : {activeVisionResult.smcElements.liquiditySweeps.side}
              </div>
            </div>
          </div>

          {/* Observations vs Interpretations Notice */}
          <div className="p-3 bg-blue-950/30 border border-blue-900/50 rounded-lg text-xs space-y-1">
            <div className="text-blue-300 font-medium">Synthèse de l’observateur :</div>
            <p className="text-slate-300 leading-relaxed">
              {activeVisionResult.overallEvaluation}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
