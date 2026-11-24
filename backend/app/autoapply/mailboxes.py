"""Which mailbox adapter the server uses: the Gmail connection when it is configured and chosen,
otherwise one that touches nobody, and (when switched on) app-password mailboxes beside either."""

from app.autoapply.adapters import MailboxAdapter
from app.autoapply.fixtures import FixtureMailbox
from app.autoapply.gmail import GmailAdapter, GmailOAuth
from app.autoapply.smtpmail import RoutedMailbox
from app.config import Settings


def build(settings: Settings) -> MailboxAdapter:
    base: MailboxAdapter = FixtureMailbox()
    if settings.autoapply_mailbox_provider == "gmail" and GmailOAuth(settings).enabled:
        base = GmailAdapter(settings)
    if settings.smtp_mailbox_enabled:
        return RoutedMailbox(base, smtp_on=True)  # type: ignore[return-value]
    return base
