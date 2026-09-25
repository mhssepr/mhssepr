// =====================================================================
// mhss-rbac.js — MHSS EPR Role-Based Access Control engine
// =====================================================================
// Reads the authenticated Supabase user's role/permissions and exposes
// the four functions dashboard.html and user-roles.html already import:
//
//   initializeRBAC({ supabase })   -> Promise<RBACState|null>
//   hasModuleAccess(module, action?) -> boolean
//   isSuperAdmin()                 -> boolean
//   getRBAC()                     -> RBACState|null
//
// IMPORTANT:
// - Preserves the existing MHSS database schema.
// - Preserves the existing ES-module exports.
// - Prevents stale RBAC state from surviving a user change.
// - Resolves the authenticated Supabase session BEFORE building RBAC.
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

// =====================================================================
// MODULES
// =====================================================================

const MODULES = [
  'office',
  'finance',
  'students',
  'attendance',
  'begena',
  'equipment',
  'id_print',
  'reports',
  'events'
];

// =====================================================================
// RBAC CACHE
// =====================================================================

let _rbacState = null;
let _initPromise = null;

// Tracks which authenticated user the cached state belongs to.
// This prevents one user's RBAC state from being reused for another user.
let _rbacUserId = null;

// =====================================================================
// HELPERS
// =====================================================================

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function emptyPermissionSet() {
  const set = {};

  MODULES.forEach((m) => {
    set[m] = {
      view: false,
      add: false,
      edit: false,
      delete: false,
      print_export: false
    };
  });

  return set;
}

function fullPermissionSet() {
  const set = {};

  MODULES.forEach((m) => {
    set[m] = {
      view: true,
      add: true,
      edit: true,
      delete: true,
      print_export: true
    };
  });

  return set;
}

// =====================================================================
// STATE
// =====================================================================

function buildState({
  user,
  isSuperAdminFlag,
  profile,
  permissions
}) {
  return {
    user,

    // RBAC was resolved successfully for this authenticated session.
    allowed: true,

    email: user?.email || null,

    isSuperAdmin: !!isSuperAdminFlag,

    profile: profile || null,

    roleType:
      profile?.role_type ||
      (isSuperAdminFlag ? 'full_access' : null),

    status:
      profile?.status ||
      (isSuperAdminFlag ? 'active' : 'inactive'),

    permissions,

    // Useful for dashboard boot/identity checks.
    userId: user?.id || null,

    initializedAt: Date.now()
  };
}

// =====================================================================
// ROLE TYPE DEFAULTS
// =====================================================================

function applyRoleTypeDefaults(
  profile,
  permissions
) {
  if (
    !profile?.role_type ||
    profile.role_type === 'custom'
  ) {
    return permissions;
  }

  MODULES.forEach((m) => {

    const row = permissions[m];

    const hasExplicitRow =
      row &&
      (
        row.view ||
        row.add ||
        row.edit ||
        row.delete ||
        row.print_export
      );

    // Explicit DB permission always wins.
    if (hasExplicitRow) {
      return;
    }

    if (
      profile.role_type === 'full_access'
    ) {

      permissions[m] = {
        view: true,
        add: true,
        edit: true,
        delete: true,
        print_export: true
      };

    } else if (
      profile.role_type === 'manage'
    ) {

      permissions[m] = {
        view: true,
        add: true,
        edit: true,
        delete: false,
        print_export: true
      };

    } else if (
      profile.role_type === 'view_only'
    ) {

      permissions[m] = {
        view: true,
        add: false,
        edit: false,
        delete: false,
        print_export: false
      };
    }
  });

  return permissions;
}

// =====================================================================
// PROFILE + PERMISSIONS
// =====================================================================

async function fetchProfileAndPermissions(
  supabase,
  authUser
) {
  let profile = null;

  try {

    // ---------------------------------------------------------------
    // Primary lookup: auth user UUID
    // ---------------------------------------------------------------

    const {
      data: byId,
      error: byIdError
    } = await supabase
      .from(CONFIG.profilesTable)
      .select('*')
      .eq(
        CONFIG.profileIdColumn,
        authUser.id
      )
      .maybeSingle();

    if (byIdError) {
      console.error(
        '[RBAC] profile lookup by id failed:',
        byIdError.message
      );
    }

    profile = byId || null;

    // ---------------------------------------------------------------
    // Fallback: email
    // ---------------------------------------------------------------

    if (
      !profile &&
      authUser.email
    ) {

      const {
        data: byEmail,
        error: byEmailError
      } = await supabase
        .from(CONFIG.profilesTable)
        .select('*')
        .eq(
          CONFIG.profileEmailColumn,
          authUser.email
        )
        .maybeSingle();

      if (byEmailError) {
        console.error(
          '[RBAC] profile lookup by email failed:',
          byEmailError.message
        );
      }

      profile = byEmail || null;
    }

  } catch (err) {

    console.error(
      '[RBAC] Unexpected error loading profile:',
      err
    );
  }

  // ---------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------

  const permissions =
    emptyPermissionSet();

  const permissionKey =
    profile?.[CONFIG.profileIdColumn] ??
    authUser.id;

  try {

    const {
      data: permRows,
      error: permError
    } = await supabase
      .from(CONFIG.permissionsTable)
      .select('*')
      .eq(
        CONFIG.permissionIdColumn,
        permissionKey
      );

    if (permError) {

      console.error(
        '[RBAC] permissions lookup failed:',
        permError.message
      );

    } else if (
      Array.isArray(permRows)
    ) {

      permRows.forEach((row) => {

        const moduleName =
          row[CONFIG.moduleColumn];

        if (!moduleName) {
          return;
        }

        // Only known modules.
        if (
          !MODULES.includes(moduleName)
        ) {
          return;
        }

        permissions[moduleName] = {
          view: !!row.view,
          add: !!row.add,
          edit: !!row.edit,
          delete: !!row.delete,
          print_export: !!row.print_export
        };
      });
    }

  } catch (err) {

    console.error(
      '[RBAC] Unexpected error loading permissions:',
      err
    );
  }

  // Apply preset role defaults after DB permissions.
  applyRoleTypeDefaults(
    profile,
    permissions
  );

  return {
    profile,
    permissions
  };
}

