import 'dotenv/config';

async function runAdminPlatformTests() {
    const BASE = 'http://localhost:5001';
    let passed = 0;

    function check(label, condition) {
        if (condition) {
            console.log(`  ✅ ${label}`);
            passed++;
        } else {
            throw new Error(`FAIL: ${label}`);
        }
    }

    console.log('\n[1] Guest user removal test...');
    // Attempt login without password (previous guest login pattern)
    const guestRes = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'UnregisteredGuest', level: 'A2' })
    });
    const guestData = await guestRes.json();
    check('Login without password rejected (400)', guestRes.status === 400);
    check('Error message asks for password', guestData.error.includes('Password is required'));

    // Attempt login with invalid credentials
    const fakeRes = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'nonexistent@example.com', password: 'Password@123' })
    });
    check('Nonexistent user rejected (404)', fakeRes.status === 404);

    console.log('\n[2] Checking @tanim Super Admin privileges...');
    const { default: mongoose } = await import('mongoose');
    const { default: User } = await import('../src/models/User.js');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tanim_german');

    const tanim = await User.findOne({
        $or: [{ nickname: 'tanim' }, { email: 'tanim.barca@gmail.com' }]
    });
    check('User @tanim exists in DB', !!tanim);
    check('@tanim has role superadmin', tanim?.role === 'superadmin');
    check('@tanim is verified', tanim?.isVerified === true);

    console.log('\n[3] Testing Admin API access control...');
    // Create a regular learner user
    const ts = Date.now();
    const testUserEmail = `learner_${ts}@example.com`;
    const testUserPass = 'Learner@1234';
    const testUserNick = `lrn_${String(ts).slice(-4)}`;

    const regRes = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testUserEmail, password: testUserPass, nickname: testUserNick })
    });
    const regData = await regRes.json();
    const testUserId = regData.userId;
    check('Regular learner created', regRes.status === 201);

    // Regular user tries to access /api/admin/stats
    const unauthorizedRes = await fetch(`${BASE}/api/admin/stats`, {
        headers: { 'X-User-Id': testUserId }
    });
    check('Regular user blocked from /api/admin/stats (403)', unauthorizedRes.status === 403);

    // Superadmin @tanim accesses /api/admin/stats
    const statsRes = await fetch(`${BASE}/api/admin/stats`, {
        headers: { 'X-User-Id': tanim.userId }
    });
    const statsData = await statsRes.json();
    check('Superadmin accesses /api/admin/stats (200)', statsRes.status === 200);
    check('Stats includes total users', typeof statsData.users?.total === 'number');
    check('Stats includes active24h', typeof statsData.users?.active24h === 'number');
    check('Stats includes verifiedRate', typeof statsData.users?.verifiedRate === 'number');
    check('Stats includes system activeModel', !!statsData.system?.activeModel);

    console.log('\n[4] Testing User Directory & ZERO PASSWORD exposure...');
    const usersRes = await fetch(`${BASE}/api/admin/users`, {
        headers: { 'X-User-Id': tanim.userId }
    });
    const usersData = await usersRes.json();
    check('Superadmin accesses /api/admin/users (200)', usersRes.status === 200);
    check('Users directory returns array', Array.isArray(usersData.users));

    // Verify ZERO password fields exist in the returned objects
    for (const u of usersData.users) {
        if ('passwordHash' in u || 'passwordSalt' in u || 'passwordResetCode' in u || 'verificationCode' in u) {
            throw new Error(`SECURITY BREACH: Password or sensitive field found in user payload for ${u.nickname}`);
        }
    }
    check('Zero password/hash/code fields exposed across all users', true);

    console.log('\n[5] Testing Super Admin protection rules...');
    // Attempt to delete @tanim
    const delTanimRes = await fetch(`${BASE}/api/admin/user/${tanim.userId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': tanim.userId }
    });
    check('Cannot delete Super Admin (403 or 400)', delTanimRes.status === 403 || delTanimRes.status === 400);

    // Attempt to demote @tanim
    const demoteRes = await fetch(`${BASE}/api/admin/user/${tanim.userId}/role`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-User-Id': tanim.userId
        },
        body: JSON.stringify({ role: 'user' })
    });
    check('Cannot demote primary Super Admin @tanim (403)', demoteRes.status === 403);

    console.log('\n[6] Testing role promotion & deletion on regular user...');
    // Promote test user to admin
    const promoteRes = await fetch(`${BASE}/api/admin/user/${testUserId}/role`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-User-Id': tanim.userId
        },
        body: JSON.stringify({ role: 'admin' })
    });
    const promoteData = await promoteRes.json();
    check('Promote user to admin succeeds (200)', promoteRes.status === 200 && promoteData.user?.role === 'admin');

    // Force verify test user
    const verifyRes = await fetch(`${BASE}/api/admin/user/${testUserId}/verify`, {
        method: 'POST',
        headers: { 'X-User-Id': tanim.userId }
    });
    check('Force verify user succeeds (200)', verifyRes.status === 200);

    // Admin reset password for test user
    const adminResetRes = await fetch(`${BASE}/api/admin/user/${testUserId}/reset-password`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-User-Id': tanim.userId
        },
        body: JSON.stringify({ newPassword: 'AdminOverride@999' })
    });
    const adminResetData = await adminResetRes.json();
    check('Admin password reset succeeds (200)', adminResetRes.status === 200 && adminResetData.success);

    // Delete test user
    const delRes = await fetch(`${BASE}/api/admin/user/${testUserId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': tanim.userId }
    });
    check('Delete test user succeeds (200)', delRes.status === 200);

    await mongoose.disconnect();

    console.log(`\n============================================================`);
    console.log(`🎉  ALL ${passed} SAAS ADMIN & RBAC TESTS PASSED SUCCESSFULLY!`);
    console.log(`============================================================\n`);
}

runAdminPlatformTests().catch(err => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
});
