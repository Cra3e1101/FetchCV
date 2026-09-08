import { Component } from "react";
import { AlertCircle } from "lucide-react";

export class WorkspaceBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="workspace-recovery" role="alert"><AlertCircle size={28} /><h2>这个页面暂时无法显示</h2><p>可以尝试重新打开，或从侧栏切换到其他工作区。</p><button className="primary-button" onClick={() => this.setState({ failed: false })}>重新打开页面</button></main>;
  }
}
