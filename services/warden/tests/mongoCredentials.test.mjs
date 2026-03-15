import assert from 'node:assert/strict';
import test from 'node:test';

import {
    __testables__,
    resolveManagedMongoRootPassword,
    resolveManagedMongoRootUsername,
} from '../docker/mongoCredentials.mjs';

test('resolveManagedMongoRootUsername defaults to root', () => {
    assert.equal(resolveManagedMongoRootUsername({}), 'root');
    assert.equal(resolveManagedMongoRootUsername({MONGO_INITDB_ROOT_USERNAME: 'admin'}), 'admin');
});

test('resolveManagedMongoRootPassword prefers explicit environment overrides', () => {
    assert.equal(
        resolveManagedMongoRootPassword({env: {MONGO_INITDB_ROOT_PASSWORD: 'explicit-secret'}}),
        'explicit-secret',
    );
    assert.equal(
        resolveManagedMongoRootPassword({env: {NOONA_MONGO_ROOT_PASSWORD: 'legacy-secret'}}),
        'legacy-secret',
    );
});

test('resolveManagedMongoRootPassword reuses cached generated credentials', () => {
    __testables__.generatedPasswordCache.clear();
    const password = resolveManagedMongoRootPassword({
        env: {},
        generator: () => 'generated-secret',
    });

    assert.equal(password, 'generated-secret');
    assert.equal(
        resolveManagedMongoRootPassword({
            env: {},
            generator: () => {
                throw new Error('generator should not run when cache is warm');
            },
        }),
        'generated-secret',
    );
});
