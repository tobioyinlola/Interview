"""Indexes for scale: every foreign key is searchable, and the hot lists have the right ones

Deleting an account cascades through dozens of tables, and each cascade (and each "all the scores of
this interview" lookup) scans a table when its foreign key has no index. Built CONCURRENTLY, so
writes are not blocked while they are made on a live database.

Revision ID: 0030
Revises: 0029
"""

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None

INDEXES = [
    ("ix_aa_kill_switches_set_by", "aa_kill_switches", ["set_by"]),
    ("ix_aa_campaigns_profile_id", "aa_campaigns", ["profile_id"]),
    ("ix_aa_hunt_targets_contact_id", "aa_hunt_targets", ["contact_id"]),
    ("ix_aa_hunt_targets_startup_id", "aa_hunt_targets", ["startup_id"]),
    ("ix_research_jobs_user_id", "research_jobs", ["user_id"]),
    ("ix_aa_applications_campaign_id", "aa_applications", ["campaign_id"]),
    ("ix_aa_applications_posting_id", "aa_applications", ["posting_id"]),
    ("ix_sessions_brief_id", "sessions", ["brief_id"]),
    ("ix_sessions_company_id", "sessions", ["company_id"]),
    ("ix_aa_outreach_posting_id", "aa_outreach", ["posting_id"]),
    ("ix_aa_outreach_application_id", "aa_outreach", ["application_id"]),
    ("ix_aa_recruiting_events_application_id", "aa_recruiting_events", ["application_id"]),
    ("ix_audio_tokens_user_id", "audio_tokens", ["user_id"]),
    ("ix_session_credits_session_id", "session_credits", ["session_id"]),
    ("ix_aa_interviews_company_id", "aa_interviews", ["company_id"]),
    ("ix_aa_interviews_last_event_id", "aa_interviews", ["last_event_id"]),
    ("ix_scores_utterance_id", "scores", ["utterance_id"]),
    ("ix_scores_session_id", "scores", ["session_id"]),
    ("ix_suggestions_utterance_id", "suggestions", ["utterance_id"]),
    ("ix_aa_startups_status_region", "aa_startups", ["status", "region"]),
    ("ix_aa_startups_directory", "aa_startups", ["directory"]),
    ("ix_aa_hunt_targets_user_status", "aa_hunt_targets", ["user_id", "status"]),
    ("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"]),
]


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, cols in INDEXES:
            op.create_index(name, table, cols, postgresql_concurrently=True, if_not_exists=True)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, _ in INDEXES:
            op.drop_index(name, table_name=table, postgresql_concurrently=True, if_exists=True)
