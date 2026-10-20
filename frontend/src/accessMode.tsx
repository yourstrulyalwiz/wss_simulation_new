import { createContext, useContext, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';

type Access = { publicReadOnly: boolean; user: { id: string } | null; signOut: () => void };
export const AccessContext = createContext<Access>({
  publicReadOnly: false, user: null, signOut: () => {},
});
export const useAppAccess = () => useContext(AccessContext);

export function AuthenticatedAccess({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  return <AccessContext.Provider value={{
    publicReadOnly: false, user: user || null,
    signOut: () => { void signOut({ redirectUrl: import.meta.env.BASE_URL }); },
  }}>{children}</AccessContext.Provider>;
}
