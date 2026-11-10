import { defineConfig } from 'vocs/config';

export default defineConfig({
  title: 'Harbor',
  iconUrl: '/harbor-mark.svg',
  description: 'Source-grounded documentation for Harbor, the NEAR Intents cross-chain DeFi agent.',
  accentColor: 'light-dark(#005fb0, #83dcff)',
  colorScheme: 'light dark',
  topNav: [
    {
      text: 'GitHub',
      link: 'https://github.com/alycz/harbor',
    },
  ],
  sidebar: [
    {
      text: 'Start here',
      items: [
        {
          text: 'Overview',
          link: '/',
        },
        {
          text: 'Quick start',
          link: '/quick-start',
        },
        {
          text: 'Current capabilities',
          link: '/status',
        },
      ],
    },
    {
      text: 'Use Harbor',
      items: [
        {
          text: 'Chat and research',
          link: '/guides/chat-research',
        },
        {
          text: 'Swap plans',
          link: '/guides/swap-plans',
        },
        {
          text: 'Price alerts',
          link: '/guides/price-alerts',
        },
        {
          text: 'Wallet sign-in',
          link: '/guides/wallet-sign-in',
        },
      ],
    },
    {
      text: 'Build with Harbor',
      items: [
        {
          text: 'Architecture',
          link: '/developers/architecture',
        },
        {
          text: 'Safety and policies',
          link: '/developers/safety',
        },
        {
          text: 'API reference',
          link: '/developers/api',
        },
        {
          text: 'Configuration',
          link: '/developers/configuration',
        },
        {
          text: 'Contributing and troubleshooting',
          link: '/developers/contributing',
        },
      ],
    },
  ],
});
