import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuthService,
  getAuthErrorMessage,
  isValidEmail,
  parseRecoveryInput,
} from '../src/services/authServiceCore.ts';
import { createChunkedStorage } from '../src/services/chunkedStorage.ts';
import {
  canAccessScreen,
  getRegisteredScreens,
  PROTECTED_SCREENS,
} from '../src/navigation/routeAccess.ts';

const makeSession = ({ email = 'person@example.com', confirmed = true } = {}) => ({
  user: {
    id: 'user-1',
    email,
    email_confirmed_at: confirmed ? '2026-01-01T00:00:00.000Z' : null,
  },
  expires_at: 1999999999,
});

class FakeAuth {
  constructor() {
    this.mode = 'confirm'; // 'confirm' => signUp requires email confirmation
    this.session = null;
    this.calls = [];
    this.listeners = new Set();
    this.signOutGlobalError = null;
    this.password = null;
  }

  emit(event, session) {
    for (const listener of this.listeners) listener(event, session);
  }

  async signUp({ email, password }) {
    this.calls.push(['signUp', email, password]);
    if (email === 'taken@example.com') {
      return {
        data: { user: null, session: null },
        error: { message: 'User already registered' },
      };
    }
    if (this.mode === 'session') {
      this.session = makeSession({ email });
      this.emit('SIGNED_IN', this.session);
      return { data: { user: this.session.user, session: this.session }, error: null };
    }
    return {
      data: { user: makeSession({ email }).user, session: null },
      error: null,
    };
  }

  async signInWithPassword({ email, password }) {
    this.calls.push(['signIn', email, password]);
    if (password !== 'CorrectPass1!') {
      return {
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      };
    }
    this.session = makeSession({ email });
    this.emit('SIGNED_IN', this.session);
    return { data: { user: this.session.user, session: this.session }, error: null };
  }

  async signOut(options = {}) {
    const scope = options.scope ?? 'global';
    this.calls.push(['signOut', scope]);
    if (scope === 'global' && this.signOutGlobalError) {
      return { error: { message: this.signOutGlobalError } };
    }
    this.session = null;
    this.emit('SIGNED_OUT', null);
    return { error: null };
  }

  async getSession() {
    return { data: { session: this.session }, error: null };
  }

  async resetPasswordForEmail(email) {
    this.calls.push(['resetPasswordForEmail', email]);
    return { data: {}, error: null };
  }

  async verifyOtp(params) {
    this.calls.push(['verifyOtp', params]);
    if (params.token === '000000' || params.token_hash === 'bad') {
      return {
        data: { user: null, session: null },
        error: { message: 'Token has expired or is invalid' },
      };
    }
    this.session = makeSession();
    this.emit('PASSWORD_RECOVERY', this.session);
    return { data: { user: this.session.user, session: this.session }, error: null };
  }

  async updateUser({ password }) {
    this.calls.push(['updateUser', password]);
    this.password = password;
    return { data: {}, error: null };
  }

  async setSession(tokens) {
    this.calls.push(['setSession', tokens]);
    this.session = makeSession();
    return { data: { user: this.session.user, session: this.session }, error: null };
  }

  onAuthStateChange(callback) {
    this.listeners.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe: () => this.listeners.delete(callback),
        },
      },
    };
  }
}

test('registration reports that email confirmation is required', async () => {
  const auth = new FakeAuth();
  const service = createAuthService(auth);

  const result = await service.signUp('new@example.com', 'Passw0rd!');

  assert.equal(result.session, null);
  assert.equal(result.needsEmailConfirmation, true);
});

test('registration signs the user in immediately when confirmation is disabled', async () => {
  const auth = new FakeAuth();
  auth.mode = 'session';
  const service = createAuthService(auth);

  const result = await service.signUp('new@example.com', 'Passw0rd!');

  assert.equal(result.needsEmailConfirmation, false);
  assert.equal(result.session.user.email, 'new@example.com');
  assert.equal(result.session.user.emailConfirmed, true);
});

test('login returns a session and maps invalid credentials', async () => {
  const auth = new FakeAuth();
  const service = createAuthService(auth);

  const result = await service.signIn('person@example.com', 'CorrectPass1!');
  assert.equal(result.session.user.id, 'user-1');

  await assert.rejects(
    () => service.signIn('person@example.com', 'wrong'),
    (error) => {
      assert.equal(
        getAuthErrorMessage(error),
        'Incorrect email or password. Please try again.'
      );
      return true;
    }
  );
});

test('logout clears the session and falls back to local scope on network failure', async () => {
  const auth = new FakeAuth();
  auth.session = makeSession();
  auth.signOutGlobalError = 'Failed to fetch';
  const service = createAuthService(auth);

  await service.signOut();

  const scopes = auth.calls
    .filter((call) => call[0] === 'signOut')
    .map((call) => call[1]);
  assert.deepEqual(scopes, ['global', 'local']);
  assert.equal(auth.session, null);
});

test('persisted sessions are restored after an app restart', async () => {
  const auth = new FakeAuth();
  auth.session = makeSession({ email: 'restored@example.com' });
  const service = createAuthService(auth);

  const restored = await service.getSession();

  assert.equal(restored.user.email, 'restored@example.com');
  assert.equal(restored.user.emailConfirmed, true);
});

