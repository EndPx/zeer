export default {
  start: ['intro', 'architecture'],
  prep: [
    'prep/overview', 'prep/quickstart',
    {type: 'category', label: 'Querying data', collapsed: false, items: ['prep/query', 'prep/fields', 'prep/continuation']},
    {type: 'category', label: 'Data reference', collapsed: false, items: ['prep/shielded', 'prep/transactions']},
    'prep/examples', 'prep/public-api',
  ],
  chef: [
    'chef/overview', 'chef/quickstart',
    {type: 'category', label: 'Building an indexer', collapsed: false, items: ['chef/configuration', 'chef/schema', 'chef/handlers', 'chef/graphql', 'chef/indexes']},
    {type: 'category', label: 'Shielded & Memos', collapsed: false, items: ['chef/shielded/overview', 'chef/shielded/local', 'chef/shielded/memos']},
    'chef/examples', 'chef/testing', 'chef/recovery', 'chef/evolution', 'chef/self-hosting',
  ],
};
