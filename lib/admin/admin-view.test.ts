/**
 * Tests for admin view switching.
 *
 *   node --test --import tsx lib/admin/admin-view.test.ts
 *
 * The property that matters is that a view only ever NARROWS. The requested
 * view arrives from a query parameter, so anyone can ask for any of them; the
 * answer must never be a role the account did not already hold.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_VIEW_MODES,
  ADMIN_VIEW_META,
  canSwitchAdminView,
  effectiveAdminRole,
  parseAdminView,
  previewedRole,
} from './admin-view';
import { canAccessAdminPage, type UserRole } from '@/lib/permissions';

const ALL_ROLES: UserRole[] = [
  'customer', 'assistant', 'admin', 'affiliate', 'warehouse', 'analytics',
];

test('only the full-panel roles can switch view', () => {
  assert.equal(canSwitchAdminView('admin'), true);
  assert.equal(canSwitchAdminView('assistant'), true);
  for (const role of ['customer', 'affiliate', 'warehouse', 'analytics'] as UserRole[]) {
    assert.equal(canSwitchAdminView(role), false, role);
  }
});

test('an unknown or missing view falls back to the full admin panel', () => {
  assert.equal(parseAdminView(null), 'admin');
  assert.equal(parseAdminView(undefined), 'admin');
  assert.equal(parseAdminView(''), 'admin');
  assert.equal(parseAdminView('warehouse'), 'admin');
  assert.equal(parseAdminView('ADMIN'), 'admin');
  assert.equal(parseAdminView('analytics'), 'analytics');
});

test('every declared view has a label and a description', () => {
  for (const mode of ADMIN_VIEW_MODES) {
    assert.ok(ADMIN_VIEW_META[mode].label.length > 0, mode);
    assert.ok(ADMIN_VIEW_META[mode].description.length > 0, mode);
  }
});

test('an admin previewing the analytics view is treated as analytics', () => {
  assert.equal(effectiveAdminRole('admin', 'analytics'), 'analytics');
  assert.equal(effectiveAdminRole('assistant', 'analytics'), 'analytics');
  assert.equal(effectiveAdminRole('admin', 'admin'), 'admin');
});

test('a role that cannot switch keeps its own role whatever it asks for', () => {
  for (const role of ALL_ROLES) {
    if (canSwitchAdminView(role)) continue;
    for (const mode of ADMIN_VIEW_MODES) {
      assert.equal(effectiveAdminRole(role, mode), role, `${role} → ${mode}`);
    }
  }
});

test('a forged ?view= can never widen access', () => {
  for (const role of ALL_ROLES) {
    for (const raw of ['analytics', 'admin', 'ADMIN', 'warehouse', '', 'null']) {
      const previewed = previewedRole(role, raw);
      // The previewed role is either the real one, or the one narrowing it.
      assert.ok(
        previewed === role || (canSwitchAdminView(role) && previewed === 'analytics'),
        `${role} + ${raw} → ${previewed}`,
      );
      // And it reaches no page the real role could not already reach.
      for (const page of ['/admin', '/admin/analytics', '/admin/users', '/admin/settings']) {
        if (canAccessAdminPage(previewed, page)) {
          assert.ok(canAccessAdminPage(role, page), `${role} + ${raw} reached ${page}`);
        }
      }
    }
  }
});
