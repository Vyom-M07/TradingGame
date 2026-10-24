import { StrictMode, useState, useMemo, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { Identity } from 'spacetimedb';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, ErrorContext } from './module_bindings/index.ts';

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://127.0.0.1:3000';
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'clob-market';
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
    return localStorage.getItem('clob_active_profile') || 'alice';
  });

  const handleSetProfile = (newProfile: string) => {
    localStorage.setItem('clob_active_profile', newProfile);
    setActiveProfile(newProfile);
  };

  const tokenKey = `${BASE_TOKEN_KEY}_${activeProfile}`;

  const connectionBuilder = useMemo(() => {
    const onConnect = (_conn: DbConnection, identity: Identity, token: string) => {
      localStorage.setItem(tokenKey, token);
      console.log(
        `Connected as [${activeProfile}] with identity:`,
        identity.toHexString()
      );
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
        <App />
      </SpacetimeDBProvider>
    </ProfileContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
