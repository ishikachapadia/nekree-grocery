# Nekree Grocery — Storefront Front-End

The front-end for a grocery e-commerce app: a product catalogue page and a product detail page that fetch live data from a REST API and render it in the browser.

## What's here

- **`index.html` / `app.js`** — the catalogue: fetches the product list from the API and renders the storefront grid.
- **`product.html` / `product.js`** — the detail view: loads a single product by ID and displays its full information.
- **`styles.css`** — shared styling for both pages.

Both scripts try the production API first and fall back to a local development server (`localhost:8001`), and surface a clear error in the page when no API is reachable.

## Status

The API this front-end was built against (`grocery.nekree.com`) is no longer running, so this repo is published as a **code case study** — it shows the front-end architecture, API integration, and error handling, but there is no live demo. Point `API_BASE` in `app.js` / `product.js` at any compatible products API to bring it back to life.

## Tech

- HTML, CSS, vanilla JavaScript
- Fetch API with multi-host fallback and user-facing error states
