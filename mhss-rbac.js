// =====================================================================
// mhss-rbac.js — MHSS EPR Role-Based Access Control engine
// =====================================================================
// Reads the authenticated Supabase user's role/permissions and exposes
// the four functions dashboard.html and user-roles.html already import:
//
//   initializeRBAC({ supabase })   -> Promise<RBACState|null>
//   hasModuleAccess(module, action?) -> boolean   (action defaults to 'view')
//   isSuperAdmin()                 -> boolean
//   getRBAC()                      -> RBACState|null (last resolved snapshot)
//
// SCHEMA ASSUMPTION (no SQL file was provided, so this is inferred
// directly from the real queries already in your user-roles.html):
//
//   table: mhss_user_profiles
//     user_id (uuid, PK, = auth.users.id)
//     name, email, sunday_school_work, role_type, status, created_at
//
//   table: mhss_user_permissions
//     user_id (uuid, FK -> mhss_user_profiles.user_id)
//     module (text: office | finance | students | attendance | begena | equipment | reports)
//     view, add, edit, delete, print_export (bool)
//
// If your actual table/column names differ, change ONLY the CONFIG
// block below — nothing else in this file needs to change.
// =====================================================================

const SUPER_ADMIN_EMAIL = 'mhssepr@gmail.com';

const CONFIG = {
  profilesTable: 'mhss_user_profiles',
  permissionsTable: 'mhss_user_permissions',
  profileIdColumn: 'user_id',
  profileEmailColumn: 'email',
  permissionIdColumn: 'user_id',
  moduleColumn: 'module',
};

const MODULES = ['office', 'finance', 'students', 'attendance', 'begena', 'equipment', 'reports'];

// Module-level cache so every page that imports this file shares one
// resolved state, and calling initializeRBAC() more than once (e.g. a
// stray duplicate call) never re-runs the DB round trip.
let _rbacState = null;
let _initPromise = null;

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function emptyPermissionSet() {
  const set = {};
  MODULES.forEach((m) => {
    set[m] = { view: false, add: false, edit: false, delete: false, print_export: false };
  });
  return set;
}

function fullPermissionSet() {
  const set = {};
  MODULES.forEach((m) => {
    set[m] = { view: true, add: true, edit: true, delete: true, print_export: true };
  });
  return set;
}

function buildState({ user, isSuperAdminFlag, profile, permissions }) {
  return {
    user,
    // user-roles.html gates entry on `r?.allowed && isSuperAdmin()`. `allowed`
    // simply means "RBAC resolved successfully for a valid session" — the
    // super-admin gate itself is `isSuperAdmin()`. Reaching this point always
    // means resolution succeeded, so this is always true here.
    allowed: true,
    email: user?.email || null,
    isSuperAdmin: !!isSuperAdminFlag,
    profile: profile || null,
    roleType: profile?.role_type || (isSuperAdminFlag ? 'full_access' : null),
    status: profile?.status || (isSuperAdminFlag ? 'active' : 'inactive'),
    permissions,
  };
}

// Expands a role_type (full_access / manage / view_only) across every
// module that doesn't already have an explicit permissions row, matching
// the Role Type behavior defined in user-roles.html's collectPayload().
// A 'custom' role_type is left untouched — its explicit rows already are
// the source of truth.
function applyRoleTypeDefaults(profile, permissions) {
  if (!profile?.role_type || profile.role_type === 'custom') return permissions;

  MODULES.forEach((m) => {
    const row = permissions[m];
    const hasExplicitRow = row && (row.view || row.add || row.edit || row.delete || row.print_export);
    if (hasExplicitRow) return; // an explicit row always wins

    if (profile.role_type === 'full_access') {
      permissions[m] = { view: true, add: true, edit: true, delete: true, print_export: true };
    } else if (profile.role_type === 'manage') {
      permissions[m] = { view: true, add: true, edit: true, delete: false, print_export: true };
    } else if (profile.role_type === 'view_only') {
      permissions[m] = { view: true, add: false, edit: false, delete: false, print_export: false };
    }
  });

  return permissions;
}

