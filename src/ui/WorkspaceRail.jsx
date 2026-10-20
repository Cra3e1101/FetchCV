import {BookOpenCheck, FileText, Home, Settings, Search} from "lucide-react";

export function WorkspaceRail({activeView, onHome, onLibrary, onKnowledge, onSettings, onSearch}) {
  return <nav className="workspace-rail" aria-label="应用导航">
    {[
      ["home", "工作区", Home, onHome],
      ["library", "我的资料", FileText, onLibrary],
      ["knowledge", "面试知识", BookOpenCheck, onKnowledge],
    ].map(([id, label, Icon, action]) => <button key={id} type="button" title={label} aria-label={label}
      aria-current={(activeView === id || (id === "home" && activeView === "job")) ? "page" : undefined}
      onClick={action}><Icon size={20}/></button>)}
    <button type="button" title="搜索聊天 (Ctrl+K)" aria-label="搜索聊天" onClick={onSearch}><Search size={20}/></button>
    <button className="rail-settings" type="button" title="设置 (Ctrl+,)" aria-label="设置" onClick={onSettings}><Settings size={20}/></button>
  </nav>;
}
