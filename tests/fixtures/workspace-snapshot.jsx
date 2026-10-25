import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentMessage } from "../../src/components/AgentMessage";
import { shareWorkspaceSnapshot } from "../../src/lib/workspace-snapshot";

const mode = new URLSearchParams(location.search).get("mode");
const sourceUrl = "https://www.xiaohongshu.com/explore/fixture-source";
const initial = {
  job: { id: "fixture-job" },
  messages: Array.from({ length: 80 }, (_, index) => ({
    id: `message-${index}`, role: "assistant",
    content: `### 完整消息 ${index}\n\n这条消息用于渲染测试。\n\n| 项目 | 内容 |\n| --- | --- |\n| 保留 | 完整文本 ${index} |\n\n[来源](${sourceUrl})`,
    metadata_json: {},
  })),
  interview_sources: [{ id: "fixture-source", source_url: sourceUrl, published_at: "2026-01-01", title: "来源内容", platform: "xiaohongshu" }],
  interview_briefs: [],
};

function Fixture() {
  const [state, setState] = useState({ snapshot: initial, revision: 0 });
  useEffect(() => {
    window.snapshotFixture = {
      refresh(action) {
        setState(current => {
          const incoming = structuredClone(current.snapshot);
          if (action === "append") incoming.messages.push({ id: "appended", role: "assistant", content: "新增完整回复", metadata_json: {} });
          if (action === "content") incoming.messages[0].content += "\n\n更新后的完整正文";
          if (action === "metadata") incoming.messages[0].metadata_json.processing_duration_ms = 4500;
          if (action === "source") incoming.interview_sources[0].published_at = "2027-02-03";
          const started = performance.now();
          const snapshot = mode === "shared" ? shareWorkspaceSnapshot(current.snapshot, incoming) : incoming;
          window.snapshotStats.sharingMs += performance.now() - started;
          return { snapshot, revision: current.revision + 1 };
        });
      },
      revision: state.revision,
      snapshot: state.snapshot,
    };
  }, [state]);
  return <main data-revision={state.revision}>
    {state.snapshot.messages.map(message => <AgentMessage key={message.id} message={message}
      interviewSources={state.snapshot.interview_sources} interviewBriefs={state.snapshot.interview_briefs} />)}
  </main>;
}

window.snapshotStats = { messageRenders: 0, markdownRenders: 0, sharingMs: 0 };
createRoot(document.getElementById("root")).render(<Fixture />);
