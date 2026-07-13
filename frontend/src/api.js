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

export const api = {
  search: async (q, limit = 10) => ({
    results: (await listWorks({ search: q, per_page: limit })).results,
  }),
  searchAuthors: async (q, limit = 10) => {
    const data = await getJSON("/authors", {
      search: q,
      per_page: limit,
      select: AUTHOR_FIELDS,
    });
    return { results: (data.results || []).map(simplifyAuthor) };
  },
  authorWorks: (id, perPage = 50) =>
    listWorks({
      filter: `author.id:${shortId(id)}`,
      sort: "cited_by_count:desc",
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
};
