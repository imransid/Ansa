// One message of the Co-Founder's interview (step 36), as the page shows it.
export type InterviewMessage = {
  id: string;
  author: "assistant" | "owner";
  authorName: string | null;
  // null when it can't be decrypted (unreadable).
  text: string | null;
  unreadable: boolean;
  createdAt: Date;
};
