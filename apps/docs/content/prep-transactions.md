# Transaction lookup & mempool

Prep has two distinct read paths: queries over its stored archive, and optional live observations from the configured node. Use the source and status fields to interpret the result.

## Inspect a transaction

Open [transaction inspection inside Prep Playground](https://zeer.endpx.cloud/app/prep?view=transaction). Enter a public transaction ID. The inspector presents available overview, inputs/outputs and raw views.

The optional `POST /transaction` route observes a TX ID through the configured source. Its supported states distinguish pending in that node's mempool, source-mined, and not observed. A source-mined transaction can precede its publication in the Prep archive.

An absent archive row does **not** mean pending. A not-observed result describes that source's view, not proof that the transaction never existed.

## Coinbase and public pool activity

Coinbase is identified from its actual input marker. Transaction position zero alone is not the classification rule. A block reward may have transparent outputs or public activity involving a shielded pool.

Public transparent output value and pool net movement differ from encrypted individual note amounts. Fees may be unavailable when resolving previous transparent inputs would be required. Do not invent a zero fee from missing information.

## Observe the mempool

The optional `GET /mempool` endpoint returns a bounded observation, with at most 20 metadata rows. It is not a complete persistent pending-transaction history. Source availability and observation time matter; transactions can be mined, evicted or replaced between observations.

Use [the existing Prep playground](https://zeer.endpx.cloud/app/prep) to switch to its mempool view. Live observation support depends on the deployment and node, so inspect `/capabilities` and handle source-unavailable responses.

See [the full transaction/observation contract](/docs/prep/query/) for request shapes and [coverage and access](/docs/prep/public-api/) for the hosted preview.