// =====================================================================
// INITIALIZE RBAC
// =====================================================================

export async function initializeRBAC({
  supabase
}) {

  // ---------------------------------------------------------------
  // Prevent duplicate simultaneous DB requests.
  // ---------------------------------------------------------------

  if (_initPromise) {
    return _initPromise;
  }

  // ---------------------------------------------------------------
  // Start a completely new resolution.
  // Clear stale state first.
  // ---------------------------------------------------------------

  _initPromise = (async () => {

    try {

      /*
       * VERY IMPORTANT:
       *
       * Always resolve the CURRENT Supabase session first.
       *
       * This prevents a previous user's RBAC state from being
       * accidentally displayed while the new user's session loads.
       */

      const {
        data,
        error: sessionError
      } = await supabase.auth.getSession();

      const session =
        data?.session || null;

      const authUser =
        session?.user || null;

      // -------------------------------------------------------------
      // No authenticated user
      // -------------------------------------------------------------

      if (
        sessionError ||
        !authUser
      ) {

        _rbacState = null;
        _rbacUserId = null;

        return null;
      }

      // -------------------------------------------------------------
      // Current authenticated user
      // -------------------------------------------------------------

      const email =
        normalizeEmail(
          authUser.email
        );

      const currentUserId =
        authUser.id;

      // -------------------------------------------------------------
      // If a different user is now logged in,
      // destroy the previous cached state first.
      // -------------------------------------------------------------

      if (
        _rbacUserId &&
        _rbacUserId !== currentUserId
      ) {

        _rbacState = null;
      }

      _rbacUserId =
        currentUserId;

      // -------------------------------------------------------------
      // SUPER ADMIN
      // -------------------------------------------------------------
      //
      // Preserve your existing behavior:
      // mhssepr@gmail.com gets complete access.
      //
      // But the state is now associated with the CURRENT auth user,
      // so it cannot leak into another user's session.
      // -------------------------------------------------------------

      if (
        email === SUPER_ADMIN_EMAIL
      ) {

        _rbacState = buildState({
          user: authUser,

          isSuperAdminFlag: true,

          profile: null,

          permissions:
            fullPermissionSet()
        });

        return _rbacState;
      }

      // -------------------------------------------------------------
      // NORMAL USER
      // -------------------------------------------------------------

      const {
        profile,
        permissions
      } =
        await fetchProfileAndPermissions(
          supabase,
          authUser
        );

      // -------------------------------------------------------------
      // Disabled/inactive account
      // -------------------------------------------------------------

      const isDisabled =
        !!profile &&
        !!profile.status &&
        profile.status !== 'active';

      _rbacState = buildState({
        user: authUser,

        isSuperAdminFlag: false,

        profile,

        permissions:
          isDisabled
            ? emptyPermissionSet()
            : permissions
      });

      return _rbacState;

    } catch (err) {

      console.error(
        '[RBAC] initializeRBAC failed:',
        err
      );

      _rbacState = null;
      _rbacUserId = null;

      return null;

    } finally {

      /*
       * Important:
       * Allow a later refresh/login to perform a new resolution.
       */
      _initPromise = null;
    }

  })();

  return _initPromise;
}

// =====================================================================
// GET CURRENT RBAC
// =====================================================================

export function getRBAC() {
  return _rbacState;
}

// =====================================================================
// SUPER ADMIN CHECK
// =====================================================================

export function isSuperAdmin() {
  return !!_rbacState?.isSuperAdmin;
}

// =====================================================================
// MODULE ACCESS
// =====================================================================

export function hasModuleAccess(
  moduleName,
  action = 'view'
) {

  if (!moduleName) {
    return false;
  }

  // Super Admin gets everything.
  if (
    _rbacState?.isSuperAdmin
  ) {
    return true;
  }

  const perm =
    _rbacState
      ?.permissions
      ?.[
        moduleName
      ];

  return !!perm?.[action];
}

// =====================================================================
// RESET RBAC
// =====================================================================

export function resetRBAC() {

  _rbacState = null;

  _rbacUserId = null;

  _initPromise = null;
}

// =====================================================================
// OPTIONAL: CLEAR WHEN SUPABASE SIGNS OUT
// =====================================================================
//
// This does NOT create another auth listener.
// dashboard.html can continue using its existing listener.
//
// You can call:
//
//   resetRBAC();
//
// after signOut if needed.
// =====================================================================