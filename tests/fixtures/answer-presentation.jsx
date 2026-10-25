// Synthetic data; renders the production message component and production styles.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/ui/workspace.css";
import { AgentMessage } from "../../src/components/AgentMessage";
import { applyInterfaceTheme } from "../../src/ui/interface-theme";
import "../../src/ui/replica-alignment.css";
import "../../src/ui/replica-components.css";

const cities = ["上海", "北京", "深圳", "广州", "杭州", "成都", "南京", "武汉", "苏州", "西安"];
const table = count => `| 城市 | 示例数值（分） |\n| :--- | ---: |\n${cities.slice(0, count).map((city, i) => `| ${city} | ${100 - i} |`).join("\n")}`;
const extra = `\n\n### 多字段对比\n\n| 城市 | 薪酬 | 生活成本 | 行业 | 机会 | 通勤 | 备注 | 来源 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| **上海** | 未提供 | 未核实 | 示例 | 示例 | 未提供 | A\\|B，含逗号与"引号" | [原始资料](https://example.com/source) |\n\n### 后续步骤\n\n1. 核对统计日期和口径。\n2. 查看原始资料。\n\n\`\`\`text\n这里是代码，不应转换成表格\n\`\`\``;
function Fixture() {
  const [streaming, setStreaming] = useState(false);
  return <>
    <nav aria-label="测试控制"><button onClick={() => setStreaming(true)}>模拟生成</button><button onClick={() => setStreaming(false)}>完成生成</button></nav>
    <main className="source-grid" style={{ display: "block", maxWidth: 800, margin: "0 auto", padding: "0 24px 24px", boxSizing: "border-box" }}>
      <AgentMessage message={{ id: streaming ? "streaming-assistant" : "fixture-answer", role: "assistant", content: `这是呈现测试的合成数据，不代表真实城市排名。\n\n${table(streaming ? 2 : 10)}${streaming ? "" : extra}` }} />
    </main>
  </>;
}
applyInterfaceTheme(new URLSearchParams(location.search).get("theme") || "white");
createRoot(document.getElementById("root")).render(<Fixture />);
