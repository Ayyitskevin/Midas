/** Auth data contract shared by the server and the web client. */

/** A user, without any secret material. */
export interface User {
  id: string;
  username: string;
  createdAt: number;
}

/** Whether auth is on, and whether new accounts may be created. */
export interface AuthStatus {
  enabled: boolean;
  allowSignup: boolean;
}

/** Returned by login / signup — a bearer token plus the user it belongs to. */
export interface AuthSession {
  token: string;
  user: User;
}
