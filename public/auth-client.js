// The site's four same-origin OTP routes work with either managed or local auth.
export function createSiteAuthClient(base = '/api/auth', fetcher = fetch) {
    async function invoke(path, data) {
        try {
            const response = await fetcher(`${base}/${path}`, { method: data === undefined ? 'GET' : 'POST',
                credentials: 'same-origin', cache: 'no-store',
                ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
            const result = await response.json();
            return response.ok ? { data: result, error: null }
                : { data: null, error: { status: response.status, message: result.error || result.message || '请求失败，请稍后再试' } };
        } catch { return { data: null, error: { message: '登录服务暂时不可用，请稍后重试' } }; }
    }
    return { getSession: () => invoke('get-session'), signOut: () => invoke('sign-out', {}),
        emailOtp: { sendVerificationOtp: data => invoke('email-otp/send-verification-otp', data) },
        signIn: { emailOtp: data => invoke('sign-in/email-otp', data) } };
}
