"""Citation Explorer API.

Wraps the OpenAlex API so the frontend has a stable, small surface:
  - GET /api/search?q=...            -> find papers by title/text
  - GET /api/works/{id}              -> one paper's metadata
  - GET /api/works/{id}/references   -> papers this one cites
  - GET /api/works/{id}/citations    -> papers that cite this one
  - GET /api/works/{id}/related      -> co-citation ranked neighbors

Responses are cached in-process with a small TTL to be a good OpenAlex
citizen and to keep the UI snappy when pivoting between papers.
"""

from __future__ import annotations

# Use the OS trust store (macOS keychain) for TLS so corporate proxy CAs are
# trusted the same way curl/browsers trust them. Must run before httpx opens
# any connection.
import truststore

truststore.inject_into_ssl()

import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from openalex import OpenAlexClient

# --- tiny TTL cache -------------------------------------------------------
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 60 * 60  # 1 hour


async def cached(key: str, coro_factory):
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < _CACHE_TTL:
        return hit[1]
    value = await coro_factory()
    _CACHE[key] = (now, value)
    return value


# --- app lifecycle --------------------------------------------------------
client: OpenAlexClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    global client
    client = OpenAlexClient()
    yield
    await client.close()


app = FastAPI(title="Citation Explorer", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # frontend is static/local; tighten before any deploy
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/search")
async def search(q: str = Query(..., min_length=2), limit: int = 10):
    try:
        results = await cached(
            f"search:{q}:{limit}", lambda: client.search_works(q, per_page=limit)
        )
    except Exception as e:  # noqa: BLE001 - surface upstream errors cleanly
        raise HTTPException(status_code=502, detail=f"OpenAlex error: {e}")
    return {"query": q, "results": results}


@app.get("/api/authors")
async def search_authors(q: str = Query(..., min_length=2), limit: int = 10):
    try:
        results = await cached(
            f"authors:{q}:{limit}", lambda: client.search_authors(q, per_page=limit)
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"OpenAlex error: {e}")
    return {"query": q, "results": results}


@app.get("/api/authors/{author_id}/works")
async def author_works(author_id: str, page: int = 1, per_page: int = 50):
    per_page = min(per_page, 200)
    try:
        return await cached(
            f"authorworks:{author_id}:{page}:{per_page}",
            lambda: client.author_works(author_id, per_page=per_page, page=page),
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"OpenAlex error: {e}")


@app.get("/api/works/{work_id}")
async def get_work(work_id: str):
    try:
        return await cached(f"work:{work_id}", lambda: client.get_work(work_id))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Not found: {e}")


@app.get("/api/works/{work_id}/references")
async def references(work_id: str, page: int = 1, per_page: int = 50):
    per_page = min(per_page, 200)
    try:
        return await cached(
            f"refs:{work_id}:{page}:{per_page}",
            lambda: client.references(work_id, per_page=per_page, page=page),
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"OpenAlex error: {e}")


@app.get("/api/works/{work_id}/citations")
async def citations(work_id: str, page: int = 1, per_page: int = 50):
    per_page = min(per_page, 200)
    try:
        return await cached(
            f"cites:{work_id}:{page}:{per_page}",
            lambda: client.citations(work_id, per_page=per_page, page=page),
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"OpenAlex error: {e}")


@app.get("/api/works/{work_id}/related")
async def related(work_id: str, limit: int = 20):
    """Co-citation neighbors: other papers most often cited alongside this one.

    We take the papers that cite this work, pull each of their reference lists,
    and count which works recur most. High counts = frequently co-cited =
    topically related. This is a lightweight relatedness signal, computed live.
    """
    try:
        return await cached(
            f"related:{work_id}:{limit}",
            lambda: _compute_related(work_id, limit),
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"OpenAlex error: {e}")


async def _compute_related(work_id: str, limit: int) -> dict[str, Any]:
    # Sample the top citing papers (most-cited first), then co-citation count.
    citing = await client.citations(work_id, per_page=25, sort_by_citations=True)
    counts: dict[str, int] = {}
    meta: dict[str, dict[str, Any]] = {}
    for citer in citing["results"]:
        refs = await client.references(citer["id"], per_page=100)
        for r in refs["results"]:
            if r["id"] == work_id or not r.get("title"):
                continue
            counts[r["id"]] = counts.get(r["id"], 0) + 1
            meta[r["id"]] = r
    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    results = [{**meta[wid], "co_citation_score": score} for wid, score in ranked]
    return {"count": len(results), "results": results}
