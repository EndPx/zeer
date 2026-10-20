const codeTheme = {
  plain: {color: '#f4f6f2', backgroundColor: '#111713'},
  styles: [
    {types: ['comment'], style: {color: '#a9b2ac'}},
    {types: ['string', 'attr-value'], style: {color: '#c1f75b'}},
    {types: ['number', 'boolean', 'keyword', 'tag'], style: {color: '#f2d49b'}},
  ],
};

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Zeer',
  tagline: 'Public chain data. Your application logic.',
  favicon: 'generated/zeer.svg',
  url: 'https://zeer.endpx.cloud',
  baseUrl: '/docs/',
  trailingSlash: true,
  organizationName: 'EndPx',
  projectName: 'zeer',
  onBrokenLinks: 'throw',
  markdown: {format: 'detect', hooks: {onBrokenMarkdownLinks: 'throw'}},
  i18n: {defaultLocale: 'en', locales: ['en']},
  clientModules: ['./src/dev-tools.js'],
  plugins: ['./plugins/preload-fonts.cjs'],
  presets: [['classic', {
    docs: {
      path: '.generated/docs',
      routeBasePath: '/',
      sidebarPath: './sidebars.js',
      showLastUpdateTime: false,
      showLastUpdateAuthor: false,
    },
    blog: false,
    theme: {customCss: './src/css/custom.css'},
  }]],
  themeConfig: {
    colorMode: {defaultMode: 'dark', disableSwitch: true, respectPrefersColorScheme: false},
    navbar: {
      title: 'zeer',
      logo: {src: 'generated/zeer.svg', alt: '', width: 32, height: 32},
      items: [
        {type: 'docSidebar', sidebarId: 'chef', label: 'Chef', position: 'left'},
        {type: 'docSidebar', sidebarId: 'prep', label: 'Prep', position: 'left'},
        {href: 'https://zeer.endpx.cloud/app', label: 'Playground', position: 'left'},
        {href: 'https://github.com/EndPx/zeer', label: 'GitHub', position: 'right'},
        {type: 'search', position: 'right'},
      ],
    },
    footer: {
      style: 'dark',
      links: [{title: 'Zeer documentation', items: [
        {label: 'Public Prep playground', href: 'https://zeer.endpx.cloud/app/prep'},
        {label: 'Chef playground', href: 'https://zeer.endpx.cloud/app/chef'},
        {label: 'Source on GitHub', href: 'https://github.com/EndPx/zeer'},
        {label: 'LLM index', href: 'https://zeer.endpx.cloud/docs/generated/llms.txt'},
      ]}],
      copyright: 'Zcash testnet · Developer preview · Public data and local, authorized shielded receipts.',
    },
    prism: {theme: codeTheme, darkTheme: codeTheme, additionalLanguages: ['bash', 'json', 'graphql', 'typescript', 'rust', 'toml', 'sql']},
  },
};
export default config;
