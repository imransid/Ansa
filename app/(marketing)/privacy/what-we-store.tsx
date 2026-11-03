// "What we store" of the privacy policy: every kind of data core keeps, and
// which of it is encrypted (step 58). Keep it equal to what the code does.
export function WhatWeStore() {
  return (
    <>
      <h2>What we store</h2>
      <ul>
        <li>
          Team accounts: name, email address, role, a one-way hash of the password (never the password itself), and the
          IP address and browser of each login.
        </li>
        <li>
          Your setup: whether ansa answers for a business or a person, the name it uses, what you do, your address and
          public phone number, your opening or away hours and time zone, your delivery, pickup and payment notes, currency
          and delivery fee, the instructions and holding reply you write, when ansa answers (&ldquo;I&apos;m away&rdquo;,
          away hours, how long it waits for you), and which AI writes its replies. If you add your own Claude API key, we
          keep it and show only its last four characters.
        </li>
        <li>
          Your menu or price list: each item&apos;s category, name, description, price, and whether it is available today. A
          photo, document or text you ask ansa to read into it is sent to the AI to read, and not kept.
        </li>
        <li>
          Saved answers (knowledge articles) your team writes, or imports from documents it uploads or public web pages it
          names: their text, where they came from, and who wrote, changed and approved them. To import a page, our server
          fetches that one page.
        </li>
        <li>
          Conversations: for each person who writes or calls, their name as the channel gives it, the channel&apos;s id for
          them (a Telegram chat, a Facebook Page&apos;s id for them, a WhatsApp id or phone number, a phone number or an email
          address) and whether you marked them important; every message they, ansa and your team sent, when, and whether it
          was delivered; what ansa did (answered, waited for your approval, or passed something on and why, never a
          message&apos;s text); and who on your team took a conversation over.
        </li>
        <li>
          Orders: the items and prices as they were when ordered, the totals ansa worked out, delivery or pickup, the time
          asked for, the delivery address and notes, the order&apos;s number and status, and who on your team moved it on.
        </li>
        <li>
          Calls: the caller&apos;s number and the name they give, when the call started and ended, what was said (as text),
          and the AI&apos;s note about the call. For calls answered through Vapi, also the transcript, the recording, and
          the AI&apos;s summary and decision.
        </li>
        <li>
          Emails forwarded to ansa: the sender&apos;s name and address, a different reply-to address if the email gives one,
          whether the sender passed the receiving server&apos;s authenticity checks, the subject, the text (taken from the
          formatted version when there is no plain one), how many attachments it had and their file names, and how many
          images it showed inside its text (not the files themselves). For an email that doesn&apos;t become a request (an
          automatic reply, a newsletter): only the sender&apos;s address and why.
        </li>
        <li>
          Requests, including the ones your team types in: what the request is about, the customer&apos;s name, email or
          phone if known, who handles it, its status, the notes your team adds, and a history of who changed what and when.
        </li>
        <li>
          Your connections: for Telegram, Telegram&apos;s ids for your account and for ansa&apos;s chat with you, and the
          account&apos;s name; for WhatsApp Business, your WhatsApp Business account&apos;s and number&apos;s ids, the number,
          and the access Meta gave us; for Facebook Pages, LinkedIn, X and YouTube, the account&apos;s name and id, the
          permissions it gave, the access it gave us and when that runs out, who connected it, and when it was
          disconnected. One-time Telegram link codes are kept only as a one-way hash.
        </li>
        <li>
          Social media posts: the posts ansa writes for your Facebook Page (&ldquo;Post for me&rdquo;) and the drafts your
          team or the AI writes: platform, topic, text, hashtags, the images and videos your team uploads and their
          descriptions, the claims a draft makes and the facts behind them, who wrote, approved, scheduled or cancelled
          each and when, what became of each post (the platform&apos;s id and address of it, or why it didn&apos;t go out),
          and the numbers the platforms give about it (views, reach, reactions, comments, shares, clicks and video views,
          as each counts them), read about once a day for up to 30 days.
        </li>
        <li>
          The marketing planner: the facts about your business your owners confirm or type in, the facts the AI proposes
          until an owner confirms or dismisses them, the planner&apos;s interview (its questions and your owners&apos;
          answers), marketing plans, the content calendar, performance reviews, and a log of who did what with your posts,
          accounts and plans.
        </li>
        <li>
          Alerts to you: when ansa passes something on to you or takes an order, it emails your owners and writes to your
          Telegram account through ansa&apos;s bot: who, on which channel and why, with a link (never their messages).
        </li>
        <li>Emails we send to your customers when a request is solved: the address, and whether it was delivered.</li>
        <li>
          Your package and billing: when your free trial ends, how many AI replies and call minutes you used each month,
          and Stripe&apos;s ids for your customer record and subscription, its status and package. No card details.
        </li>
      </ul>
      <p>
        Messages, what was said on calls, transcripts and the AI&apos;s notes about calls, email contents (including
        attachment names), request notes, orders&apos; delivery addresses and notes, the marketing planner&apos;s interview,
        your own Claude API key and the access other platforms give us are encrypted in our database; that access and
        your key are never shown to anyone, your team included. Your setup, menu, saved answers, business facts, plans,
        drafts, posts, post numbers and reviews are stored as plain text: they are your own information about your
        business, written to be shown to the people who contact you or to be published, and the forms that write them ask
        you to keep customer details out. Recordings, documents and media files are kept in private storage and only open
        through links that stop working after a few minutes.
      </p>
    </>
  );
}
