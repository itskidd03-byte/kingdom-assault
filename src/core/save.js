/**
 * Local accounts and automatic saves.
 *
 * The game is a static build (GitHub Pages / APK), so accounts and saves live on
 * the device: passwords are salted and stretched with PBKDF2-SHA256 before they
 * are stored, and each account keeps its own campaign save.
 */

const ACCOUNT_KEY = 'ka-accounts-v1';
const SESSION_KEY = 'ka-session-v1';
const SAVE_PREFIX = 'ka-save-v1:';
const ITERATIONS = 120000;

const readJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

/** Weak fallback for browsers without WebCrypto (e.g. file://). */
function weakHash(text) {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = (h1 ^ c) * 16777619 >>> 0;
    h2 = (h2 + c * (i + 7)) * 2654435761 >>> 0;
  }
  return (h1.toString(16) + h2.toString(16)).padStart(16, '0');
}

async function derive(password, salt) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return weakHash(`${salt}:${password}`);
  try {
    const enc = new TextEncoder();
    const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
      key,
      256,
    );
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return weakHash(`${salt}:${password}`);
  }
}

const normalise = (name) => String(name || '').trim().slice(0, 18);

export class Accounts {
  static list() {
    return readJSON(ACCOUNT_KEY, []);
  }

  static current() {
    const name = localStorage.getItem(SESSION_KEY);
    return name && Accounts.list().some((a) => a.name === name) ? name : null;
  }

  static async create(name, password) {
    const clean = normalise(name);
    if (clean.length < 3) return { ok: false, reason: 'Name needs at least 3 characters' };
    if (String(password || '').length < 4) return { ok: false, reason: 'Password needs at least 4 characters' };
    const accounts = Accounts.list();
    if (accounts.some((a) => a.name.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, reason: 'That name is already taken on this device' };
    }
    const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const hash = await derive(password, salt);
    if (hash === weakHash(`${salt}:${password}`) && !globalThis.crypto?.subtle) {
      // still fine — fallback hash is consistent on this device
    }
    accounts.push({ name: clean, salt, hash, created: Date.now(), storage: hash.length === 64 ? 'pbkdf2' : 'fallback' });
    writeJSON(ACCOUNT_KEY, accounts);
    localStorage.setItem(SESSION_KEY, clean);
    return { ok: true, name: clean };
  }

  static async login(name, password) {
    const clean = normalise(name);
    const account = Accounts.list().find((a) => a.name.toLowerCase() === clean.toLowerCase());
    if (!account) return { ok: false, reason: 'No account with that name on this device' };
    const hash = await derive(password, account.salt);
    if (hash !== account.hash) return { ok: false, reason: 'Wrong password' };
    localStorage.setItem(SESSION_KEY, account.name);
    return { ok: true, name: account.name };
  }

  static logout() {
    localStorage.removeItem(SESSION_KEY);
  }
}

export class Saves {
  static key(user) { return SAVE_PREFIX + user; }

  static has(user) { return !!user && !!localStorage.getItem(Saves.key(user)); }

  static read(user) {
    if (!user) return null;
    const data = readJSON(Saves.key(user), null);
    return data && data.v === 1 ? data : null;
  }

  static write(user, data) {
    if (!user || !data) return false;
    const payload = { ...data, user, savedAt: Date.now() };
    return writeJSON(Saves.key(user), payload);
  }

  static clear(user) {
    if (user) localStorage.removeItem(Saves.key(user));
  }

  static stamp(data) {
    if (!data || !data.savedAt) return '';
    const mins = Math.floor((Date.now() - data.savedAt) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.floor(hours / 24)} d ago`;
  }

  static describe(data) {
    if (!data) return '';
    const gold = Math.round(data.kingdoms?.[0]?.resources?.gold || 0);
    const army = (data.units || []).filter((u) => u.owner === 0 && !u.isKing).length;
    const mins = Math.floor((data.time || 0) / 60);
    return `Minute ${mins} · ${army} troops · ${gold} gold`;
  }
}
