# Email

WebBites sends mail for: password reset, board invitations, and confirming a changed email address.
Without email configured it still works: invitation links are shown in the app so you can send them
yourself, a changed email address answers "email is not configured", and nobody can reset a password
by mail. An administrator with shell access can set one:

```sh
docker compose exec parse node scripts/reset-password.js someone@example.com
```

(prints a new random password and signs that person out everywhere).

## SMTP

In **/admin → Settings → Email**: provider SMTP, server, port, user, password, and the From address.
Use **Test connection**, then **Send me a test email**. Typical values:

| Provider | Server | Port | TLS from the start |
|---|---|---|---|
| Most (STARTTLS) | smtp.example.com | 587 | No |
| Implicit TLS | smtp.example.com | 465 | Yes |

Or set `MAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`,
`MAIL_FROM` in `.env`. A value in `.env` locks the field on the settings page.

**Mailgun** (`MAIL_PROVIDER=mailgun`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and `MAILGUN_API_URL=https://api.eu.mailgun.net` for the EU
region) works the same way.

## Notes

- Saving email settings restarts Parse (a few seconds), because Parse sends the password-reset mail and
  reads its settings at start-up. The settings page offers the restart button.
- Set up SPF/DKIM for the From domain with your mail provider or messages land in spam.
- A broken Parse start never locks you out: if Parse cannot start with the saved settings it falls back
  to the previous ones and the settings page says so.
