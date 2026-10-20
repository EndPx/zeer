# Prep examples

Open [Prep Playground](https://zeer.endpx.cloud/app/prep), choose an example and inspect its generated request. Changing an example fills the inputs; **Run query** sends the request. **Use verified testnet sample** provides a known public example without substituting a recorded response.

| Question | Example to choose | What you learn |
| --- | --- | --- |
| What does a block header contain? | Block history | Heights, hashes and timestamps without transaction bodies |
| Can I find a known transaction? | Find a transaction | Transaction-ID filtering and public structure |
| Which public outputs reference an address? | Payments to an address | Transparent output matching, not shielded ownership |
| Where is a shielded pool active? | Sapling, Orchard, Ironwood or combined activity | Public component presence and counts |
| How large are transactions? | Transaction sizes & inputs | Lightweight size and entry-count projections |
| Which formats occur in this history? | Filter by version | Public format-version filtering |
| Can I decode bytes independently? | Raw transaction bytes | Complete public serialization, including ciphertext |

## Compare two projections

First request transaction identity and version only. Then add the public fields your application requires. Compare response size and usefulness while keeping the filter and historical range equivalent. Include all continuation pages in any full-range comparison.

## Understand a zero result

Before a pool's activation, its activity filter can return no matches while scanning still progresses. Inspect the cursor before concluding the captured history is complete. Use the verified sample control when demonstrating a populated modern range.

To process these records into persistent application entities, move on to [Chef examples](/docs/chef/examples/).
