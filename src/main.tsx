import { StrictMode, Suspense, lazy, useState, useMemo, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Identity } from 'spacetimedb';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, ErrorContext } from './module_bindings/index.ts';

// Route split: the instructor dashboard never loads Phaser.
const IS_INSTRUCTOR_ROUTE = window.location.pathname.replace(/\/+$/, '') === '/instructor';
const App = lazy(() => import('./App.tsx'));
const InstructorApp = lazy(() => import('./instructor/InstructorApp.tsx'));

// SpacetimeDB target comes from .env.development (dev) or .env.production
// (every `vite build`, including Vercel). Production never falls back to localhost.
const HOST = import.meta.env.VITE_SPACETIMEDB_URI || (import.meta.env.DEV ? 'ws://localhost:3000' : '');
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_NAME || (import.meta.env.DEV ? 'serious-trading-local' : '');
if (!HOST || !DB_NAME) {
  throw new Error('VITE_SPACETIMEDB_URI and VITE_SPACETIMEDB_NAME must be set for production builds');
}
const BASE_TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

export interface ProfileContextType {
  activeProfile: string;
  setProfile: (profile: string) => void;
  availableProfiles: { id: string; name: string }[];
}

export const ProfileContext = createContext<ProfileContextType>({
  activeProfile: 'alice',
  setProfile: () => {},
  availableProfiles: [],
});

export const useProfile = () => useContext(ProfileContext);

const PROFILES = [
  { id: 'alice', name: 'Trader Alice' },
  { id: 'bob', name: 'Trader Bob' },
  { id: 'charlie', name: 'Trader Charlie' },
];

function Root() {
  const [activeProfile, setActiveProfile] = useState<string>(() => {
    // The dashboard keeps its own identity so a teacher can run it next to a floor tab.
    if (IS_INSTRUCTOR_ROUTE) return 'instructor';
    return localStorage.getItem('clob_active_profile') || 'alice';
  });

  const handleSetProfile = (newProfile: string) => {
    if (!IS_INSTRUCTOR_ROUTE) localStorage.setItem('clob_active_profile', newProfile);
    setActiveProfile(newProfile);
  };

  const tokenKey = `${BASE_TOKEN_KEY}_${activeProfile}`;

  const connectionBuilder = useMemo(() => {
    const onConnect = (_conn: DbConnection, identity: Identity, token: string) => {
      localStorage.setItem(tokenKey, token);
      console.log(`Connected as [${activeProfile}] with identity:`, identity.toHexString());
    };

    const onDisconnect = () => {
      console.log(`Disconnected profile [${activeProfile}]`);
    };

    const onConnectError = (_ctx: ErrorContext, err: Error) => {
      console.log(`Error connecting profile [${activeProfile}]:`, err);
    };

    return DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB_NAME)
      .withToken(localStorage.getItem(tokenKey) || undefined)
      .onConnect(onConnect)
      .onDisconnect(onDisconnect)
      .onConnectError(onConnectError);
  }, [activeProfile, tokenKey]);

  const profileContextValue = useMemo(
    () => ({
      activeProfile,
      setProfile: handleSetProfile,
      availableProfiles: PROFILES,
    }),
    [activeProfile]
  );

  return (
    <ProfileContext.Provider value={profileContextValue}>
      <SpacetimeDBProvider key={activeProfile} connectionBuilder={connectionBuilder}>
        <Suspense fallback={null}>{IS_INSTRUCTOR_ROUTE ? <InstructorApp /> : <App />}</Suspense>
      </SpacetimeDBProvider>
    </ProfileContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
