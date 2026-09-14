'use client';

import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { deleteUser } from '@/lib/admin/api';
import type { Customer } from '@/lib/supabase';

interface DeleteConfirmDialogProps {
  user: Customer;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DeleteConfirmDialog({ user, onClose, onSuccess }: DeleteConfirmDialogProps) {
  const [deleteMode, setDeleteMode] = useState<'soft' | 'hard'>('soft');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setError('');
    setLoading(true);

    const result = await deleteUser(user.id, deleteMode === 'hard');

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Failed to delete user');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-md w-full">
        {/* Header */}
        <div className="p-6 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-ink">Delete User</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm text-ink">
              You are about to delete the following user:
            </p>
            <div className="p-3 bg-surface rounded-lg">
              <p className="font-medium text-ink text-sm">{user.first_name} {user.last_name}</p>
              <p className="text-xs text-ink-muted">{user.email}</p>
              <p className="text-xs text-ink-muted mt-1">Role: {user.role}</p>
            </div>
          </div>

          {/* Delete Mode */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-ink">Select deletion type:</p>

            <label className="flex items-start gap-3 p-3 border border-line rounded-lg cursor-pointer hover:bg-surface transition-colors">
              <input
                type="radio"
                name="deleteMode"
                value="soft"
                checked={deleteMode === 'soft'}
                onChange={(e) => setDeleteMode('soft')}
                className="mt-0.5"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-ink">Deactivate (Recommended)</p>
                <p className="text-xs text-ink-muted mt-0.5">
                  User account will be deactivated but data is preserved. Can be reactivated later.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 border border-red-200 rounded-lg cursor-pointer hover:bg-red-50 transition-colors">
              <input
                type="radio"
                name="deleteMode"
                value="hard"
                checked={deleteMode === 'hard'}
                onChange={(e) => setDeleteMode('hard')}
                className="mt-0.5"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-600">Permanent Delete</p>
                <p className="text-xs text-red-600/80 mt-0.5">
                  User and all associated data will be permanently deleted. This action cannot be undone.
                </p>
              </div>
            </label>
          </div>

          {deleteMode === 'hard' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs text-amber-700">
                ⚠️ Warning: This will permanently delete all user data including order history. Make sure you have a backup if needed.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg text-sm font-medium hover:bg-line transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={loading}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                deleteMode === 'hard'
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-amber-500 hover:bg-amber-600 text-white'
              }`}
            >
              {loading
                ? 'Processing...'
                : deleteMode === 'hard'
                ? 'Permanently Delete'
                : 'Deactivate User'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
