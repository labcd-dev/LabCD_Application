"""Default brand, landing copy, and nav menus seeded from the marketing HTML."""

from __future__ import annotations

from typing import Any

SETTING_BRAND = "site.brand"
SETTING_LANDING = "site.landing"

MENU_LOCATIONS = (
    "header",
    "footer_product",
    "footer_resources",
    "footer_company",
    "footer_legal",
    "footer_social",
)

DEFAULT_BRAND: dict[str, Any] = {
    "brand_name": "LabCD",
    "tagline": "Lab of Control Design",
    "logo_url": "",
    "primary_color": "#22d3ee",
    "secondary_color": "#2563eb",
    "sign_in_url": "https://chat.labcd.ai",
    "access_platform_url": "https://chat.labcd.ai",
    "page_title": "AI Control Design Platform - Lab of Control Design",
    "plant_agent_hero_image_url": "",
    "plant_agent_hero_enabled": True,
}

DEFAULT_LANDING: dict[str, Any] = {
    "hero": {
        "label": "AI-Powered Control Design Platform",
        "label_emoji": "🚀",
        "heading_before": "From Prompt to",
        "heading_highlight_1": "Deployed",
        "heading_highlight_2": "Control System",
        "description": (
            "Harness Agentic AI and control engineering to deliver an end-to-end solution: "
            "synthesize, verify, improve, and deploy reliable modular control systems for "
            "robotics, aerospace, embedded systems, and mechatronics—in hours, not weeks."
        ),
        "primary_cta_label": "Try Now",
        "primary_cta_url": "https://chat.labcd.ai",
        "secondary_cta_label": "Watch Demo",
        "secondary_cta_url": "https://chat.labcd.ai",
        "visual_caption": "Inverted Pendulum Control",
    },
    "trust": {
        "title": "Enterprise-Grade Integration",
        "cards": [
            {"emoji": "⚙️", "title": "MATLAB Compatible"},
            {"emoji": "🤖", "title": "ROS Ready"},
            {"emoji": "🍓", "title": "Raspberry Pi"},
            {"emoji": "🛡️", "title": "Safety-Critical Ready"},
            {"emoji": "📊", "title": "Modular Design Pattern"},
            {"emoji": "⚡", "title": "Real-time Capable"},
        ],
    },
    "features": {
        "title": "Powerful Features",
        "subtitle": (
            "Everything you need to design, verify, and deploy production-grade "
            "control systems."
        ),
        "items": [
            {
                "title": "Control Architecture Design",
                "description": (
                    "Plan your CONTROL system from natural language specifications. "
                    "Define goals, constraints, signals, and architecture requirements "
                    "before moving into automated controller generation."
                ),
                "icon": "architecture",
            },
            {
                "title": "AI-Powered Control Synthesis",
                "description": (
                    "Automated tuning, deployment, feedback collection, and "
                    "hyperparameter optimization for MPC, PID, LQR, RL-based, and other "
                    "control systems using an iterative design pattern."
                ),
                "icon": "synthesis",
            },
            {
                "title": "Modular Design Pattern",
                "description": (
                    "Deliver a modular architecture that allows the integration of "
                    "required blocks including disturbance observer, parameter estimator, "
                    "state observer, adaptive elements, and robust terms—into the control "
                    "system according to mission requirements."
                ),
                "icon": "modular",
            },
            {
                "title": "Multi-Stage Testing (MIL/SIL/PIL)",
                "description": (
                    "Verify your design through Model-in-Loop, Software-in-Loop, and "
                    "Processor-in-Loop testing with automated reports and validation "
                    "checkpoints."
                ),
                "icon": "testing",
            },
            {
                "title": "One-Click Deployment",
                "description": (
                    "Generate optimized C/C++ code and deploy directly to your hardware. "
                    "Support for Raspberry Pi, Arduino, STM32, and more."
                ),
                "icon": "deploy",
            },
            {
                "title": "Simulation & Validation",
                "description": (
                    "Comprehensive simulation environment with scope analysis, "
                    "performance metrics, and real-time visualization of control "
                    "behavior."
                ),
                "icon": "simulation",
            },
        ],
    },
    "workflow": {
        "title": "How It Works",
        "subtitle": "A streamlined pipeline from specification to deployed system.",
        "steps": [
            {
                "title": "Natural Language Prompt",
                "description": (
                    'Describe your control system requirements in plain English: '
                    '"Design an adaptive trajectory tracking controller for this '
                    'quadrotor with minimized control effort."'
                ),
                "icon": "prompt",
            },
            {
                "title": "Agent Planning & Analysis",
                "description": (
                    "AI agents decompose requirements, analyze your system dynamics, "
                    "and propose an optimal control architecture."
                ),
                "icon": "planning",
            },
            {
                "title": "Iterative Parameter Tuning",
                "description": (
                    "Iteratively tune the parameters of each architectural block by "
                    "leveraging effective feedback from the closed-loop system response, "
                    "using AI agents empowered by efficient context engineering."
                ),
                "icon": "tuning",
            },
            {
                "title": "Verification & Testing",
                "description": (
                    "Run MIL, SIL, and PIL tests automatically. Generate traceability "
                    "reports and safety documentation."
                ),
                "icon": "verify",
            },
            {
                "title": "Hardware Deployment",
                "description": (
                    "One-click deployment of optimized C/C++ code to your target "
                    "platform. Real-time monitoring and logging included."
                ),
                "icon": "hardware",
            },
        ],
    },
    "differentiation": {
        "title": "Why LabCD?",
        "subtitle": (
            "The next evolution in control system design. Not scripting. Not manual "
            "tuning. Intelligent, structured engineering."
        ),
        "labcd_column": "LabCD",
        "traditional_column": "Traditional Approach",
        "rows": [
            {"feature": "Start from Prompt", "labcd": True, "traditional": False},
            {"feature": "AI-Powered Synthesis", "labcd": True, "traditional": False},
            {"feature": "Model-Based Design", "labcd": True, "traditional": True},
            {"feature": "Automatic Code Generation", "labcd": True, "traditional": False},
            {"feature": "Integrated Testing", "labcd": True, "traditional": False},
            {"feature": "Safety-Critical Ready", "labcd": True, "traditional": False},
            {"feature": "Requires Deep Expertise", "labcd": False, "traditional": True},
            {"feature": "Weeks to Deploy", "labcd": False, "traditional": True},
        ],
    },
    "demo": {
        "title": "See It In Action",
        "subtitle": "Watch how a control system goes from prompt to deployment in minutes.",
        "video_url": "",
        "caption": "YouTube video embed would go here • 12 minutes",
    },
    "testimonials": {
        "title": "Trusted by Engineers",
        "subtitle": "See what control systems experts are saying about LabCD.",
        "items": [
            {
                "quote": (
                    "LabCD reduced our development cycle from 12 weeks to 3 weeks. "
                    "The AI-powered synthesis and automatic testing saved us countless "
                    "hours of manual tuning."
                ),
                "author": "Dr. Sarah Chen",
                "role": "Control Systems Lead at Robotics Innovations Inc.",
                "rating": 5,
            },
            {
                "quote": (
                    "For our safety-critical robotics application, the traceability and "
                    "safety-ready documentation was invaluable. We deployed with "
                    "confidence."
                ),
                "author": "James Moretti",
                "role": "Senior Engineer at Autonomous Systems Corp.",
                "rating": 5,
            },
            {
                "quote": (
                    "The natural language interface made it accessible to engineers "
                    "without deep control theory backgrounds. Yet it remained rigorous "
                    "for advanced users."
                ),
                "author": "Dr. Yuki Tanaka",
                "role": "Research Director at Mechatronics Lab",
                "rating": 5,
            },
        ],
    },
    "final_cta": {
        "heading": "Ready to Revolutionize Your",
        "heading_line2": "Control Design?",
        "subtitle": (
            "Join engineers designing the next generation of robotics and control "
            "systems. Start free, no credit card required."
        ),
        "primary_cta_label": "Get Started Free",
        "primary_cta_url": "/login",
        "secondary_cta_label": "Schedule Demo",
        "secondary_cta_url": "#demo",
        "helper_text": "Free tier: 2 projects, full feature access. Upgrade anytime.",
    },
    "footer": {
        "description": (
            "AI-powered platform for control system analysis, design, simulation, "
            "optimization, and modern engineering workflows."
        ),
        "copyright": "© 2026 Lab of Control Design. All rights reserved.",
        "column_titles": {
            "product": "Product",
            "resources": "Resources",
            "company": "Company",
            "legal": "Legal",
        },
    },
}

