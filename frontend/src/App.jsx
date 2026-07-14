import React, { useEffect, useRef, useState } from "react";
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

// A clickable person row (co-author or top citer). Clicking loads that author.
function PersonRow({ person, onPick, unit }) {
  return (
    <button className="card person" onClick={() => onPick(person)}>
      <div className="card-title">{person.name}</div>
      <div className="card-tags">
        <span className="tag score">
          {person.count} {unit}
        </span>
      </div>
    </button>
  );
}

const MODES = [
  { key: "papers", label: "Papers" },
  { key: "authors", label: "Authors" },
  { key: "topics", label: "Topics" },
];

const PLACEHOLDERS = {
  papers: "Search a paper by title (or paste a DOI / OpenAlex ID)…",
  authors: "Search an author by name…",
  topics: "Search a topic / category (e.g. pharmacokinetics, hERG)…",
};

// OpenAlex work types worth surfacing for research scouting.
const WORK_TYPES = [
  { value: "", label: "Any type" },
  { value: "article", label: "Article" },
  { value: "review", label: "Review" },
  { value: "preprint", label: "Preprint" },
  { value: "book-chapter", label: "Book chapter" },
  { value: "dataset", label: "Dataset" },
];

const SORTS = [
  { value: "relevance", label: "Relevance" },
  { value: "cited", label: "Most cited" },
  { value: "newest", label: "Newest" },
];

const EMPTY_FILTERS = {
  fromYear: "",
  toYear: "",
  type: "",
  minCitations: "",
  sort: "relevance",
};

// Normalize the raw form state into the numeric shape api.js expects.
function normalizeFilters(f) {
  return {
    fromYear: f.fromYear ? Number(f.fromYear) : null,
    toYear: f.toYear ? Number(f.toYear) : null,
    type: f.type || null,
    minCitations: f.minCitations ? Number(f.minCitations) : null,
    sort: f.sort,
  };
}

