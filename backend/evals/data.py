"""Labelled evaluation data. Plain Python so it can be reviewed and extended in a diff.

DETECTION: 100 interviewer utterances, 50 that need an answer outline and 50 that do not.
A "question" is anything the candidate is expected to answer or speak to, including a request such
as "Tell me about yourself." Non-questions are small talk, greetings, acknowledgements, half
sentences and housekeeping, which must show NO outline."""

# (text, kind) where kind is the question type, or "none"
QUESTIONS: list[tuple[str, str]] = [
    # behavioral
    ("Tell me about a time you led a project under a tight deadline.", "behavioral"),
    (
        "Can you describe a situation where you disagreed with a teammate and how you handled it?",
        "behavioral",
    ),
    ("Give me an example of a goal you set and how you achieved it.", "behavioral"),
    ("Tell me about a time you failed.", "behavioral"),
    ("Describe a moment when you had to learn something quickly.", "behavioral"),
    ("What is the hardest feedback you have received and what did you do with it?", "behavioral"),
    ("Walk me through a project you are proud of.", "behavioral"),
    ("Tell me about a time you had to influence someone without authority.", "behavioral"),
    ("Have you ever had to deliver bad news to a stakeholder? How did it go?", "behavioral"),
    ("Tell me about yourself.", "behavioral"),
    # technical
    ("How would you design a rate limiter for a public API?", "technical"),
    ("What is the difference between a process and a thread?", "technical"),
    ("Explain how a database index works and when it can hurt performance.", "technical"),
    ("How do you decide between SQL and a document database?", "technical"),
    ("What happens when you type a URL into a browser and press enter?", "technical"),
    ("How would you measure the success of a new onboarding flow?", "technical"),
    ("Can you explain what idempotency means and why it matters for payments?", "technical"),
    ("How do you prioritise a backlog when everything is urgent?", "technical"),
    ("What trade-offs would you consider when choosing between building and buying?", "technical"),
    ("Walk me through how you would debug a sudden spike in API latency.", "technical"),
    # situational
    ("What would you do if two senior stakeholders asked for conflicting features?", "situational"),
    (
        "Imagine a launch is two days away and a critical bug appears. What do you do?",
        "situational",
    ),
    ("How would you handle a teammate who consistently misses deadlines?", "situational"),
    ("Suppose you inherit a product with no documentation. Where do you start?", "situational"),
    (
        "If your manager asked you to cut scope by half, how would you decide what goes?",
        "situational",
    ),
    ("What would your first ninety days in this role look like?", "situational"),
    (
        "How would you respond if a customer threatened to leave over a missing feature?",
        "situational",
    ),
    ("Say the data contradicts your intuition. What do you do?", "situational"),
    (
        "What would you do if you realised you had made a mistake in a report already sent to the board?",
        "situational",
    ),
    ("How would you approach a market you know nothing about?", "situational"),
    # motivation and company
    ("Why do you want to work here?", "company"),
    ("What do you know about our company?", "company"),
    ("Why are you leaving your current role?", "motivation"),
    ("Where do you see yourself in five years?", "motivation"),
    ("What attracted you to this position?", "motivation"),
    ("Why should we hire you?", "motivation"),
    ("What do you think is our biggest challenge right now?", "company"),
    ("How do you see our product evolving over the next two years?", "company"),
    ("What does a great working culture look like to you?", "company"),
    ("What are you looking for in your next role?", "motivation"),
    # follow-up
    ("Can you say more about that?", "follow-up"),
    ("What was your specific contribution there?", "follow-up"),
    ("How did you measure the result?", "follow-up"),
    ("And what would you do differently next time?", "follow-up"),
    ("Why did you choose that approach over the alternatives?", "follow-up"),
    ("Who else was involved and what was your role compared to theirs?", "follow-up"),
    ("Could you walk me through the numbers on that?", "follow-up"),
    ("What was the outcome for the customer?", "follow-up"),
    ("Do you have any questions for us?", "other"),
    ("Is there anything else you would like us to know about you?", "other"),
]

