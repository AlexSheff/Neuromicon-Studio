import {
  Download,
  FolderOpen,
  Globe,
  PanelLeft,
  PanelRight,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
} from 'lucide-react';
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tFor } from '../i18n';
import { InspectorTab, Language } from '../types/studio';

interface TopBarProps {
  lang: Language;
  activeTab: InspectorTab;
  hasAudio: boolean;
  canUndo: boolean;
  canRedo: boolean;
  dimsLabel: string;
  leftOpen: boolean;
  rightOpen: boolean;
  saveStatus: 'saved' | 'saving' | 'error';
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleLanguage: () => void;
  onExportProjectJson: () => void;
  onImportProjectJson: (file: File) => void;
  onResetWorkspace: () => void;
  onSelectSection: (section: 'media' | InspectorTab) => void;
  onStartExport: () => void;
}

export function TopBar({
  lang,
  activeTab,
  hasAudio,
  canUndo,
  canRedo,
  dimsLabel,
  leftOpen,
  rightOpen,
  saveStatus,
  onToggleLeftPanel,
  onToggleRightPanel,
  onUndo,
  onRedo,
  onToggleLanguage,
  onExportProjectJson,
  onImportProjectJson,
  onResetWorkspace,
  onSelectSection,
  onStartExport,
}: TopBarProps) {
  const t = tFor(lang);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const navTabs: { id: InspectorTab; label: string }[] = [
    { id: 'clip', label: t.tabClip },
    { id: 'effects', label: t.tabEffects },
    { id: 'generator', label: t.tabGenerator },
    { id: 'typography', label: t.tabTypography },
    { id: 'export', label: t.tabExport },
  ];

  return (
    <header className="h-12 border-b border-[#262B38] bg-[#0E1016] px-3 lg:px-4 flex items-center justify-between gap-3 shrink-0">
      {/* Zone 1: Panel Toggle, Brand Wordmark, Project Spec & Autosave Status */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleLeftPanel}
          title={t.toggleLeftPanel}
          aria-label={t.toggleLeftPanel}
          aria-pressed={leftOpen}
          className={`hidden lg:inline-flex p-1.5 rounded-md border transition-colors cursor-pointer ${
            leftOpen
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              : 'border-[#262B38] bg-[#141821] text-gray-400 hover:text-gray-200'
          }`}
        >
          <PanelLeft className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectSection('media');
          }}
          className="text-sm lg:text-base font-bold tracking-tight text-gray-100 whitespace-nowrap shrink-0 hover:text-white transition-colors"
        >
          {t.brandName}
        </a>

        <span className="hidden xl:inline-block px-2 py-0.5 rounded bg-[#141821] border border-[#262B38] text-[10px] font-mono tabular-nums text-gray-400 whitespace-nowrap">
          {dimsLabel}
        </span>

        <span
          className={`hidden xl:inline-block text-[10px] font-mono whitespace-nowrap ${
            saveStatus === 'error'
              ? 'text-rose-400'
              : saveStatus === 'saving'
                ? 'text-amber-300'
                : 'text-gray-500'
          }`}
        >
          {saveStatus === 'error'
            ? t.saveStatusError
            : saveStatus === 'saving'
              ? t.saveStatusSaving
              : t.saveStatusSaved}
        </span>
      </div>

      {/* Zone 2: Inspector Quick-Focus Tabs */}
      <nav className="hidden md:flex items-center gap-3 text-xs font-medium">
        <button
          type="button"
          onClick={() => onSelectSection('media')}
          className="text-gray-400 hover:text-gray-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1"
        >
          {t.navComposition}
        </button>
        <span className="text-[#262B38]" aria-hidden="true">
          |
        </span>
        {navTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectSection(tab.id)}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 border-b-2 ${
              activeTab === tab.id
                ? 'text-amber-400 border-amber-500'
                : 'text-gray-400 border-transparent hover:text-gray-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Zone 3: History, Reset, Project JSON, Right Panel Toggle, Language & Export CTA */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="hidden sm:flex items-center gap-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title={`${t.undoLabel} (Ctrl+Z)`}
            aria-label={t.undoLabel}
            className="p-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 transition-colors cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title={`${t.redoLabel} (Ctrl+Shift+Z)`}
            aria-label={t.redoLabel}
            className="p-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 transition-colors cursor-pointer"
          >
            <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          <input
            ref={jsonInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const file = e.target.files?.[0];
              if (file) onImportProjectJson(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => jsonInputRef.current?.click()}
            title={t.importProjectJson}
            aria-label={t.importProjectJson}
            className="hidden lg:inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            <FolderOpen className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
            <span className="hidden 2xl:inline">{t.importProjectJson}</span>
          </button>
          <button
            type="button"
            onClick={onExportProjectJson}
            title={t.exportProjectJson}
            aria-label={t.exportProjectJson}
            className="hidden lg:inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
            <span className="hidden 2xl:inline">{t.exportProjectJson}</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            title={t.resetWorkspaceBtn}
            aria-label={t.resetWorkspaceBtn}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-rose-500/60 hover:text-rose-300 text-[11px] font-medium text-gray-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">{t.resetWorkspaceBtn}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleRightPanel}
          title={t.toggleRightPanel}
          aria-label={t.toggleRightPanel}
          aria-pressed={rightOpen}
          className={`hidden lg:inline-flex p-1.5 rounded-md border transition-colors cursor-pointer ${
            rightOpen
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              : 'border-[#262B38] bg-[#141821] text-gray-400 hover:text-gray-200'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onToggleLanguage}
          aria-label="Switch language"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-300 transition-colors cursor-pointer whitespace-nowrap"
        >
          <Globe className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
          <span>{lang === 'ru' ? 'RU' : 'EN'}</span>
        </button>

        <button
          type="button"
          onClick={onStartExport}
          disabled={!hasAudio}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.primaryExportCta}</span>
        </button>
      </div>

      {confirmResetOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="reset-dialog-title"
              className="w-full max-w-sm rounded-lg border border-[#323849] bg-[#12151C] shadow-2xl p-5 space-y-4"
            >
              <div className="space-y-1.5">
                <h3 id="reset-dialog-title" className="text-sm font-semibold text-gray-100">
                  {t.resetConfirmTitle}
                </h3>
                <p className="text-xs text-gray-400 leading-relaxed">{t.resetConfirmDesc}</p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmResetOpen(false)}
                  className="px-3 py-1.5 rounded-md border border-[#262B38] bg-[#161A24] hover:border-gray-500 text-xs font-medium text-gray-200 cursor-pointer"
                >
                  {t.cancelAction}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmResetOpen(false);
                    onResetWorkspace();
                  }}
                  className="px-3.5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer"
                >
                  {t.resetConfirmProceed}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </header>
  );
}
