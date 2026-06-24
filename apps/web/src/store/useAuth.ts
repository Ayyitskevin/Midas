import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@midas/shared';
import { authToken } from '@/lib/authToken';

interface AuthState {
  token: string | null;
  user: User | null;
  setSession: (token: string, user: User) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => {
        authToken.set(token);
        set({ token, user });
      },
      clear: () => {
        authToken.set(null);
        set({ token: null, user: null });
      },
    }),
    {
      name: 'midas-auth',
      // Push the persisted token into the API client once rehydrated.
      onRehydrateStorage: () => (state) => {
        if (state?.token) authToken.set(state.token);
      },
    },
  ),
);

// A 401 on an authenticated request means the session is gone — drop it so the
// login gate reappears.
authToken.setOnUnauthorized(() => useAuth.getState().clear());
