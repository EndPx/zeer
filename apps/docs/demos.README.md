# Overview recordings

`static/demos/chef-query.gif` and `prep-query.gif` use before/after captures of the
actual public testnet playground on 21 October 2026. Chef queries its genesis
BlockSummary; Prep returns block headers 0 and 1. Responses were HTTP 200 and
their requested identities were checked before encoding. No result was mocked.

Each GIF plays once for four seconds, ending on the response. These are query
demonstrations, not indexing throughput measurements. Matching PNG result frames
are selected through native picture sources for `prefers-reduced-motion`.

Recordings and encoding helpers remain in the local verification evidence. Build
requires only the committed GIF/PNG assets, not a capture service or Python.
