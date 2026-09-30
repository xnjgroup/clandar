/**
 * The message body is untrusted HTML from a stranger, so it is rendered inside a
 * sandboxed iframe with its own strict CSP: no scripts, no fonts, frames or
 * other network — only images, over https (as Gmail shows them), plus inline
 * `data:` ones. Image requests send no referrer. A sender can still see that
 * their images loaded (i.e. that the email was opened), the same as in Gmail.
 */
export function EmailHtmlBody({ html }: { html: string }) {
  const document = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; media-src data:">
<meta name="referrer" content="no-referrer">
<style>
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; padding: 16px; font: 13px/1.6 -apple-system, "Segoe UI", sans-serif; color: #24271f; word-break: break-word; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #41631a; }
</style></head><body>${html}</body></html>`;

  return (
    <iframe
      sandbox=""
      srcDoc={document}
      title="Message body"
      referrerPolicy="no-referrer"
      className="h-[60vh] w-full border-0 bg-white"
    />
  );
}
