import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** When this value changes, a tripped boundary resets (e.g. the panel's module). */
  resetKey?: string;
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/runtime errors thrown by a panel's module so one bad module
 * shows a contained fallback instead of white-screening the whole terminal.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[midas] panel error', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div className="flex h-full flex-col items-start gap-2 overflow-auto p-3 text-xs">
          <div className="text-term-down">⚠ {this.props.label ?? 'This panel hit an error'}.</div>
          <div className="break-all font-mono text-2xs text-term-muted">{error.message}</div>
          <button
            onClick={this.reset}
            className="no-drag mt-1 rounded-sm border border-term-border px-2 py-1 text-2xs text-term-amber hover:border-term-amber"
          >
            reload panel
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
