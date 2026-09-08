---
name: interview-research
description: Build a traceable interview brief from local evidence, low-frequency public Xiaohongshu reads and Nowcoder posts.
---

# Interview research

Use for 面经、面试问题、面试准备 and interview intelligence.

1. Read job context and confirmed company, business unit and functional role.
   Never infer an unconfirmed business unit.
2. Call `search_interview_knowledge`. Reuse captured and analyzed sources.
   Default research must include a Nowcoder discovery attempt when
   `needs_nowcoder_discovery=true`, even if enough Xiaohongshu sources exist.
   When `ready_for_brief=true`, build from verified sources without recapture.
3. Call `discover_interview_sources`. The default includes Xiaohongshu and 牛客;
   `platforms: ["nowcoder"]` can continue research when Xiaohongshu is paused.
   Expand company/role wording sparingly. A search miss or partial search does
   not prove posts do not exist. Honor `discovery_exhausted`, stop reasons,
   `cooldown_until` and `retry_after_ms`; never immediately retry or repeatedly
   change wording to spend more requests after a budget or protection stop.
4. Xiaohongshu uses a separate browser partition. The user may explicitly log
   in through the desktop connection entry; no credentials from other browsers
   are imported. A login stop needs the user to connect, not automatic retries.
   Shared navigation/scroll budgets and persistent
   cooldowns apply across jobs. Cache hits and already-loaded page text are
   preferred. Never use `search_web`, `read_web_page`, alternate crawlers or a
   different browser to bypass a paused capture path. No private API signing,
   CAPTCHA solving, account rotation, comments, likes, follows or publishing.
5. Discovery snippets are candidates, never evidence. Capture relevant posts
   with `capture_interview_source`, then use `analyze_interview_source` with
   priority given to the same business unit and role. Do not stop after two
   captures or count narrative-only posts as question evidence. Read remaining
   relevant candidates while the shared budget allows; on a budget stop retain
   unread URLs and report the continuation need without immediate retries. Use
   `collect_interview_ocr` after collecting other posts to retrieve local OCR
   jobs. Image OCR runs locally in parallel and must not block the next capture;
   do not busy-poll queued/running jobs. Report saved/processed image counts.
   OCR text is separate unverified material, never an exact author quote. Use
   short exact source quotes. Separate reported questions from preparation
   advice. Skip 404, login, CAPTCHA, empty shells and navigation pages. Cache
   and original URLs remain the evidence trail; never claim inaccessible text.
6. Images without recognized text remain `image_evidence_pending`. DOM and
   already-loaded page state extract text without extra requests. Screenshots
   or local OCR are useful for image content, but are not anti-blocking methods.
   Do not claim OCR ran when it did not, and never invent image questions.
7. Nowcoder search reports `nowcoder_pages`, `nowcoder_continuations` and
   `nowcoder_stop_reason`. For a continuation pass the exact query as
   `nowcoder_query` and page as `nowcoder_start_page`. Budgets, repeated pages
   and unrecognized HTML mean incomplete coverage. Stop on access protection.
8. Cluster verified questions and call `build_interview_brief`, retaining
   existing relevant sources. Each question must cite exact source IDs and
   include `why_it_matters` and concrete `preparation`. The tool computes
   frequency: a single source is one account, not a recurring pattern. Four
   analyzed sources including one Xiaohongshu source are the existing minimum
   for sufficient evidence; smaller or Nowcoder-only briefs remain limited.
   Never manufacture sources merely to satisfy platform coverage.
9. Connect preparation to the JD and verified resume facts. Report actual
   per-platform coverage, gaps and stop reasons. List every source actually
   used newest first with publication dates when available. Original post URLs
   are the primary action, local snapshots the backup. If Nowcoder has no
   verifiable results, say so; continue with available evidence and limits.