NON_QUESTIONS: list[str] = [
    # greetings and small talk
    "Good morning, it's nice to meet you.",
    "Thanks for making the time today.",
    "Hi there, welcome.",
    "Sorry, my connection is a bit slow today.",
    "It has been a long week for everyone, I think.",
    "The weather has been terrible here lately.",
    "I'm Sam, I lead the platform team here.",
    "We are a team of about forty people at the moment.",
    "Great, thank you.",
    "That's interesting.",
    # acknowledgements
    "Mm-hm, right.",
    "Okay, great.",
    "Got it.",
    "Yeah, that makes sense.",
    "Right, ok.",
    "Sure, no problem.",
    "Uh-huh.",
    "Perfect.",
    "Understood, thanks.",
    "Alright then.",
    # housekeeping and thinking aloud
    "Let me just pull up your résumé for a second.",
    "One moment while I find the notes.",
    "I'll share my screen in a minute.",
    "Bear with me, I'm just taking some notes here.",
    "Hold on, I think my microphone cut out.",
    "We have about forty minutes together today.",
    "I'll walk you through how the session will run.",
    "Let me scroll up to the last page.",
    "We'll leave time at the end for your thoughts.",
    "I was just reading through your portfolio.",
    # half sentences and fragments
    "So the next thing we usually",
    "And what I wanted to ask was, uh,",
    "Okay so, um,",
    "Right, and then",
    "So basically what happens is that",
    "I was going to say that when",
    "Just a second, I need to",
    "So, to start with,",
    "Well, the thing about that is",
    "And on the other hand,",
    # statements and feedback, not requests
    "That was a really clear explanation.",
    "I see you worked at a few startups before.",
    "Our engineering team is spread across three time zones.",
    "We shipped a big release last quarter.",
    "The role reports to the head of product.",
    "I appreciate you sharing that.",
    "That's a good example, thank you.",
    "We're looking to hire two people for this team.",
    "I think that covers most of what I wanted to hear.",
    "Thanks, that gives me a good picture.",
]

DETECTION: list[tuple[str, bool]] = [(q, True) for q, _ in QUESTIONS] + [
    (t, False) for t in NON_QUESTIONS
]

SAMPLE_ROLE = "Product Manager"

# Three personas of notes. Outlines are graded against these, with and without a company brief.
NOTE_SETS: dict[str, str] = {
    "pm": (
        "## Launch project\nLed the 2025 checkout launch at Acme with a team of 6. Cut onboarding time "
        "by 30% and raised conversion from 2.1% to 2.6%.\n## Stakeholders\nRan weekly reviews with "
        "finance and legal; resolved a pricing disagreement by testing both options for two weeks."
    ),
    "engineer": (
        "## Payments migration\nMigrated a monolith's billing to a service in Go over 5 months; zero "
        "downtime. Used PostgreSQL and Kafka.\n## Incident\nDebugged a latency spike caused by a "
        "missing index; p95 dropped from 900 ms to 120 ms."
    ),
    "thin": "## Experience\nTwo years in customer support at Initech. Interested in moving into product.",
}

BRIEF = (
    "- Snapshot: Northwind builds payroll software for small businesses in Europe. [brief: Northwind site]\n"
    "- Products and customers: Sells a payroll app to companies with 5 to 50 employees. [brief: Northwind site]\n"
    "- Recent news (May 2026): Raised a Series B to expand in Germany. [brief: TechNews]\n"
    "- Culture and values: Describes itself as remote-first and customer-obsessed. [brief: Careers page]"
)

GROUNDING_QUESTIONS: list[str] = [q for q, _ in QUESTIONS[:20]] + [
    "Why do you want to work here?",
    "What do you know about our company?",
    "What do you think is our biggest challenge right now?",
    "How do you see our product evolving over the next two years?",
    "Why should we hire you?",
    "Tell me about a time you used data to make a decision.",
    "Describe a time you managed a conflict between teams.",
    "What is your biggest weakness?",
    "Tell me about your most complex project.",
    "How have you handled tight deadlines?",
]
