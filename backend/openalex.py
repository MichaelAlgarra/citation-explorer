"""Thin client for the OpenAlex API (https://docs.openalex.org).

No API key required. We send a `mailto` param ("polite pool") for better
rate limits and pick only the fields we need via `select` to keep responses small.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

BASE_URL = "https://api.openalex.org"
# OpenAlex asks for a contact email to put you in the faster "polite pool".
MAILTO = os.environ.get("OPENALEX_MAILTO", "citation-explorer@example.com")

# Fields we return for every author.
AUTHOR_FIELDS = ",".join(
    [
        "id",
        "display_name",
        "orcid",
        "works_count",
        "cited_by_count",
        "last_known_institutions",
    ]
)

# Fields we return for every work. Keeps payloads small and predictable.
WORK_FIELDS = ",".join(
    [
        "id",
        "doi",
        "title",
        "display_name",
        "publication_year",
        "cited_by_count",
        "authorships",
        "primary_location",
        "open_access",
    ]
)


def _short_id(openalex_id: str) -> str:
    """Turn a full OpenAlex URL id into its short form (e.g. 'W2626778328')."""
    return openalex_id.rsplit("/", 1)[-1] if openalex_id else openalex_id


def _simplify_work(w: dict[str, Any]) -> dict[str, Any]:
    """Reduce a raw OpenAlex work to the shape our frontend consumes."""
    authors = [
        a.get("author", {}).get("display_name")
        for a in (w.get("authorships") or [])
        if a.get("author")
    ]
    loc = w.get("primary_location") or {}
    source = (loc.get("source") or {}).get("display_name")
    oa = w.get("open_access") or {}
    return {
        "id": _short_id(w.get("id", "")),
        "openalex_url": w.get("id"),
        "doi": w.get("doi"),
        "title": w.get("title") or w.get("display_name"),
        "year": w.get("publication_year"),
        "cited_by_count": w.get("cited_by_count", 0),
        "authors": authors,
        "venue": source,
        "oa_url": oa.get("oa_url"),
    }


def _simplify_author(a: dict[str, Any]) -> dict[str, Any]:
    """Reduce a raw OpenAlex author to the shape our frontend consumes."""
    insts = a.get("last_known_institutions") or []
    institution = insts[0].get("display_name") if insts else None
    return {
        "id": _short_id(a.get("id", "")),
        "openalex_url": a.get("id"),
        "orcid": a.get("orcid"),
        "name": a.get("display_name"),
        "works_count": a.get("works_count", 0),
        "cited_by_count": a.get("cited_by_count", 0),
        "institution": institution,
    }


class OpenAlexClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=20.0,
            headers={"User-Agent": f"citation-explorer ({MAILTO})"},
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        params = {**params, "mailto": MAILTO}
        resp = await self._client.get(path, params=params)
        resp.raise_for_status()
        return resp.json()

    async def search_works(self, query: str, per_page: int = 10) -> list[dict[str, Any]]:
        """Free-text search over titles/abstracts. Returns simplified works."""
        data = await self._get(
            "/works",
            {"search": query, "per_page": per_page, "select": WORK_FIELDS},
        )
        return [_simplify_work(w) for w in data.get("results", [])]

    async def search_authors(
        self, query: str, per_page: int = 10
    ) -> list[dict[str, Any]]:
        """Free-text search over author names. Returns simplified authors."""
        data = await self._get(
            "/authors",
            {"search": query, "per_page": per_page, "select": AUTHOR_FIELDS},
        )
        return [_simplify_author(a) for a in data.get("results", [])]

    async def author_works(
        self, author_id: str, per_page: int = 50, page: int = 1
    ) -> dict[str, Any]:
        """Papers written by an author, most-cited first."""
        aid = _short_id(author_id)
        data = await self._get(
            "/works",
            {
                "filter": f"author.id:{aid}",
                "sort": "cited_by_count:desc",
                "per_page": per_page,
                "page": page,
                "select": WORK_FIELDS,
            },
        )
        return {
            "count": data.get("meta", {}).get("count", 0),
            "results": [_simplify_work(w) for w in data.get("results", [])],
        }

    async def get_work(self, work_id: str) -> dict[str, Any]:
        """Fetch a single work by OpenAlex id, DOI, or short id."""
        wid = _short_id(work_id)
        data = await self._get(f"/works/{wid}", {"select": WORK_FIELDS})
        return _simplify_work(data)

    async def references(
        self, work_id: str, per_page: int = 50, page: int = 1
    ) -> dict[str, Any]:
        """Papers THIS work cites (backward citations)."""
        wid = _short_id(work_id)
        data = await self._get(
            "/works",
            {
                "filter": f"cited_by:{wid}",
                "per_page": per_page,
                "page": page,
                "select": WORK_FIELDS,
            },
        )
        return {
            "count": data.get("meta", {}).get("count", 0),
            "results": [_simplify_work(w) for w in data.get("results", [])],
        }

    async def citations(
        self, work_id: str, per_page: int = 50, page: int = 1, sort_by_citations: bool = True
    ) -> dict[str, Any]:
        """Papers that CITE this work (forward citations)."""
        wid = _short_id(work_id)
        params: dict[str, Any] = {
            "filter": f"cites:{wid}",
            "per_page": per_page,
            "page": page,
            "select": WORK_FIELDS,
        }
        if sort_by_citations:
            params["sort"] = "cited_by_count:desc"
        data = await self._get("/works", params)
        return {
            "count": data.get("meta", {}).get("count", 0),
            "results": [_simplify_work(w) for w in data.get("results", [])],
        }