test('chunked secure storage round-trips long sessions and removes every chunk', async () => {
  const backing = new Map();
  const store = {
    async getItemAsync(key) {
      return backing.has(key) ? backing.get(key) : null;
    },
    async setItemAsync(key, value) {
      backing.set(key, value);
    },
    async deleteItemAsync(key) {
      backing.delete(key);
    },
  };

  const chunked = createChunkedStorage(store, 10);
  const value = `session-${'x'.repeat(95)}`;

  await chunked.setItem('evidencevault-auth', value);

  assert.equal(await chunked.getItem('evidencevault-auth'), value);
  const chunkKeys = [...backing.keys()].filter((key) =>
    key.startsWith('evidencevault-auth.chunk.')
  );
  assert.ok(chunkKeys.length >= 10, 'value should span multiple chunks');

  await chunked.removeItem('evidencevault-auth');

  assert.equal(await chunked.getItem('evidencevault-auth'), null);
  assert.equal(
    [...backing.keys()].filter((key) => key.startsWith('evidencevault-auth')).length,
    0
  );
});

test('chunked secure storage splits multi-byte text without exceeding the byte limit', async () => {
  const backing = new Map();
  const store = {
    async getItemAsync(key) {
      return backing.has(key) ? backing.get(key) : null;
    },
    async setItemAsync(key, value) {
      backing.set(key, value);
    },
    async deleteItemAsync(key) {
      backing.delete(key);
    },
  };

  const chunked = createChunkedStorage(store, 16);
  const value = JSON.stringify({ email: 'tést+emoji😀@example.com', token: 'x'.repeat(40) });
  const byteLength = (text) =>
    [...text].reduce((total, char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      if (codePoint <= 0x7f) return total + 1;
      if (codePoint <= 0x7ff) return total + 2;
      if (codePoint <= 0xffff) return total + 3;
      return total + 4;
    }, 0);

  await chunked.setItem('evidencevault-auth', value);

  const chunkValues = [...backing.entries()]
    .filter(([key]) => key.startsWith('evidencevault-auth.chunk.'))
    .map(([, chunk]) => chunk);

  assert.ok(chunkValues.length > 1);
  for (const chunk of chunkValues) {
    assert.ok(byteLength(chunk) <= 16, 'chunk must fit the byte budget');
  }
  assert.equal(await chunked.getItem('evidencevault-auth'), value);
});

test('recovery input accepts an OTP, a token_hash link, and implicit tokens', () => {
  assert.equal(parseRecoveryInput('123456').token, '123456');

  const link = parseRecoveryInput(
    'https://project.supabase.co/auth/v1/verify?token=abcdefghijklmnop&type=recovery&redirect_to=x'
  );
  assert.equal(link.tokenHash, 'abcdefghijklmnop');

  const redirect = parseRecoveryInput(
    'evidencevault://reset#access_token=access-1&refresh_token=refresh-1&type=recovery'
  );
  assert.equal(redirect.accessToken, 'access-1');
  assert.equal(redirect.refreshToken, 'refresh-1');

  assert.deepEqual(parseRecoveryInput('not a token'), {});
});

test('password recovery verifies the code, updates the password, and clears the recovery session', async () => {
  const auth = new FakeAuth();
  const events = [];
  const service = createAuthService(auth);
  service.onAuthStateChange((session, event) => events.push([event, session]));

  await service.completeRecovery(
    'person@example.com',
    '123456',
    'NewPassw0rd!'
  );

  assert.equal(auth.password, 'NewPassw0rd!');
  assert.equal(auth.session, null);

  const callTypes = auth.calls.map((call) => call[0]);
  assert.deepEqual(callTypes.slice(0, 2), ['verifyOtp', 'updateUser']);
  assert.equal(callTypes[callTypes.length - 1], 'signOut');
  assert.deepEqual(
    events.map((event) => event[0]),
    ['PASSWORD_RECOVERY', 'SIGNED_OUT']
  );
});

test('password recovery rejects an expired or invalid code', async () => {
  const auth = new FakeAuth();
  const service = createAuthService(auth);

  await assert.rejects(
    () => service.completeRecovery('person@example.com', '000000', 'NewPassw0rd!'),
    (error) => {
      assert.equal(
        getAuthErrorMessage(error),
        'That recovery code is invalid or has expired. Request a new email.'
      );
      return true;
    }
  );
});

test('password reset requests trim the email address', async () => {
  const auth = new FakeAuth();
  const service = createAuthService(auth);

  await service.requestPasswordReset(' person@example.com ');

  assert.deepEqual(auth.calls[0], ['resetPasswordForEmail', 'person@example.com']);
});

test('protected screens are only registered and reachable when authenticated', () => {
  assert.deepEqual(getRegisteredScreens(false), ['WelcomeVault']);
  assert.ok(getRegisteredScreens(true).includes('Dashboard'));

  for (const screen of PROTECTED_SCREENS) {
    assert.equal(canAccessScreen(screen, false), false, `${screen} must be protected`);
    assert.equal(canAccessScreen(screen, true), true, `${screen} must open when signed in`);
  }

  assert.equal(canAccessScreen('WelcomeVault', false), true);
});

test('auth state subscriptions can be removed', () => {
  const auth = new FakeAuth();
  const service = createAuthService(auth);
  let count = 0;

  const subscription = service.onAuthStateChange(() => {
    count += 1;
  });
  auth.emit('SIGNED_IN', makeSession());
  assert.equal(count, 1);

  subscription.unsubscribe();
  auth.emit('SIGNED_OUT', null);
  assert.equal(count, 1);
});

test('validation and error messages are human readable', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('not-an-email'), false);

  assert.equal(
    getAuthErrorMessage(new Error('Email not confirmed')),
    'Please confirm your email address before signing in. Check your inbox for the confirmation link.'
  );
  assert.equal(
    getAuthErrorMessage(new Error('Failed to fetch')),
    'Network error. Check your internet connection and try again.'
  );
  assert.equal(
    getAuthErrorMessage(new Error('Email rate limit exceeded')),
    'Too many attempts. Please wait a moment and try again.'
  );
});
