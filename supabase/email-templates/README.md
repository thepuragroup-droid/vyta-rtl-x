# Supabase Auth email templates

These are the bodies pasted into **Supabase → Authentication → Email Templates**.
They live here so the copy is reviewable and versioned; nothing in the app reads
them at runtime — editing a file does not change what Supabase sends until it is
pasted into the dashboard.

| File | Supabase template | Sent when |
| --- | --- | --- |
| `reset-password.html` | **Reset Password** | `resetPasswordForEmail` — the self-serve `/forgot-password` page, and the admin desks' "Send password reset link" action (`lib/admin/password-reset.ts`) |
| `magic-link.html` | **Magic Link** | A passwordless sign-in request |

`reset-password.html` is a fragment, not a full document — the dashboard editor
expects body markup. `magic-link.html` predates that and carries a full
`<!DOCTYPE>`; both render, so it has been left as-is.

## The confirmation URL

Use `{{ .ConfirmationURL }}` **on its own**. Do not append a path to it:

```html
<!-- WRONG — corrupts the link -->
<a href="{{ .ConfirmationURL }}/reset-password">

<!-- RIGHT -->
<a href="{{ .ConfirmationURL }}">
```

`ConfirmationURL` is GoTrue's `…/auth/v1/verify?token=…&type=recovery&redirect_to=…`.
Anything appended lands on the tail of the **encoded `redirect_to` value**, not on
aminocan.com, so the recipient is sent somewhere that does not exist. The
destination is already carried inside it: the caller passes
`redirectTo: <site>/reset-password`, and that path reads the recovery session out
of the URL on arrival.

## Redirect allow-list

Every `redirectTo` must be listed under **Authentication → URL Configuration →
Redirect URLs**. When it is not, GoTrue silently falls back to the project's Site
URL — the recipient lands on the homepage with no recovery session and
`/reset-password` reports the link as invalid or expired. That failure looks
identical to a broken link, so check the allow-list first. Note `www.aminocan.com`
and `aminocan.com` are distinct entries.

## Expiry wording

`reset-password.html` says the link expires in **1 hour**, matching GoTrue's
default email OTP expiry. If that is changed under **Authentication → Settings**,
update the copy here to match.
