# Citation Explorer

**Live:** https://michaelalgarra.github.io/citation-explorer/

A central hub for finding papers related to each other through the citation
graph. Search for any paper and instantly see:

- **← References** — every paper it cites (backward citations)
- **Cited by →** — every paper that cites it (forward citations)
- **Related** — papers most often *co-cited* alongside it (a lightweight
  topical-relatedness signal computed on the fly)

Search by **author** to browse everything a researcher has published (most
cited first), their most frequent **co-authors**, and the people who **cite
them most** — click any collaborator or citer to pivot to that author. Useful
for mapping a field or scouting a prospective collaborator.

Search by **topic** to see the most-cited papers in any OpenAlex category
(e.g. "drug metabolism", "molecular docking").

Click any result to pivot and make it the new focus, so you can walk the
citation graph in any direction. Recent papers are kept as breadcrumbs.

Clicking a paper also shows its **abstract**. All data comes from
[OpenAlex](https://openalex.org) — free, open, and no API key required.

## Architecture

```
frontend/   Vite + React single-page app — calls the OpenAlex API directly
backend/    FastAPI mirror of the same logic (optional; for local/offline dev)
```

The app is a **pure static site**: the browser calls `api.openalex.org`
directly (OpenAlex has open CORS and needs no key), so it can be hosted for
free on GitHub Pages with no server. `src/api.js` contains all the OpenAlex
logic — abstract reconstruction, co-citation ranking, the lot.

The `backend/` FastAPI service is kept as an equivalent implementation (handy
for local dev behind a corporate proxy, or as a base for future features that
need a server, like saved libraries), but it is **not required** to run or
deploy the app.

## Running locally

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5199. That's it — no backend needed.

> If `npm install` fails with an `EEXIST`/`EACCES` error in `~/.npm`, use a
> project-local cache: `npm install --cache ../.npm-cache`.

## Deploying to GitHub Pages

This project deploys by publishing the built site to a `gh-pages` branch. To
release a new version:

```bash
# 1. push source
git push origin main

# 2. build with the Pages base path (your repo name)
VITE_BASE=/citation-explorer/ npm run build --prefix frontend
touch frontend/dist/.nojekyll

# 3. publish dist/ to the gh-pages branch
cd frontend/dist
git init -q && git checkout -q -b gh-pages
git add -A && git commit -q -m "Deploy"
git push -f https://github.com/<username>/citation-explorer.git gh-pages:gh-pages
rm -rf .git
```

Then set **Settings → Pages → Source → Deploy from a branch → `gh-pages` /
(root)** (one-time). Your site lands at
`https://<username>.github.io/citation-explorer/`.

> **Why not GitHub Actions?** An Actions workflow (`build → deploy-pages`) is
> the cleaner approach, but it requires a token/permission that can push
> `.github/workflows/*`. If yours can, add that workflow and switch the Pages
> source to "GitHub Actions" for automatic deploys on push.

> **`VITE_BASE`** must match your repo name (e.g. `/citation-explorer/`) so
> assets resolve under the Pages subpath; it defaults to `/` for local dev.

> Because the OpenAlex `mailto` ships in client code, it's set to a generic
> support address in `src/api.js`. Change it if you like, but don't use a
> personal email.

## OpenAlex calls used

| Function (`src/api.js`) | OpenAlex request |
| --- | --- |
| `search(q)` | `/works?search=` |
| `searchAuthors(q)` | `/authors?search=` |
| `searchTopics(q)` | `/topics?search=` |
| `author(id)` | `/authors/{id}` |
| `authorWorks(id)` | `/works?filter=author.id:` |
| `coauthors(id)` | author's works → tally co-authors |
| `topCiters(id)` | author's top works → authors of citing papers, counted |
| `topicWorks(id)` | `/works?filter=topics.id:` (most cited) |
| `work(id)` | `/works/{id}` (incl. abstract) |
| `references(id)` | `/works?filter=cited_by:{id}` |
| `citations(id)` | `/works?filter=cites:{id}` |
| `related(id)` | co-citation: citing papers → their references, counted |

## Ideas / next steps

- Saved libraries (persist papers of interest — would need a backend + DB)
- A visual citation graph (force-directed) instead of lists
- Pull TLDRs and "influential citations" from Semantic Scholar
- Filter references/citations by year, venue, or open-access
