# M9 workspace layout redesign — 2026-10-09

User requested a mature Codex / ChatGPT-style agent workspace instead of the expanded form stack. Existing vanilla renderer and APP contracts retained; no framework or dependency replacement.

## Source inspection

Read actual upstream source on 2026-10-09 (master, moving branch; not a pinned reproducible snapshot):
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-layout/src/client/AppFrame.tsx
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-layout/src/client/AppFrame.module.css
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar/src/client/SidebarRoot.module.css
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-theme/src/styles/design-platform.css

Observed separate shell regions, collapsible navigation, clipped frame with independent content scrolling, optional auxiliary panel, semantic neutral surface tokens and reduced-motion handling. GitHub API tree request was rate-limited; read GitHub directory HTML and raw source instead. No upstream code copied, installed or executed. Codex reference is the user's requested visual direction; no claim of access to its private implementation.

## Changes

Compact workspace navigation and context-specific catalogue; restrained neutral surfaces; stable header and horizontal object tabs; independent main reader scroll. Conversation composer stays at the bottom. Import, retrieval, memory and notes are separate native-modal drawer views with labelled entry points, Escape and focus return. Narrow layouts hide navigation until requested, make the covered main region inert and return focus on close. Welcome actions use existing real navigation, not fake statistics or placeholder model output. Message rows distinguish user input from assistant prose.

## Verification

m9-shell-ui-01: real Electron / preload / APP utility / LPAC import and existing functional path passed, exit 0, no renderer errors, 320/768/1024/1440 widths without horizontal overflow, narrow navigation inert/Escape and drawer focus checks, composer within viewport. Screenshots inspected. Synthetic model and native picker choices; no real provider request. Review found a stale previous-run status in the composer after changing objects; cleared on object selection, and final retest pending. M9 overall remains incomplete.

Final slice: m9-shell-ui-02 passed the complete Electron path again (exit 0). Independent review caught malformed workspace scope option markup; fixed and exercised current → workspace → current with an existing record selected. Old Agent status cleared; active navigation and viewport composer assertions passed. Final desktop and narrow screenshots inspected. Independent review confirmed Required resolved.
