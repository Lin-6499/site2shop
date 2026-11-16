# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Node.js / TypeScript CLI, Playwright capture and verification, native Shopify Liquid themes, Admin GraphQL through the official Shopify CLI, Ajax Cart, and a static HTML report.

## Users
The owner uses this locally to turn a fixed reference website into a Shopify theme and test catalog. Visual fidelity, repeatable operation, and explicit evidence are priorities.

## Product Purpose
Input a URL; discover its sitemap and homepage-linked routes; capture representative pages and content snapshots; export a native theme, source assets, catalog bindings and a comparison report. Commerce mode adds photo/name customization and a grouped cart against a target test store.

## Capabilities and Constraints
West & Willow is the implemented adapter. Phase 2 covers the homepage, one portrait product with 81 variants, four paid add-on products, and a new cart. Phase 3 discovers 399 source routes and prepares read-only snapshots for 55 homepage-linked routes: 25 products, 17 collections and 13 pages. It adds generic native templates for content pages, collections and standard products. Complex customized product families remain adapter work and are not marked write-ready.

The connected test store is azhiip-13.myshopify.com. Phase 2 uses independent unpublished theme 189540892871; the original phase-1 and live themes were not changed. Products are synchronized to the store and published to its Online Store channel. Authentication stays in the official Shopify CLI; no password or token is requested in chat. Theme ZIP files do not contain the product database; another store requires a fresh output directory and its own synchronization/binding.

Local previews cannot transact. Cart and upload verification do not constitute a completed order: checkout is blocked because Shopify reports the test store is not set up to receive orders, and no order was created. Phase 3 has not created its pages, collections, navigation or additional products in Shopify and has not uploaded its theme. Reviews, fulfillment, service-promise validation, per-module merchant editing, real order tests and frame-by-frame animation fidelity remain incomplete. Other domains require adapters; this version does not promise arbitrary-URL or full-site automation.

## Brand Commitments
Reference appearance is fixed by https://westandwillow.com/. Preserve its layout, fonts, colors and assets. The added customization confirmation and cart extend that incumbent system; they are not a redesign. Report UI remains an independent readable Chinese technical document. DESIGN.md and .impeccable/design.json retain the phase-1 visual baseline; current capability status is recorded here and in README.md.

## Product Principles
Evidence before inference; preserve original layout; keep source snapshots distinct from live store data; separate generated, local, Shopify-rendered, cart/upload and order status. Match verification evidence to the theme build hash. Never equate top-1000-pixel differences with whole-site fidelity or cart success with order completion.
