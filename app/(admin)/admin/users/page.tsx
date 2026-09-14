'use client';

import React, { useState, useEffect } from 'react';
import { Search, Filter, UserPlus, Pencil, Trash2, Power, PowerOff, Users } from 'lucide-react';
import { getUsers, toggleUserActive, deleteUser } from '@/lib/admin/api';
import { useUserRole } from '../layout';
import { canEdit, getRoleBadgeClasses, getRoleName } from '@/lib/permissions';
import type { Customer } from '@/lib/supabase';
import CreateUserModal from './_components/CreateUserModal';
import EditUserModal from './_components/EditUserModal';
import DeleteConfirmDialog from './_components/DeleteConfirmDialog';

export default function UsersPage() {
  const userRole = useUserRole();
  const [users, setUsers] = useState<Customer[]>([]);
  const [filtered, setFiltered] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'customer' | 'analytics' | 'assistant' | 'admin'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | boolean>('all');
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<Customer | null>(null);
  const [deletingUser, setDeletingUser] = useState<Customer | null>(null);

  // Action states
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    filterUsers();
  }, [users, search, roleFilter, statusFilter]);

  const loadUsers = async () => {
    setLoading(true);
    const data = await getUsers();
    setUsers(data);
    setLoading(false);
  };

  const filterUsers = () => {
    let result = users;

    // Apply role filter
    if (roleFilter !== 'all') {
      result = result.filter(u => u.role === roleFilter);
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter(u => u.active === statusFilter);
    }

    // Apply search filter
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(u =>
        u.email.toLowerCase().includes(q) ||
        u.first_name.toLowerCase().includes(q) ||
        u.last_name.toLowerCase().includes(q)
      );
    }

    setFiltered(result);
  };

  const handleToggleActive = async (userId: string, currentActive: boolean) => {
    setTogglingId(userId);
    await toggleUserActive(userId, !currentActive);
    await loadUsers();
    setTogglingId(null);
  };

  const handleUserCreated = () => {
    setShowCreateModal(false);
    loadUsers();
  };

  const handleUserUpdated = () => {
    setEditingUser(null);
    loadUsers();
  };

  const handleUserDeleted = () => {
    setDeletingUser(null);
    loadUsers();
  };

  const getStatusBadge = (active: boolean) => {
    if (active) {
      return (
        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400">
          Active
        </span>
      );
    }
    return (
      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400">
        Inactive
      </span>
    );
  };

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">User Management</h1>
          <p className="text-sm text-ink-muted mt-1">Create and manage user accounts</p>
        </div>
        {canEdit(userRole) && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 bg-ink text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="pl-10 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 appearance-none"
          >
            <option value="all">All Roles</option>
            <option value="customer">Customer</option>
            <option value="analytics">Analytics</option>
            <option value="assistant">Assistant</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="relative">
          <select
            value={statusFilter === 'all' ? 'all' : statusFilter ? 'active' : 'inactive'}
            onChange={(e) => setStatusFilter(e.target.value === 'all' ? 'all' : e.target.value === 'active')}
            className="pl-4 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 appearance-none"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Stat chips */}
      <div className="flex flex-wrap gap-4 mb-6 text-sm">
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <Users className="w-4 h-4 text-ink-muted" />
          <span className="text-ink font-semibold">{users.length}</span>
          <span className="text-ink-muted">total</span>
        </div>
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-emerald-500 font-semibold tabular-nums">{users.filter(u => u.active).length}</span>
          <span className="text-ink-muted">active</span>
        </div>
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-red-500 font-semibold tabular-nums">{users.filter(u => !u.active).length}</span>
          <span className="text-ink-muted">inactive</span>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="p-5 md:p-6 border-b border-line flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Users</h2>
          <span className="text-sm text-ink-muted">{filtered.length} shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-line">
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">User</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Phone</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Role</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Joined</th>
                {canEdit(userRole) && (
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <tr>
                  <td colSpan={canEdit(userRole) ? 6 : 5} className="px-5 py-12 text-center text-ink-muted text-sm">
                    Loading users...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={canEdit(userRole) ? 6 : 5} className="px-5 py-12 text-center text-ink-muted text-sm">
                    {search || roleFilter !== 'all' || statusFilter !== 'all' ? 'No users match your filters' : 'No users yet'}
                  </td>
                </tr>
              ) : (
                filtered.map((user) => (
                  <tr key={user.id} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-medium text-ink text-sm">{user.first_name} {user.last_name}</div>
                      <div className="text-xs text-ink-muted">{user.email}</div>
                    </td>
                    <td className="px-5 py-4 text-sm text-ink-muted">{user.phone || '-'}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${getRoleBadgeClasses(user.role)}`}>
                        {getRoleName(user.role)}
                      </span>
                    </td>
                    <td className="px-5 py-4">{getStatusBadge(user.active)}</td>
                    <td className="px-5 py-4 text-sm text-ink-muted">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    {canEdit(userRole) && (
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingUser(user)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                            title="Edit user"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(user.id, user.active)}
                            disabled={togglingId === user.id}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
                              user.active
                                ? 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'
                                : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'
                            }`}
                            title={user.active ? 'Deactivate user' : 'Activate user'}
                          >
                            {user.active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => setDeletingUser(user)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Delete user"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleUserCreated}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSuccess={handleUserUpdated}
        />
      )}

      {deletingUser && (
        <DeleteConfirmDialog
          user={deletingUser}
          onClose={() => setDeletingUser(null)}
          onSuccess={handleUserDeleted}
        />
      )}
    </>
  );
}
