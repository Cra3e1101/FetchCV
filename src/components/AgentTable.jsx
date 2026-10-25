import { Check, Copy, Download } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { markdownTableRows, serializeTable } from "../lib/markdown-table";
import "./AgentTable.css";

export const MarkdownStreamingContext = createContext(false);

export function AgentTable({ node, children }) {
  const streaming = useContext(MarkdownStreamingContext);
  const rows = markdownTableRows(node);
  const [feedback, setFeedback] = useState("");
  const timer = useRef(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const announce = (text) => {
    setFeedback(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFeedback(""), 2500);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serializeTable(rows, "\t"));
      announce("已复制");
    } catch {
      announce("复制失败，请重试");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob(["\uFEFF", serializeTable(rows)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "FetchCV-表格.csv";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="agent-data-table" aria-busy={streaming}>
      <div className="agent-table-scroll" role="region" aria-label="数据表，可横向滚动" tabIndex={0}>
        <table>{children}</table>
      </div>
      <div className="agent-table-actions">
        <button type="button" onClick={copy} disabled={streaming} aria-label="复制表格" title={feedback === "已复制" ? "已复制" : "复制表格"}>
          {feedback === "已复制" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
        <button type="button" onClick={download} disabled={streaming} aria-label="导出表格 CSV" title="导出 CSV">
          <Download size={14} aria-hidden="true" />
        </button>
      </div>
      <div className={feedback.startsWith("复制失败") ? "agent-table-feedback" : "agent-table-announcement"} role="status">{feedback}</div>
    </div>
  );
}
