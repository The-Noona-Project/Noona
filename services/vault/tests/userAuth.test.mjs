import test from 'node:test';
import assert from 'node:assert/strict';

import {
    defaultPermissionsForRole,
    MOON_OP_PERMISSION_KEYS,
    normalizePermissionList,
    sanitizeUser,
    validatePermissionListInput,
} from '../users/userAuth.mjs';

test('normalizePermissionList folds legacy Moon permissions into management permissions', () => {
    assert.deepEqual(
        normalizePermissionList([
            'moon_login',
            'lookup_new_title',
            'download_new_title',
            'check_download_missing_titles',
            'download_management',
        ]),
        ['moon_login', 'library_management', 'download_management'],
    );
});

test('validatePermissionListInput accepts legacy permission names and returns canonical ones', () => {
    assert.deepEqual(validatePermissionListInput(['moon_login', 'lookup_new_title', 'download_new_title']), {
        ok: true,
        permissions: ['moon_login', 'library_management', 'download_management'],
    });
});

test('default member permissions and sanitized legacy users use canonical management permissions', () => {
    assert.deepEqual(defaultPermissionsForRole('member'), [
        'moon_login',
        'library_management',
        'download_management',
    ]);
    assert.deepEqual(MOON_OP_PERMISSION_KEYS, [
        'moon_login',
        'library_management',
        'download_management',
        'user_management',
        'admin',
    ]);

    const sanitized = sanitizeUser({
        username: 'ReaderOne',
        role: 'member',
        permissions: ['moon_login', 'lookup_new_title', 'check_download_missing_titles'],
    });

    assert.equal(sanitized?.role, 'member');
    assert.deepEqual(sanitized?.permissions, [
        'moon_login',
        'library_management',
        'download_management',
    ]);
});