DEFAULT_MENUS: list[dict[str, Any]] = [
    {"location": "header", "label": "Product", "href": "#", "sort_order": 0, "is_external": False},
    {"location": "header", "label": "Features", "href": "#features", "sort_order": 1, "is_external": False},
    {"location": "header", "label": "Workflow", "href": "#workflow", "sort_order": 2, "is_external": False},
    {"location": "header", "label": "Pricing", "href": "#", "sort_order": 3, "is_external": False},
    {"location": "header", "label": "Docs", "href": "#", "sort_order": 4, "is_external": False},
    {"location": "header", "label": "Blog", "href": "/blog", "sort_order": 5, "is_external": False},
    {"location": "footer_product", "label": "Features", "href": "#features", "sort_order": 0, "is_external": False},
    {"location": "footer_product", "label": "Pricing", "href": "#", "sort_order": 1, "is_external": False},
    {"location": "footer_product", "label": "Security", "href": "#", "sort_order": 2, "is_external": False},
    {"location": "footer_product", "label": "Roadmap", "href": "#", "sort_order": 3, "is_external": False},
    {"location": "footer_resources", "label": "Documentation", "href": "#", "sort_order": 0, "is_external": False},
    {"location": "footer_resources", "label": "API Reference", "href": "#", "sort_order": 1, "is_external": False},
    {"location": "footer_resources", "label": "Tutorials", "href": "#", "sort_order": 2, "is_external": False},
    {"location": "footer_resources", "label": "Community", "href": "#", "sort_order": 3, "is_external": False},
    {"location": "footer_company", "label": "About", "href": "#", "sort_order": 0, "is_external": False},
    {"location": "footer_company", "label": "Blog", "href": "/blog", "sort_order": 1, "is_external": False},
    {"location": "footer_company", "label": "Careers", "href": "#", "sort_order": 2, "is_external": False},
    {"location": "footer_company", "label": "Contact", "href": "#", "sort_order": 3, "is_external": False},
    {"location": "footer_legal", "label": "Privacy", "href": "#", "sort_order": 0, "is_external": False},
    {"location": "footer_legal", "label": "Terms", "href": "#", "sort_order": 1, "is_external": False},
    {"location": "footer_legal", "label": "Cookies", "href": "#", "sort_order": 2, "is_external": False},
    {"location": "footer_legal", "label": "License", "href": "#", "sort_order": 3, "is_external": False},
    {"location": "footer_social", "label": "Twitter", "href": "#", "sort_order": 0, "is_external": True},
    {"location": "footer_social", "label": "LinkedIn", "href": "#", "sort_order": 1, "is_external": True},
    {"location": "footer_social", "label": "GitHub", "href": "#", "sort_order": 2, "is_external": True},
]
