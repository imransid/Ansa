import type { SetupStatus } from "@/lib/types/company-settings";

// What the Setup page shows. The forwarding address comes already built, so
// pages never handle the bare token.
export type SetupOverview = Omit<SetupStatus, "inboundToken"> & { forwardingAddress: string };
