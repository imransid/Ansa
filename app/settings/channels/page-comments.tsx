import Link from "next/link";
import { StatusDot } from "@/components/status-dot";
import type { CoreMessenger } from "@/lib/core-views/channels";
import type { CommentsSettings } from "@/lib/types/comments";
import { CommentsSwitch } from "./comments-switch";
import { ForDevelopers } from "./stand-in";

// What ansa does with a comment, in one sentence, wherever the setting shows.
const WHAT_ANSA_DOES =
  "When someone comments on your Page's posts, ansa answers a question under the comment, sends prices and orders to them privately in Messenger, says sorry and passes a complaint to you, and leaves praise and spam alone. With Ask me first, its own answers wait for you.";

type PageCommentsProps = {
  settings: CommentsSettings;
  // How ansa's Meta app stands here: a development stand-in, or real Facebook.
  mode: CoreMessenger["mode"];
};

// Settings → Connections → Facebook Page → Comments on your posts
// (businesses): what ansa does with them, the switch (owners; members read
// it), and each Page's state: a real Page must grant the two comment
// permissions, so one connected before asks to be connected again.
export function PageComments({ settings, mode }: PageCommentsProps) {
  const notAllowed = settings.pages.filter((page) => !page.allowed);
  return (
    <div className="grid gap-3 border-t pt-4">
      <h3 id="comments-heading" className="scroll-mt-6 font-semibold">
        Comments on your posts
      </h3>
      <p className="text-sm text-muted-foreground">
        {WHAT_ANSA_DOES}{" "}
        <Link href="/inbox/comments" className="text-link hover:underline">
          See the comments
        </Link>
      </p>
      {settings.canChange ? (
        <CommentsSwitch on={settings.on} />
      ) : (
        <p className="text-sm">
          <span className="font-medium">Answering comments:</span> {settings.on ? "on" : "off"}. Only owners change it.
        </p>
      )}
      {settings.pages.length > 0 ? (
        <ul className="divide-y border-y">
          {settings.pages.map((page) => (
            <li key={page.name} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="font-medium">{page.name}</span>
              {page.allowed ? (
                <StatusDot tone="success">Comments come to ansa</StatusDot>
              ) : (
                <StatusDot tone="attention">Connect it again and allow comments</StatusDot>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Connect your Facebook Page above first.</p>
      )}
      {mode === "stand-in" ? (
        <StandInCommentsNote />
      ) : (
        notAllowed.length > 0 &&
        settings.canChange && (
          <p className="text-sm text-muted-foreground">
            Press Connect Facebook Page above, and allow ansa to read and answer comments when Facebook asks.
          </p>
        )
      )}
    </div>
  );
}

// On this computer the stand-in Page answers comments at once; on real
// Facebook, ansa's Meta app first needs Meta's approval of two more
// permissions.
function StandInCommentsNote() {
  return (
    <div className="grid gap-1">
      <p className="text-sm text-muted-foreground">
        The stand-in Page answers comments at once: write one as a customer in the{" "}
        <Link href="/settings/channels/practice-chat" className="text-link hover:underline">
          practice chat
        </Link>{" "}
        (Facebook comment). On real Facebook, Meta must approve ansa first.
      </p>
      <ForDevelopers>
        Real Pages need Meta&apos;s App Review of pages_read_user_content and pages_manage_engagement (with Business Verification), and the
        Page&apos;s feed webhook.
      </ForDevelopers>
    </div>
  );
}
