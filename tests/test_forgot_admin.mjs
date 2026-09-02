import 'dotenv/config';

async function testForgotAndAdmin() {
    const BASE = 'http://localhost:5001';
    const ts = Date.now();
    const email = `reset_test_${ts}@example.com`;
    const pass = 'Initial@1234';
    const newPass = 'Updated@5678';
    const nick = `rst_${String(ts).slice(-4)}`;

    console.log('[1] Registering user for test...');
    const regRes = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass, nickname: nick })
    });
    const regData = await regRes.json();
    console.log('Register response:', regRes.status, regData);
    if (regRes.status !== 201) throw new Error('Registration failed');

    console.log('\n[2] Requesting forgot-password...');
    const fpRes = await fetch(`${BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const fpData = await fpRes.json();
    console.log('Forgot-password response:', fpRes.status, fpData);
    if (fpRes.status !== 200 || !fpData.success) throw new Error('Forgot password request failed');

    // Fetch user from DB using mongoose to retrieve reset OTP
    const { default: mongoose } = await import('mongoose');
    const { default: User } = await import('../src/models/User.js');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tanim_german');
    const userInDb = await User.findOne({ email }).select('+passwordResetCode');
    const resetOtp = userInDb.passwordResetCode;
    console.log(`Found reset OTP in DB: ${resetOtp}`);

    console.log('\n[3] Submitting reset-password...');
    const resetRes = await fetch(`${BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: resetOtp, newPassword: newPass })
    });
    const resetData = await resetRes.json();
    console.log('Reset-password response:', resetRes.status, resetData);
    if (resetRes.status !== 200 || !resetData.success) throw new Error('Password reset failed');

    console.log('\n[4] Logging in with new password...');
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email, password: newPass })
    });
    const loginData = await loginRes.json();
    console.log('Login response:', loginRes.status, loginData.nickname);
    if (loginRes.status !== 200) throw new Error('Login with new password failed');

    console.log('\n[5] Testing Admin API endpoint (GET /api/admin/users)...');
    const adminSecret = process.env.ADMIN_SECRET;
    const adminGetRes = await fetch(`${BASE}/api/admin/users`, {
        headers: { 'X-Admin-Secret': adminSecret }
    });
    const adminGetData = await adminGetRes.json();
    console.log(`Admin user count: ${adminGetData.total}`);
    if (adminGetRes.status !== 200) throw new Error('Admin GET failed');

    console.log('\n[6] Testing Admin API endpoint (DELETE /api/admin/user/:query)...');
    const adminDelRes = await fetch(`${BASE}/api/admin/user/${email}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Secret': adminSecret }
    });
    const adminDelData = await adminDelRes.json();
    console.log('Admin DELETE response:', adminDelRes.status, adminDelData);
    if (adminDelRes.status !== 200 || !adminDelData.success) throw new Error('Admin DELETE failed');

    await mongoose.disconnect();
    console.log('\n🎉 ALL FORGOT PASSWORD & ADMIN API TESTS PASSED!\n');
}

testForgotAndAdmin().catch(e => {
    console.error('Test error:', e);
    process.exit(1);
});
