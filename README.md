# Citation Explorer

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

A workflow at `.github/workflows/deploy.yml` builds and deploys automatically:

1. Create a GitHub repo and push this project.
2. In the repo: **Settings → Pages → Build and deployment → Source →
   GitHub Actions**.
3. Push to `main`. The action builds `frontend/` (setting Vite's `base` to
   your repo name) and publishes it.

Your site lands at `https://<username>.github.io/<repo>/`.

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
