// Another open ticket of the same customer (step 29: the same phone number
// or email address, always in the same company), as a ticket's page lists it.

export type SameCustomerTicket = {
  ticketNumber: number;
  subject: string;
  assigneeName: string | null;
  createdAt: Date;
};
