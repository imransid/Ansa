// A phone number as its company's Setup page shows it.
export type PhoneLineOverview = {
  vapiPhoneNumberId: string;
  // When the last call on it was saved; null until the first call.
  lastCallAt: Date | null;
};
