import { Component, type ReactNode } from "react";
import { CircleAlert, Download, Home, RefreshCw } from "lucide-react";

export default class WorkspaceBoundary extends Component<
  {
    children: ReactNode;
    resetKey: string;
    onHome: () => void;
    onDownload: () => void;
    hasProject: boolean;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-loading" role="alert">
        <CircleAlert size={28} />
        <h1>The studio could not finish loading.</h1>
        <p>
          Your workspace is still available. Download your current project, then
          reload to try again.
        </p>
        <div className="recovery-actions">
          {this.props.hasProject && (
            <button
              className="button secondary"
              onClick={this.props.onDownload}
            >
              <Download size={16} />
              Download project
            </button>
          )}
          <button className="button primary" onClick={() => location.reload()}>
            <RefreshCw size={16} />
            Reload Meridian
          </button>
          <button className="button quiet" onClick={this.props.onHome}>
            <Home size={16} />
            Back to home
          </button>
        </div>
      </div>
    );
  }
}
