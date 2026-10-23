import { lazy, Suspense, useEffect, useState } from 'react';
import { Redirect, Route, Switch } from 'wouter';
import { AccessContext } from './accessMode';
import { Gallery, Home, NewSimulation, PortalLayout, ErrorMessage, Skeletons } from './Portal';
import { projectRequest, type Identity } from './projectApi';

const ProjectWorkspace = lazy(() => import('./ProjectWorkspace'));
function ReplitSignIn({ next = '/user-portal' }: { next?: string }) {
  return <PortalLayout><main className="auth-layout"><div>
    <span className="portal-eyebrow">Your WB Replit account</span>
    <h1>One account.<br />Your own simulations.</h1>
    <p>Continue with the Replit account you use to access the WB workspace. There is no separate application password.</p>
    <p>Create new simulations, save progress and return to your private drafts. Preserved examples stay unchanged; make a private copy to edit them.</p>
  </div><section className="portal-message"><h2>Continue to your workspace</h2>
    <p>Replit verifies your identity using its existing sign-in. If your Replit session is still active, you may not need to sign in again.</p>
    <a className="portal-btn" href={`/api/login?next=${encodeURIComponent(next)}`}>Continue with Replit <span aria-hidden="true">↗</span></a>
    <p>WB workspace access is managed by your organization.</p>
  </section></main></PortalLayout>;
}

export default function ReplitAccess() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; setError(''); setLoading(true);
    projectRequest<{ user: Identity | null }>('/session').then(data => { if (live) setIdentity(data.user); })
      .catch(err => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [attempt]);
  const signOut = async () => {
    try {
      await projectRequest('/logout', { method: 'POST' });
      window.location.assign('/');
    } catch (err) { setError((err as Error).message); }
  };
  return <AccessContext.Provider value={{ publicReadOnly: false, user: identity, signOut: () => { void signOut(); } }}>
    {loading ? <PortalLayout><main className="portal-wrap portal-section"><Skeletons /></main></PortalLayout>
      : error ? <PortalLayout><main className="portal-wrap portal-section"><ErrorMessage message={error} retry={() => setAttempt(n => n + 1)} /></main></PortalLayout>
      : <Switch key={identity?.id || 'anonymous'}>
        <Route path="/">{() => identity ? <Redirect to="/user-portal" /> : <Home />}</Route>
        <Route path="/sign-in">{() => identity ? <Redirect to="/user-portal" /> : <ReplitSignIn />}</Route>
        <Route path="/sign-up">{() => <Redirect to="/sign-in" />}</Route>
        <Route path="/user-portal">{() => identity ? <Gallery identity={identity} /> : <ReplitSignIn />}</Route>
        <Route path="/simulations/new">{() => identity ? <NewSimulation identity={identity} /> : <ReplitSignIn next="/simulations/new" />}</Route>
        <Route path="/simulations/:id">{(params: { id: string }) => <Suspense fallback={<PortalLayout><main className="portal-wrap portal-section"><Skeletons /></main></PortalLayout>}>
          <ProjectWorkspace key={`${identity?.id || 'anonymous'}:${params.id}`} id={params.id} identity={identity} />
        </Suspense>}</Route>
        <Route>{() => <Redirect to="/" />}</Route>
      </Switch>}
  </AccessContext.Provider>;
}
