import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';

const Base = connectPgSimple(session);
type Stored = session.SessionData & { __loaded?: boolean };

// Same existing PostgreSQL table. Row locks coordinate all instances, not just this process.
export class CoordinatedSessionStore extends Base {
  constructor(readonly database: pg.Pool) {
    super({ pool: database, tableName: 'wss_auth_sessions', createTableIfMissing: false, disableTouch: true });
  }
  override get(sid: string, callback: (err: any, value?: session.SessionData | null) => void) {
    super.get(sid, (error, value) => callback(error, value ? { ...value, __loaded: true } as Stored : null));
  }
  async coordinate<T>(sid: string, change: (value: Stored) => Promise<T>): Promise<T | null> {
    const db = await this.database.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout = '15s'");
      const found = await db.query('SELECT sess FROM wss_auth_sessions WHERE sid=$1 AND expire>now() FOR UPDATE', [sid]);
      if (!found.rows.length) { await db.query('COMMIT'); return null; }
      const value = found.rows[0].sess as Stored;
      const result = await change(value);
      const expiry = value.account?.idleExpiresAt && value.account?.absoluteExpiresAt
        ? Math.min(value.account.idleExpiresAt, value.account.absoluteExpiresAt)
        : new Date(value.cookie.expires!).getTime();
      value.cookie.expires = new Date(expiry) as any;
      delete value.__loaded;
      await db.query('UPDATE wss_auth_sessions SET sess=$2,expire=$3 WHERE sid=$1',
        [sid, JSON.stringify(value), new Date(expiry)]);
      await db.query('COMMIT');
      return result;
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
  override set(sid: string, incoming: Stored, callback?: (err?: any) => void) {
    // express-session can finish a response after renewal or logout. Never let its
    // stale copy replace rotated credentials, extend deadlines, or recreate a deleted row.
    void (async () => {
      const updated = await this.coordinate(sid, async current => {
        if (incoming.login) current.login = incoming.login;
        else delete current.login;
        return true;
      });
      if (updated || incoming.__loaded) return;
      const value = { ...incoming }; delete value.__loaded;
      await this.database.query('INSERT INTO wss_auth_sessions(sid,sess,expire) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [sid, JSON.stringify(value), value.cookie.expires]);
    })().then(() => callback?.(), error => callback?.(error));
  }
}
