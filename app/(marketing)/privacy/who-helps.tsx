// "Who helps us run the service" of the privacy policy: every outside
// service core or the brain sends data to, and what each gets (step 58).
// Keep it equal to what the code sends.
export function WhoHelps() {
  return (
    <>
      <h2>Who helps us run the service</h2>
      <ul>
        <li>
          Anthropic: its AI, Claude, writes ansa&apos;s replies. For each message it reads your setup, the items on your
          menu or price list that are available today, your instructions, up to three of your saved answers that match,
          the names of your request categories, and the newest 20 messages of that one conversation (card numbers, social
          security numbers and email addresses in your customers&apos; words hidden); on a call, what was said so far, and
          after it, the call, to write its note. It reads a comment on your Facebook Page&apos;s posts and the start of its
          post, to answer it. It also reads forwarded emails, to sum them up and route them; for calls
          answered through Vapi, an excerpt of the transcript, to decide whether the call needs you; a menu photo or
          document you ask it to read; your business&apos;s details, to write &ldquo;Post for me&rdquo; posts; and, for the
          marketing planner, your business facts, the interview, the saved answers your owners pick, your plans, and your
          posts&apos; numbers with their topics. If you add your own Claude API key, your replies and posts are written
          under your own account with Anthropic.
        </li>
        <li>Telegram: carries messages between the people who write to your Telegram account and ansa, and ansa&apos;s notes to you.</li>
        <li>
          Meta (Facebook and WhatsApp): carries Facebook Messenger messages to your Page and WhatsApp messages to your
          WhatsApp Business number, brings us the comments on your Page&apos;s posts and publishes ansa&apos;s answers under
          them, publishes your Page&apos;s posts, and tells us their numbers. Connecting WhatsApp
          Business opens Meta&apos;s own sign-up window, under Meta&apos;s terms.
        </li>
        <li>
          LinkedIn, X and Google (YouTube): only for the accounts your owners connect there. The platform gives us access
          to the account, gets each post your owners schedule there (its text, title and image or video, published in
          your account&apos;s name), and tells us that post&apos;s numbers when we ask. When an account is disconnected we
          delete that access, and ask X and Google to take it back too, unless another ansa account still has the same
          platform account connected (taking it back would end theirs).
        </li>
        <li>Vapi: answers phone calls on the lines connected to it, and makes their transcripts and recordings.</li>
        <li>Resend: sends and receives email.</li>
        <li>Cloudflare: stores recordings, documents and media files.</li>
        <li>Neon: hosts our database.</li>
        <li>Stripe: handles payments.</li>
        <li>Our hosting provider: runs the application.</li>
      </ul>
      <p>Each one receives only what it needs for its part, under its own terms.</p>
    </>
  );
}
