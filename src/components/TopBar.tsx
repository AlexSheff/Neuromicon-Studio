import { Download, FolderOpen, Redo2, Save, Undo2 } from 'lucide-react';
import React, { useRef } from 'react';
import { tFor } from '../i18n';
import { InspectorTab, Language } from '../types/studio';

interface TopBarProps {
  lang: Language;
  activeTab: InspectorTab;
  hasAudio: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExportProjectJson: () => void;
  onImportProjectJson: (file: File) => void;
  onSelectSection: (section: 'media' | InspectorTab) => void;
  onStartExport: () => void;
}

export function TopBar({
  lang,
  activeTab,
  hasAudio,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onExportProjectJson,
  onImportProjectJson,
  onSelectSection,
  onStartExport,
}: TopBarProps) {
  const t = tFor(lang);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="h-14 border-b border-[#262B38] bg-[#0E1016] px-4 lg:px-6 flex items-center justify-between gap-4 shrink-0">
      {/* Zone 1: Brand Wordmark */}
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onSelectSection('media');
        }}
        className="text-base font-bold tracking-tight text-gray-100 whitespace-nowrap shrink-0 hover:text-white transition-colors"
      >
        {t.brandName}
      </a>

      {/* Zone 2: Concise single-line navigation links */}
      <nav className="hidden md:flex items-center gap-5 text-sm font-medium">
        <button
          type="button"
          onClick={() => onSelectSection('media')}
          className="text-gray-400 hover:text-gray-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1"
        >
          {t.navComposition}
        </button>
        <button
          type="button"
          onClick={() => onSelectSection('effects')}
          className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 border-b-2 ${
            activeTab === 'effects'
              ? 'text-amber-400 border-amber-500'
              : 'text-gray-400 border-transparent hover:text-gray-100'
          }`}
        >
          {t.navEffects}
        </button>
        <button
          type="button"
          onClick={() => onSelectSection('generator')}
          className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 border-b-2 ${
            activeTab === 'generator'
              ? 'text-amber-400 border-amber-500'
              : 'text-gray-400 border-transparent hover:text-gray-100'
          }`}
        >
          {t.navGenerator}
        </button>
        <button
          type="button"
          onClick={() => onSelectSection('typography')}
          className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 border-b-2 ${
            activeTab === 'typography'
              ? 'text-amber-400 border-amber-500'
              : 'text-gray-400 border-transparent hover:text-gray-100'
          }`}
        >
          {t.navTypography}
        </button>
        <button
          type="button"
          onClick={() => onSelectSection('export')}
          className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 border-b-2 ${
            activeTab === 'export'
              ? 'text-amber-400 border-amber-500'
              : 'text-gray-400 border-transparent hover:text-gray-100'
          }`}
        >
          {t.navExport}
        </button>
      </nav>

      {/* Zone 3: History, Project JSON & Primary Export CTA */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden sm:flex items-center gap-1 mr-1">
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
            className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            <FolderOpen className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
            <span>{t.importProjectJson}</span>
          </button>
          <button
            type="button"
            onClick={onExportProjectJson}
            title={t.exportProjectJson}
            aria-label={t.exportProjectJson}
            className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#262B38] bg-[#141821] hover:border-gray-500 text-[11px] font-medium text-gray-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
            <span>{t.exportProjectJson}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onStartExport}
          disabled={!hasAudio}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.primaryExportCta}</span>
        </button>
      </div>
    </header>
  );
}
