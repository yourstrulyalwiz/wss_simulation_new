import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import { basePath, Gallery, Home, NewSimulation, PortalLayout, ErrorMessage } from './Portal';
import { projectRequest, type Identity } from './projectApi';
import { AccessContext, AuthenticatedAccess } from './accessMode';
const ProjectWorkspace = lazy(() => import('./ProjectWorkspace'));
const ReplitAccess = lazy(() => import('./ReplitAccess'));

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
const clerkAppearance = {
  theme: shadcn,
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: { colorPrimary: '#014972', colorForeground: '#243f4c', colorMutedForeground: '#587784', colorDanger: '#a44730', colorBackground: '#f7fbfc', colorInput: '#edf4f6', colorInputForeground: '#243f4c', colorNeutral: '#507480', fontFamily: 'DM Sans, sans-serif', borderRadius: '6px' },
  elements: {
    rootBox: { width: '100%', display: 'flex', justifyContent: 'center' },
    cardBox: { background: '#f7fbfc', borderRadius: '9px', width: '440px', maxWidth: '100%', overflow: 'hidden', border: '1px solid #c4d8df' },
    card: { background: 'transparent', border: 'none', boxShadow: 'none' }, footer: { background: '#e7f0f3', boxShadow: 'none' },
    headerTitle: { color: '#014972', fontFamily: 'Manrope, sans-serif', fontSize: '24px' }, headerSubtitle: { color: '#52727f' },
    socialButtonsBlockButtonText: { color: '#014972' }, formFieldLabel: { color: '#315a6b' }, footerActionLink: { color: '#006c79' },
    footerActionText: { color: '#52727f' }, dividerText: { color: '#52727f' }, identityPreviewEditButton: { color: '#014972' },
    formFieldSuccessText: { color: '#236e61' }, alertText: { color: '#8d422e' }, logoBox: { height: '60px' }, logoImage: { height: '54px' },
    socialButtonsBlockButton: { background: '#eaf2f4', border: '1px solid #bfd4dc' }, formButtonPrimary: { background: '#014972', color: '#f5fafb', boxShadow: 'none' },
    formFieldInput: { background: '#edf4f6', color: '#243f4c', border: '1px solid #bfd4dc' }, footerAction: { background: 'transparent' },
    dividerLine: { background: '#c4d8df' }, alert: { background: '#fff0e5', border: '1px solid #e8c4ad' },
    otpCodeFieldInput: { color: '#014972', borderColor: '#bfd4dc' }, formFieldRow: { marginBottom: '16px' }, main: { gap: '22px' },
  },
};
function AuthPage({ mode }: { mode: 'in' | 'up' }) {
  return <PortalLayout><main className="auth-layout"><div><span className="portal-eyebrow">Your verified planning workspace</span><h1>{mode === 'in' ? 'Welcome back to the bigger picture.' : 'A place for your next planning decision.'}</h1><p>Use your verified <strong>@worldbankgroup.org</strong> identity to save and resume simulations. Your working drafts are private by default.</p><div className="portal-message">Access is checked by the server after sign-in. Institutional single sign-on availability depends on the organization’s identity-provider configuration.</div></div><div className="auth-form">{mode === 'in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={`${basePath}/user-portal`} /> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={`${basePath}/user-portal`} />}</div></main></PortalLayout>;
}
function Verified({ children, optional = false }: { children: (identity: Identity | null) => ReactNode; optional?: boolean }) {
  const { isLoaded, user } = useUser();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!isLoaded) return;
    setIdentity(null); setError('');
    if (!user) { setLoading(false); return; }
    let live = true; setLoading(true);
    projectRequest<Identity>('/me').then(value => { if (live) setIdentity(value); }).catch(err => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [isLoaded, user?.id, retry]);
  if (!isLoaded || loading) return <div className="portal"><div className="portal-wrap portal-section"><div className="portal-skeleton" aria-label="Checking account access" /></div></div>;
  if (!user && !optional) return <Redirect to="/" />;
  if (user && error) return <PortalLayout><main className="portal-wrap portal-section"><span className="portal-eyebrow">Account access</span><h1 style={{ fontSize: 38 }}>Let’s check your access.</h1><ErrorMessage message={error} retry={() => setRetry(value => value + 1)} /><p>WSS requires a verified World Bank mailbox and permission for the requested record. If you have just verified your address, try again. Otherwise sign out and use the correct institutional account.</p></main></PortalLayout>;
  if (user && !identity) return null;
  return <>{children(identity)}</>;
}
function HomeRedirect() {
  const { isLoaded, user } = useUser();
  if (!isLoaded) return <Home />;
  return user ? <Redirect to="/user-portal" /> : <Home />;
}
function Routes() {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  return <div key={user?.id || 'anonymous'}><Switch>
    <Route path="/" component={HomeRedirect} />
    <Route path="/sign-in/*?">{() => <AuthPage mode="in" />}</Route>
    <Route path="/sign-up/*?">{() => <AuthPage mode="up" />}</Route>
    <Route path="/user-portal">{() => <Verified>{identity => identity && <Gallery identity={identity} />}</Verified>}</Route>
    <Route path="/simulations/new">{() => <Verified>{identity => identity && <NewSimulation identity={identity} />}</Verified>}</Route>
    <Route path="/simulations/:id">{(params: { id: string }) => <Verified optional>{identity => <Suspense fallback={<div className="portal"><div className="portal-wrap portal-section"><div className="portal-skeleton" aria-label="Loading simulation workspace" /></div></div>}><ProjectWorkspace key={`${identity?.id || 'anonymous'}:${params.id}`} id={params.id} identity={identity} /></Suspense>}</Verified>}</Route>
    <Route>{() => <PortalLayout><main className="portal-wrap portal-section"><h1>That page is not here.</h1><p>Your simulations are still in your workspace.</p><button className="portal-btn" onClick={() => setLocation('/')}>Return home</button></main></PortalLayout>}</Route>
  </Switch></div>;
}
function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Return to your workspace', subtitle: 'Sign in with your World Bank identity' } }, signUp: { start: { title: 'Your planning workspace', subtitle: 'Use your verified World Bank mailbox' } } }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  ><AuthenticatedAccess><Routes /></AuthenticatedAccess></ClerkProvider>;
}
function PublicRoutes() {
  return <AccessContext.Provider value={{ publicReadOnly: true, user: null, signOut: () => {} }}>
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/user-portal">{() => <Gallery />}</Route>
      <Route path="/simulations/new">{() => <Redirect to="/user-portal" />}</Route>
      <Route path="/simulations/:id">{(params: { id: string }) => <Suspense fallback={<div className="portal-wrap portal-section">Opening simulation…</div>}>
        <ProjectWorkspace key={params.id} id={params.id} identity={null} />
      </Suspense>}</Route>
      <Route>{() => <Redirect to="/user-portal" />}</Route>
    </Switch>
  </AccessContext.Provider>;
}
function Router() {
  const [mode, setMode] = useState<'public' | 'replit' | 'clerk' | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; setError('');
    projectRequest<{ public_read_only: boolean; auth_provider?: string }>('/access-mode')
      .then(data => {
        const provider = data.public_read_only ? 'public' : data.auth_provider || 'clerk';
        if (!['public', 'replit', 'clerk'].includes(provider)) throw new Error('Unsupported sign-in configuration.');
        if (live) setMode(provider as 'public' | 'replit' | 'clerk');
      })
      .catch(err => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [attempt]);
  return <WouterRouter base={basePath}>{error
    ? <main className="portal-wrap portal-section"><h1>Unable to load access settings</h1><ErrorMessage message={error} retry={() => setAttempt(n => n + 1)} /></main>
    : mode === null ? <main className="portal-wrap portal-section" role="status">Loading application…</main>
    : mode === 'public' ? <PublicRoutes />
    : mode === 'replit' ? <Suspense fallback={<main className="portal-wrap portal-section">Loading workspace…</main>}><ReplitAccess /></Suspense>
    : <ClerkProviderWithRoutes />}</WouterRouter>;
}
export default Router;
