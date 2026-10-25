"""Default SQLite knowledge retrieval; no network or model dependency.

Chinese uses overlapping bigrams (and single characters for one-character
queries), English uses whole words. Quoted bigram phrases preserve adjacency.
This is lexical retrieval, not semantic segmentation or vector search.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import re
import unicodedata

from sqlalchemy import select, text
from sqlalchemy.orm import defer

from .models import InterviewBrief, InterviewSource

_WORDS = re.compile(r"[\u3400-\u9fff\U00020000-\U0002fa1f]+|[a-z0-9\u00c0-\u024f]+")
_HAN = re.compile(r"^[\u3400-\u9fff\U00020000-\U0002fa1f]+$")
_PREVIEW_TERMS = 12
_PREVIEW_LENGTH = 800
# Only used by the opt-in, zero-hit natural-language fallback. This is lexical
# query relaxation, not synonym expansion or semantic understanding.
_QUESTION_FILLER = re.compile("请问|请帮我|帮我|如何|怎么|怎样|什么|哪些|为什么|是否|能否|可以|一下|关于|介绍|面试问题|面试|问题|的|了|呢|吗|和|与|及")
_SPECS = {
    "source": ("interview_sources", InterviewSource,
               ("company", "role", "business_unit", "title", "summary", "extracted_questions", "tags", "raw_text")),
    "brief": ("interview_briefs", InterviewBrief,
              ("company", "role", "business_unit", "summary", "common_questions", "recommendations", "query_terms")),
}


def _words(value: str) -> list[str]:
    return _WORDS.findall(unicodedata.normalize("NFKC", value).casefold())


def _grams(word: str) -> list[str]:
    return [word[i:i + 2] for i in range(len(word) - 1)] if _HAN.fullmatch(word) and len(word) > 1 else [word]


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)


def index_tokens(value) -> str:
    value = str(value or "")
    if value.startswith(("[", "{")):
        try:
            value = " \n ".join(_strings(json.loads(value)))
        except (ValueError, TypeError):
            pass
    tokens = []
    for word in _words(value):
        tokens.extend(_grams(word))
        tokens.append("fetchcvboundary")
        if _HAN.fullmatch(word) and len(word) > 1:
            tokens.extend(word)
            tokens.append("fetchcvboundary")
    return " ".join(tokens)


def register_search_functions(dbapi_connection, _record=None) -> None:
    dbapi_connection.create_function("fetchcv_fts_v1", 1, index_tokens, deterministic=True)


def match_query(query: str, *, any_terms: bool = False) -> str:
    # Never pass user FTS operators/column selectors through to MATCH.
    phrases = list(dict.fromkeys('"' + " ".join(_grams(w)) + '"' for w in _words(query)))
    return (" OR " if any_terms else " AND ").join(phrases)


def _relaxed_query(query: str) -> tuple[str, str]:
    words = _words(query)
    if not any(_HAN.fullmatch(word) and len(word) >= 8 for word in words):
        return "", ""
    grams = list(dict.fromkeys(
        gram for word in words if _HAN.fullmatch(word)
        for part in _QUESTION_FILLER.split(word) if len(part) >= 2
        for gram in _grams(part)
    ))[:24]
    if len(grams) < 2:
        return "", ""
    # English/code identifiers remain mandatory exact words, even in fallback.
    english = list(dict.fromkeys(word for word in words if not _HAN.fullmatch(word)))
    relaxed = "(" + " OR ".join(f'"{gram}"' for gram in grams) + ")"
    if english:
        relaxed += " AND " + match_query(" ".join(english))
    return relaxed, " ".join([*english, *grams])


def _preview_expressions(body: str, query: str) -> tuple[list[str], dict, list[str]]:
    """Extract bounded verbatim windows around candidate query terms in SQLite.

    Contentless FTS stores normalized grams, so snippet(fts) cannot recover
    source characters. Locate at most 12 query terms in the canonical body and
    score their bounded windows instead. At most 12 x 800 characters per hit
    enter Python, never an unbounded document. Keeping the small coverage sort
    in Python avoids repeated body scans by correlated SQLite subqueries.
    Common fullwidth English spellings are searched in the original body, so
    normalization never changes the offsets used to slice the quoted text.
    """
    terms = list(dict.fromkeys(_words(query)))[:_PREVIEW_TERMS]
    if not terms:
        return [f"substr({body}, 1, {_PREVIEW_LENGTH}) AS preview_0"], {}, []
    expressions, params = [], {}
    for term_id, term in enumerate(terms):
        variants = [term]
        if term.isascii():
            variants.extend("".join(chr(ord(c) + 0xFEE0) if c.isalnum() else c for c in spelling)
                            for spelling in (term, term.upper()))
        positions = []
        for variant in dict.fromkeys(variants):
            name = f"preview_needle_{len(params)}"
            params[name] = variant
            positions.append(f"nullif(instr(lower({body}), :{name}), 0)")
        position = f"coalesce({', '.join(positions)}, 1)"
        expressions.append(f"substr({body}, max(1, {position} - 80), {_PREVIEW_LENGTH}) AS preview_{term_id}")
    return expressions, params, terms


def _best_preview(fragments, terms: list[str]) -> str:
    def coverage(fragment: str) -> int:
        normalized = unicodedata.normalize("NFKC", fragment).casefold()
        words = set(_WORDS.findall(normalized))
        return sum(term in normalized if _HAN.fullmatch(term) else term in words for term in terms)
    return max(dict.fromkeys(fragment or "" for fragment in fragments), key=coverage)


def install_search_index(connection) -> None:
    """Install/backfill once. Triggers cover ORM, SQL and cascading deletion.

    The connection must register fetchcv_fts_v1, including managed migrations.
    Missing FTS5 fails explicitly rather than silently using a full table scan.
    """
    if connection.dialect.name != "sqlite":
        return
    raw = connection.connection.driver_connection
    register_search_functions(raw)
    if not raw.in_transaction:
        connection.exec_driver_sql("BEGIN")
    for kind, (table, _, columns) in _SPECS.items():
        fts = f"interview_{kind}_fts_v1"
        existing = connection.exec_driver_sql("SELECT 1 FROM sqlite_master WHERE name=?", (fts,)).scalar()
        fields = ", ".join(columns)
        values = ", ".join(f"fetchcv_fts_v1(new.{c})" for c in columns)
        old_values = ", ".join(f"fetchcv_fts_v1(old.{c})" for c in columns)
        # Contentless FTS retains postings/lengths only; the canonical original
        # and its metadata remain in the domain table. Delete requires the
        # exact previous normalized tokens, supplied transactionally by OLD.
        connection.exec_driver_sql(f"CREATE VIRTUAL TABLE IF NOT EXISTS {fts} USING fts5({fields}, content='', tokenize='unicode61 remove_diacritics 0')")
        connection.exec_driver_sql(f"""CREATE TRIGGER IF NOT EXISTS {fts}_insert AFTER INSERT ON {table}
            BEGIN INSERT INTO {fts}(rowid, {fields}) VALUES (new.rowid, {values}); END""")
        connection.exec_driver_sql(f"""CREATE TRIGGER IF NOT EXISTS {fts}_update AFTER UPDATE OF {fields} ON {table}
            BEGIN INSERT INTO {fts}({fts}, rowid, {fields}) VALUES ('delete', old.rowid, {old_values});
            INSERT INTO {fts}(rowid, {fields}) VALUES (new.rowid, {values}); END""")
        connection.exec_driver_sql(f"""CREATE TRIGGER IF NOT EXISTS {fts}_delete AFTER DELETE ON {table}
            BEGIN INSERT INTO {fts}({fts}, rowid, {fields}) VALUES ('delete', old.rowid, {old_values}); END""")
        if not existing:
            tokens = ", ".join(f"fetchcv_fts_v1({c})" for c in columns)
            connection.exec_driver_sql(f"INSERT INTO {fts}(rowid, {fields}) SELECT rowid, {tokens} FROM {table}")


def drop_search_index(connection) -> None:
    if connection.dialect.name == "sqlite":
        for kind in _SPECS:
            name = f"interview_{kind}_fts_v1"
            for suffix in ("insert", "update", "delete"):
                connection.exec_driver_sql(f"DROP TRIGGER IF EXISTS {name}_{suffix}")
            connection.exec_driver_sql(f"DROP TABLE IF EXISTS {name}")


@dataclass
class SearchHit:
    item: InterviewSource | InterviewBrief
    score: float | None
    preview: str
    match_strategy: str = "exact"


def search_knowledge(session, *, query: str = "", candidate_id: str | None = None,
                     kind: str = "source", limit: int | None = 30, offset: int = 0,
                     any_terms: bool = False, relax_if_empty: bool = False) -> list[SearchHit]:
    table, model, _ = _SPECS[kind]
    if session.bind.dialect.name != "sqlite":
        raise RuntimeError("Knowledge search requires SQLite with FTS5")
    if limit is not None and (not isinstance(limit, int) or limit < 1):
        raise ValueError("Invalid search limit")
    if offset < 0:
        raise ValueError("Invalid search offset")
    session.flush()
    match = match_query(query, any_terms=any_terms)
    if query.strip() and not match:
        return []
    fts = f"interview_{kind}_fts_v1"
    params = {"candidate": candidate_id, "limit": limit if limit is not None else -1, "offset": offset}
    where = ["s.candidate_id = :candidate"] if candidate_id is not None else []
    join, score = "", "NULL"
    order = "s.updated_at DESC, s.id"
    if match:
        join = f"JOIN {fts} ON {fts}.rowid=s.rowid"
        where.append(f"{fts} MATCH :match")
        params["match"] = match
        weights = "6,5,4,4,2,2,1,1" if kind == "source" else "6,5,4,2,2,1,1"
        score = f"bm25({fts},{weights})"
        order = "score, s.updated_at DESC, s.id"
    selection = f"FROM {table} s {join} {'WHERE ' + ' AND '.join(where) if where else ''}"
    ranked_sql = text(f"SELECT s.id, {score} AS score {selection} ORDER BY {order} LIMIT :limit OFFSET :offset")
    rows = session.execute(ranked_sql, params).mappings().all()
    strategy = "any_terms" if any_terms else "exact"
    preview_query = query
    if not rows and match and relax_if_empty and not any_terms:
        # A page beyond the strict results is not a zero-hit query. Check the
        # original candidate scope before enabling the explicitly marked fallback.
        strict_exists = offset and session.execute(text(f"SELECT 1 {selection} LIMIT 1"), params).first()
        relaxed, relaxed_preview = _relaxed_query(query)
        if not strict_exists and relaxed:
            params["match"] = relaxed
            rows = session.execute(ranked_sql, params).mappings().all()
            strategy, preview_query = "lexical_relaxed", relaxed_preview
    if not rows:
        return []
    items, previews = {}, {}
    # Select IDs/ranks first. Body processing occurs only for the selected page,
    # including when a query sorts thousands of matching index entries.
    body = f"{table}.raw_text" if kind == "source" else f"{table}.summary"
    preview, preview_params, preview_terms = _preview_expressions(body, preview_query)
    # Preserve the existing uncapped-library API without exceeding older
    # SQLite builds' bound-parameter limit for large libraries.
    for start in range(0, len(rows), 256):
        stmt = select(model, *(text(expression) for expression in preview)).where(model.id.in_([r["id"] for r in rows[start:start + 256]]))
        if candidate_id is not None:
            stmt = stmt.where(model.candidate_id == candidate_id)
        if kind == "source":
            stmt = stmt.options(defer(InterviewSource.raw_text))
        for item, *fragments in session.execute(stmt, preview_params):
            items[item.id], previews[item.id] = item, _best_preview(fragments, preview_terms)
    return [SearchHit(items[r["id"]], r["score"], previews[r["id"]], strategy) for r in rows if r["id"] in items]


def source_metadata(hit: SearchHit) -> dict:
    item = hit.item
    result = {}
    for column in item.__table__.columns:
        if column.key in {"raw_text", "content_hash", "url_hash"}:
            continue
        value = getattr(item, column.key)
        result[column.key] = value.isoformat() if hasattr(value, "isoformat") else value
    result["text_preview"] = hit.preview
    result["search_score"] = hit.score
    result["match_strategy"] = hit.match_strategy
    return result
