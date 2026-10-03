import type { LandingPayload } from '../api/types'

export const FALLBACK_LANDING: LandingPayload = {
  brand: {
    brand_name: 'LabCD',
    tagline: 'Lab of Control Design',
    logo_url: '',
    primary_color: '#22d3ee',
    secondary_color: '#2563eb',
    sign_in_url: 'https://chat.labcd.ai',
    access_platform_url: 'https://chat.labcd.ai',
    plant_agent_hero_image_url: '',
    plant_agent_hero_enabled: true,
    page_title: 'AI Control Design Platform - Lab of Control Design',
  },
  menus: {
    header: [
      { id: 1, location: 'header', label: 'Product', href: '#', sort_order: 0, is_external: false },
      { id: 2, location: 'header', label: 'Features', href: '#features', sort_order: 1, is_external: false },
      { id: 3, location: 'header', label: 'Workflow', href: '#workflow', sort_order: 2, is_external: false },
      { id: 4, location: 'header', label: 'Pricing', href: '#', sort_order: 3, is_external: false },
      { id: 5, location: 'header', label: 'Docs', href: '#', sort_order: 4, is_external: false },
      { id: 6, location: 'header', label: 'Blog', href: '/blog', sort_order: 5, is_external: false },
    ],
    footer_product: [
      { id: 7, location: 'footer_product', label: 'Features', href: '#features', sort_order: 0, is_external: false },
    ],
    footer_resources: [],
    footer_company: [
      { id: 8, location: 'footer_company', label: 'Blog', href: '/blog', sort_order: 1, is_external: false },
    ],
    footer_legal: [],
    footer_social: [],
  },
  landing: {
    hero: {
      label: 'AI-Powered Control Design Platform',
      label_emoji: '🚀',
      heading_before: 'From Prompt to',
      heading_highlight_1: 'Deployed',
      heading_highlight_2: 'Control System',
      description:
        'Harness Agentic AI and control engineering to deliver an end-to-end solution: synthesize, verify, improve, and deploy reliable modular control systems for robotics, aerospace, embedded systems, and mechatronics—in hours, not weeks.',
      primary_cta_label: 'Try Now',
      primary_cta_url: 'https://chat.labcd.ai',
      secondary_cta_label: 'Watch Demo',
      secondary_cta_url: 'https://chat.labcd.ai',
      visual_caption: 'Inverted Pendulum Control',
    },
    trust: {
      title: 'Enterprise-Grade Integration',
      cards: [
        { emoji: '⚙️', title: 'MATLAB Compatible' },
        { emoji: '🤖', title: 'ROS Ready' },
        { emoji: '🍓', title: 'Raspberry Pi' },
        { emoji: '🛡️', title: 'Safety-Critical Ready' },
        { emoji: '📊', title: 'Modular Design Pattern' },
        { emoji: '⚡', title: 'Real-time Capable' },
      ],
    },
    features: {
      title: 'Powerful Features',
      subtitle:
        'Everything you need to design, verify, and deploy production-grade control systems.',
      items: [],
    },
    workflow: { title: 'How It Works', subtitle: '', steps: [] },
    differentiation: { title: 'Why LabCD?', subtitle: '', rows: [] },
    demo: { title: 'See It In Action', subtitle: '', video_url: '', caption: '' },
    testimonials: { title: 'Trusted by Engineers', subtitle: '', items: [] },
    final_cta: {
      heading: 'Ready to Revolutionize Your',
      heading_line2: 'Control Design?',
      subtitle: '',
      primary_cta_label: 'Get Started Free',
      primary_cta_url: '/login',
      secondary_cta_label: 'Schedule Demo',
      secondary_cta_url: '#demo',
      helper_text: '',
    },
    footer: {
      description: '',
      copyright: '© 2026 Lab of Control Design. All rights reserved.',
      column_titles: {
        product: 'Product',
        resources: 'Resources',
        company: 'Company',
        legal: 'Legal',
      },
    },
  },
}
