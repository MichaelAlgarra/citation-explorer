import React, { useEffect, useState } from "react";
import { api } from "./api.js";

function authorLine(authors) {
  if (!authors || authors.length === 0) return "Unknown authors";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} +${authors.length - 3}`;
}

// One clickable paper card. Clicking it makes that paper the new focus.
function PaperCard({ paper, onPick, score }) {
  return (
    <button className="card" onClick={() => onPick(paper.id)}>
      <div className="card-title">{paper.title || "Untitled"}</div>
      <div className="card-meta">
        <span>{authorLine(paper.authors)}</span>
        {paper.year && <span className="dot">·</span>}
        {paper.year && <span>{paper.year}</span>}
        {paper.venue && <span className="dot">·</span>}
        {paper.venue && <span className="venue">{paper.venue}</span>}
      </div>
      <div className="card-tags">
        <span className="tag">{paper.cited_by_count} citations</span>
        {score != null && <span className="tag score">co-cited ×{score}</span>}
        {paper.oa_url && (
          <a
            className="tag oa"
            href={paper.oa_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Open access
          </a>
        )}
      </div>
    </button>
  );
}

// Search box with a Papers/Authors mode toggle and debounced autocomplete.
function SearchBar({ mode, setMode, onPick, onPickAuthor }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Clear results when switching modes so stale hits don't linger.
  useEffect(() => {
    setResults([]);
    setOpen(false);
  }, [mode]);

  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data =
          mode === "authors" ? await api.searchAuthors(q, 8) : await api.search(q, 8);
        if (active) {
          setResults(data.results);
          setOpen(true);
        }
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, mode]);

  const isAuthors = mode === "authors";

  return (
    <div className="search-wrap">
      <div className="mode-toggle">
        <button
          className={!isAuthors ? "active" : ""}
          onClick={() => setMode("papers")}
        >
          Papers
        </button>
        <button
          className={isAuthors ? "active" : ""}
          onClick={() => setMode("authors")}
        >
          Authors
        </button>
      </div>
      <div className="search">
        <input
          value={q}
          placeholder={
            isAuthors
              ? "Search an author by name…"
              : "Search a paper by title (or paste a DOI / OpenAlex ID)…"
          }
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            if (
              !isAuthors &&
              e.key === "Enter" &&
              q.trim().length > 4 &&
              !results.length
            ) {
              // Treat direct input as an id/DOI lookup.
              onPick(q.trim());
              setOpen(false);
            }
          }}
        />
        {loading && <span className="search-spin">…</span>}
        {open && results.length > 0 && (
          <div className="dropdown">
            {isAuthors
              ? results.map((a) => (
                  <div
                    key={a.id}
                    className="dropdown-item"
                    onClick={() => {
                      onPickAuthor(a);
                      setOpen(false);
                      setQ(a.name);
                    }}
                  >
                    <div className="di-title">{a.name}</div>
                    <div className="di-meta">
                      {a.institution ? `${a.institution} · ` : ""}
                      {a.works_count} works · {a.cited_by_count} cites
                    </div>
                  </div>
                ))
              : results.map((r) => (
                  <div
                    key={r.id}
                    className="dropdown-item"
                    onClick={() => {
                      onPick(r.id);
                      setOpen(false);
                      setQ(r.title);
                    }}
                  >
                    <div className="di-title">{r.title}</div>
                    <div className="di-meta">
                      {authorLine(r.authors)} · {r.year} · {r.cited_by_count} cites
                    </div>
                  </div>
                ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState("papers"); // search mode: papers | authors
  const [focusId, setFocusId] = useState(null);
  const [focus, setFocus] = useState(null);
  const [tab, setTab] = useState("references");
  const [list, setList] = useState({ count: 0, results: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);

  // When an author is selected we show their works instead of a paper view.
  const [author, setAuthor] = useState(null);
  const [authorList, setAuthorList] = useState({ count: 0, results: [] });
  const [authorLoading, setAuthorLoading] = useState(false);

  // Load focus paper metadata when the id changes.
  useEffect(() => {
    if (!focusId) return;
    let active = true;
    setError(null);
    api
      .work(focusId)
      .then((w) => active && setFocus(w))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [focusId]);

  // Load the active tab's list.
  useEffect(() => {
    if (!focusId) return;
    let active = true;
    setLoading(true);
    setError(null);
    const fetcher =
      tab === "references"
        ? api.references(focusId)
        : tab === "citations"
        ? api.citations(focusId)
        : api.related(focusId);
    fetcher
      .then((d) => active && setList(d))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [focusId, tab]);

  // Load an author's works when one is selected.
  useEffect(() => {
    if (!author) return;
    let active = true;
    setAuthorLoading(true);
    setError(null);
    api
      .authorWorks(author.id)
      .then((d) => active && setAuthorList(d))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setAuthorLoading(false));
    return () => {
      active = false;
    };
  }, [author]);

  function pick(id) {
    if (focus) setHistory((h) => [focus, ...h].slice(0, 12));
    setAuthor(null); // leaving author view for a paper
    setFocusId(id);
    setFocus(null);
    setTab("references");
  }

  function pickAuthor(a) {
    setFocusId(null);
    setFocus(null);
    setAuthor(a);
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div>
            <h1>Citation Explorer</h1>
            <p>Find related papers through the citation graph — powered by OpenAlex</p>
          </div>
        </div>
        <SearchBar
          mode={mode}
          setMode={setMode}
          onPick={pick}
          onPickAuthor={pickAuthor}
        />
      </header>

      {history.length > 0 && (
        <div className="breadcrumbs">
          <span className="bc-label">Recent:</span>
          {history.map((h, i) => (
            <button key={i} className="bc" onClick={() => pick(h.id)}>
              {(h.title || "").slice(0, 40)}
              {h.title && h.title.length > 40 ? "…" : ""}
            </button>
          ))}
        </div>
      )}

      {!focusId && !author && (
        <div className="empty">
          <h2>Start with a paper or an author</h2>
          <p>
            Search for a <b>paper</b> to see everything it <b>cites</b>,
            everything that <b>cites it</b>, and papers most often{" "}
            <b>co-cited</b> alongside it. Or search an <b>author</b> to browse
            their work. Click any result to pivot and keep exploring.
          </p>
        </div>
      )}

      {author && (
        <>
          <section className="focus">
            <h2 className="focus-title">{author.name}</h2>
            <div className="focus-meta">
              {author.institution ? `${author.institution} · ` : ""}
              {author.works_count} works · {author.cited_by_count} total
              citations
              {author.orcid && (
                <>
                  {" · "}
                  <a href={author.orcid} target="_blank" rel="noreferrer">
                    ORCID
                  </a>
                </>
              )}
            </div>
          </section>

          <div className="results">
            <div className="section-label">
              Papers by this author{" "}
              {authorList.count ? `(${authorList.count.toLocaleString()})` : ""}
              , most cited first — click one to explore its citations
            </div>
            {error && <div className="error">{error}</div>}
            {authorLoading && <div className="loading">Loading…</div>}
            {!authorLoading &&
              authorList.results.map((p) => (
                <PaperCard key={p.id} paper={p} onPick={pick} />
              ))}
            {!authorLoading && authorList.count > authorList.results.length && (
              <div className="more-note">
                Showing {authorList.results.length} of{" "}
                {authorList.count.toLocaleString()}.
              </div>
            )}
          </div>
        </>
      )}

      {focus && (
        <section className="focus">
          <h2 className="focus-title">{focus.title}</h2>
          <div className="focus-meta">
            {authorLine(focus.authors)} · {focus.year}
            {focus.venue ? ` · ${focus.venue}` : ""} ·{" "}
            {focus.cited_by_count} citations
            {focus.doi && (
              <>
                {" · "}
                <a href={focus.doi} target="_blank" rel="noreferrer">
                  DOI
                </a>
              </>
            )}
          </div>
          {focus.abstract && (
            <p className="focus-abstract">{focus.abstract}</p>
          )}
        </section>
      )}

      {focusId && (
        <>
          <nav className="tabs">
            <button
              className={tab === "references" ? "active" : ""}
              onClick={() => setTab("references")}
            >
              ← References <small>(this paper cites)</small>
            </button>
            <button
              className={tab === "citations" ? "active" : ""}
              onClick={() => setTab("citations")}
            >
              Cited by → <small>(papers citing this)</small>
            </button>
            <button
              className={tab === "related" ? "active" : ""}
              onClick={() => setTab("related")}
            >
              Related <small>(co-citation)</small>
            </button>
          </nav>

          <div className="results">
            {error && <div className="error">{error}</div>}
            {loading && <div className="loading">Loading…</div>}
            {!loading && !error && list.results.length === 0 && (
              <div className="loading">No papers found for this view.</div>
            )}
            {!loading &&
              !error &&
              list.results.map((p) => (
                <PaperCard
                  key={p.id}
                  paper={p}
                  onPick={pick}
                  score={p.co_citation_score}
                />
              ))}
            {!loading && list.count > list.results.length && (
              <div className="more-note">
                Showing {list.results.length} of {list.count.toLocaleString()}.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
