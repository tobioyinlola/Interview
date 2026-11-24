# ruff: noqa: E501
"""A starter list of well-known companies, so there is something real to research even when an
accelerator's directory cannot be read by a polite fetcher. Name, website, headquarters country and
what they do, all well-known public facts. Each is still researched from its own site before anyone
is contacted, and only companies that really are in the US, Europe or the UK ever get a note."""

from app.hunt.directory import Found

NAME = "Hand-picked starter list"
URL = "built in"

_US = "United States"
_UK = "United Kingdom"

SEED: list[Found] = [
    Found("Stripe", "https://stripe.com", "Online payments infrastructure", _US),
    Found("Notion", "https://www.notion.so", "Connected workspace for notes, docs and projects", _US),
    Found("Figma", "https://www.figma.com", "Collaborative interface design", _US),
    Found("Linear", "https://linear.app", "Issue tracking and product planning for teams", _US),
    Found("Vercel", "https://vercel.com", "Platform for building and deploying web apps", _US),
    Found("Ramp", "https://ramp.com", "Corporate cards and spend management", _US),
    Found("Brex", "https://www.brex.com", "Corporate cards and finance software", _US),
    Found("Gusto", "https://gusto.com", "Payroll, benefits and HR for small businesses", _US),
    Found("Rippling", "https://www.rippling.com", "Workforce management: HR, IT and finance", _US),
    Found("Webflow", "https://webflow.com", "Visual website building", _US),
    Found("Retool", "https://retool.com", "Build internal tools quickly", _US),
    Found("Plaid", "https://plaid.com", "Connects apps to bank accounts", _US),
    Found("Mercury", "https://mercury.com", "Banking for startups", _US),
    Found("Deel", "https://www.deel.com", "Global payroll and hiring", _US),
    Found("Airtable", "https://www.airtable.com", "Spreadsheet-database for team workflows", _US),
    Found("Calendly", "https://calendly.com", "Scheduling meetings without the back and forth", _US),
    Found("Zapier", "https://zapier.com", "Automates work between apps", _US),
    Found("Monzo", "https://monzo.com", "Mobile bank", _UK),
    Found("Revolut", "https://www.revolut.com", "Financial super app", _UK),
    Found("Wise", "https://wise.com", "Cheaper international money transfers", _UK),
    Found("GoCardless", "https://gocardless.com", "Bank-to-bank payments", _UK),
    Found("Checkout.com", "https://www.checkout.com", "Payments for global businesses", _UK),
    Found("Cleo", "https://web.meetcleo.com", "AI money assistant", _UK),
    Found("Octopus Energy", "https://octopus.energy", "Renewable energy supplier and software", _UK),
    Found("Tide", "https://www.tide.co", "Business banking for small businesses", _UK),
    Found("Paddle", "https://www.paddle.com", "Payments and billing for software companies", _UK),
    Found("Mollie", "https://www.mollie.com", "Payments for European businesses", "Netherlands"),
    Found("Adyen", "https://www.adyen.com", "Payments platform", "Netherlands"),
    Found("Klarna", "https://www.klarna.com", "Pay later and shopping app", "Sweden"),
    Found("Typeform", "https://www.typeform.com", "Forms and surveys that feel like conversations", "Spain"),
    Found("Personio", "https://www.personio.com", "HR software for small and medium companies", "Germany"),
    Found("N26", "https://n26.com", "Mobile bank", "Germany"),
    Found("DeepL", "https://www.deepl.com", "AI translation and writing", "Germany"),
    Found("Contentful", "https://www.contentful.com", "Content management platform", "Germany"),
    Found("Celonis", "https://www.celonis.com", "Process mining and execution", "Germany"),
    Found("Bolt", "https://bolt.eu", "Ride-hailing, scooters and delivery", "Estonia"),
    Found("Pleo", "https://www.pleo.io", "Company cards and spend management", "Denmark"),
    Found("Qonto", "https://qonto.com", "Business banking for small businesses", "France"),
    Found("Alan", "https://alan.com", "Digital health insurance", "France"),
    Found("Back Market", "https://www.backmarket.com", "Marketplace for refurbished electronics", "France"),
    Found("Spendesk", "https://www.spendesk.com", "Spend management for companies", "France"),
    Found("Mirakl", "https://www.mirakl.com", "Marketplace software", "France"),
]  # fmt: skip
