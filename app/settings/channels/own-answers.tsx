// What ansa does when the business answers a customer itself, in its own
// app (core/internal/conversations, stepBackWithin): answering yourself
// means you're handling it. With "Always" the conversation is taken over
// until someone hands it back; with "Only when I'm away" ansa only stops
// waiting to step in for that message.
export function OwnAnswersNote({ app, personal }: { app: string; personal: boolean }) {
  return (
    <p className="text-sm text-muted-foreground">
      When ansa sees you answer {personal ? "someone" : "a customer"} yourself {app}: if it answers Always (Settings → Assistant), that conversation is yours from
      then on, and ansa stays quiet in it until you press Hand back to ansa in your Inbox; if it answers Only when I&apos;m away, it just
      doesn&apos;t step in for the message you answered.
    </p>
  );
}
