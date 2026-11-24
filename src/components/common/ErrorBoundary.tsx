import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

function isRussianLocale(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator.language || '').toLowerCase().startsWith('ru');
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected render error',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[Neuromicon Studio ErrorBoundary]', error, info.componentStack);
  }

  private handleTryContinue = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const ru = isRussianLocale();
    const title = ru ? 'Произошла ошибка интерфейса' : 'Interface render error';
    const subtitle = ru
      ? 'Текущий проект не удалён из памяти браузера. Вы можете продолжить работу или перезагрузить страницу.'
      : 'Your project remains preserved in local storage. You can try to continue or reload the page.';
    const continueLabel = ru ? 'Попробовать продолжить' : 'Try Continue';
    const reloadLabel = ru ? 'Перезагрузить' : 'Reload';

    return (
      <div className="min-h-screen bg-[#0B0D11] text-gray-100 flex items-center justify-center p-6">
        <div
          role="alert"
          className="w-full max-w-md rounded-xl border border-rose-500/45 bg-[#121620] p-6 shadow-2xl space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/35 shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-400" aria-hidden="true" />
            </div>
            <div className="space-y-1 min-w-0">
              <h1 className="text-sm font-semibold text-gray-100">{title}</h1>
              <p className="text-xs text-gray-400 leading-relaxed">{subtitle}</p>
            </div>
          </div>

          {this.state.errorMessage && (
            <div className="rounded-md border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-[11px] font-mono text-rose-300 break-words">
              {this.state.errorMessage}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={this.handleTryContinue}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 text-xs font-medium text-amber-200 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{continueLabel}</span>
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-xs font-semibold text-zinc-950 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{reloadLabel}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