// A compact row of paper filters: year range, type, min citations, sort.
// Applies to paper search, an author's papers, and a topic's papers.
function FilterBar({ filters, setFilters }) {
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const dirty =
    filters.fromYear ||
    filters.toYear ||
    filters.type ||
    filters.minCitations ||
    filters.sort !== "relevance";
  return (
    <div className="filters">
      <div className="filter year">
        <label>Year</label>
        <input
          type="number"
          inputMode="numeric"
          placeholder="from"
          value={filters.fromYear}
          onChange={set("fromYear")}
        />
        <span className="dash">–</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder="to"
          value={filters.toYear}
          onChange={set("toYear")}
        />
      </div>
      <div className="filter">
        <label>Type</label>
        <select value={filters.type} onChange={set("type")}>
          {WORK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="filter">
        <label>Min cites</label>
        <input
          type="number"
          inputMode="numeric"
          placeholder="0"
          value={filters.minCitations}
          onChange={set("minCitations")}
        />
      </div>
      <div className="filter">
        <label>Sort</label>
        <select value={filters.sort} onChange={set("sort")}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {dirty && (
        <button className="filter-clear" onClick={() => setFilters(EMPTY_FILTERS)}>
          Clear
        </button>
      )}
    </div>
  );
}

// Search box with a Papers/Authors/Topics mode toggle and debounced autocomplete.
function SearchBar({ mode, setMode, onPick, onPickAuthor, onPickTopic, filters }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  // Clear results when switching modes so stale hits don't linger.
  useEffect(() => {
    setResults([]);
    setOpen(false);
  }, [mode]);

  // Close the dropdown when clicking anywhere outside the search box.
  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

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
          mode === "authors"
            ? await api.searchAuthors(q, 8)
            : mode === "topics"
            ? await api.searchTopics(q, 8)
            : await api.search(q, 8, normalizeFilters(filters));
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
  }, [q, mode, filters]);

  return (
    <div className="search-wrap" ref={wrapRef}>
      <div className="mode-toggle">
        {MODES.map((m) => (
          <button
            key={m.key}
            className={mode === m.key ? "active" : ""}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="search">
        <input
          value={q}
          placeholder={PLACEHOLDERS[mode]}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            if (
              mode === "papers" &&
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
            {mode === "authors" &&
              results.map((a) => (
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
              ))}
            {mode === "topics" &&
              results.map((t) => (
                <div
                  key={t.id}
                  className="dropdown-item"
                  onClick={() => {
                    onPickTopic(t);
                    setOpen(false);
                    setQ(t.name);
                  }}
                >
                  <div className="di-title">{t.name}</div>
                  <div className="di-meta">
                    {t.field ? `${t.field} · ` : ""}
                    {t.works_count.toLocaleString()} works
                  </div>
                </div>
              ))}
            {mode === "papers" &&
              results.map((r) => (
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
        {mode === "topics" &&
          !loading &&
          q.trim().length >= 3 &&
          results.length === 0 && (
            <div className="search-hint">
              No topic matches. Topics are broad named categories — try full
              terms (e.g. "drug metabolism", "molecular docking") rather than
              acronyms like hERG or ADME.
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
  // Shared paper filters: apply to paper search, author papers, topic papers.
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // When an author is selected we show their works instead of a paper view.
  const [author, setAuthor] = useState(null);
  const [authorTab, setAuthorTab] = useState("works"); // works | coauthors | citers
  const [authorList, setAuthorList] = useState({ count: 0, results: [] });
  const [authorLoading, setAuthorLoading] = useState(false);

  // When a topic is selected we show its most-cited papers.
  const [topic, setTopic] = useState(null);
  const [topicList, setTopicList] = useState({ count: 0, results: [] });
  const [topicLoading, setTopicLoading] = useState(false);

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

  // Load an author's active sub-tab (their works, co-authors, or top citers).
  useEffect(() => {
    if (!author) return;
    let active = true;
    setAuthorLoading(true);
    setError(null);
    const fetcher =
      authorTab === "coauthors"
        ? api.coauthors(author.id)
        : authorTab === "citers"
        ? api.topCiters(author.id)
        : api.authorWorks(author.id, 50, normalizeFilters(filters));
    fetcher
      .then((d) => active && setAuthorList(d))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setAuthorLoading(false));
    return () => {
      active = false;
    };
  }, [author, authorTab, filters]);

  // Load a topic's most-cited papers when one is selected.
  useEffect(() => {
    if (!topic) return;
    let active = true;
    setTopicLoading(true);
    setError(null);
    api
      .topicWorks(topic.id, 50, normalizeFilters(filters))
      .then((d) => active && setTopicList(d))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setTopicLoading(false));
    return () => {
      active = false;
    };
  }, [topic, filters]);

  function pick(id) {
    if (focus) setHistory((h) => [focus, ...h].slice(0, 12));
    setAuthor(null); // leaving author view for a paper
    setTopic(null);
    setFocusId(id);
    setFocus(null);
    setTab("references");
  }

  function pickAuthor(a) {
    setFocusId(null);
    setFocus(null);
    setTopic(null);
    setAuthorTab("works");
    setAuthorList({ count: 0, results: [] });
    // Rows from co-author/citer lists only carry {id, name, count}; fetch the
    // full record so the header shows institution and totals.
    if (a.works_count == null) {
      setAuthor({ ...a, works_count: null, cited_by_count: null });
      api
        .author(a.id)
        .then((full) => setAuthor(full))
        .catch(() => {});
    } else {
      setAuthor(a);
    }
  }

  function pickTopic(t) {
    setFocusId(null);
    setFocus(null);
    setAuthor(null);
    setTopicList({ count: 0, results: [] });
    setTopic(t);
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div>
            <h1>Citation Explorer</h1>
            <p>
              Explore papers, authors, and topics through the citation graph —
              powered by OpenAlex
            </p>
          </div>
        </div>
        <SearchBar
          mode={mode}
          setMode={setMode}
          onPick={pick}
          onPickAuthor={pickAuthor}
          onPickTopic={pickTopic}
          filters={filters}
        />
        {(mode === "papers" || author || topic) && (
          <FilterBar filters={filters} setFilters={setFilters} />
        )}
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

      {!focusId && !author && !topic && (
        <div className="empty">
          <h2>Start with a paper, author, or topic</h2>
          <p>
            Search for a <b>paper</b> to see everything it <b>cites</b>,
            everything that <b>cites it</b>, and papers most often{" "}
            <b>co-cited</b> alongside it. Search an <b>author</b> to browse their
            work, collaborators, and who cites them. Or search a <b>topic</b> to
            see its most-cited papers. Click any result to pivot and keep
            exploring.
          </p>
        </div>
      )}

      {author && (
        <>
          <section className="focus">
            <h2 className="focus-title">{author.name}</h2>
            <div className="focus-meta">
              {author.institution ? `${author.institution} · ` : ""}
              {author.works_count != null
                ? `${author.works_count} works · ${author.cited_by_count} total citations`
                : "loading…"}
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

          <nav className="tabs">
            <button
              className={authorTab === "works" ? "active" : ""}
              onClick={() => setAuthorTab("works")}
            >
              Papers <small>(most cited)</small>
            </button>
            <button
              className={authorTab === "coauthors" ? "active" : ""}
              onClick={() => setAuthorTab("coauthors")}
            >
              Co-authors <small>(collaborators)</small>
            </button>
            <button
              className={authorTab === "citers" ? "active" : ""}
              onClick={() => setAuthorTab("citers")}
            >
              Cited by <small>(who cites them most)</small>
            </button>
          </nav>

          <div className="results">
            {authorTab === "works" && (
              <div className="section-label">
                Most-cited papers — click one to explore its citations
              </div>
            )}
            {authorTab === "coauthors" && (
              <div className="section-label">
                Most frequent collaborators across their work — click to explore
                that author
              </div>
            )}
            {authorTab === "citers" && (
              <div className="section-label">
                Researchers who most cite this author (sampled from their top
                papers) — click to explore that author
              </div>
            )}
            {error && <div className="error">{error}</div>}
            {authorLoading && <div className="loading">Loading…</div>}
            {!authorLoading &&
              authorTab === "works" &&
              authorList.results.map((p) => (
                <PaperCard key={p.id} paper={p} onPick={pick} />
              ))}
            {!authorLoading &&
              authorTab === "coauthors" &&
              authorList.results.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  onPick={pickAuthor}
                  unit="papers together"
                />
              ))}
            {!authorLoading &&
              authorTab === "citers" &&
              authorList.results.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  onPick={pickAuthor}
                  unit="citing papers"
                />
              ))}
            {!authorLoading && authorList.results.length === 0 && (
              <div className="loading">No results for this view.</div>
            )}
          </div>
        </>
      )}

      {topic && (
        <>
          <section className="focus">
            <h2 className="focus-title">{topic.name}</h2>
            <div className="focus-meta">
              {[topic.field, topic.subfield].filter(Boolean).join(" › ")}
              {topic.field ? " · " : ""}
              {topic.works_count.toLocaleString()} works
            </div>
          </section>

          <div className="results">
            <div className="section-label">
              Most-cited papers in this topic — click one to explore its
              citations
            </div>
            {error && <div className="error">{error}</div>}
            {topicLoading && <div className="loading">Loading…</div>}
            {!topicLoading &&
              topicList.results.map((p) => (
                <PaperCard key={p.id} paper={p} onPick={pick} />
              ))}
            {!topicLoading && topicList.count > topicList.results.length && (
              <div className="more-note">
                Showing {topicList.results.length} of{" "}
                {topicList.count.toLocaleString()}.
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
