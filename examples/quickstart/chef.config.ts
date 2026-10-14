import publicExample from "../chef-public/chef.config.ts";

// Reuse the real public-data handlers; only the fixed fixture range differs.
export default {
  ...publicExample,
  project: "quickstart_public",
  startHeight: 1687106,
  schema: "../chef-public/schema.graphql",
};
