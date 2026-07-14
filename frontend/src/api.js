// Talks directly to the OpenAlex API from the browser — no backend needed.
// OpenAlex has open CORS and requires no key. We send `mailto` to join the
// faster "polite pool". This ships in client code, so use a support address.
const BASE = "https://api.openalex.org";
const MAILTO = "citation-explorer@example.com";

const WORK_FIELDS = [
  "id",
  "doi",
  "title",
  "display_name",
  "publication_year",
  "cited_by_count",
  "authorships",
  "primary_location",
  "open_access",
  "abstract_inverted_index",
].join(",");

const AUTHOR_FIELDS = [
  "id",
  "display_name",
  "orcid",
  "works_count",
  "cited_by_count",
  "last_known_institutions",
].join(",");

function shortId(id) {
  return id ? id.split("/").pop() : id;
}

async function getJSON(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries({ ...params, mailto: MAILTO })) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenAlex request failed: ${res.status}`);
  return res.json();
}

// OpenAlex abstracts come as an inverted index {word: [positions]}. Rebuild
// the plain text by placing each word at its position(s).
function reconstructAbstract(inverted) {
  if (!inverted) return null;
  const slots = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const p of positions) slots[p] = word;
  }
  const text = slots.join(" ").trim();
  return text || null;
}

function simplifyWork(w) {
  const authors = (w.authorships || [])
    .filter((a) => a.author)
    .map((a) => a.author.display_name);
  const loc = w.primary_location || {};
  const source = (loc.source || {}).display_name || null;
  const oa = w.open_access || {};
  return {
    id: shortId(w.id || ""),
    openalex_url: w.id,
    doi: w.doi,
    title: w.title || w.display_name,
    year: w.publication_year,
    cited_by_count: w.cited_by_count || 0,
    authors,
    venue: source,
    oa_url: oa.oa_url,
    abstract: reconstructAbstract(w.abstract_inverted_index),
  };
}

function simplifyTopic(t) {
  return {
    id: shortId(t.id || ""),
    name: t.display_name,
    works_count: t.works_count || 0,
    // OpenAlex hierarchy: domain > field > subfield > topic.
    field: t.field?.display_name || null,
    subfield: t.subfield?.display_name || null,
  };
}

function simplifyAuthor(a) {
  const insts = a.last_known_institutions || [];
  return {
    id: shortId(a.id || ""),
    openalex_url: a.id,
    orcid: a.orcid,
    name: a.display_name,
    works_count: a.works_count || 0,
    cited_by_count: a.cited_by_count || 0,
    institution: insts.length ? insts[0].display_name : null,
  };
}

async function listWorks(params) {
  const data = await getJSON("/works", { select: WORK_FIELDS, ...params });
  return {
    count: data.meta?.count || 0,
    results: (data.results || []).map(simplifyWork),
  };
}

// Translate the UI filter state into OpenAlex /works filter clauses.
// { fromYear, toYear, type, minCitations } -> ["from_publication_date:…", …]
function filterClauses(f = {}) {
  const clauses = [];
  if (f.fromYear) clauses.push(`from_publication_date:${f.fromYear}-01-01`);
  if (f.toYear) clauses.push(`to_publication_date:${f.toYear}-12-31`);
  if (f.type) clauses.push(`type:${f.type}`);
  // OpenAlex `>N` is strictly greater, so subtract 1 for an inclusive minimum.
  if (f.minCitations) clauses.push(`cited_by_count:>${Math.max(0, f.minCitations - 1)}`);
  return clauses;
}

// Combine a required base filter (e.g. author.id:X) with the UI filters.
function mergeFilter(base, f) {
  return [base, ...filterClauses(f)].filter(Boolean).join(",");
}

// Sort for keyword search, where OpenAlex's default (and best) is relevance.
function searchSort(f = {}) {
  if (f.sort === "cited") return "cited_by_count:desc";
  if (f.sort === "newest") return "publication_date:desc";
  return null; // relevance — let OpenAlex default apply
}

// Sort for listings without a search term (author/topic works). Relevance is
// invalid there, so a missing/relevance choice falls back to most-cited.
function listSort(f = {}) {
  return f.sort === "newest" ? "publication_date:desc" : "cited_by_count:desc";
}

// Co-citation neighbors: papers most often cited alongside this one. We take
// the top citing papers, pull each of their reference lists, and count which
// works recur most. Mirrors the old backend /related endpoint.
async function computeRelated(id, limit = 20) {
  const citing = await listWorks({
    filter: `cites:${id}`,
    sort: "cited_by_count:desc",
    per_page: 25,
  });
  const counts = new Map();
  const meta = new Map();
  const refLists = await Promise.all(
    citing.results.map((c) =>
      listWorks({ filter: `cited_by:${c.id}`, per_page: 100 }).catch(() => ({
        results: [],
      }))
    )
  );
  for (const refs of refLists) {
    for (const r of refs.results) {
      if (r.id === id || !r.title) continue;
      counts.set(r.id, (counts.get(r.id) || 0) + 1);
      meta.set(r.id, r);
    }
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([wid, score]) => ({ ...meta.get(wid), co_citation_score: score }));
  return { count: ranked.length, results: ranked };
}

// Most frequent co-authors: tally co-authors across the author's own works.
async function coauthors(id, limit = 15) {
  const aid = shortId(id);
  const data = await getJSON("/works", {
    filter: `author.id:${aid}`,
    per_page: 100,
    select: "id,authorships",
  });
  const tally = new Map();
  for (const w of data.results || []) {
    for (const a of w.authorships || []) {
      const cid = shortId(a.author?.id);
      if (!cid || cid === aid) continue;
      const cur = tally.get(cid) || { id: cid, name: a.author.display_name, count: 0 };
      cur.count += 1;
      tally.set(cid, cur);
    }
  }
  const results = [...tally.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return { count: results.length, results };
}

// Who cites this author most: sample their top works, collect the authors of
// papers citing those works, and tally. A rough "who's paying attention" map.
async function topCiters(id, limit = 15) {
  const aid = shortId(id);
  const top = await getJSON("/works", {
    filter: `author.id:${aid}`,
    sort: "cited_by_count:desc",
    per_page: 10,
    select: "id",
  });
  const lists = await Promise.all(
    (top.results || []).map((w) =>
      getJSON("/works", {
        filter: `cites:${shortId(w.id)}`,
        per_page: 50,
        select: "authorships",
      }).catch(() => ({ results: [] }))
    )
  );
  const tally = new Map();
  for (const citing of lists) {
    for (const c of citing.results || []) {
      for (const a of c.authorships || []) {
        const cid = shortId(a.author?.id);
        if (!cid || cid === aid) continue;
        const cur = tally.get(cid) || { id: cid, name: a.author.display_name, count: 0 };
        cur.count += 1;
        tally.set(cid, cur);
      }
    }
  }
  const results = [...tally.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return { count: results.length, results };
}

export const api = {
  search: async (q, limit = 10, filters = {}) => {
    const params = { search: q, per_page: limit };
    const filter = filterClauses(filters).join(",");
    if (filter) params.filter = filter;
    const sort = searchSort(filters);
    if (sort) params.sort = sort;
    const { count, results } = await listWorks(params);
    return { count, results };
  },
  searchAuthors: async (q, limit = 10) => {
    const data = await getJSON("/authors", {
      search: q,
      per_page: limit,
      select: AUTHOR_FIELDS,
    });
    return { results: (data.results || []).map(simplifyAuthor) };
  },
  author: async (id) => {
    const data = await getJSON(`/authors/${shortId(id)}`, {
      select: AUTHOR_FIELDS,
    });
    return simplifyAuthor(data);
  },
  authorWorks: (id, perPage = 50, filters = {}) =>
    listWorks({
      filter: mergeFilter(`author.id:${shortId(id)}`, filters),
      sort: listSort(filters),
      per_page: perPage,
    }),
  work: async (id) => {
    const data = await getJSON(`/works/${shortId(id)}`, { select: WORK_FIELDS });
    return simplifyWork(data);
  },
  references: (id, perPage = 50) =>
    listWorks({ filter: `cited_by:${shortId(id)}`, per_page: perPage }),
  citations: (id, perPage = 50) =>
    listWorks({
      filter: `cites:${shortId(id)}`,
      sort: "cited_by_count:desc",
      per_page: perPage,
    }),
  related: (id, limit = 20) => computeRelated(shortId(id), limit),
  coauthors: (id, limit = 15) => coauthors(id, limit),
  topCiters: (id, limit = 15) => topCiters(id, limit),
  searchTopics: async (q, limit = 10) => {
    const data = await getJSON("/topics", {
      search: q,
      per_page: limit,
      select: "id,display_name,works_count,field,subfield",
    });
    return { results: (data.results || []).map(simplifyTopic) };
  },
  topicWorks: (id, perPage = 50, filters = {}) =>
    listWorks({
      filter: mergeFilter(`topics.id:${shortId(id)}`, filters),
      sort: listSort(filters),
      per_page: perPage,
    }),
};
