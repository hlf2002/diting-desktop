export const APP_NAME = 'Diting'

export const siteInfo = {
  title: APP_NAME,
  description:
    'AI-powered RSS reader for deep, noise-free reading with contextual AI.',
  webUrl: 'https://diting.7373.com.cn',
  appUrl: 'https://diting.7373.com.cn',
  githubLink: 'https://github.com/hlf2002/diting-desktop',
  githubApiLink: 'https://ungh.cc/repos/hlf2002/diting-desktop',
  xLink: 'https://x.com/diting_app',
  discordLink: 'https://discord.gg/followapp',
  productHuntLink: 'https://www.producthunt.com/posts/follow-5',
  navigation: [
    { title: 'Features', href: '/#features' },
    { title: 'Testimonials', href: '/#testimonials' },
    { title: 'FAQ', href: '/#faq' },
  ],
  seo: {
    titleTemplate: '%s — AI-powered RSS Reader',
    defaultTitle: 'Diting — AI-powered RSS Reader',
    description:
      'AI-powered RSS reader for deep, noise-free reading with contextual AI.',
    keywords: [
      'RSS reader',
      'RSS',
      'RSSHub',
      'information browser',
      'content curation',
      'news aggregator',
      'feed reader',
      'AI-powered',
      'real-time updates',
      'content discovery',
      'social media integration',
      'cross-platform',
    ] as string[],
    authors: [{ name: 'Follow Team' }] as Array<{ name: string }>,
    creator: 'Follow Team',
    publisher: 'Follow Team',
    openGraph: {
      type: 'website' as const,
      locale: 'en_US',
      url: 'https://diting.7373.com.cn',
      siteName: 'Diting',
      title: 'Diting — AI-powered RSS Reader',
      description:
        'AI-powered RSS reader for deep, noise-free reading with contextual AI.',
      images: [
        {
          url: 'https://diting.7373.com.cn/opengraph-image.png',
          width: 1200,
          height: 630,
          alt: 'Diting — AI-powered RSS Reader',
        },
      ] as Array<{
        url: string
        width: number
        height: number
        alt: string
      }>,
    },
    twitter: {
      card: 'summary_large_image' as const,
      site: '@diting_app',
      creator: '@diting_app',
      title: 'Diting — AI-powered RSS Reader',
      description:
        'AI-powered RSS reader for deep, noise-free reading with contextual AI.',
      images: ['https://diting.7373.com.cn/opengraph-image.png'] as string[],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  },
} as const
