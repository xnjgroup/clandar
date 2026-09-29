import type { Metadata } from "next";
import { LegalDoc } from "../legal-doc";

export const metadata: Metadata = { title: "Terms of Service — Clandar" };

export default function TermsPage() {
  return (
    <LegalDoc title="Terms of Service" updated="September 29, 2026">
      <p>
        These terms govern use of Clandar, operated by{" "}
        <strong>XNJGROUP LLC</strong>. By signing in, you
        agree to them.
      </p>

      <h2>The service</h2>
      <p>
        Clandar is a business-management tool: customers, jobs, AI-assisted quoting, scheduling, tasks, a connected
        email inbox, and invoice/expense tracking, for one organization&rsquo;s team at a time.
      </p>

      <h2>Your account</h2>
      <p>
        You sign in with Google. The first person to sign in for a new organization is its owner and can invite
        teammates. You&rsquo;re responsible for what happens under your account and for keeping your Google account
        secure.
      </p>

      <h2>AI-generated content isn&rsquo;t final</h2>
      <p>
        Estimates, summaries, and drafts the AI features produce are <strong>starting points, not advice</strong>.
        Nothing is sent to a customer, saved as a quote, or acted on until you review and explicitly approve it (by
        clicking Save or Send). You&rsquo;re responsible for checking pricing, scope, and accuracy before relying on
        anything AI-generated — Clandar and its operator aren&rsquo;t liable for a job priced or scheduled from an
        estimate you didn&rsquo;t review.
      </p>

      <h2>Your data</h2>
      <p>
        You own the customer, job, and business data you put into Clandar. You&rsquo;re responsible for having the
        right to store your customers&rsquo; contact information and for how you use anything the app sends on your
        behalf (estimates, replies, etc.). See the{" "}
        <a href="/privacy">Privacy Policy</a> for how that data is handled.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don&rsquo;t use Clandar to send unsolicited bulk email, to store or transmit unlawful content, or to try to
        access another organization&rsquo;s data. We can suspend an account that does.
      </p>

      <h2>Third-party services</h2>
      <p>
        Features depend on services you choose to connect — Google (sign-in, Gmail, Calendar) and whichever AI
        provider you configure. Their availability, terms, and pricing are their own; we aren&rsquo;t responsible
        for their outages or changes.
      </p>

      <h2>&ldquo;As is,&rdquo; and limits on liability</h2>
      <p>
        Clandar is provided &ldquo;as is,&rdquo; without warranties of any kind. To the extent the law allows,{" "}
        <strong>XNJGROUP LLC</strong> isn&rsquo;t liable for indirect, incidental, or consequential
        damages arising from using it — including a job mispriced from an AI estimate, a missed schedule entry, or
        an email sent from your connected account.
      </p>

      <h2>Termination</h2>
      <p>
        You can stop using Clandar and delete your data at any time. We can suspend or terminate access for
        violating these terms.
      </p>

      <h2>Trademarks</h2>
      <p>
        &ldquo;Clandar&rdquo; and its logo belong to <strong>XNJGROUP LLC</strong>. Google, Gmail,
        Google Calendar, and the Google &ldquo;G&rdquo; mark are trademarks of Google LLC, referenced here only to
        describe the sign-in and connector features that use them — Clandar isn&rsquo;t endorsed by or affiliated
        with Google. Other product names mentioned (e.g. OpenAI) belong to their respective owners.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms; continued use after a change means you accept the update. Material changes will
        update the date above.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of [your state/country — required before this is a real agreement].</p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <strong>legal@clandar.com</strong>.
      </p>
    </LegalDoc>
  );
}
