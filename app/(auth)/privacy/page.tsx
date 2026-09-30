import type { Metadata } from "next";
import { LegalDoc } from "../legal-doc";

export const metadata: Metadata = { title: "Privacy Policy — Clandar" };

export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy Policy" updated="September 30, 2026">
      <p>
        This policy describes what Clandar (&ldquo;the app,&rdquo; &ldquo;we&rdquo;) collects, why, and how it&rsquo;s
        used, for the account holder and anyone they invite to their organization&rsquo;s workspace.
        <strong> Operator: XNJGROUP LLC. Contact: privacy@clandar.com.</strong>
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Google account info.</strong> Signing in with Google shares your name, email address, and profile
          photo. This creates your account and lets your teammates see who&rsquo;s who — it&rsquo;s never used for
          anything else.
        </li>
        <li>
          <strong>Gmail and Calendar data — only if you connect an account.</strong> Connecting Gmail (on the
          Connectors page) grants read/write access (the <code>gmail.modify</code> scope: reading, organizing,
          labeling, trashing, and sending mail — never permanently deleting anything, and never sending anything
          without you clicking &ldquo;Send&rdquo;). Connecting Calendar grants read-only access. This data is read
          live from Google each time it&rsquo;s needed; the app does not keep a standing copy of your mailbox.
        </li>
        <li>
          <strong>Business data you enter.</strong> Customers, jobs, estimates, schedule entries, tasks, invoices,
          vendors, and any photos or files you upload for a job. This is stored in our database and file storage so
          the app can show it back to you and your team.
        </li>
        <li>
          <strong>AI provider credentials.</strong> If you configure an LLM provider (OpenAI, a local server, etc.)
          on the Settings page, its API key is encrypted (AES-256-GCM) before it&rsquo;s stored and is never shown
          back to you or sent anywhere except that provider.
        </li>
        <li>
          <strong>Session data.</strong> A signed, httpOnly cookie identifies your session. We don&rsquo;t use
          advertising cookies or tracking pixels.
        </li>
        <li>
          <strong>Usage analytics.</strong> We use Google Analytics to count visits and see which parts of the app
          are used. It sets cookies and receives your IP address, browser details and which pages you view. We only
          send page names with record ids removed (for example &ldquo;/projects/:id&rdquo;) — never search terms,
          filters, or any of your customers, jobs, email or other business data. You can opt out with Google&rsquo;s{" "}
          <a href="https://tools.google.com/dlpage/gaoptout" className="underline">
            opt-out browser add-on
          </a>{" "}
          or by blocking cookies for clandar.com.
        </li>
      </ul>

      <h2>How AI features use your data</h2>
      <p>
        Quoting (photos → estimate) and inbox cleanup suggestions work by sending the relevant content — job photos
        and a short description for quoting, or message metadata for cleanup — to whichever AI provider your
        organization has configured on the Settings page. That may be OpenAI, another cloud provider, or a server
        you run yourself. <strong>We do not use your data to train any AI model.</strong> What that third-party
        provider does with the data it receives is governed by its own terms — review them before connecting a
        provider you don&rsquo;t control.
      </p>

      <h2>How we use Gmail data specifically</h2>
      <p>
        Gmail access exists to power features you explicitly use: showing your inbox, drafting/sending a reply or
        an estimate email, and suggesting low-value messages to clean up. Gmail data is never sold, never used for
        advertising, and never shared except with the AI provider you&rsquo;ve configured, and only for the specific
        action you triggered (e.g., summarizing the message you&rsquo;re looking at). This use is consistent with
        Google&rsquo;s{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          API Services User Data Policy
        </a>
        , including its Limited Use requirements.
      </p>

      <h2>Sharing</h2>
      <p>
        We don&rsquo;t sell personal data. Data is shared only with: Google (to authenticate you and, if you connect
        it, to read/send mail or calendar events on your behalf; and Google Analytics for page-view statistics,
        as described above), the AI provider your org configures, and other
        members of your own organization (customers, jobs, invoices, etc. are visible to your teammates by design).
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        Business data is kept until you delete it or your account is closed. Deleting a job also deletes its
        uploaded photos and files from storage. To close your account or request deletion of your data, contact{" "}
        <strong>privacy@clandar.com</strong>.
      </p>

      <h2>Security</h2>
      <p>
        API keys and connector secrets are encrypted at rest (AES-256-GCM). Sessions use signed, httpOnly cookies.
        Access to your organization&rsquo;s data is limited to signed-in members of that organization.
      </p>

      <h2>Children</h2>
      <p>Clandar is a business tool and isn&rsquo;t directed at or knowingly used by children under 13.</p>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes materially, we&rsquo;ll update the date above. Continued use after a change means
        you accept the update.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or your data: <strong>privacy@clandar.com</strong>.
      </p>
    </LegalDoc>
  );
}
