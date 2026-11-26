# Support

People write to the team from any app (web, Windows, Mac, Android, iPhone); the team answers in
the back office. It is one codebase, so every app has it once it is rebuilt.

## For a person

- **Support** in the menu (and "Write to support" on Help): pick what it is about, write a subject
  and a message, send. The conversation is kept; a reply from the team appears there and is emailed.
- A dot and a count on the menu item show conversations with a reply they have not read.
- They can add to a conversation, say it is sorted out, or write back to reopen a resolved one.
- The app sends which app and version it came from and the page (the path only, never a query), to
  help reproduce a problem. Passwords and CV text are never sent by the app.
- Limits: five new conversations a day, 200 messages in one, 4,000 characters in a message.
  Conversations are deleted with the account.

## For staff

- **Support** in the back office (Product group), with the number waiting on a reply on the link.
- Tabs: Needs a reply, Answered, Resolved, Closed. Search by subject or email. Unread first.
- Open a conversation to see the whole thread, where it was sent from, and the person's account.
- **Reply to the person** emails them (`support_reply`) with a link back into the app. **Private
  note** is for the team only: never shown to the person, never emailed.
- Mark resolved, close or reopen. A person writing back reopens it and puts it back in the queue.

## New messages reach the team by email too

`SUPPORT_EMAIL` (comma-separated allowed) is told when someone writes in (`support_new`, with a link
to the thread). If it is empty, the addresses in `ADMIN_EMAILS` are used. Email is best effort: the
back office is the source of truth, so an undelivered email loses nothing. Both messages are in the
back office's Emails catalogue with a preview.

## Not covered

Someone who cannot sign in cannot reach support in the app. Put `SUPPORT_EMAIL` somewhere on the
sign-in help text if you want a fallback.
