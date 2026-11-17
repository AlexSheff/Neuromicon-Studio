import { Download } from 'lucide-react';
import { tFor } from '../i18n';
import { InspectorTab, Language } from '../types/studio';

interface TopBarProps {
  lang: Language;
  activeTab: InspectorTab;
  hasAudio: boolean;
  onSelectSection: (section: 'media' | InspectorTab) => void;
  onStartExport: () => void;
}

export function TopBar({
  lang,
  activeTab,
  hasAudio,
  onSelectSection,
  onStartExport,
}: TopBarProps) {
  const t = tFor(lang);

  return (
    <header className="h-14 border-b border-[#262B38] bg-[#0E1016] px-6 flex items-center justify-between gap-8 shrink-0">
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
      <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
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

      {/* Zone 3: 1 Primary Action */}
      <div className="shrink-0">
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
