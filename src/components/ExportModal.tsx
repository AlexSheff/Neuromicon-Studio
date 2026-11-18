import { CheckCircle2, Download, FileText, Loader2, X, XCircle } from 'lucide-react';
import { tFor } from '../i18n';
import { ExportProgressState, Language } from '../types/studio';

interface ExportModalProps {
  lang: Language;
  state: ExportProgressState;
  onCancel: () => void;
  onClose: () => void;
  onDownloadMetadataTxt: () => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

function formatElapsed(ms: number): string {
  const sec = ms / 1000;
  return `${sec.toFixed(1)}s`;
}

function formatEta(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

export function ExportModal({
  lang,
  state,
  onCancel,
  onClose,
  onDownloadMetadataTxt,
}: ExportModalProps) {
  const t = tFor(lang);
  if (state.phase === 'idle') return null;

  const pct =
    state.totalFrames > 0
      ? Math.min(100, Math.round((state.currentFrame / state.totalFrames) * 100))
      : 0;
  const isBusy =
    state.phase === 'preparing' || state.phase === 'encoding' || state.phase === 'muxing';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-lg border border-[#323849] bg-[#12151C] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#262B38] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-100 truncate">{t.exportModalTitle}</h3>
            {state.batchIndex !== undefined && state.batchTotal !== undefined && (
              <p className="text-[11px] font-mono text-amber-400 mt-0.5">
                {t.batchProgressLabel}: {state.batchIndex}/{state.batchTotal}
                {state.batchLabel ? ` · ${state.batchLabel}` : ''}
              </p>
            )}
          </div>
          {!isBusy && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t.closeLabel}
              className="p-1 rounded text-gray-400 hover:text-gray-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {isBusy && (
            <>
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-amber-400 animate-spin shrink-0" />
                <p className="text-xs font-medium text-gray-200">
                  {state.phase === 'preparing'
                    ? t.exportPreparing
                    : state.phase === 'muxing'
                      ? t.exportMuxing
                      : t.exportEncoding}
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="h-2 rounded-full bg-[#1E2330] overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-150"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] font-mono tabular-nums text-gray-400">
                  <span>{pct}%</span>
                  <span>
                    {state.currentFrame} / {state.totalFrames}
                  </span>
                </div>
              </div>
            </>
          )}

          {state.phase === 'complete' && (
            <>
              <div className="flex items-center gap-2.5 text-emerald-400">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <p className="text-sm font-semibold">{t.exportComplete}</p>
              </div>

              {state.streamedToDisk && (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                  {t.streamSavedNote}{' '}
                  {state.outputFileName && (
                    <span className="font-mono text-emerald-300">({state.outputFileName})</span>
                  )}
                </div>
              )}

              {state.outputUrl && (
                <div className="rounded-md border border-[#262B38] bg-black overflow-hidden">
                  <video
                    src={state.outputUrl}
                    controls
                    playsInline
                    className="w-full max-h-64 object-contain mx-auto"
                  />
                </div>
              )}
            </>
          )}

          {state.phase === 'error' && (
            <div className="flex items-start gap-2.5 text-rose-400">
              <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">{t.exportErrorTitle}</p>
                <p className="text-xs text-gray-300 mt-1">{state.errorMessage}</p>
              </div>
            </div>
          )}

          {state.phase === 'cancelled' && (
            <p className="text-sm font-medium text-gray-300">{t.exportCancelled}</p>
          )}

          {state.isNonDeterministicFallback && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300 leading-snug">
              {t.exportFallbackWarning}
            </div>
          )}

          {/* Real Encoding Metrics */}
          <div className="rounded-md border border-[#262B38] bg-[#0D1016] divide-y divide-[#262B38] text-xs">
            <div className="px-3 py-2 flex justify-between">
              <span className="text-gray-400">{t.codecLabel}</span>
              <span className="font-mono text-gray-200">{state.encoderLabel}</span>
            </div>
            <div className="px-3 py-2 flex justify-between">
              <span className="text-gray-400">{t.framesLabel}</span>
              <span className="font-mono tabular-nums text-gray-200">
                {state.currentFrame} / {state.totalFrames}
              </span>
            </div>
            <div className="px-3 py-2 flex justify-between">
              <span className="text-gray-400">{t.elapsedLabel}</span>
              <span className="font-mono tabular-nums text-gray-200">
                {formatElapsed(state.elapsedMs)}
              </span>
            </div>
            {isBusy && state.etaMs !== undefined && (
              <div className="px-3 py-2 flex justify-between">
                <span className="text-gray-400">{t.etaLabel}</span>
                <span className="font-mono tabular-nums text-amber-300">
                  {formatEta(state.etaMs)}
                </span>
              </div>
            )}
            {state.outputSizeBytes !== undefined && (
              <div className="px-3 py-2 flex justify-between">
                <span className="text-gray-400">{t.sizeLabel}</span>
                <span className="font-mono tabular-nums text-gray-200">
                  {formatBytes(state.outputSizeBytes)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-[#262B38] bg-[#0E1016] flex flex-wrap items-center justify-end gap-2.5">
          {isBusy ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-md border border-[#323849] bg-[#161A24] hover:bg-[#1F2533] text-xs font-medium text-gray-200 cursor-pointer"
            >
              {t.cancelExportBtn}
            </button>
          ) : (
            <>
              {state.phase === 'complete' && (
                <>
                  <button
                    type="button"
                    onClick={onDownloadMetadataTxt}
                    className="px-3.5 py-2 rounded-md border border-[#262B38] bg-[#161A24] hover:border-gray-500 text-xs font-medium text-gray-200 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
                    <span>{t.exportMetaTxtBtn}</span>
                  </button>
                  {state.outputUrl && (
                    <a
                      href={state.outputUrl}
                      download={state.outputFileName || `neuromicon.${state.outputFormat}`}
                      className="px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-xs font-semibold text-zinc-950 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t.downloadVideoBtn}</span>
                    </a>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-md border border-[#262B38] bg-[#161A24] hover:border-gray-500 text-xs font-medium text-gray-200 cursor-pointer"
              >
                {t.doneBtn}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
