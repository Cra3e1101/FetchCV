MINIMUM_SOURCES = 4
PRIMARY_PLATFORM = "xiaohongshu"
EVIDENCE_GUIDANCE = "至少4篇且含小红书才称证据充分；不足时标注证据有限，不声称多源共性。"

def evidence_status(sources):
    verified = [source for source in sources if source.status == "analyzed" and source.extracted_questions]
    return "sufficient" if len(verified) >= MINIMUM_SOURCES and any(source.platform == PRIMARY_PLATFORM for source in verified) else "limited"


def ready_for_brief(sources):
    """Enough verified material to synthesize; coverage can still be limited."""
    return len([s for s in sources if s.status == "analyzed" and s.extracted_questions]) >= MINIMUM_SOURCES
