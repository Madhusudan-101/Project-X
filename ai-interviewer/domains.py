# domains.py
# Shared between graph.py (interview logic) and token_server.py (request
# validation) so the two can't drift out of sync on what a valid domain is.

DOMAIN_LABELS = {
    "ai_ml": "AI/ML",
    "web_dev": "Web Development",
    "dsa": "Data Structures & Algorithms",
}
