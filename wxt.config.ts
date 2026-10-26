import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'X Timeline Filter',
    version: '0.1.5',
    description: 'Show only allowed accounts in X home timelines. Settings stay on this device.',
    permissions: ['storage'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
      },
    },
  },
});
