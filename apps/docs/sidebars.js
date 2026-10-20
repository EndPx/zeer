export default {
  start: [
    'intro', 'architecture',
    {type: 'category', label: 'Start with Chef', collapsed: false, items: [
      {type: 'link', label: 'Overview', href: '/docs/chef/overview/'},
      {type: 'link', label: 'Quickstart', href: '/docs/chef/quickstart/'},
      {type: 'link', label: 'Quickstart with AI', href: '/docs/chef/quickstart-ai/'},
    ]},
    {type: 'category', label: 'Start with Prep', collapsed: false, items: [
      {type: 'link', label: 'Overview', href: '/docs/prep/overview/'},
      {type: 'link', label: 'Quickstart', href: '/docs/prep/quickstart/'},
      {type: 'link', label: 'Quickstart with AI', href: '/docs/prep/quickstart-ai/'},
      {type: 'link', label: 'Getting Started', href: '/docs/prep/getting-started/'},
    ]},
  ],
  prep: [
    'prep/overview', 'prep/quickstart', 'prep/quickstart-ai', 'prep/getting-started', 'prep/clients',
    'prep/query', 'prep/fields', 'prep/examples', 'prep/curl', 'prep/tokens', 'prep/networks', 'prep/continuation',
    {type: 'category', label: 'Data reference', collapsed: false, items: ['prep/shielded', 'prep/transactions']},
    'prep/public-api', 'prep/troubleshooting',
  ],
  chef: [
    'chef/overview', 'chef/quickstart', 'chef/quickstart-ai', 'chef/benchmarks',
    {type: 'category', label: 'Building an indexer', collapsed: false, items: ['chef/configuration', 'chef/schema', 'chef/handlers', 'chef/graphql', 'chef/indexes']},
    {type: 'category', label: 'Shielded & Memos', collapsed: false, items: ['chef/shielded/overview', 'chef/shielded/local', 'chef/shielded/memos']},
    'chef/examples', 'chef/testing', 'chef/recovery', 'chef/evolution', 'chef/self-hosting',
  ],
};
