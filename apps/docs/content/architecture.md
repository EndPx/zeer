# From source to API

Prep and Chef have different responsibilities. Your application can read Prep directly, or use Chef when it needs a persistent application model.

```text
Zcash source → Prep → your application
                 │
                 └→ Chef handlers → PostgreSQL → GraphQL → your application
```

## Prep: public data access

Prep stores available public chain history and returns selected fields from matching blocks and transactions. It also reports archive coverage and source status. Query continuation is tied to an archive snapshot; a changed chain branch can invalidate it.

Source preparation, retrieval and application indexing are separate workloads. Starting a query at block zero selects a historical starting point. It does not require every field from every block to arrive in one response.

## Chef: your application projection

Chef uses Prep as its data source. You define an entity schema and deterministic TypeScript handlers. Chef validates the scanned headers, processes the supported handler events in order, and commits entities with the checkpoint and undo information.

Your PostgreSQL database holds the projection. The authenticated GraphQL reader serves committed application state and checkpoint metadata. Check readiness and application coverage before interpreting entity results.

## Authorized shielded receipts

```text
Prep public transaction bytes
  → local watch-only scanner + developer's UFVK file
  → Chef receipt handler
  → private application entities in developer-owned PostgreSQL
  → authenticated local GraphQL
```

The local scanner reads only notes accessible to its configured viewing key. It does not require a spending key and does not send transactions. Private received values and memo plaintext never become public Prep fields.

## Application responsibility

Zeer provides data and indexing primitives. An application decides what its entities mean. A decrypted memo is useful metadata, while actual received note value, receiver, confirmation policy and application state determine how a payment application should act.

Keep external actions such as payments and notifications outside deterministic handlers: replay and database rollback cannot retract an already sent action.

## Follow the right guide

- [Prep quickstart](/docs/prep/quickstart/) for a direct public query.
- [Chef quickstart](/docs/chef/quickstart/) for an application database and GraphQL API.
- [Chef's shielded receipt contract](/docs/chef/shielded/overview/) for the experimental local testnet profile.