async function fetchProfileAndPermissions(supabase, authUser) {
  let profile = null;

  try {
    const { data: byId, error: byIdError } = await supabase
      .from(CONFIG.profilesTable)
      .select('*')
      .eq(CONFIG.profileIdColumn, authUser.id)
      .maybeSingle();

    if (byIdError) console.error('[RBAC] profile lookup by id failed:', byIdError.message);
    profile = byId || null;

    // Fallback for setups that link the profile row by email instead of uid.
    if (!profile && authUser.email) {
      const { data: byEmail, error: byEmailError } = await supabase
        .from(CONFIG.profilesTable)
        .select('*')
        .eq(CONFIG.profileEmailColumn, authUser.email)
        .maybeSingle();
      if (byEmailError) console.error('[RBAC] profile lookup by email failed:', byEmailError.message);
      profile = byEmail || null;
    }
  } catch (err) {
    console.error('[RBAC] Unexpected error loading profile:', err);
  }

  const permissions = emptyPermissionSet();
  const permissionKey = profile?.[CONFIG.profileIdColumn] ?? authUser.id;

  try {
    const { data: permRows, error: permError } = await supabase
      .from(CONFIG.permissionsTable)
      .select('*')
      .eq(CONFIG.permissionIdColumn, permissionKey);

    if (permError) {
      console.error('[RBAC] permissions lookup failed:', permError.message);
    } else if (Array.isArray(permRows)) {
      permRows.forEach((row) => {
        const moduleName = row[CONFIG.moduleColumn];
        if (!moduleName) return;
        permissions[moduleName] = {
          view: !!row.view,
          add: !!row.add,
          edit: !!row.edit,
          delete: !!row.delete,
          print_export: !!row.print_export,
        };
      });
    }
  } catch (err) {
    console.error('[RBAC] Unexpected error loading permissions:', err);
  }

  applyRoleTypeDefaults(profile, permissions);
  return { profile, permissions };
}

export async function initializeRBAC({ supabase }) {
  // Coalesce concurrent/duplicate calls onto a single in-flight request.
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      const session = data?.session;

      if (sessionError || !session?.user) {
        _rbacState = null;
        return null;
      }

      const authUser = session.user;
      const email = normalizeEmail(authUser.email);

      if (email === SUPER_ADMIN_EMAIL) {
        // Super Admin is granted full access unconditionally. This check
        // happens BEFORE any database lookup, so a missing profile row,
        // a bad permissions row, or a DB error can never lock this
        // account out, downgrade it, or hide User Roles from it.
        _rbacState = buildState({
          user: authUser,
          isSuperAdminFlag: true,
          profile: null,
          permissions: fullPermissionSet(),
        });
        return _rbacState;
      }

      const { profile, permissions } = await fetchProfileAndPermissions(supabase, authUser);

      // A disabled account is authenticated but has no module access.
      const isDisabled = !!profile && profile.status && profile.status !== 'active';

      _rbacState = buildState({
        user: authUser,
        isSuperAdminFlag: false,
        profile,
        permissions: isDisabled ? emptyPermissionSet() : permissions,
      });
      return _rbacState;
    } catch (err) {
      console.error('[RBAC] initializeRBAC failed:', err);
      _rbacState = null;
      return null;
    }
  })();

  return _initPromise;
}

export function getRBAC() {
  return _rbacState;
}

export function isSuperAdmin() {
  return !!_rbacState?.isSuperAdmin;
}

export function hasModuleAccess(moduleName, action = 'view') {
  if (!moduleName) return false;
  if (_rbacState?.isSuperAdmin) return true;
  const perm = _rbacState?.permissions?.[moduleName];
  return !!perm?.[action];
}

// Not used by the existing pages today, but exposed in case you ever want
// to force a re-read (e.g. right after User Roles saves a change to the
// currently-logged-in account) without a full page reload.
export function resetRBAC() {
  _rbacState = null;
  _initPromise = null;
}