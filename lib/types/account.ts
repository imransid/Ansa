// The Account page: your own name, your password and where you are logged in.
export type AccountDetails = {
  name: string;
  email: string;
  // Browsers and devices logged in right now, this one included.
  activeSessionCount: number;
};
