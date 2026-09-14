import { useUserRole } from '@/app/(admin)/admin/layout';
import {
  canEdit as canEditFn,
  canCreate as canCreateFn,
  canDelete as canDeleteFn,
  canEditProductDescriptors as canEditProductDescriptorsFn,
  canManageCategories as canManageCategoriesFn,
  canManageMarketing as canManageMarketingFn,
} from '@/lib/permissions';

export function usePermissions() {
  const userRole = useUserRole();
  return {
    userRole,
    canEdit: canEditFn(userRole),
    canCreate: canCreateFn(userRole),
    canDelete: canDeleteFn(userRole),
    canEditProductDescriptors: canEditProductDescriptorsFn(userRole),
    canManageCategories: canManageCategoriesFn(userRole),
    canManageMarketing: canManageMarketingFn(userRole),
  };
}
